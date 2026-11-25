CREATE TABLE IF NOT EXISTS rail_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  capture_id TEXT,
  order_id TEXT,
  reference_id TEXT,
  resource_status TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qr_approvals (
  code TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  proposal JSONB NOT NULL,
  idempotency_key TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  trusted_vendors JSONB NOT NULL,
  hourly_spent_minor BIGINT NOT NULL DEFAULT 0,
  initial_reason_code TEXT NOT NULL,
  invoice_text TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_settled_invoices_invoice_id
  ON settled_invoices (invoice_id);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_owner_time
  ON ledger_entries (owner_id, settled_at);
