import { buildServer } from './server.js';
import { createPayPalClient } from './modules/paypal/client.js';
import { createPayPalExecutor } from './modules/paypal/executor.js';

const port = Number(process.env.PORT ?? 4000);
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

const server = buildServer(500_000, paypalExecutor ? { paypalExecutor } : {});
const started = await server.listen(Number.isFinite(port) && port > 0 ? port : 4000);

console.log(`PayGuard API listening on http://localhost:${started.port}`);
console.log(
  paypalExecutor
    ? `PayPal Sandbox executor: CONNECTED (${paypalBaseUrl})`
    : 'PayPal Sandbox executor: NOT CONFIGURED (running in simulated in-memory ledger mode)',
);
console.log('The LLM proposes; deterministic financial policies dispose.');

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received - draining...`);
  await started.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
