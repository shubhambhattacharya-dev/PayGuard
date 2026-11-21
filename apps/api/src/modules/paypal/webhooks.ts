import type { PayPalClient } from './client.js';

/**
 * PayPal webhook receiver support (production hardening).
 *
 * The webhook route is PUBLIC by design - PayPal's signature IS the identity.
 * Verification is delegated to PayPal's authoritative
 * `/v1/notifications/verify-webhook-signature` API; any error or non-SUCCESS
 * verdict fails closed. A client-side cert_url allowlist adds defense in
 * depth before we ever hand attacker-controlled input to PayPal.
 */

export interface PayPalWebhookConfig {
  readonly client: PayPalClient;
  /**
   * Webhook ID(s) from developer.paypal.com. PayPal delivers each event under
   * the webhook that subscribed to it - one event type per webhook is a valid
   * setup, so verification tries every configured id and fails closed only
   * when none matches.
   */
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
    /** Set at order creation; PayPal surfaces this on PAYMENT.CAPTURE.* events. */
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
  /** Parsed webhook_event JSON exactly as PayPal transmitted it. */
  readonly event: unknown;
  /**
   * The RAW request body as received (optional). When present it is spliced
   * into the postback byte-for-byte: PayPal requires webhook_event to match
   * the original transmission exactly — parse→re-serialize can fail
   * verification per PayPal's integration guide.
   */
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

// Only PayPal-controlled cert hosts are acceptable (api-m.* and api-3.*).
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
        // Splice the ORIGINAL bytes in: webhook_event must match the
        // transmitted body byte-for-byte, and parse→stringify may deviate.
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

/**
 * Maps a verified PayPal event_type to the reconciliation action applied to
 * our ledger entry. Unknown/irrelevant event types are recorded but change
 * nothing (`RECORDED`).
 */
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
