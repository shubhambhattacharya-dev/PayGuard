-- Backfill legacy settlements whose vendor_name predates the column.
-- Existing rows received the 'Unknown vendor' default when 001 added the
-- column; audit events already recorded the real vendor for those invoices.
-- This is idempotent: it only touches rows still marked 'Unknown vendor'.

UPDATE ledger_entries AS le
SET vendor_name = source.vendor
FROM (
  SELECT DISTINCT ON (payload->>'invoiceId')
    payload->>'invoiceId' AS invoice_id,
    payload->>'vendor' AS vendor
  FROM audit_events
  WHERE payload->>'vendor' IS NOT NULL
    AND payload->>'vendor' <> ''
  ORDER BY (payload->>'invoiceId'), created_at DESC
) AS source
WHERE le.vendor_name = 'Unknown vendor'
  AND le.invoice_id = source.invoice_id;
