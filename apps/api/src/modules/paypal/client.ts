export interface PayPalConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl: string; // e.g. https://api-m.sandbox.paypal.com
}

export interface PayPalClientDeps {
  readonly fetchFn?: typeof fetch;
  readonly sleepFn?: (ms: number) => Promise<void>;
  readonly nowMsFn?: () => number;
}

export interface PayPalRequestOptions {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

export type PayPalClientErrorCode =
  | 'PAYPAL_AUTH_FAILED'
  | 'PAYPAL_VALIDATION_ERROR'
  | 'PAYPAL_RETRY_EXHAUSTED';

export type PayPalClientResult<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly error: PayPalClientErrorCode;
      readonly message: string;
    };

export interface PayPalClient {
  request<T>(options: PayPalRequestOptions): Promise<PayPalClientResult<T>>;
}

/**
 * 20% KERNEL — PayPal Sandbox OAuth2 & Resilient HTTP Client
 *
 * Business Rules (to be implemented manually in Closed-Book mode):
 * 1. Credential validation: fail closed with PAYPAL_AUTH_FAILED if clientId or clientSecret is missing.
 * 2. Token caching: exchange Basic credentials at POST /v1/oauth2/token (grant_type=client_credentials),
 *    cache the access token with a 60-second safety buffer before expiry using deps.nowMsFn, and reuse
 *    cached tokens on subsequent requests.
 * 3. Idempotency header: attach PayPal-Request-Id header on write requests when idempotencyKey is provided.
 * 4. 401 single refresh: on HTTP 401, clear the cached token, fetch one fresh token, and retry once;
 *    if it still returns 401, return ok: false with error PAYPAL_AUTH_FAILED.
 * 5. Terminal vs retryable status codes:
 *    - 422 returns PAYPAL_VALIDATION_ERROR immediately with ZERO retries.
 *    - 429 or 5xx retries with bounded exponential backoff (up to 3 retries), honoring Retry-After
 *      header when present, via deps.sleepFn; if retries exhaust, return PAYPAL_RETRY_EXHAUSTED.
 */
export function createPayPalClient(
  _config: PayPalConfig,
  _deps: PayPalClientDeps = {},
): PayPalClient {
  return {
    async request<T>(_options: PayPalRequestOptions): Promise<PayPalClientResult<T>> {
      // TODO: SHUBHAM 20% KERNEL
      throw new Error('KERNEL_NOT_IMPLEMENTED');
    },
  };
}
