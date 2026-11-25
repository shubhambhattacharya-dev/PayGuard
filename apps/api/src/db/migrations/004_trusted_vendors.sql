CREATE TABLE IF NOT EXISTS trusted_vendors (
  vendor_name TEXT PRIMARY KEY,
  whatsapp_phone TEXT NOT NULL,
  payout_account TEXT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_catalog_items (
  sku TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  description TEXT NOT NULL,
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
