import { assertApprovedForExecution, type ApprovedForExecution } from '@payguard/contracts';
import type { PayPalClient } from './client.js';

// =====================================================
// EXECUTION RESULT
// =====================================================

export type PayPalExecutionErrorCode =
  | 'CAPABILITY_INVALID'
  | 'PAYPAL_AUTH_FAILED'
  | 'PAYPAL_VALIDATION_ERROR'
  | 'PAYPAL_RETRY_EXHAUSTED';

export type PayPalExecutionResult =
  | {
      readonly ok: true;
      readonly paypalOrderId: string;
      readonly captureId: string | null;
      readonly status: string;
    }
  | {
      readonly ok: false;
      readonly stage: 'CREATE_ORDER' | 'CAPTURE_ORDER';
      readonly errorCode: PayPalExecutionErrorCode;
      readonly message: string;
    };

export interface PayPalExecutor {
  /**
   * Moves money on the PayPal rail. The branded ApprovedForExecution
   * parameter makes gateless invocation a compile-time error; the runtime
   * assertion re-verifies the token was minted by this process's gate.
   */
  execute(token: ApprovedForExecution): Promise<PayPalExecutionResult>;
}

interface PayPalOrderResponse {
  readonly id?: string;
  readonly status?: string;
  readonly purchase_units?: {
    readonly payments?: {
      readonly captures?: { readonly id?: string }[];
    };
  }[];
}

function toOrderValue(totalMinor: number): string {
  return (totalMinor / 100).toFixed(2);
}

/**
 * create -> capture order flow. Retries and 401 refresh live inside the
 * PayPalClient; 422 is terminal (no retry), mapped from the client layer.
 */
export function createPayPalExecutor(client: PayPalClient): PayPalExecutor {
  return {
    async execute(token: ApprovedForExecution): Promise<PayPalExecutionResult> {
      try {
        assertApprovedForExecution(token);
      } catch {
        return {
          ok: false,
          stage: 'CREATE_ORDER',
          errorCode: 'CAPABILITY_INVALID',
          message: 'Execution requires a gate-minted ApprovedForExecution capability token.',
        };
      }

      const created = await client.request<PayPalOrderResponse>({
        method: 'POST',
        path: '/v2/checkout/orders',
        idempotencyKey: token.idempotencyKey,
        body: {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: token.idempotencyKey.slice(0, 127),
              description: `PayGuard settlement ${token.proposal.invoiceId}`.slice(0, 127),
              amount: {
                currency_code: token.proposal.currency,
                value: toOrderValue(Number(token.authorizedTotalMinor)),
              },
            },
          ],
        },
      });

      if (!created.ok) {
        return {
          ok: false,
          stage: 'CREATE_ORDER',
          errorCode: created.error,
          message: created.message,
        };
      }

      const orderId = created.data.id ?? '';
      if (orderId.length === 0) {
        return {
          ok: false,
          stage: 'CREATE_ORDER',
          errorCode: 'PAYPAL_VALIDATION_ERROR',
          message: 'PayPal order response did not include an order id.',
        };
      }

      const captured = await client.request<PayPalOrderResponse>({
        method: 'POST',
        path: `/v2/checkout/orders/${orderId}/capture`,
        idempotencyKey: `${token.idempotencyKey}-capture`.slice(0, 255),
      });

      if (!captured.ok) {
        return {
          ok: false,
          stage: 'CAPTURE_ORDER',
          errorCode: captured.error,
          message: captured.message,
        };
      }

      const captureId = captured.data.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null;
      return {
        ok: true,
        paypalOrderId: orderId,
        captureId,
        status: captured.data.status ?? 'CAPTURED',
      };
    },
  };
}
