import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { buildServer } from './server.js';
import { createPgPool, runMigrations } from './db/pool.js';
import { PostgresLedger } from './modules/ledger/postgres-ledger.js';
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
  ledger = new PostgresLedger(pool);
}

const langfuse = createLangfuseReporter();

const server = buildServer(DEFAULT_SEED_BALANCE_MINOR, {
  ...(paypalExecutor ? { paypalExecutor } : {}),
  ...(ledger ? { ledger } : {}),
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
const started = await server.listen(Number.isFinite(port) && port > 0 ? port : 4000);

console.log(`PayGuard API listening on http://localhost:${started.port}`);
console.log(
  ledger
    ? 'Ledger store: PostgreSQL (durable, SELECT FOR UPDATE)'
    : 'Ledger store: In-Memory (ephemeral fallback)',
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
