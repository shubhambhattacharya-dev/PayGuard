import { describe, it, expect, vi } from 'vitest';
import { createPayPalClient, type PayPalConfig } from './client.js';

const testConfig: PayPalConfig = {
  clientId: 'sbx_client_id_test',
  clientSecret: 'sbx_client_secret_test',
  baseUrl: 'https://api-m.sandbox.paypal.com',
};

function makeJsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('PayPal Sandbox Client (modules/paypal/client.ts)', () => {
  it('fetches OAuth2 token once and reuses cached token across requests', async () => {
    let now = 1_000_000;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        return makeJsonResponse(200, { access_token: 'tok_cached_1', expires_in: 3600 });
      }
      return makeJsonResponse(200, { id: 'ORD-1', status: 'CREATED' });
    });

    const client = createPayPalClient(testConfig, {
      fetchFn: fetchMock as unknown as typeof fetch,
      sleepFn: async () => {},
      nowMsFn: () => now,
    });

    const r1 = await client.request({ method: 'GET', path: '/v2/checkout/orders/ORD-1' });
    now += 10_000;
    const r2 = await client.request({ method: 'GET', path: '/v2/checkout/orders/ORD-1' });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    const tokenCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).endsWith('/v1/oauth2/token'),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it('attaches PayPal-Request-Id header on write requests when idempotencyKey is given', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/oauth2/token')) {
        return makeJsonResponse(200, { access_token: 'tok_idem', expires_in: 3600 });
      }
      return makeJsonResponse(201, { id: 'ORD-IDEM', status: 'CREATED' });
    });

    const client = createPayPalClient(testConfig, {
      fetchFn: fetchMock as unknown as typeof fetch,
      sleepFn: async () => {},
      nowMsFn: () => 1_000_000,
    });

    const res = await client.request({
      method: 'POST',
      path: '/v2/checkout/orders',
      body: { intent: 'CAPTURE' },
      idempotencyKey: 'idem-key-123',
    });

    expect(res.ok).toBe(true);
    const orderCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith('/v2/checkout/orders'),
    );
    expect(orderCall).toBeDefined();
    const initArg = (orderCall as unknown[] | undefined)?.[1] as RequestInit | undefined;
    const headers = new Headers(initArg?.headers);
    expect(headers.get('PayPal-Request-Id')).toBe('idem-key-123');
    expect(headers.get('Authorization')).toBe('Bearer tok_idem');
  });

  it('refreshes OAuth2 token once on 401 and retries, failing closed on repeated 401', async () => {
    let tokenIssueCount = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/oauth2/token')) {
        tokenIssueCount += 1;
        return makeJsonResponse(200, {
          access_token: `tok_${tokenIssueCount}`,
          expires_in: 3600,
        });
      }
      const headers = new Headers(init?.headers);
      if (headers.get('Authorization') === 'Bearer tok_1') {
        return makeJsonResponse(401, { error: 'invalid_token' });
      }
      return makeJsonResponse(200, { id: 'ORD-REFRESHED', status: 'CREATED' });
    });

    const client = createPayPalClient(testConfig, {
      fetchFn: fetchMock as unknown as typeof fetch,
      sleepFn: async () => {},
      nowMsFn: () => 1_000_000,
    });

    const okResult = await client.request<{ id: string }>({
      method: 'POST',
      path: '/v2/checkout/orders',
      idempotencyKey: 'idem-401-once',
    });

    expect(okResult.ok).toBe(true);
    expect(tokenIssueCount).toBe(2);

    const always401Fetch = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/oauth2/token')) {
        return makeJsonResponse(200, { access_token: 'tok_bad', expires_in: 3600 });
      }
      return makeJsonResponse(401, { error: 'invalid_token' });
    });
    const badClient = createPayPalClient(testConfig, {
      fetchFn: always401Fetch as unknown as typeof fetch,
      sleepFn: async () => {},
      nowMsFn: () => 1_000_000,
    });

    const failResult = await badClient.request({ method: 'GET', path: '/v2/checkout/orders/X' });
    expect(failResult.ok).toBe(false);
    if (!failResult.ok) {
      expect(failResult.error).toBe('PAYPAL_AUTH_FAILED');
    }
  });

  it('retries 429 with backoff and never retries terminal 422', async () => {
    let apiAttempts429 = 0;
    const sleepCalls: number[] = [];
    const fetch429 = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/oauth2/token')) {
        return makeJsonResponse(200, { access_token: 'tok_ok', expires_in: 3600 });
      }
      apiAttempts429 += 1;
      if (apiAttempts429 <= 2) {
        return makeJsonResponse(429, { name: 'RATE_LIMIT_REACHED' }, { 'Retry-After': '1' });
      }
      return makeJsonResponse(200, { id: 'ORD-BACKOFF', status: 'CREATED' });
    });

    const client429 = createPayPalClient(testConfig, {
      fetchFn: fetch429 as unknown as typeof fetch,
      sleepFn: async (ms: number) => {
        sleepCalls.push(ms);
      },
      nowMsFn: () => 1_000_000,
    });

    const res429 = await client429.request({
      method: 'POST',
      path: '/v2/checkout/orders',
      idempotencyKey: 'idem-429',
    });
    expect(res429.ok).toBe(true);
    expect(apiAttempts429).toBe(3);
    expect(sleepCalls.length).toBeGreaterThanOrEqual(2);

    let apiAttempts422 = 0;
    const fetch422 = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/v1/oauth2/token')) {
        return makeJsonResponse(200, { access_token: 'tok_ok', expires_in: 3600 });
      }
      apiAttempts422 += 1;
      return makeJsonResponse(422, { name: 'UNPROCESSABLE_ENTITY' });
    });

    const client422 = createPayPalClient(testConfig, {
      fetchFn: fetch422 as unknown as typeof fetch,
      sleepFn: async () => {},
      nowMsFn: () => 1_000_000,
    });

    const res422 = await client422.request({
      method: 'POST',
      path: '/v2/checkout/orders',
      idempotencyKey: 'idem-422',
    });
    expect(res422.ok).toBe(false);
    expect(apiAttempts422).toBe(1);
    if (!res422.ok) {
      expect(res422.error).toBe('PAYPAL_VALIDATION_ERROR');
    }
  });
});
