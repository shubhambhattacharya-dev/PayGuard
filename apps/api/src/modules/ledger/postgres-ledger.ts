import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg';
import type {
  LedgerStore,
  SettleOrderInput,
  SettlementResult,
} from './ledger.js';
import { assertApprovedForExecution } from '@payguard/contracts';


/**
 * Durable PostgreSQL ledger adapter using row-level pessimistic locking
 * (`SELECT ... FOR UPDATE`) and `UNIQUE(owner_id, idempotency_key)`.
 */
export class PostgresLedger implements LedgerStore {
  public constructor(private readonly pool: Pool) { }

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

  public async settleOrder(input: SettleOrderInput): Promise<SettlementResult> {
    try {

      assertApprovedForExecution(input.token)
      if (input.token.ownerId !== input.ownerId || input.token.idempotencyKey !== input.idempotencyKey || input.token.authorizedTotalMinor !== input.proposal.grandTotalMinor || input.token.proposal.invoiceId !== input.proposal.invoiceId) {
        return { success: false, error: 'FORBIDDEN_CAPABILITY' }
      }




    } catch (error) {
      return { success: false, error: 'FORBIDDEN_CAPABILITY' }


    }
    if (!Number.isSafeInteger(input.proposal.grandTotalMinor) || input.proposal.grandTotalMinor <= 0) {
      throw new Error('Invalid settlement amount')
    }

    const client = await this.pool.connect()

    try {
      await client.query('BEGIN')
      const accountRes = await client.query<{ balance_minor: string }>('SELECT balance_minor FROM ledger_accounts WHERE owner_id=$1 FOR UPDATE', [input.ownerId])

      const existing = await client.query<{ settlement_id: string, owner_id: string, invoice_id: string, amount_minor: string, remaining_balance_minor: string, settled_at: Date | string, status: string }>('SELECT  settlement_id, owner_id, invoice_id, amount_minor, remaining_balance_minor, settled_at, status FROM ledger_entries WHERE owner_id=$1 AND idempotency_key=$2', [input.ownerId, input.idempotencyKey])


      const row = existing.rows[0]

      if (row) {
        if (row.invoice_id !== input.proposal.invoiceId || Number(row.amount_minor) !== input.proposal.grandTotalMinor) {
          await client.query('ROLLBACK')
          throw new Error('IDEMPOTENCY_KEY_CONFLICT')
        }
        await client.query('COMMIT')
        return { success: true, settlement: { amountMinor: Number(row.amount_minor), settlementId: row.settlement_id, ownerId: row.owner_id, invoiceId: row.invoice_id, remainingBalanceMinor: Number(row.remaining_balance_minor), settledAt: row.settled_at instanceof Date ? row.settled_at.toISOString() : String(row.settled_at), status: 'SETTLED' } }
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

      await client.query('INSERT INTO ledger_entries  (settlement_id, owner_id, idempotency_key, invoice_id, amount_minor, remaining_balance_minor, status, settled_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [settlementId, input.ownerId, input.idempotencyKey, input.proposal.invoiceId, input.proposal.grandTotalMinor, newBalance, 'SETTLED', settledAt])

      await client.query("COMMIT")
      return { success: true, settlement: { settlementId: settlementId, ownerId: input.ownerId, invoiceId: input.proposal.invoiceId, amountMinor: input.proposal.grandTotalMinor, remainingBalanceMinor: newBalance, settledAt: settledAt, status: 'SETTLED' } }

    } catch (error) {
      try {
        await client.query('ROLLBACK')

      } catch {


      }
      throw error


    } finally {
      client.release()
    }
  }
}
