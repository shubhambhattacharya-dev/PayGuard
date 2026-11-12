import { describe, it, expect } from 'vitest';
import { issueApprovedToken, toMoneyMinor, type OrderProposal, type ApprovedForExecution } from '@payguard/contracts';
import { createPayPalExecutor } from './executor.js';
import type { PayPalClient, PayPalClientResult, PayPalRequestOptions } from './client.js';

const sampleProposal: OrderProposal = {
  invoiceId: 'INV-3155',
  vendorName: 'Cedar Supply',
  lineItems: [
    {
      sku: 'CED-PPR-01',
      description: 'Office Paper Reams',
      quantity: 4,
      unitPriceMinor: toMoneyMinor(1600),
      taxBps: 0,
      lineTotalMinor: toMoneyMinor(6400),
    },
  ],
  currency: 'USD',
  subtotalMinor: toMoneyMinor(6400),
  taxTotalMinor: toMoneyMinor(0),
  grandTotalMinor: toMoneyMinor(6400),
};

function mintedToken(idempotencyKey = 'idem-pp-1'): ApprovedForExecution {
  return issueApprovedToken({
    ownerId: 'owner_northstar',
    proposal: sampleProposal,
    idempotencyKey,
    policyVersion: 'v2026.11',
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
}

function fakeClient(
  handler: (options: PayPalRequestOptions, attempt: number) => PayPalClientResult<unknown>,
): PayPalClient & { calls: PayPalRequestOptions[] } {
  const calls: PayPalRequestOptions[] = [];
  let attempt = 0;
  return {
    calls,
    async request<T>(options: PayPalRequestOptions): Promise<PayPalClientResult<T>> {
      calls.push(options);
      const current = attempt;
      attempt += 1;
      return handler(options, current) as PayPalClientResult<T>;
    },
  };
}

describe('PayPal executor (the only door to money)', () => {
  it('happy path: create then capture with PayPal-Request-Id idempotency headers', async () => {
    const client = fakeClient((options) => {
      if (options.path === '/v2/checkout/orders') {
        return { ok: true, status: 201, data: { id: 'PAYPAL-ORDER-1', status: 'CREATED' } };
      }
      return {
        ok: true,
        status: 201,
        data: {
          id: 'PAYPAL-ORDER-1',
          status: 'COMPLETED',
          purchase_units: [{ payments: { captures: [{ id: 'CAPTURE-9' }] } }],
        },
      };
    });

    const executor = createPayPalExecutor(client);
    const result = await executor.execute(mintedToken());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.paypalOrderId).toBe('PAYPAL-ORDER-1');
      expect(result.captureId).toBe('CAPTURE-9');
      expect(result.status).toBe('COMPLETED');
    }

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.idempotencyKey).toBe('idem-pp-1');
    expect(client.calls[1]?.path).toBe('/v2/checkout/orders/PAYPAL-ORDER-1/capture');
  });

  it('order body carries the exact integer-verified amount ($64.00) and USD', async () => {
    let seenBody: unknown = null;
    const client = fakeClient((options) => {
      if (options.path === '/v2/checkout/orders') {
        seenBody = options.body;
        return { ok: true, status: 201, data: { id: 'PAYPAL-ORDER-2', status: 'CREATED' } };
      }
      return { ok: true, status: 201, data: { id: 'PAYPAL-ORDER-2', status: 'COMPLETED' } };
    });

    const executor = createPayPalExecutor(client);
    await executor.execute(mintedToken('idem-pp-2'));

    const body = seenBody as { intent: string; purchase_units: { amount: { value: string; currency_code: string } }[] };
    expect(body.intent).toBe('CAPTURE');
    expect(body.purchase_units[0]?.amount.value).toBe('64.00');
    expect(body.purchase_units[0]?.amount.currency_code).toBe('USD');
  });

  it('422 validation error is terminal: capture is never attempted', async () => {
    const client = fakeClient(() => ({
      ok: false,
      status: 422,
      error: 'PAYPAL_VALIDATION_ERROR',
      message: 'INVALID_CURRENCY',
    }));

    const executor = createPayPalExecutor(client);
    const result = await executor.execute(mintedToken('idem-pp-3'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('CREATE_ORDER');
      expect(result.errorCode).toBe('PAYPAL_VALIDATION_ERROR');
    }
    expect(client.calls).toHaveLength(1);
  });

  it('capture-stage failure maps to the client error code with stage CAPTURE_ORDER', async () => {
    const client = fakeClient((options) => {
      if (options.path === '/v2/checkout/orders') {
        return { ok: true, status: 201, data: { id: 'PAYPAL-ORDER-3', status: 'CREATED' } };
      }
      return { ok: false, status: 500, error: 'PAYPAL_RETRY_EXHAUSTED', message: 'PayPal request failed after retries' };
    });

    const executor = createPayPalExecutor(client);
    const result = await executor.execute(mintedToken('idem-pp-4'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe('CAPTURE_ORDER');
      expect(result.errorCode).toBe('PAYPAL_RETRY_EXHAUSTED');
    }
    expect(client.calls).toHaveLength(2);
  });

  it('a forged / foreign token object is rejected as CAPABILITY_INVALID before any network call', async () => {
    const client = fakeClient(() => ({ ok: true, status: 201, data: { id: 'X', status: 'CREATED' } }));
    const forged = {
      approvalId: 'forged',
      proposal: sampleProposal,
      ownerId: 'owner_northstar',
      authorizedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      authorizedTotalMinor: toMoneyMinor(6400),
      idempotencyKey: 'idem-pp-5',
      policyVersion: 'v2026.11',
    } as unknown as ApprovedForExecution;

    const executor = createPayPalExecutor(client);
    const result = await executor.execute(forged);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('CAPABILITY_INVALID');
    }
    expect(client.calls).toHaveLength(0);
  });

  it('expired capability token is rejected before any network call', async () => {
    const client = fakeClient(() => ({ ok: true, status: 201, data: { id: 'X', status: 'CREATED' } }));

    // Mint a token that is valid at issuance, then let it expire before executing.
    const almostExpired = issueApprovedToken({
      ownerId: 'owner_northstar',
      proposal: sampleProposal,
      idempotencyKey: 'idem-pp-7',
      policyVersion: 'v2026.11',
      expiresAt: new Date(Date.now() + 30).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const executor = createPayPalExecutor(client);
    const result = await executor.execute(almostExpired);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('CAPABILITY_INVALID');
    }
    expect(client.calls).toHaveLength(0);
  });
});
