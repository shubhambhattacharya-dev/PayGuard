-- PayGuard initial PostgreSQL schema (80% Shell)
-- Stores durable ledger balances, idempotent settlement entries, settled invoices, and audit events.

CREATE TABLE IF NOT EXISTS ledger_accounts (
  owner_id TEXT PRIMARY KEY,
  balance_minor BIGINT NOT NULL CHECK (balance_minor >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  settlement_id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES ledger_accounts(owner_id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  remaining_balance_minor BIGINT NOT NULL CHECK (remaining_balance_minor >= 0),
  status TEXT NOT NULL DEFAULT 'SETTLED',
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ledger_owner_idempotency UNIQUE (owner_id, idempotency_key)
);

-- UI transactions list reads real settlements; vendor persisted at settle time.
ALTER TABLE ledger_entries ADD COLUMN IF NOT EXISTS vendor_name TEXT NOT NULL DEFAULT 'Unknown vendor';

CREATE TABLE IF NOT EXISTS settled_invoices (
  owner_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (owner_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id UUID PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
