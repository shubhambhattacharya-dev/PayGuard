import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';
import { toMoneyMinor, type OrderProposal } from '@payguard/contracts';

/**
 * Auth gate (P0-1) + approvals-surface regression (P0-2):
 * identity comes from the API key only; client-supplied ownerId cannot
 * impersonate another tenant; nothing /v1 is reachable unauthenticated.
 */

function makeProposal(overrides: { invoiceId?: string; vendorName?: string; totalMinor?: number } = {}): OrderProposal {
  const total = overrides.totalMinor ?? 5000; // $50.00 - under the $100 auto cap
  return {
    invoiceId: overrides.invoiceId ?? 'INV-AUTH-01',
    vendorName: overrides.vendorName ?? 'Cedar Supply',
    lineItems: [
      {
        sku: 'CED-PPR-01',
        description: 'Office Paper Reams',
        quantity: 1,
        unitPriceMinor: toMoneyMinor(total),
        taxBps: 0,
        lineTotalMinor: toMoneyMinor(total),
      },
    ],
    currency: 'USD',
    subtotalMinor: toMoneyMinor(total),
    taxTotalMinor: toMoneyMinor(0),
    grandTotalMinor: toMoneyMinor(total),
  };
}

const KEYS = new Map([
  ['pgk_alpha', 'owner_northstar'],
  ['pgk_beta', 'owner_1'],
]);

describe('API-key auth gate (P0-1)', () => {
  it('401s unauthenticated /v1 access and never leaks the approvals surface (P0-2 regression)', async () => {
    const server = buildServer(500_000, { auth: { keys: KEYS } });
    for (const url of ['/v1/transactions', '/v1/approvals', '/v1/audit', '/v1/vendors', '/v1/catalog']) {
      const res = await server.inject({ method: 'GET', url });
      expect(res.statusCode, `${url} must be unreachable without a key`).toBe(401);
      expect(res.json<{ error: string }>().error).toBe('UNAUTHENTICATED');
    }
    const approvalsBody = await server.inject({ method: 'GET', url: '/v1/approvals' });
    expect(approvalsBody.body).not.toContain('singleUseCode');
  });

  it('health routes stay public', async () => {
    const server = buildServer(500_000, { auth: { keys: KEYS } });
    const health = await server.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    const ready = await server.inject({ method: 'GET', url: '/readyz' });
    expect(ready.statusCode).toBe(200);
  });

  it('accepts a valid key and rejects unknown keys', async () => {
    const server = buildServer(500_000, { auth: { keys: KEYS } });
    const ok = await server.inject({
      method: 'GET',
      url: '/v1/transactions',
      headers: { authorization: 'Bearer pgk_alpha' },
    });
    expect(ok.statusCode).toBe(200);

    const bad = await server.inject({
      method: 'GET',
      url: '/v1/transactions',
      headers: { authorization: 'Bearer pgk_nope' },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('evaluate: missing body.ownerId defaults to the key owner; mismatched ownerId is 403', async () => {
    const server = buildServer(500_000, { auth: { keys: KEYS } });

    const defaulted = await server.inject({
      method: 'POST',
      url: '/v1/evaluate',
      headers: { authorization: 'Bearer pgk_alpha' },
      payload: { proposal: makeProposal() },
    });
    expect(defaulted.statusCode).toBe(200);
    const decision = defaulted.json<{ decision: { state: string; reasonCode: string } }>().decision;
    expect(decision.state).toBe('APPROVED');

    const impersonated = await server.inject({
      method: 'POST',
      url: '/v1/evaluate',
      headers: { authorization: 'Bearer pgk_alpha' },
      payload: { ownerId: 'owner_1', proposal: makeProposal({ invoiceId: 'INV-AUTH-02' }) },
    });
    expect(impersonated.statusCode).toBe(403);
    expect(impersonated.json<{ error: string }>().error).toBe('FORBIDDEN_OWNER');
  });

  it('execute: forged tokens and foreign identities cannot move money', async () => {
    const server = buildServer(500_000, { auth: { keys: KEYS } });

    // Foreign identity on execute is 403 before anything settles.
    const foreign = await server.inject({
      method: 'POST',
      url: '/v1/execute',
      headers: { authorization: 'Bearer pgk_alpha' },
      payload: {
        ownerId: 'owner_1',
        idempotencyKey: 'idem-auth-01',
        proposal: makeProposal({ invoiceId: 'INV-AUTH-03' }),
      },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('HITL approve is tenant-scoped: a foreign key cannot approve another owner QR (404, not 403)', async () => {
    const server = buildServer(500_000, { auth: { keys: KEYS } });

    // Seed demo QR belongs to owner_northstar.
    const foreign = await server.inject({
      method: 'POST',
      url: '/v1/hitl/approve',
      headers: { authorization: 'Bearer pgk_beta' },
      payload: { singleUseCode: 'PG-7F3K-9D2L' },
    });
    expect(foreign.statusCode).toBe(404);

    const sameOwner = await server.inject({
      method: 'POST',
      url: '/v1/hitl/approve',
      headers: { authorization: 'Bearer pgk_alpha' },
      payload: { singleUseCode: 'PG-7F3K-9D2L' },
    });
    expect(sameOwner.statusCode).toBe(200);
  });
});

describe('Demo mode (no auth configured)', () => {
  it('buildServer without auth stays open for tests/demo (backward compatible)', async () => {
    const server = buildServer(500_000);
    const res = await server.inject({ method: 'GET', url: '/v1/transactions' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ executionMode: string }>();
    expect(body.executionMode).toBe('in_memory_simulated');
  });
});
