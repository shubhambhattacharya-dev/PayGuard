import type { PayPalClient } from './client.js';

export interface PayPalWebhookConfig {
  readonly client: PayPalClient;
  readonly webhookIds: readonly string[];
}

export interface PayPalWebhookHeaders {
  readonly authAlgo?: string | undefined;
  readonly certUrl?: string | undefined;
  readonly transmissionId?: string | undefined;
  readonly transmissionSig?: string | undefined;
  readonly transmissionTime?: string | undefined;
}

export interface PayPalWebhookEvent {
  readonly id?: string;
  readonly event_type?: string;
  readonly event_version?: string;
  readonly resource_type?: string;
  readonly resource?: {
    readonly id?: string;
    readonly status?: string;
    readonly reference_id?: string;
    readonly custom_id?: string;
    readonly supplementary_data?: {
      readonly related_ids?: {
        readonly order_id?: string;
      };
    };
  };
}

export interface WebhookVerifyInput {
  readonly headers: PayPalWebhookHeaders;
  readonly event: unknown;
  readonly rawEventBody?: string;
}

export type WebhookVerifyOutcome =
  | { readonly verified: true; readonly event: PayPalWebhookEvent }
  | {
      readonly verified: false;
      readonly reason:
        | 'MISSING_HEADERS'
        | 'MALFORMED_EVENT'
        | 'CERT_URL_NOT_PAYPAL'
        | 'PAYPAL_REJECTED'
        | 'PAYPAL_UNREACHABLE';
    };

export type RailAction =
  | 'RAIL_CONFIRMED'
  | 'RAIL_FAILED'
  | 'RAIL_REFUNDED'
  | 'RECORDED';

const PAYPAL_CERT_HOST_PATTERN = /^https:\/\/api(-m|-3)?\.(sandbox\.)?paypal\.com\//;

interface VerifySignatureApiResponse {
  readonly verification_status?: string;
}

export async function verifyPayPalWebhookSignature(
  config: PayPalWebhookConfig,
  input: WebhookVerifyInput,
): Promise<WebhookVerifyOutcome> {
  const h = input.headers;
  if (
    !h.authAlgo ||
    !h.certUrl ||
    !h.transmissionId ||
    !h.transmissionSig ||
    !h.transmissionTime
  ) {
    return { verified: false, reason: 'MISSING_HEADERS' };
  }

  if (
    typeof input.event !== 'object' ||
    input.event === null ||
    typeof (input.event as PayPalWebhookEvent).event_type !== 'string' ||
    typeof (input.event as PayPalWebhookEvent).id !== 'string'
  ) {
    return { verified: false, reason: 'MALFORMED_EVENT' };
  }

  if (!PAYPAL_CERT_HOST_PATTERN.test(h.certUrl)) {
    return { verified: false, reason: 'CERT_URL_NOT_PAYPAL' };
  }

  let lastOutcome: WebhookVerifyOutcome | null = null;
  const verifyFields = {
    auth_algo: h.authAlgo,
    cert_url: h.certUrl,
    transmission_id: h.transmissionId,
    transmission_sig: h.transmissionSig,
    transmission_time: h.transmissionTime,
  };
  const hasRawBody = typeof input.rawEventBody === 'string' && input.rawEventBody.trim().length > 0;
  for (const webhookId of config.webhookIds) {
    let verdict: string | undefined;
    try {
      let requestInit: { body?: unknown; rawBody?: string };
      if (hasRawBody) {
        const wrapper = JSON.stringify({ ...verifyFields, webhook_id: webhookId });
        requestInit = {
          rawBody: `${wrapper.slice(0, -1)},"webhook_event":${input.rawEventBody}}`,
        };
      } else {
        requestInit = {
          body: { ...verifyFields, webhook_id: webhookId, webhook_event: input.event },
        };
      }
      const result = await config.client.request<VerifySignatureApiResponse>({
        method: 'POST',
        path: '/v1/notifications/verify-webhook-signature',
        ...requestInit,
      });
      if (!result.ok) {
        return { verified: false, reason: 'PAYPAL_UNREACHABLE' };
      }
      verdict = result.data?.verification_status;
    } catch {
      return { verified: false, reason: 'PAYPAL_UNREACHABLE' };
    }

    if (verdict === 'SUCCESS') {
      return { verified: true, event: input.event as PayPalWebhookEvent };
    }
    lastOutcome = { verified: false, reason: 'PAYPAL_REJECTED' };
  }

  return lastOutcome ?? { verified: false, reason: 'PAYPAL_REJECTED' };
}

export function classifyCaptureEvent(eventType?: string): RailAction {
  switch (eventType) {
    case 'PAYMENT.CAPTURE.COMPLETED':
    case 'CHECKOUT.ORDER.COMPLETED':
      return 'RAIL_CONFIRMED';
    case 'PAYMENT.CAPTURE.DENIED':
    case 'PAYMENT.CAPTURE.DECLINED':
      return 'RAIL_FAILED';
    case 'PAYMENT.CAPTURE.REFUNDED':
    case 'PAYMENT.CAPTURE.REVERSED':
      return 'RAIL_REFUNDED';
    default:
      return 'RECORDED';
  }
}
