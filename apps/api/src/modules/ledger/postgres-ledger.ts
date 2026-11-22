import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg';
import type {
  LedgerStore,
  SettleOrderInput,
  SettlementResult,
} from './ledger.js';
import { assertApprovedForExecution } from '@payguard/contracts';

const HOURLY_VELOCITY_WINDOW = "INTERVAL '60 minutes'";

/**
 * Durable PostgreSQL ledger adapter using row-level pessimistic locking
 * (`SELECT ... FOR UPDATE`), `UNIQUE(owner_id, idempotency_key)`,
 * a global duplicate-invoice guard, and an in-transaction velocity check
 * (closes the mint-time parallel-evaluate race at the money path).
 */
export class PostgresLedger implements LedgerStore {
  public constructor(
    private readonly pool: Pool,
    private readonly hourlyVelocityCapMinor?: number,
  ) {}

  public async seedAccount(ownerId: string, initialBalanceMinor: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ledger_accounts (owner_id, balance_minor)
       VALUES ($1, $2)
       ON CONFLICT (owner_id)
       DO UPDATE SET balance_minor = EXCLUDED.balance_minor, updated_at = NOW()`,
      [ownerId, initialBalanceMinor],
    );
  }

  public async getBalance(ownerId: string): Promise<number> {
    const res = await this.pool.query<{ balance_minor: string }>(
      `SELECT balance_minor FROM ledger_accounts WHERE owner_id = $1`,
      [ownerId],
    );
    const row = res.rows[0];
    return row ? Number(row.balance_minor) : 0;
  }

  public async getHourlySpentMinor(ownerId: string): Promise<number> {
    const res = await this.pool.query<{ total_minor: string | null }>(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total_minor
       FROM ledger_entries
       WHERE owner_id = $1 AND settled_at > NOW() - ${HOURLY_VELOCITY_WINDOW}`,
      [ownerId],
    );
    return Number(res.rows[0]?.total_minor ?? 0);
  }

  public async isKnownIdempotencyKey(ownerId: string, idempotencyKey: string): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM ledger_entries WHERE owner_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [ownerId, idempotencyKey],
    );
    return (res.rowCount ?? 0) > 0;
  }

  public async settleOrder(input: SettleOrderInput): Promise<SettlementResult> {
    try {
      assertApprovedForExecution(input.token)
      if (input.token.ownerId !== input.ownerId || input.token.idempotencyKey !== input.idempotencyKey || input.token.authorizedTotalMinor !== input.proposal.grandTotalMinor || input.token.proposal.invoiceId !== input.proposal.invoiceId) {
        return { success: false, error: 'FORBIDDEN_CAPABILITY' }
      }
    } catch {
      return { success: false, error: 'FORBIDDEN_CAPABILITY' }
    }

    if (!Number.isSafeInteger(input.proposal.grandTotalMinor) || input.proposal.grandTotalMinor <= 0) {
      throw new Error('Invalid settlement amount')
    }

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const accountRes = await client.query<{ balance_minor: string }>(
        'SELECT balance_minor FROM ledger_accounts WHERE owner_id=$1 FOR UPDATE',
        [input.ownerId],
      )

      const existing = await client.query<{ settlement_id: string, owner_id: string, invoice_id: string, amount_minor: string, remaining_balance_minor: string, settled_at: Date | string, status: string }>(
        'SELECT settlement_id, owner_id, invoice_id, amount_minor, remaining_balance_minor, settled_at, status FROM ledger_entries WHERE owner_id=$1 AND idempotency_key=$2',
        [input.ownerId, input.idempotencyKey],
      )

      const row = existing.rows[0]

      if (row) {
        if (row.invoice_id !== input.proposal.invoiceId || Number(row.amount_minor) !== input.proposal.grandTotalMinor) {
          await client.query('ROLLBACK')
          return { success: false, error: 'IDEMPOTENCY_CONFLICT' }
        }
        await client.query('COMMIT')
        return { success: true, settlement: { amountMinor: Number(row.amount_minor), settlementId: row.settlement_id, ownerId: row.owner_id, invoiceId: row.invoice_id, remainingBalanceMinor: Number(row.remaining_balance_minor), settledAt: row.settled_at instanceof Date ? row.settled_at.toISOString() : String(row.settled_at), status: 'SETTLED' } }
      }

      // Velocity cap enforced INSIDE the transaction against committed settlements,
      // so parallel autonomous executes can never collectively breach the cap.
      // Explicit human-in-the-loop QR/dashboard approvals set bypassVelocityCap.
      if (!input.bypassVelocityCap && this.hourlyVelocityCapMinor !== undefined) {
        const velocityRes = await client.query<{ total_minor: string | null }>(
          `SELECT COALESCE(SUM(amount_minor), 0) AS total_minor
           FROM ledger_entries
           WHERE owner_id = $1 AND settled_at > NOW() - ${HOURLY_VELOCITY_WINDOW}`,
          [input.ownerId],
        )
        const hourlySpent = Number(velocityRes.rows[0]?.total_minor ?? 0)
        if (hourlySpent + input.proposal.grandTotalMinor > this.hourlyVelocityCapMinor) {
          await client.query('ROLLBACK')
          return { success: false, error: 'VELOCITY_CAP_EXCEEDED' }
        }
      }

      // Global duplicate-invoice guard: atomic insert; a prior settlement of the
      // same invoiceId (any idempotency key) rejects here, never double-pays.
      const duplicateRes = await client.query<{ owner_id: string }>(
        `INSERT INTO settled_invoices (owner_id, invoice_id)
         VALUES ($1, $2)
         ON CONFLICT (invoice_id) DO NOTHING
         RETURNING owner_id`,
        [input.ownerId, input.proposal.invoiceId],
      )
      if (duplicateRes.rowCount === 0) {
        await client.query('ROLLBACK')
        return { success: false, error: 'DUPLICATE_INVOICE' }
      }

      const account = accountRes.rows[0]
      if (!account || Number(account.balance_minor) < input.proposal.grandTotalMinor) {
        await client.query('ROLLBACK')
        return { success: false, error: 'INSUFFICIENT_FUNDS' }
      }
      const newBalance = Number(account.balance_minor) - input.proposal.grandTotalMinor
      const settlementId = randomUUID()
      const settledAt = new Date().toISOString()
      await client.query('UPDATE ledger_accounts SET balance_minor = $1, updated_at = NOW() WHERE owner_id = $2 ', [newBalance, input.ownerId])

      await client.query('INSERT INTO ledger_entries (settlement_id, owner_id, idempotency_key, invoice_id, vendor_name, amount_minor, remaining_balance_minor, status, settled_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [settlementId, input.ownerId, input.idempotencyKey, input.proposal.invoiceId, input.proposal.vendorName, input.proposal.grandTotalMinor, newBalance, 'SETTLED', settledAt])

      await client.query("COMMIT")
      return { success: true, settlement: { settlementId: settlementId, ownerId: input.ownerId, invoiceId: input.proposal.invoiceId, amountMinor: input.proposal.grandTotalMinor, remainingBalanceMinor: newBalance, settledAt: settledAt, status: 'SETTLED' } }

    } catch (error) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // connection already aborted; nothing to roll back
      }
      // Unexpected DB failure: rethrow (http boundary maps to 500). Never mask
      // an outage as a policy verdict.
      throw error
    } finally {
      client.release()
    }
  }

  /** Invoice ids already settled, used to rehydrate the gate's duplicate guard. */
  public async listSettledInvoiceIds(): Promise<string[]> {
    const res = await this.pool.query<{ invoice_id: string }>(
      `SELECT invoice_id FROM settled_invoices`,
    );
    return res.rows.map((row) => row.invoice_id);
  }

  /** Owner-scoped settled invoice keys (`ownerId:invoiceId`) matching the composite PK. */
  public async listSettledInvoiceKeys(): Promise<string[]> {
    const res = await this.pool.query<{ owner_id: string; invoice_id: string }>(
      `SELECT owner_id, invoice_id FROM settled_invoices`,
    );
    return res.rows.map((row) => `${row.owner_id}:${row.invoice_id}`);
  }

  /** Real settlements for the UI transactions list (newest first). */
  public async listEntries(ownerId: string | null, limit = 100): Promise<{
    settlementId: string; vendorName: string; invoiceId: string; amountMinor: number; remainingBalanceMinor: number; status: string; settledAt: string;
  }[]> {
    const base = 'SELECT settlement_id, vendor_name, invoice_id, amount_minor, remaining_balance_minor, status, settled_at FROM ledger_entries'
    const res = ownerId
      ? await this.pool.query(`${base} WHERE owner_id = $1 ORDER BY settled_at DESC LIMIT ${limit}`, [ownerId])
      : await this.pool.query(`${base} ORDER BY settled_at DESC LIMIT ${limit}`)
    return res.rows.map((r: { settlement_id: string; vendor_name: string; invoice_id: string; amount_minor: string; remaining_balance_minor: string; status: string; settled_at: Date | string }) => ({
      settlementId: r.settlement_id,
      vendorName: r.vendor_name,
      invoiceId: r.invoice_id,
      amountMinor: Number(r.amount_minor),
      remainingBalanceMinor: Number(r.remaining_balance_minor),
      status: r.status,
      settledAt: r.settled_at instanceof Date ? r.settled_at.toISOString() : String(r.settled_at),
    }))
  }
}
