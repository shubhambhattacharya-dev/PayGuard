import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type ApprovedForExecution,
  type OrderProposal,
  issueApprovedToken,
  toMoneyMinor,
} from '@payguard/contracts';
import type { Pool } from 'pg';
import { createPgPool, runMigrations } from '../../db/pool.js';
import { PostgresLedger } from './postgres-ledger.js';

// IMPORTANT: never load the repository `.env` here. These specs TRUNCATE
// ledger tables, so pointing them at a developer's real DATABASE_URL would
// destroy production/demo data. Only an explicit TEST_DATABASE_URL (preferred)
// or a LOCAL/CI PostgreSQL instance is allowed.
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://payguard:payguard@127.0.0.1:5432/payguard';

const isCi = process.env.CI === 'true' || process.env.CI === '1';
const isLocalHost = (() => {
  try {
    const host = new URL(DATABASE_URL).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
})();

async function canReachPostgres(connectionString: string): Promise<boolean> {
  const probePool = createPgPool(connectionString);
  try {
    await probePool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await probePool.end().catch(() => undefined);
  }
}

// A remote database is never a valid target for a destructive test suite,
// even in CI. Local Docker/CI service hosts are always numeric hostnames.
const isSafeDestructiveTarget = isCi || isLocalHost;
const pgReachable = isSafeDestructiveTarget && (await canReachPostgres(DATABASE_URL));

describe.skipIf(!pgReachable)('PostgresLedger (Ticket 1 Red-First TDD: SELECT FOR UPDATE & Idempotency)', () => {
  let pool: Pool;
  let ledger: PostgresLedger;
  const ownerId = 'pg_corp_finance_01';

  const makeProposal = (invoiceId: string, amountMinor: number): OrderProposal => ({
    invoiceId,
    vendorName: 'Acme Cloud Services',
    lineItems: [
      {
        sku: 'HOST-01',
        description: 'Server Hosting',
        quantity: 1,
        unitPriceMinor: toMoneyMinor(amountMinor),
        taxBps: 0,
        lineTotalMinor: toMoneyMinor(amountMinor),
      },
    ],
    currency: 'USD',
    subtotalMinor: toMoneyMinor(amountMinor),
    taxTotalMinor: toMoneyMinor(0),
    grandTotalMinor: toMoneyMinor(amountMinor),
  });

  beforeAll(async () => {
    pool = createPgPool(DATABASE_URL);
    await runMigrations(pool);
    ledger = new PostgresLedger(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE ledger_entries, ledger_accounts, settled_invoices CASCADE');
    await ledger.seedAccount(ownerId, 10000); // $100.00
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('rejects settlement when capability token is forged (FORBIDDEN_CAPABILITY)', async () => {
    const forged = { decisionId: 'fake' } as unknown as ApprovedForExecution;

    const result = await ledger.settleOrder({
      ownerId,
      proposal: makeProposal('INV-PG-001', 5000),
      token: forged,
      idempotencyKey: 'pg-idemp-forge',
    });

    expect(result).toEqual({ success: false, error: 'FORBIDDEN_CAPABILITY' });
    expect(await ledger.getBalance(ownerId)).toBe(10000);
  });

  it('settles atomically, persists to Postgres, and returns cached receipt on idempotent retry', async () => {
    const proposal = makeProposal('INV-PG-002', 4000);
    const token = issueApprovedToken({
      ownerId,
      proposal,
      idempotencyKey: 'pg-idemp-01',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const first = await ledger.settleOrder({
      ownerId,
      proposal,
      token,
      idempotencyKey: 'pg-idemp-01',
    });
    const retry = await ledger.settleOrder({
      ownerId,
      proposal,
      token,
      idempotencyKey: 'pg-idemp-01',
    });

    expect(first.success).toBe(true);
    expect(retry).toEqual(first);
    expect(await ledger.getBalance(ownerId)).toBe(6000);
  });

  it('prevents concurrent double-spend via SELECT ... FOR UPDATE', async () => {
    const p1 = makeProposal('INV-PG-RACE-1', 8000);
    const p2 = makeProposal('INV-PG-RACE-2', 8000);

    const t1 = issueApprovedToken({
      ownerId,
      proposal: p1,
      idempotencyKey: 'pg-race-1',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const t2 = issueApprovedToken({
      ownerId,
      proposal: p2,
      idempotencyKey: 'pg-race-2',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const [r1, r2] = await Promise.all([
      ledger.settleOrder({ ownerId, proposal: p1, token: t1, idempotencyKey: 'pg-race-1' }),
      ledger.settleOrder({ ownerId, proposal: p2, token: t2, idempotencyKey: 'pg-race-2' }),
    ]);

    const successes = [r1, r2].filter((r) => r.success);
    const failures = [r1, r2].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toEqual({ success: false, error: 'INSUFFICIENT_FUNDS' });
    expect(await ledger.getBalance(ownerId)).toBe(2000);
  });

  it('rejects IDEMPOTENCY_CONFLICT (typed result) when reusing an idempotency key for a different proposal', async () => {
    const p1 = makeProposal('INV-PG-CONFLICT-1', 3000);
    const p2 = makeProposal('INV-PG-CONFLICT-2', 4000);

    const t1 = issueApprovedToken({
      ownerId,
      proposal: p1,
      idempotencyKey: 'pg-conflict-key',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const t2 = issueApprovedToken({
      ownerId,
      proposal: p2,
      idempotencyKey: 'pg-conflict-key',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const first = await ledger.settleOrder({
      ownerId,
      proposal: p1,
      token: t1,
      idempotencyKey: 'pg-conflict-key',
    });
    expect(first.success).toBe(true);

    // Production hardening: key conflicts are now a typed error result (HTTP 409),
    // not a thrown error (which surfaced as an untyped HTTP 500).
    const conflict = await ledger.settleOrder({
      ownerId,
      proposal: p2,
      token: t2,
      idempotencyKey: 'pg-conflict-key',
    });
    expect(conflict).toEqual({ success: false, error: 'IDEMPOTENCY_CONFLICT' });
    expect(await ledger.getBalance(ownerId)).toBe(7000);
  });

  describe('Production hardening guards (migration 002)', () => {
    // $200/hour velocity cap wired like production main.ts.
    let cappedLedger: PostgresLedger;
    const cappedOwner = `${ownerId}_capped`;

    beforeAll(() => {
      cappedLedger = new PostgresLedger(pool, 20000);
    });

    beforeEach(async () => {
      await pool.query('TRUNCATE TABLE ledger_entries, ledger_accounts, settled_invoices CASCADE');
      await cappedLedger.seedAccount(cappedOwner, 1_000_000); // $10,000 - balance never interferes
    });

    it('rejects a second settlement of the same invoice under a DIFFERENT idempotency key (DUPLICATE_INVOICE)', async () => {
      const proposal = makeProposal('INV-PG-DUP-1', 3000);
      const t1 = issueApprovedToken({
        ownerId: cappedOwner,
        proposal,
        idempotencyKey: 'dup-key-1',
        policyVersion: '1.0.0',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const t2 = issueApprovedToken({
        ownerId: cappedOwner,
        proposal,
        idempotencyKey: 'dup-key-2',
        policyVersion: '1.0.0',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });

      const first = await cappedLedger.settleOrder({
        ownerId: cappedOwner,
        proposal,
        token: t1,
        idempotencyKey: 'dup-key-1',
      });
      expect(first.success).toBe(true);

      const second = await cappedLedger.settleOrder({
        ownerId: cappedOwner,
        proposal,
        token: t2,
        idempotencyKey: 'dup-key-2',
      });
      expect(second).toEqual({ success: false, error: 'DUPLICATE_INVOICE' });
      expect(await cappedLedger.getBalance(cappedOwner)).toBe(1_000_000 - 3000);
    });

    it('enforces the hourly velocity cap inside the settle transaction (VELOCITY_CAP_EXCEEDED)', async () => {
      const settle = (invoiceId: string, amountMinor: number, key: string) =>
        cappedLedger.settleOrder({
          ownerId: cappedOwner,
          proposal: makeProposal(invoiceId, amountMinor),
          token: issueApprovedToken({
            ownerId: cappedOwner,
            proposal: makeProposal(invoiceId, amountMinor),
            idempotencyKey: key,
            policyVersion: '1.0.0',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          }),
          idempotencyKey: key,
        });

      const first = await settle('INV-PG-VEL-1', 15000, 'vel-key-1'); // $150
      expect(first.success).toBe(true);

      const second = await settle('INV-PG-VEL-2', 6000, 'vel-key-2'); // $60 -> $210 > $200 cap
      expect(second).toEqual({ success: false, error: 'VELOCITY_CAP_EXCEEDED' });
      expect(await cappedLedger.getBalance(cappedOwner)).toBe(1_000_000 - 15000);

      // Under-cap order after the rejection still settles (cap is rolling, not blocking).
      const third = await settle('INV-PG-VEL-3', 4000, 'vel-key-3'); // $40 -> $190 <= $200
      expect(third.success).toBe(true);
    });

    it('parallel settles cannot collectively breach the velocity cap', async () => {
      // 4 x $60 orders against a $200 cap: exactly 3 settle, 1 is rejected.
      const results = await Promise.all(
        [0, 1, 2, 3].map((i) =>
          cappedLedger.settleOrder({
            ownerId: cappedOwner,
            proposal: makeProposal(`INV-PG-PAR-${i}`, 6000),
            token: issueApprovedToken({
              ownerId: cappedOwner,
              proposal: makeProposal(`INV-PG-PAR-${i}`, 6000),
              idempotencyKey: `par-key-${i}`,
              policyVersion: '1.0.0',
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            }),
            idempotencyKey: `par-key-${i}`,
          }),
        ),
      );

      const successes = results.filter((r) => r.success);
      const failures = results.filter((r) => !r.success);
      expect(successes).toHaveLength(3);
      expect(failures).toHaveLength(1);
      expect((failures[0] as { error: string }).error).toBe('VELOCITY_CAP_EXCEEDED');
    });
  });
});
