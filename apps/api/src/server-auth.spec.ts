import { describe, it, expect } from 'vitest';
import { buildServer, type ApiKeyRole } from './server.js';
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

describe('Maker-checker roles', () => {
  const ROLE_KEYS = new Map([
    ['pgk_prop', 'owner_northstar'],
    ['pgk_app', 'owner_northstar'],
  ]);
  const ROLE_MAP: ReadonlyMap<string, ApiKeyRole> = new Map([
    ['pgk_prop', 'proposer'],
    ['pgk_app', 'approver'],
  ]);

  function makeServer() {
    return buildServer(500_000, { auth: { keys: ROLE_KEYS, roles: ROLE_MAP } });
  }

  it('proposer can draft (evaluate) but can NEVER move money', async () => {
    const server = makeServer();

    const evaluate = await server.inject({
      method: 'POST',
      url: '/v1/evaluate',
      headers: { authorization: 'Bearer pgk_prop' },
      payload: { proposal: makeProposal({ invoiceId: 'INV-ROLE-1' }) },
    });
    expect(evaluate.statusCode).toBe(200);
    expect(evaluate.json<{ decision: { state: string } }>().decision.state).toBe('APPROVED');

    for (const attempt of [
      { method: 'POST' as const, url: '/v1/hitl/approve', payload: { singleUseCode: 'PG-ANY' } },
      { method: 'POST' as const, url: '/v1/transactions/tx-1/approve' },
      { method: 'POST' as const, url: '/v1/transactions/tx-1/reject' },
      {
        method: 'POST' as const,
        url: '/v1/execute',
        payload: { ownerId: 'owner_northstar', idempotencyKey: 'idem-role-1', proposal: makeProposal({ invoiceId: 'INV-ROLE-2' }) },
      },
    ]) {
      const res = await server.inject({
        method: attempt.method,
        url: attempt.url,
        headers: { authorization: 'Bearer pgk_prop' },
        ...(attempt.payload !== undefined ? { payload: attempt.payload } : {}),
      });
      expect(res.statusCode, `${attempt.url} must 403 for proposer`).toBe(403);
      expect(res.json<{ error: string }>().error).toBe('FORBIDDEN_ROLE');
    }
  });

  it('approver passes the role gate (404 on unknown tx, not 403) and can draft too', async () => {
    const server = makeServer();

    const approve = await server.inject({
      method: 'POST',
      url: '/v1/transactions/tx-does-not-exist/approve',
      headers: { authorization: 'Bearer pgk_app' },
    });
    expect(approve.statusCode).toBe(404);

    const evaluate = await server.inject({
      method: 'POST',
      url: '/v1/evaluate',
      headers: { authorization: 'Bearer pgk_app' },
      payload: { proposal: makeProposal({ invoiceId: 'INV-ROLE-3' }) },
    });
    expect(evaluate.statusCode).toBe(200);
  });

  it('legacy two-part keys default to admin (approve path reachable)', async () => {
    const server = buildServer(500_000, { auth: { keys: KEYS } });
    const res = await server.inject({
      method: 'POST',
      url: '/v1/transactions/tx-does-not-exist/approve',
      headers: { authorization: 'Bearer pgk_alpha' },
    });
    expect(res.statusCode).toBe(404);
  });
});
