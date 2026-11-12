export interface PayPalConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl: string;
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

export function createPayPalClient(
  config: PayPalConfig,
  deps: PayPalClientDeps = {},
): PayPalClient {
  const fetchFn = deps.fetchFn ?? fetch;
  const nowMsFn = deps.nowMsFn ?? Date.now;
  const sleepFn = deps.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let cachedToken: string | null = null;
  let tokenExpireAtMs = 0;

  return {
    async request<T>(options: PayPalRequestOptions): Promise<PayPalClientResult<T>> {
      if (!config.clientId.trim() || !config.clientSecret.trim()) {
        return {
          ok: false,
          status: 401,
          error: 'PAYPAL_AUTH_FAILED',
          message: 'Invalid or missing PayPal credentials.',
        };
      }

      if (!cachedToken || nowMsFn() >= tokenExpireAtMs - 60_000) {
        const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
        const tokenRes = await fetchFn(`${config.baseUrl}/v1/oauth2/token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });

        if (!tokenRes.ok) {
          return {
            ok: false,
            status: tokenRes.status,
            error: 'PAYPAL_AUTH_FAILED',
            message: 'Failed to obtain access token from Paypal',
          };
        }

        const accessTokenJson = (await tokenRes.json()) as { access_token?: string; expires_in?: number };
        if (!accessTokenJson.access_token) {
          return {
            ok: false,
            status: 401,
            error: 'PAYPAL_AUTH_FAILED',
            message: 'Missing access_token in PayPal response',
          };
        }

        cachedToken = accessTokenJson.access_token;
        tokenExpireAtMs = nowMsFn() + (accessTokenJson.expires_in ?? 3600) * 1000;
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${cachedToken}`,
        'Content-Type': 'application/json',
      };

      if (options.idempotencyKey) {
        headers['PayPal-Request-Id'] = options.idempotencyKey;
      }

      const url = `${config.baseUrl}${options.path}`;
      const reqInit: RequestInit = {
        method: options.method,
        headers,
      };

      if (options.body !== undefined) {
        reqInit.body = JSON.stringify(options.body);
      }

      let lastStatus = 500;

      for (let attempt = 0; attempt < 3; attempt++) {
        let res = await fetchFn(url, reqInit);
        lastStatus = res.status;

        if (res.ok) {
          const data = (await res.json()) as T;
          return { ok: true, status: res.status, data };
        }

        if (res.status === 422) {
          return {
            ok: false,
            status: 422,
            error: 'PAYPAL_VALIDATION_ERROR',
            message: 'PayPal validation error',
          };
        }

        if (res.status === 401) {
          cachedToken = null;
          const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
          const refreshRes = await fetchFn(`${config.baseUrl}/v1/oauth2/token`, {
            method: 'POST',
            headers: {
              Authorization: `Basic ${basicAuth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials',
          });

          if (!refreshRes.ok) {
            return {
              ok: false,
              status: 401,
              error: 'PAYPAL_AUTH_FAILED',
              message: 'Failed to refresh token',
            };
          }

          const refreshJson = (await refreshRes.json()) as { access_token?: string; expires_in?: number };
          if (!refreshJson.access_token) {
            return {
              ok: false,
              status: 401,
              error: 'PAYPAL_AUTH_FAILED',
              message: 'Missing token in refresh',
            };
          }

          cachedToken = refreshJson.access_token;
          tokenExpireAtMs = nowMsFn() + (refreshJson.expires_in ?? 3600) * 1000;
          headers['Authorization'] = `Bearer ${cachedToken}`;

          res = await fetchFn(url, reqInit);
          lastStatus = res.status;

          if (res.ok) {
            const data = (await res.json()) as T;
            return { ok: true, status: res.status, data };
          }
          if (res.status === 401) {
            return {
              ok: false,
              status: 401,
              error: 'PAYPAL_AUTH_FAILED',
              message: 'Authentication failed after refresh',
            };
          }
        }

        if (res.status === 429 || res.status >= 500) {
          if (attempt < 2) {
            const retryAfterHeader = res.headers.get('Retry-After');
            const delayMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : Math.pow(2, attempt) * 1000;
            await sleepFn(delayMs);
            continue;
          }
        }
      }

      return {
        ok: false,
        status: lastStatus,
        error: 'PAYPAL_RETRY_EXHAUSTED',
        message: 'PayPal request failed after retries',
      };
    },
  };
}