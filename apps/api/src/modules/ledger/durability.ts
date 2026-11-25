import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AuditEvent, QrApprovalRecord } from '../../server.js';
import type { PayPalWebhookEvent, RailAction } from '../paypal/webhooks.js';

export interface RailEntryRow {
  readonly settlementId: string;
  readonly ownerId: string;
  readonly invoiceId: string;
  readonly idempotencyKey: string;
  readonly amountMinor: number;
  readonly status: string;
  readonly settledAt: string;
}

export interface RailEventRow {
  readonly eventId: string;
  readonly eventType: string;
  readonly captureId: string | null;
  readonly orderId: string | null;
  readonly referenceId: string | null;
  readonly receivedAt: string;
}

export interface RailStateReport {
  readonly unconfirmedEntries: readonly RailEntryRow[];
  readonly failedOrRefundedEntries: readonly RailEntryRow[];
  readonly recentEvents: readonly RailEventRow[];
}

export interface DurableStore {
  saveAuditEvent(event: AuditEvent): Promise<void>;
  loadAuditEvents(limit?: number): Promise<AuditEvent[]>;
  saveQrApproval(record: QrApprovalRecord): Promise<void>;
  markQrUsed(code: string): Promise<void>;
  loadPendingQrApprovals(): Promise<QrApprovalRecord[]>;
  saveRailEvent(event: PayPalWebhookEvent): Promise<'stored' | 'duplicate'>;
  applyRailAction(input: {
    readonly referenceId?: string | undefined;
    readonly action: RailAction;
  }): Promise<{ updated: number }>;
  getRailStateReport(): Promise<RailStateReport>;
  saveTrustedVendor?(input: {
    readonly vendorName: string;
    readonly whatsappPhone: string;
    readonly payoutAccount: string;
  }): Promise<void>;
  loadTrustedVendors?(): Promise<{
    readonly vendorName: string;
    readonly whatsappPhone: string;
    readonly payoutAccount: string;
  }[]>;
  saveCustomCatalogItem?(item: {
    readonly sku: string;
    readonly name: string;
    readonly vendorName: string;
    readonly description: string;
    readonly unitPriceMinor: number;
  }): Promise<void>;
  loadCustomCatalogItems?(): Promise<{
    readonly sku: string;
    readonly name: string;
    readonly vendorName: string;
    readonly description: string;
    readonly unitPriceMinor: number;
  }[]>;
}

interface QrApprovalRow {
  code: string;
  owner_id: string;
  proposal: unknown;
  idempotency_key: string;
  policy_version: string;
  trusted_vendors: unknown;
  hourly_spent_minor: string | number;
  initial_reason_code: string;
  invoice_text: string | null;
  expires_at: Date | string;
  used: boolean;
}

function rowToQrApproval(row: QrApprovalRow): QrApprovalRecord {
  return {
    code: row.code,
    ownerId: row.owner_id,
    proposal: row.proposal as QrApprovalRecord['proposal'],
    idempotencyKey: row.idempotency_key,
    policyVersion: row.policy_version,
    trustedVendors: row.trusted_vendors as QrApprovalRecord['trustedVendors'],
    hourlySpentMinor: Number(row.hourly_spent_minor),
    initialReasonCode: row.initial_reason_code,
    expiresAtMs: row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at),
    ...(row.invoice_text ? { invoiceText: row.invoice_text } : {}),
    used: row.used,
  };
}

export class PostgresDurabilityStore implements DurableStore {
  public constructor(private readonly pool: Pool) {}

  public async saveAuditEvent(event: AuditEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (event_id, owner_id, event_type, payload, created_at)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        randomUUID(),
        event.actor,
        event.action,
        JSON.stringify(event),
        event.timestamp,
      ],
    );
  }

  public async loadAuditEvents(limit = 200): Promise<AuditEvent[]> {
    const res = await this.pool.query<{ payload: AuditEvent }>(
      `SELECT payload FROM audit_events ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return res.rows.map((row) => row.payload);
  }

  public async saveQrApproval(record: QrApprovalRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO qr_approvals
         (code, owner_id, proposal, idempotency_key, policy_version,
          trusted_vendors, hourly_spent_minor, initial_reason_code,
          invoice_text, expires_at, used)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
       ON CONFLICT (code) DO NOTHING`,
      [
        record.code,
        record.ownerId,
        JSON.stringify(record.proposal),
        record.idempotencyKey,
        record.policyVersion,
        JSON.stringify(record.trustedVendors),
        record.hourlySpentMinor,
        record.initialReasonCode,
        record.invoiceText ?? null,
        new Date(record.expiresAtMs).toISOString(),
        record.used,
      ],
    );
  }

  public async markQrUsed(code: string): Promise<void> {
    await this.pool.query(`UPDATE qr_approvals SET used = TRUE WHERE code = $1`, [code]);
  }

  public async loadPendingQrApprovals(): Promise<QrApprovalRecord[]> {
    const res = await this.pool.query<QrApprovalRow>(
      `SELECT code, owner_id, proposal, idempotency_key, policy_version,
              trusted_vendors, hourly_spent_minor, initial_reason_code,
              invoice_text, expires_at, used
       FROM qr_approvals`,
    );
    return res.rows.map(rowToQrApproval);
  }

  public async saveRailEvent(event: PayPalWebhookEvent): Promise<'stored' | 'duplicate'> {
    const resource = event.resource ?? {};
    const res = await this.pool.query(
      `INSERT INTO rail_events
         (event_id, event_type, capture_id, order_id, reference_id, resource_status, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [
        event.id ?? '',
        event.event_type ?? 'UNKNOWN',
        typeof resource.id === 'string' ? resource.id : null,
        typeof resource.supplementary_data?.related_ids?.order_id === 'string'
          ? resource.supplementary_data.related_ids.order_id
          : null,
        typeof resource.reference_id === 'string' ? resource.reference_id : null,
        typeof resource.status === 'string' ? resource.status : null,
        JSON.stringify(event),
      ],
    );
    return res.rowCount === 0 ? 'duplicate' : 'stored';
  }

  public async applyRailAction(input: {
    readonly referenceId?: string;
    readonly action: RailAction;
  }): Promise<{ updated: number }> {
    if (!input.referenceId || input.action === 'RECORDED') {
      return { updated: 0 };
    }
    const res = await this.pool.query(
      `UPDATE ledger_entries
       SET status = $2
       WHERE idempotency_key = $1 AND status = 'SETTLED'`,
      [input.referenceId, input.action],
    );
    return { updated: res.rowCount ?? 0 };
  }

  public async getRailStateReport(): Promise<RailStateReport> {
    const unconfirmed = await this.pool.query<{
      settlement_id: string;
      owner_id: string;
      invoice_id: string;
      idempotency_key: string;
      amount_minor: string;
      status: string;
      settled_at: Date | string;
    }>(
      `SELECT settlement_id, owner_id, invoice_id, idempotency_key, amount_minor, status, settled_at
       FROM ledger_entries
       WHERE status = 'SETTLED' AND settled_at < NOW() - INTERVAL '1 hour'
       ORDER BY settled_at ASC
       LIMIT 100`,
    );
    const failedOrRefunded = await this.pool.query<{
      settlement_id: string;
      owner_id: string;
      invoice_id: string;
      idempotency_key: string;
      amount_minor: string;
      status: string;
      settled_at: Date | string;
    }>(
      `SELECT settlement_id, owner_id, invoice_id, idempotency_key, amount_minor, status, settled_at
       FROM ledger_entries
       WHERE status IN ('RAIL_FAILED', 'RAIL_REFUNDED')
       ORDER BY settled_at DESC
       LIMIT 100`,
    );
    const events = await this.pool.query<{
      event_id: string;
      event_type: string;
      capture_id: string | null;
      order_id: string | null;
      reference_id: string | null;
      received_at: Date | string;
    }>(
      `SELECT event_id, event_type, capture_id, order_id, reference_id, received_at
       FROM rail_events
       ORDER BY received_at DESC
       LIMIT 50`,
    );

    const mapEntry = (row: {
      settlement_id: string;
      owner_id: string;
      invoice_id: string;
      idempotency_key: string;
      amount_minor: string;
      status: string;
      settled_at: Date | string;
    }): RailEntryRow => ({
      settlementId: row.settlement_id,
      ownerId: row.owner_id,
      invoiceId: row.invoice_id,
      idempotencyKey: row.idempotency_key,
      amountMinor: Number(row.amount_minor),
      status: row.status,
      settledAt: row.settled_at instanceof Date ? row.settled_at.toISOString() : String(row.settled_at),
    });

    return {
      unconfirmedEntries: unconfirmed.rows.map(mapEntry),
      failedOrRefundedEntries: failedOrRefunded.rows.map(mapEntry),
      recentEvents: events.rows.map((row) => ({
        eventId: row.event_id,
        eventType: row.event_type,
        captureId: row.capture_id,
        orderId: row.order_id,
        referenceId: row.reference_id,
        receivedAt: row.received_at instanceof Date ? row.received_at.toISOString() : String(row.received_at),
      })),
    };
  }

  public async saveTrustedVendor(input: {
    readonly vendorName: string;
    readonly whatsappPhone: string;
    readonly payoutAccount: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO trusted_vendors (vendor_name, whatsapp_phone, payout_account)
       VALUES ($1, $2, $3)
       ON CONFLICT (vendor_name) DO UPDATE
       SET whatsapp_phone = EXCLUDED.whatsapp_phone, payout_account = EXCLUDED.payout_account, verified_at = NOW()`,
      [input.vendorName, input.whatsappPhone, input.payoutAccount],
    );
  }

  public async loadTrustedVendors(): Promise<{
    readonly vendorName: string;
    readonly whatsappPhone: string;
    readonly payoutAccount: string;
  }[]> {
    const res = await this.pool.query<{
      vendor_name: string;
      whatsapp_phone: string;
      payout_account: string;
    }>(`SELECT vendor_name, whatsapp_phone, payout_account FROM trusted_vendors ORDER BY verified_at DESC`);
    return res.rows.map((r) => ({
      vendorName: r.vendor_name,
      whatsappPhone: r.whatsapp_phone,
      payoutAccount: r.payout_account,
    }));
  }

  public async saveCustomCatalogItem(item: {
    readonly sku: string;
    readonly name: string;
    readonly vendorName: string;
    readonly description: string;
    readonly unitPriceMinor: number;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO custom_catalog_items (sku, name, vendor_name, description, unit_price_minor)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sku) DO UPDATE
       SET name = EXCLUDED.name, vendor_name = EXCLUDED.vendor_name, description = EXCLUDED.description, unit_price_minor = EXCLUDED.unit_price_minor`,
      [item.sku, item.name, item.vendorName, item.description, item.unitPriceMinor],
    );
  }

  public async loadCustomCatalogItems(): Promise<{
    readonly sku: string;
    readonly name: string;
    readonly vendorName: string;
    readonly description: string;
    readonly unitPriceMinor: number;
  }[]> {
    const res = await this.pool.query<{
      sku: string;
      name: string;
      vendor_name: string;
      description: string;
      unit_price_minor: string;
    }>(`SELECT sku, name, vendor_name, description, unit_price_minor FROM custom_catalog_items ORDER BY created_at DESC`);
    return res.rows.map((r) => ({
      sku: r.sku,
      name: r.name,
      vendorName: r.vendor_name,
      description: r.description,
      unitPriceMinor: Number(r.unit_price_minor),
    }));
  }
}
