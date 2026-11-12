export { buildServer } from './server.js';
export type {
  PayGuardServer,
  InjectOptions,
  InjectResponse,
  EvaluateRequestPayload,
  ExecuteRequestPayload,
  QrApprovalRecord,
  BuildServerOptions,
} from './server.js';
export { createPayPalClient, type PayPalClient, type PayPalConfig } from './modules/paypal/client.js';
export { createPayPalExecutor, type PayPalExecutor, type PayPalExecutionResult } from './modules/paypal/executor.js';
export {
  runAgentLoop,
  createProviderChatFn,
  createFixtureChatFn,
  buildVendorDocumentFence,
  buildSystemPrompt,
  MAX_ROUNDS,
  type AgentChatFn,
  type AgentChatMessage,
  type AgentRunResult,
  type AgentThought,
  type ProviderConfig,
  type ProviderName,
} from './modules/agent/runner.js';
export { createCatalog, DEFAULT_CATALOG, type CatalogItem, type CatalogStore } from './modules/agent/catalog.js';
export { detectPromptInjection } from './server.js';
