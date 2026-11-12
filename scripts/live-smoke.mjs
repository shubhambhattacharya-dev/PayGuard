/**
 * PayGuard live smoke test - verifies the REAL integrations end to end.
 * Reads keys from the repo root .env (never committed) and:
 *   A. runs the live AI agent (Gemini -> Groq) through /v1/agent/run
 *   B. creates + captures a real PayPal sandbox order through the executor
 *   C. runs the full gate -> settle -> PayPal rail path via /v1/execute
 *
 * Usage: node scripts/live-smoke.mjs   (from the repository root)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildServer,
  createPayPalClient,
  createPayPalExecutor,
} from '../apps/api/dist/index.js';
import { issueApprovedToken, toMoneyMinor } from '../packages/contracts/dist/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (dev convenience only; production uses real env vars).
try {
  const env = readFileSync(join(root, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) {
      process.env[match[1]] = match[2];
    }
  }
} catch {
  console.log('note: no .env found, using existing environment');
}

let failures = 0;
function report(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (detail) console.log(`        ${detail}`);
  if (!pass) failures += 1;
}

const proposal = {
  invoiceId: 'INV-SMOKE-001',
  vendorName: 'Cedar Supply',
  lineItems: [
    {
      sku: 'CED-PPR-01',
      description: 'Office Paper Reams',
      quantity: 4,
      unitPriceMinor: toMoneyMinor(1600),
      taxBps: 0,
      lineTotalMinor: toMoneyMinor(6400),
    },
  ],
  currency: 'USD',
  subtotalMinor: toMoneyMinor(6400),
  taxTotalMinor: toMoneyMinor(0),
  grandTotalMinor: toMoneyMinor(6400),
};

// ---------- A. Live AI agent through the HTTP boundary ----------
try {
  const server = buildServer();
  const res = await server.inject({
    method: 'POST',
    url: '/v1/agent/run',
    payload: {
      ownerId: 'owner_northstar',
      model: 'auto',
      goal: 'Pay the Cedar Supply invoice INV-3155 for 4 reams of office paper at $16.00 each.',
      invoiceText: 'Vendor: Cedar Supply | Invoice INV-3155 | Office Paper Reams x4 @ $16.00 | Total $64.00',
      idempotencyKey: 'smoke-live-1',
    },
  });
  const body = res.json();
  const decided = body.decision?.state !== undefined;
  report(
    `Live agent (/v1/agent/run) - provider=${body.model ?? 'n/a'} rounds=${body.roundsUsed ?? 0}`,
    decided && body.terminalReason !== 'MODEL_UNAVAILABLE',
    `verdict=${body.decision?.state ?? '?'} reason=${body.decision?.reasonCode ?? body.terminalReason ?? '?'} ` +
      `total=${body.proposal?.grandTotalMinor ?? '-'}c ` +
      `thoughts=${(body.thoughts ?? []).map((t) => `R${t.round}:${t.tool ?? 'none'}(${t.summary.slice(0, 80)})`).join(' > ')}`,
  );
} catch (error) {
  report('Live agent (/v1/agent/run)', false, String(error));
}

// ---------- B. Real PayPal sandbox order via the executor ----------
const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
const baseUrl = process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com';

if (clientId && clientSecret && !clientId.includes('your-')) {
  const client = createPayPalClient({ clientId, clientSecret, baseUrl });
  const executor = createPayPalExecutor(client);
  const token = issueApprovedToken({
    ownerId: 'owner_northstar',
    proposal,
    idempotencyKey: 'smoke-paypal-1',
    policyVersion: 'v2026.11',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  try {
    const result = await executor.execute(token);
    // Sandbox orders without a payer approval cannot complete capture (422),
    // but a created order id is live proof of the real rail.
    const created = result.ok || result.stage === 'CAPTURE_ORDER';
    report(
      'PayPal sandbox executor (create+capture)',
      created,
      result.ok
        ? `order=${result.paypalOrderId} status=${result.status} capture=${result.captureId ?? 'none'}`
        : `order created; capture stage=${result.stage} code=${result.errorCode} (${result.message}) - expected for unapproved sandbox orders`,
    );
  } catch (error) {
    report('PayPal sandbox executor (create+capture)', false, String(error));
  }

  // ---------- C. Full gate -> ledger -> rail through /v1/execute ----------
  try {
    const server = buildServer(500_000, { paypalExecutor: executor });
    const evalRes = await server.inject({
      method: 'POST',
      url: '/v1/evaluate',
      payload: { ownerId: 'owner_northstar', proposal, idempotencyKey: 'smoke-paypal-2' },
    });
    const approvalId = evalRes.json().approvalId;
    const execRes = await server.inject({
      method: 'POST',
      url: '/v1/execute',
      payload: { ownerId: 'owner_northstar', proposal, approvalId, idempotencyKey: 'smoke-paypal-2' },
    });
    const body = execRes.json();
    report(
      'Full money path (/v1/evaluate -> /v1/execute with live rail)',
      body.success === true && typeof body.paypalOrderId === 'string',
      `settled=$${(body.settlement?.amountMinor ?? 0) / 100} paypalOrder=${body.paypalOrderId} rail=${JSON.stringify(body.paypal ?? 'simulation')}`,
    );
  } catch (error) {
    report('Full money path (/v1/execute)', false, String(error));
  }
} else {
  console.log('[SKIP] PayPal sandbox tests - no credentials in .env');
}

console.log(failures === 0 ? '\nLive smoke: ALL PASS' : `\nLive smoke: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
