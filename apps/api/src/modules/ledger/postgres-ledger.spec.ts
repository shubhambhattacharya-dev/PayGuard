import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnvPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(rootEnvPath);
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://payguard:payguard@127.0.0.1:5432/payguard';

const isCi = process.env.CI === 'true' || process.env.CI === '1';

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

const pgReachable = isCi ? true : await canReachPostgres(DATABASE_URL);

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
    await pool.query('TRUNCATE TABLE ledger_entries, ledger_accounts CASCADE');
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

  it('rejects IDEMPOTENCY_KEY_CONFLICT when reusing an idempotency key for a different proposal', async () => {
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

    await expect(
      ledger.settleOrder({
        ownerId,
        proposal: p2,
        token: t2,
        idempotencyKey: 'pg-conflict-key',
      }),
    ).rejects.toThrow('IDEMPOTENCY_KEY_CONFLICT');
    expect(await ledger.getBalance(ownerId)).toBe(7000);
  });
});
