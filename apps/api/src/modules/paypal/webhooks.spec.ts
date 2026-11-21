import { describe, it, expect, vi } from 'vitest';
import { createPayPalClient } from './client.js';
import { verifyPayPalWebhookSignature, classifyCaptureEvent } from './webhooks.js';
import { buildServer } from '../../server.js';
import type { DurableStore } from '../ledger/durability.js';
import type { AuditEvent, QrApprovalRecord } from '../../server.js';
import type { PayPalWebhookEvent } from './webhooks.js';

/**
 * Webhook receiver (P1 reconciliation): PayPal's signature is the identity.
 * Anything that is not provably PayPal fails closed; verified events are
 * stored idempotently and drive ledger rail-state updates.
 */

// camelCase shape for direct verifyPayPalWebhookSignature() calls.
const VALID_HEADERS = {
  authAlgo: 'SHA256withRSA',
  certUrl: 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-36064242-4438-11ee-9f70-3f2d4fb47a34',
  transmissionId: '49e07c81-b19c-4a7d-9d02-c1a0a4f72280',
  transmissionSig: 'Ad99VFeH-left-pad-not-real-signature-0000000000',
  transmissionTime: '2026-11-21T10:00:00Z',
};

// Kebab-case HTTP headers as PayPal transmits them (server.inject calls).
const HTTP_HEADERS = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-36064242-4438-11ee-9f70-3f2d4fb47a34',
  'paypal-transmission-id': '49e07c81-b19c-4a7d-9d02-c1a0a4f72280',
  'paypal-transmission-sig': 'Ad99VFeH-left-pad-not-real-signature-0000000000',
  'paypal-transmission-time': '2026-11-21T10:00:00Z',
};

const SAMPLE_EVENT = {
  id: 'WH-1A2B3C4D-5E6F',
  event_type: 'PAYMENT.CAPTURE.COMPLETED',
  resource_type: 'capture',
  resource: {
    id: 'CAPTURE-01',
    status: 'COMPLETED',
    reference_id: 'idem_test_01',
    custom_id: 'idem_test_01',
  },
} as const;

function makeClient(verificationStatus: 'SUCCESS' | 'FAILURE') {
  const fetchFn = vi.fn(async (url: string | URL | Request) => {
    const href = typeof url === 'string' ? url : url.toString();
    if (href.includes('/v1/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ verification_status: verificationStatus }), { status: 200 });
  });
  const client = createPayPalClient({ clientId: 'cid', clientSecret: 'csecret', baseUrl: 'https://api-m.sandbox.paypal.com' }, { fetchFn: fetchFn as unknown as typeof fetch });
  return { client, fetchFn };
}

class FakeDurability implements DurableStore {
  public railEvents = new Map<string, PayPalWebhookEvent>();
  public auditLog: AuditEvent[] = [];
  public qrStore = new Map<string, QrApprovalRecord>();

  async saveAuditEvent(event: AuditEvent): Promise<void> {
    this.auditLog.push(event);
  }
  async saveQrApproval(record: QrApprovalRecord): Promise<void> {
    this.qrStore.set(record.code, record);
  }
  async markQrUsed(code: string): Promise<void> {
    const rec = this.qrStore.get(code);
    if (rec) rec.used = true;
  }
  async loadPendingQrApprovals(): Promise<QrApprovalRecord[]> {
    return Array.from(this.qrStore.values()).filter((r) => !r.used);
  }
  async saveRailEvent(event: PayPalWebhookEvent): Promise<'stored' | 'duplicate'> {
    if (!event.id || this.railEvents.has(event.id)) return 'duplicate';
    this.railEvents.set(event.id, event);
    return 'stored';
  }
  async applyRailAction(): Promise<{ updated: number }> {
    return { updated: 0 };
  }
  async getRailStateReport() {
    return { unconfirmedEntries: [], failedOrRefundedEntries: [], recentEvents: [] };
  }
}

describe('verifyPayPalWebhookSignature (fail closed)', () => {
  it('rejects missing PayPal headers without contacting PayPal', async () => {
    const { client, fetchFn } = makeClient('SUCCESS');
    const outcome = await verifyPayPalWebhookSignature(
      { client, webhookIds: ['WHID'] },
      { headers: { authAlgo: 'SHA256withRSA' }, event: SAMPLE_EVENT },
    );
    expect(outcome).toEqual({ verified: false, reason: 'MISSING_HEADERS' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects malformed events (no id / event_type) before verification', async () => {
    const { client } = makeClient('SUCCESS');
    const outcome = await verifyPayPalWebhookSignature(
      { client, webhookIds: ['WHID'] },
      { headers: VALID_HEADERS, event: { foo: 'bar' } },
    );
    expect(outcome).toEqual({ verified: false, reason: 'MALFORMED_EVENT' });
  });

  it('rejects non-PayPal cert URLs (defense in depth)', async () => {
    const { client, fetchFn } = makeClient('SUCCESS');
    const outcome = await verifyPayPalWebhookSignature(
      { client, webhookIds: ['WHID'] },
      {
        headers: { ...VALID_HEADERS, certUrl: 'https://evil.example.com/cert.pem' },
        event: SAMPLE_EVENT,
      },
    );
    expect(outcome).toEqual({ verified: false, reason: 'CERT_URL_NOT_PAYPAL' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fails closed when PayPal verdicts FAILURE', async () => {
    const { client } = makeClient('FAILURE');
    const outcome = await verifyPayPalWebhookSignature(
      { client, webhookIds: ['WHID'] },
      { headers: VALID_HEADERS, event: SAMPLE_EVENT },
    );
    expect(outcome).toEqual({ verified: false, reason: 'PAYPAL_REJECTED' });
  });

  it('fails closed when the verify endpoint is unreachable', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response('boom', { status: 500 });
    });
    const client = createPayPalClient({ clientId: 'cid', clientSecret: 'cs', baseUrl: 'https://api-m.sandbox.paypal.com' }, { fetchFn: fetchFn as unknown as typeof fetch });
    const outcome = await verifyPayPalWebhookSignature(
      { client, webhookIds: ['WHID'] },
      { headers: VALID_HEADERS, event: SAMPLE_EVENT },
    );
    expect(outcome).toEqual({ verified: false, reason: 'PAYPAL_UNREACHABLE' });
  });

  it('verifies when PayPal verdicts SUCCESS', async () => {
    const { client } = makeClient('SUCCESS');
    const outcome = await verifyPayPalWebhookSignature(
      { client, webhookIds: ['WHID'] },
      { headers: VALID_HEADERS, event: SAMPLE_EVENT },
    );
    expect(outcome.verified).toBe(true);
  });

  it('verifies against the matching webhook id when several are configured (one-event-per-webhook setup)', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('/v1/oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { webhook_id?: string };
      return new Response(
        JSON.stringify({ verification_status: body.webhook_id === 'WH-DENIED' ? 'SUCCESS' : 'FAILURE' }),
        { status: 200 },
      );
    });
    const client = createPayPalClient(
      { clientId: 'cid', clientSecret: 'cs', baseUrl: 'https://api-m.sandbox.paypal.com' },
      { fetchFn: fetchFn as unknown as typeof fetch },
    );
    const outcome = await verifyPayPalWebhookSignature(
      { client, webhookIds: ['WH-CAPTURE', 'WH-DENIED'] },
      { headers: VALID_HEADERS, event: SAMPLE_EVENT },
    );
    expect(outcome.verified).toBe(true);
  });
});

describe('classifyCaptureEvent', () => {
  it('maps completed / denied / refunded families; unknowns are RECORDED', () => {
    expect(classifyCaptureEvent('PAYMENT.CAPTURE.COMPLETED')).toBe('RAIL_CONFIRMED');
    expect(classifyCaptureEvent('PAYMENT.CAPTURE.DENIED')).toBe('RAIL_FAILED');
    expect(classifyCaptureEvent('PAYMENT.CAPTURE.REFUNDED')).toBe('RAIL_REFUNDED');
    expect(classifyCaptureEvent('CHECKOUT.ORDER.APPROVED')).toBe('RECORDED');
    expect(classifyCaptureEvent(undefined)).toBe('RECORDED');
  });
});

describe('POST /v1/webhooks/paypal route', () => {
  it('503s without webhook config or without durable store (fail closed)', async () => {
    const { client } = makeClient('SUCCESS');
    const noConfig = buildServer(500_000, { durability: new FakeDurability() });
    const resNoConfig = await noConfig.inject({ method: 'POST', url: '/v1/webhooks/paypal', payload: SAMPLE_EVENT, headers: HTTP_HEADERS });
    expect(resNoConfig.statusCode).toBe(503);

    const noDurability = buildServer(500_000, { paypalWebhook: { client, webhookIds: ['WHID'] } });
    const resNoDurability = await noDurability.inject({ method: 'POST', url: '/v1/webhooks/paypal', payload: SAMPLE_EVENT, headers: HTTP_HEADERS });
    expect(resNoDurability.statusCode).toBe(503);
    expect(resNoDurability.json<{ error: string }>().error).toBe('WEBHOOKS_REQUIRE_DURABLE_STORE');
  });

  it('processes a verified capture event once and ignores the replay', async () => {
    const { client } = makeClient('SUCCESS');
    const durability = new FakeDurability();
    const server = buildServer(500_000, { paypalWebhook: { client, webhookIds: ['WHID'] }, durability });

    const first = await server.inject({ method: 'POST', url: '/v1/webhooks/paypal', payload: SAMPLE_EVENT, headers: HTTP_HEADERS });
    expect(first.statusCode).toBe(200);
    const body = first.json<{ status: string; action: string }>();
    expect(body.status).toBe('processed');
    expect(body.action).toBe('RAIL_CONFIRMED');
    expect(durability.railEvents.has(SAMPLE_EVENT.id)).toBe(true);
    expect(durability.auditLog.length).toBeGreaterThan(0);

    const replay = await server.inject({ method: 'POST', url: '/v1/webhooks/paypal', payload: SAMPLE_EVENT, headers: HTTP_HEADERS });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ status: string }>().status).toBe('duplicate_ignored');
  });

  it('401s a tampered transmission (PayPal verdicts FAILURE)', async () => {
    const { client } = makeClient('FAILURE');
    const durability = new FakeDurability();
    const server = buildServer(500_000, { paypalWebhook: { client, webhookIds: ['WHID'] }, durability });

    const res = await server.inject({ method: 'POST', url: '/v1/webhooks/paypal', payload: SAMPLE_EVENT, headers: HTTP_HEADERS });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ reason: string }>().reason).toBe('PAYPAL_REJECTED');
    expect(durability.railEvents.size).toBe(0);
  });
});
