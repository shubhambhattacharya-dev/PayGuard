import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { buildServer } from './server.js';
import { createPgPool, runMigrations } from './db/pool.js';
import { PostgresLedger } from './modules/ledger/postgres-ledger.js';
import { PostgresDurabilityStore } from './modules/ledger/durability.js';
import { HOURLY_VELOCITY_CAP_MINOR } from './modules/policy/gate.js';
import { createLangfuseReporter } from './modules/observability/telemetry.js';
import { createPayPalClient } from './modules/paypal/client.js';
import { createPayPalExecutor } from './modules/paypal/executor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../../.env');
if (!process.env.DATABASE_URL && existsSync(rootEnvPath) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(rootEnvPath);
}

const DEFAULT_SEED_BALANCE_MINOR = 500_000;
const port = Number(process.env.PORT ?? 4000);
const databaseUrl = process.env.DATABASE_URL?.trim() ?? '';
const paypalClientId = process.env.PAYPAL_CLIENT_ID?.trim() ?? '';
const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() ?? '';
const paypalBaseUrl = process.env.PAYPAL_BASE_URL?.trim() || 'https://api-m.sandbox.paypal.com';
const paypalWebhookIds = (process.env.PAYPAL_WEBHOOK_ID ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

const paypalExecutor =
  paypalClientId && paypalClientSecret
    ? createPayPalExecutor(
        createPayPalClient({
          clientId: paypalClientId,
          clientSecret: paypalClientSecret,
          baseUrl: paypalBaseUrl,
        }),
      )
    : undefined;

let pool: Pool | undefined;
let ledger: PostgresLedger | undefined;
let durabilityStore: PostgresDurabilityStore | undefined;

if (databaseUrl) {
  pool = createPgPool(databaseUrl);
  await runMigrations(pool);
  // Seed demo accounts only if missing so restarts never overwrite real balances.
  await pool.query(
    `INSERT INTO ledger_accounts (owner_id, balance_minor)
     VALUES ($1, $3), ($2, $3)
     ON CONFLICT (owner_id) DO NOTHING`,
    ['owner_northstar', 'owner_1', DEFAULT_SEED_BALANCE_MINOR],
  );
  // Velocity cap enforced INSIDE the settle transaction (race-proof).
  ledger = new PostgresLedger(pool, HOURLY_VELOCITY_CAP_MINOR);
  durabilityStore = new PostgresDurabilityStore(pool);
}

const langfuse = createLangfuseReporter();

// --- Auth: fail closed at boot (P0-1 fix) ---
// Production requires PAYGUARD_API_KEYS ("apiKey:ownerId,..." CSV).
// Demo/test mode must be an explicit opt-out via PAYGUARD_AUTH_DISABLED=true.
const authDisabled = process.env.PAYGUARD_AUTH_DISABLED === 'true';
const rawKeys = process.env.PAYGUARD_API_KEYS?.trim() ?? '';
const authKeys = new Map<string, string>();
for (const entry of rawKeys.split(',')) {
  const [key, owner] = entry.split(':').map((part) => part?.trim());
  if (key && owner) {
    authKeys.set(key, owner);
  }
}
if (!authDisabled && authKeys.size === 0) {
  console.error(
    'REFUSING TO START: no auth configured. Set PAYGUARD_API_KEYS ("apiKey:ownerId,...") ' +
      'or explicitly set PAYGUARD_AUTH_DISABLED=true for demo mode. Money APIs never run unauthenticated by default.',
  );
  process.exit(1);
}
const auth = authKeys.size > 0 ? { keys: authKeys } : undefined;

// --- PayPal webhook verification inputs ---
// PAYPAL_WEBHOOK_ID accepts a CSV: one webhook per event type is a valid
// PayPal setup, and every webhook has its own verification id.
const paypalWebhook =
  paypalExecutor && paypalWebhookIds.length > 0
    ? {
        // The webhook verifies signatures through the same OAuth-capable client.
        client: createPayPalClient({
          clientId: paypalClientId,
          clientSecret: paypalClientSecret,
          baseUrl: paypalBaseUrl,
        }),
        webhookIds: paypalWebhookIds,
      }
    : undefined;

const server = buildServer(DEFAULT_SEED_BALANCE_MINOR, {
  ...(paypalExecutor ? { paypalExecutor } : {}),
  ...(paypalWebhook ? { paypalWebhook } : {}),
  ...(ledger ? { ledger } : {}),
  ...(durabilityStore ? { durability: durabilityStore } : {}),
  ...(auth ? { auth } : {}),
  ...(langfuse ? { langfuse } : {}),
  ...(pool
    ? {
        readinessCheck: async () => {
          try {
            await pool.query('SELECT 1');
            return true;
          } catch {
            return false;
          }
        },
      }
    : {}),
});
await server.hydrate();

const started = await server.listen(Number.isFinite(port) && port > 0 ? port : 4000);

console.log(`PayGuard API listening on http://localhost:${started.port}`);
console.log(
  auth
    ? `Auth: API-key auth ENABLED (${authKeys.size} key(s), identity from key only)`
    : 'Auth: DISABLED (explicit demo mode via PAYGUARD_AUTH_DISABLED=true - never use with real money APIs)',
);
console.log(
  ledger
    ? 'Ledger store: PostgreSQL (durable, SELECT FOR UPDATE, in-txn velocity + duplicate guards)'
    : 'Ledger store: In-Memory (ephemeral fallback - demo only)',
);
console.log(
  durabilityStore
    ? 'Durability: audit evidence + pending QR approvals + rail events persisted to PostgreSQL'
    : 'Durability: in-memory only (restarts lose pending approvals and audit history)',
);
console.log(
  langfuse
    ? 'Observability: Structured JSON logs + Langfuse tracing CONNECTED'
    : 'Observability: Structured JSON logs (Langfuse keys not set)',
);
console.log(
  paypalExecutor
    ? `PayPal Sandbox executor: CONNECTED (${paypalBaseUrl})`
    : `PayPal Sandbox executor: NOT CONFIGURED (running in simulated ${ledger ? 'PostgreSQL' : 'in-memory'} ledger mode)`,
);
console.log(
  paypalWebhook
    ? 'PayPal webhook receiver: ENABLED at POST /v1/webhooks/paypal (signature-verified)'
    : 'PayPal webhook receiver: NOT CONFIGURED (set PAYPAL_WEBHOOK_ID to enable reconciliation)',
);
console.log('The LLM proposes; deterministic financial policies dispose.');

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received - draining...`);
  await started.close();
  if (pool) {
    await pool.end();
  }
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
