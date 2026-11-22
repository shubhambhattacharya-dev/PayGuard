import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  OrderProposalSchema,
  ReasonCode,
  issueApprovedToken,
  toPublicPolicyDecision,
  type ApprovedForExecution,
  type OrderProposal,
  type PolicyDecision,
} from '@payguard/contracts';
import { evaluatePolicy } from './modules/policy/gate.js';
import { verifyQuoteGrounding, type QuoteCitation } from './modules/policy/quote-matcher.js';
import { InMemoryLedger, LedgerStore, type SettlementResult } from './modules/ledger/ledger.js';
import { PostgresLedger } from './modules/ledger/postgres-ledger.js';
import type { DurableStore } from './modules/ledger/durability.js';
import {
  verifyPayPalWebhookSignature,
  classifyCaptureEvent,
  type PayPalWebhookConfig,
  type PayPalWebhookEvent,
} from './modules/paypal/webhooks.js';
import {
  runAgentLoop,
  createProviderChatFn,
  createFixtureChatFn,
  type AgentChatFn,
  type AgentRunResult,
  type ProviderName,
} from './modules/agent/runner.js';
import { createCatalog, type CatalogStore } from './modules/agent/catalog.js';
import type { PayPalExecutor, PayPalExecutionResult } from './modules/paypal/executor.js';
import {
  emitStructuredLog,
  type LangfuseReporter,
  type TelemetrySpan,
  type TracePayload,
} from './modules/observability/telemetry.js';


export interface InjectOptions {
  readonly method: 'GET' | 'POST' | 'OPTIONS';
  readonly url: string;
  readonly payload?: unknown;
  readonly headers?: Record<string, string>;
  /** Original request body bytes — webhook postback fidelity depends on it. */
  readonly rawBody?: string;
}

export interface InjectResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  json<R = T>(): R;
}

export interface EvaluateRequestPayload {
  readonly ownerId: string;
  readonly proposal: OrderProposal;
  readonly trustedVendors?: readonly string[];
  readonly isDuplicateInvoice?: boolean;
  readonly hourlySpentMinor?: number;
  readonly policyVersion?: string;
  readonly idempotencyKey?: string;
  readonly invoiceText?: string;
  readonly citation?: QuoteCitation;
  readonly vendorDestination?: {
    readonly trustedAccount: string;
    readonly invoiceAccount: string;
  };
}

export interface ExecuteRequestPayload {
  readonly ownerId: string;
  readonly proposal: OrderProposal;
  readonly idempotencyKey: string;
  readonly approvalId?: string;
  readonly token?: ApprovedForExecution;
}

export interface QrApprovalRecord {
  readonly code: string;
  readonly ownerId: string;
  readonly proposal: OrderProposal;
  readonly idempotencyKey: string;
  readonly policyVersion: string;
  readonly trustedVendors: readonly string[];
  readonly hourlySpentMinor: number;
  readonly initialReasonCode: string;
  readonly expiresAtMs: number;
  readonly invoiceText?: string;
  used: boolean;
  outcome?: 'APPROVED' | 'REJECTED';
}

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly ownerId?: string;
  readonly action: 'EVALUATE' | 'AGENT_RUN' | 'HITL_APPROVE' | 'TX_APPROVE' | 'TX_REJECT' | 'EXECUTE';
  readonly actor: string;
  readonly invoiceId: string;
  readonly vendor: string;
  readonly amountMinor: number;
  readonly decisionState: string;
  readonly reasonCode: string;
  readonly detail: string;
}

export interface LedgerTransactionRecord {
  id: string;
  vendor: string;
  invoiceNumber: string;
  amountFormatted: string;
  amountMinor: number;
  status: 'Review required' | 'Paid' | 'On hold' | 'Blocked';
  policyCode: string;
  dateFormatted: string;
  canApproveReject: boolean;
  qrCode?: string;
  paypalOrderId?: string;
  proposal: OrderProposal;
}

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /forget\s+(all\s+)?(previous\s+)?instructions/i,
  /disregard\s+(all\s+)?(policy|limits|instructions)/i,
  /bypass\s+(all\s+)?(policy|approval|gate|limits)/i,
  /override\s+(all\s+)?(policy|limits)/i,
  /system\s+override/i,
  /pre-approved\s+for\s+\$/i,
  /auto-approval\s+limit\s+raised/i,
  /(BEGIN|END)_VENDOR_DOCUMENT/i,
];

export function detectPromptInjection(text: string): string | null {
  const normalized = text.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '');
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

/** Maker-checker roles: 'proposer' drafts, 'approver' moves money, 'admin' does both. */
export type ApiKeyRole = 'admin' | 'proposer' | 'approver';

const MONEY_MOVING_ROLES: readonly ApiKeyRole[] = ['approver', 'admin'];

export interface BuildServerOptions {
  /**
   * PayPal rail behind the policy gate. When omitted, /v1/execute settles the
   * in-memory ledger and returns a simulated sandbox reference (offline demo).
   */
  paypalExecutor?: PayPalExecutor;
  /**
   * PayPal webhook verification inputs (client + webhook id). The webhook
   * route stays public; PayPal's signature is the identity.
   */
  readonly paypalWebhook?: PayPalWebhookConfig;
  readonly ledger?: LedgerStore
  /**
   * API-key auth. Key -> ownerId map (plus optional key -> role map for
   * maker-checker: 'proposer' | 'approver' | 'admin', default admin); every
   * /v1 route (except health and the signature-verified webhook route) then
   * requires `Authorization: Bearer`. Identity is always taken from the key,
   * never from the request body. Money-moving routes additionally require an
   * approver/admin role. `undefined` = auth disabled (demo/test mode only).
   */
  readonly auth?: {
    readonly keys: ReadonlyMap<string, string>;
    readonly roles?: ReadonlyMap<string, ApiKeyRole>;
  };
  /** Durable side-store: audit evidence, pending QR approvals, rail events. */
  readonly durability?: DurableStore;
  /**
   * Agent chat function. `undefined` = auto (Gemini -> Groq from env keys);
   * `null` = no model available, agent route fails closed to HOLD;
   * a function = injected model (tests / recorded fixture replay).
   */
  readonly agentChat?: AgentChatFn | null;
  readonly agentProvider?: ProviderName;
  readonly catalog?: CatalogStore;
  readonly corsOrigin?: string;
  readonly rateLimitPerMinute?: number;
  readonly readinessCheck?: () => Promise<boolean>;
  readonly langfuse?: LangfuseReporter | null;
  readonly enableStructuredLogs?: boolean;
}

export interface AgentRunRequestPayload {
  readonly ownerId: string;
  readonly invoiceText: string;
  readonly goal?: string;
  readonly idempotencyKey?: string;
  readonly model?: 'auto' | 'fixture';
}

export interface PayGuardServer {
  readonly ledger: LedgerStore;
  readonly capabilityVault: Map<string, ApprovedForExecution>;
  readonly qrApprovals: Map<string, QrApprovalRecord>;
  inject<T = unknown>(options: InjectOptions): Promise<InjectResponse<T>>;
  /** Restores pending QR approvals from the durable store (call once at boot). */
  hydrate(): Promise<void>;
  listen(port?: number): Promise<{ port: number; close: () => Promise<void> }>;
}

export function buildServer(initialSeedBalanceMinor = 500_000, serverOptions: BuildServerOptions = {}): PayGuardServer {
  const ledger = serverOptions.ledger ?? new InMemoryLedger();
  // Durable PostgreSQL mode must never fall back to demo seed rows: real
  // deployments should show only persisted settlements and approvals.
  const isDurableLedger = ledger instanceof PostgresLedger;
  if (!serverOptions.ledger) {
    ledger.seedAccount('owner_northstar', initialSeedBalanceMinor);
    ledger.seedAccount('owner_1', initialSeedBalanceMinor);

  }


  const capabilityVault = new Map<string, ApprovedForExecution>();
  const qrApprovals = new Map<string, QrApprovalRecord>();
  const inFlightQrCodes = new Set<string>();
  const settledExecutionEnvelopes = new Map<string, Record<string, unknown>>();
  // Velocity is read from the ledger store (durable under PostgreSQL, receipt-derived in memory).
  const getHourlySpentMinor = async (ownerId: string): Promise<number> =>
    ledger.getHourlySpentMinor(ownerId);
  // QR codes: 64 bits of entropy (was 32). Single-use codes must not be guessable.
  const newQrCode = (): string => `PG-${randomBytes(8).toString('hex').toUpperCase()}`;
  const durability = serverOptions.durability;
  const pushAudit = (event: AuditEvent): void => {
    auditEvents.unshift(event);
    // Durable evidence is best-effort: the in-memory array stays authoritative
    // for the read path; a failed insert must not fail the money path.
    if (durability) {
      void durability.saveAuditEvent(event).catch(() => {});
    }
  };
  const rateLimitHits = new Map<string, number[]>();
  const rateLimitPerMinute = serverOptions.rateLimitPerMinute ?? 60;
  const checkRateLimit = (key: string): number | null => {
    const now = Date.now();
    const cutoff = now - 60_000;
    const hits = (rateLimitHits.get(key) ?? []).filter((ts) => ts >= cutoff);
    if (hits.length >= rateLimitPerMinute) {
      const retryAfterSec = Math.max(1, Math.ceil((hits[0]! + 60_000 - now) / 1000));
      rateLimitHits.set(key, hits);
      return retryAfterSec;
    }
    hits.push(now);
    rateLimitHits.set(key, hits);
    return null;
  };
  const pruneInMemoryStores = (): void => {
    const now = Date.now();
    for (const [code, rec] of qrApprovals.entries()) {
      if (now >= rec.expiresAtMs + 60 * 60_000) {
        qrApprovals.delete(code);
      }
    }
    for (const [id, tok] of capabilityVault.entries()) {
      if (Date.parse(tok.expiresAt) <= now) {
        capabilityVault.delete(id);
      }
    }
    if (auditEvents.length > 500) {
      auditEvents.length = 500;
    }
    if (settledExecutionEnvelopes.size > 500) {
      const oldestKey = settledExecutionEnvelopes.keys().next().value;
      if (oldestKey) settledExecutionEnvelopes.delete(oldestKey);
    }
  };
  const settledKey = (owner: string, invoiceId: string): string => `${owner}:${invoiceId}`;
  const settledInvoices = new Set<string>(isDurableLedger ? [] : [settledKey('owner_northstar', 'INV-3150')]);
  const auditEvents: AuditEvent[] = isDurableLedger
    ? []
    : [
        {
          id: 'evt-seed-1',
          timestamp: '2026-11-01T09:14:00.000Z',
          action: 'EVALUATE',
          actor: 'policy-gate',
          invoiceId: 'INV-2048',
          vendor: 'Aster Cloud',
          amountMinor: 84250,
          decisionState: 'HOLD',
          reasonCode: ReasonCode.HOLD_OVER_CAP,
          detail: 'Example: $842.50 exceeds $100.00 auto-cap; single-use QR PG-7F3K-9D2L issued.',
        },
      ];
  const catalog: CatalogStore = serverOptions.catalog ?? createCatalog();

  const defaultTrustedVendors = [
    'Aster Cloud',
    'Lumen Office',
    'Cedar Supply',
    'Bluebird Logistics',
    'Acme Cloud Corp',
  ];
  const defaultTrustedVendorAccounts: Record<string, string> = {
    'Aster Cloud': 'ACCT-ASTER-01',
    'Lumen Office': 'ACCT-LUMEN-01',
    'Cedar Supply': 'ACCT-CEDAR-01',
    'Bluebird Logistics': 'ACCT-BLUEBIRD-01',
    'Acme Cloud Corp': 'ACCT-ACME-01',
  };

  const makeSeedProposal = (
    invoiceId: string,
    vendorName: string,
    sku: string,
    description: string,
    amountMinor: number,
  ): OrderProposal => ({
    invoiceId,
    vendorName,
    lineItems: [
      {
        sku,
        description,
        quantity: 1,
        unitPriceMinor: amountMinor as OrderProposal['lineItems'][number]['unitPriceMinor'],
        taxBps: 0,
        lineTotalMinor: amountMinor as OrderProposal['lineItems'][number]['lineTotalMinor'],
      },
    ],
    currency: 'USD',
    subtotalMinor: amountMinor as OrderProposal['subtotalMinor'],
    taxTotalMinor: 0 as OrderProposal['taxTotalMinor'],
    grandTotalMinor: amountMinor as OrderProposal['grandTotalMinor'],
  });

  const transactions: LedgerTransactionRecord[] = isDurableLedger ? [] : [
    {
      id: 'tx-1',
      vendor: 'Aster Cloud',
      invoiceNumber: 'INV-2048',
      amountFormatted: '$842.50',
      amountMinor: 84250,
      status: 'Review required',
      policyCode: 'HOLD_OVER_CAP',
      dateFormatted: 'Nov 1, 2026',
      canApproveReject: true,
      qrCode: 'PG-7F3K-9D2L',
      proposal: makeSeedProposal('INV-2048', 'Aster Cloud', 'AC-PRO-001', 'Aster Cloud Professional Plan', 84250),
    },
  ];

  if (!isDurableLedger && transactions[0]) {
    qrApprovals.set('PG-7F3K-9D2L', {
      code: 'PG-7F3K-9D2L',
      ownerId: 'owner_northstar',
      proposal: transactions[0].proposal,
      idempotencyKey: 'idem_seed_tx1',
      policyVersion: 'v2026.11',
      trustedVendors: defaultTrustedVendors,
      hourlySpentMinor: 0,
      initialReasonCode: ReasonCode.HOLD_OVER_CAP,
      expiresAtMs: Date.now() + 24 * 60 * 60_000,
      used: false,
    });
  }

  async function handleRequest(options: InjectOptions): Promise<InjectResponse> {
    pruneInMemoryStores();
    const reqStartMs = performance.now();
    const reqStartIso = new Date().toISOString();
    const traceId = options.headers?.['x-request-id']?.trim() || randomUUID();
    const metrics: {
      ownerId?: string;
      llmMs?: number;
      dbMs?: number;
      paypalMs?: number;
      decisionState?: string;
      reasonCode?: string;
      spans: TelemetrySpan[];
    } = { spans: [] };

    const recordSpan = async <T>(
      name: string,
      fn: () => Promise<T>,
      onDone?: (durationMs: number) => void,
    ): Promise<T> => {
      const startMs = performance.now();
      const startTime = new Date().toISOString();
      try {
        return await fn();
      } finally {
        const durationMs = Math.round((performance.now() - startMs) * 100) / 100;
        const endTime = new Date().toISOString();
        metrics.spans.push({ name, startTime, endTime, durationMs });
        onDone?.(durationMs);
      }
    };

    // Authed mode defaults to restrictive CORS: the dashboard talks through the
    // same-origin Next proxy, so no cross-origin header is emitted unless
    // explicitly configured. Demo mode keeps the legacy wildcard.
    const allowedOrigin =
      serverOptions.corsOrigin ?? process.env.CORS_ORIGIN ?? (serverOptions.auth ? '' : '*');
    const corsHeaders: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      ...(allowedOrigin === '*'
        ? { 'access-control-allow-origin': '*' }
        : allowedOrigin.length > 0
          ? { 'access-control-allow-origin': allowedOrigin, vary: 'Origin' }
          : {}),
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-idempotency-key, x-request-id',
    };

    const reply = (statusCode: number, data: unknown, extraHeaders?: Record<string, string>): InjectResponse => {
      const totalMs = Math.round((performance.now() - reqStartMs) * 100) / 100;
      const trace: TracePayload = {
        traceId,
        name: `${options.method} ${options.url}`,
        startTime: reqStartIso,
        endTime: new Date().toISOString(),
        totalMs,
        statusCode,
        method: options.method,
        path: options.url,
        ...(metrics.ownerId ? { ownerId: metrics.ownerId } : {}),
        ...(metrics.llmMs !== undefined ? { llmMs: metrics.llmMs } : {}),
        ...(metrics.dbMs !== undefined ? { dbMs: metrics.dbMs } : {}),
        ...(metrics.paypalMs !== undefined ? { paypalMs: metrics.paypalMs } : {}),
        ...(metrics.decisionState ? { decisionState: metrics.decisionState } : {}),
        ...(metrics.reasonCode ? { reasonCode: metrics.reasonCode } : {}),
        spans: metrics.spans,
      };

      const shouldLog = serverOptions.enableStructuredLogs ?? (process.env.NODE_ENV !== 'test' && !process.env.VITEST);
      if (shouldLog) {
        emitStructuredLog(trace);
      }
      if (
        serverOptions.langfuse &&
        options.method !== 'OPTIONS' &&
        options.url !== '/healthz' &&
        options.url !== '/health' &&
        options.url !== '/readyz'
      ) {
        serverOptions.langfuse.emitTrace(trace);
      }

      const body = JSON.stringify(data);
      return {
        statusCode,
        headers: {
          ...corsHeaders,
          'x-request-id': traceId,
          'x-response-time-ms': String(totalMs),
          ...(extraHeaders ?? {}),
        },
        body,
        json: <T>() => JSON.parse(body) as T,
      };
    };

    if (options.method === 'OPTIONS') {
      return reply(204, {});
    }

    // 0. AuthN/AuthZ gate (P0-1 fix). When auth is configured, identity comes
    // from the API key ONLY - client-supplied ownerId is cross-checked against
    // it and mismatches are rejected. Health routes and the signature-verified
    // PayPal webhook route are the only public paths.
    const PUBLIC_PATHS = new Set(['/healthz', '/health', '/readyz', '/v1/webhooks/paypal']);
    let authedOwnerId: string | null = null;
    let authedBearer = '';
    if (serverOptions.auth && !PUBLIC_PATHS.has(options.url)) {
      const authHeader = options.headers?.['authorization'];
      const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';
      // Clients may send either the bare key or the full "key:ownerId" env
      // value — strip the owner suffix for lookup so both forms authenticate.
      const lookupKey = bearer.includes(':') ? bearer.slice(0, bearer.indexOf(':')).trim() : bearer;
      const keyOwner = lookupKey.length > 0 ? serverOptions.auth.keys.get(lookupKey) : undefined;
      if (!keyOwner) {
        return reply(401, {
          error: 'UNAUTHENTICATED',
          detail: 'Valid Authorization: Bearer <api-key> required on /v1 routes.',
        });
      }
      authedOwnerId = keyOwner;
      // Role lookup must use the SAME normalized key as the auth lookup —
      // a raw bearer with ':owner' suffix would miss the roles map and
      // default to admin (proposer escalation bug, caught in re-audit).
      authedBearer = lookupKey;
    }
    // Maker-checker: money-moving routes require an approver/admin key; a
    // proposer key may draft (evaluate/agent) but never settle. Demo mode
    // (auth disabled) is exempt.
    const authedRole: ApiKeyRole | null =
      serverOptions.auth && authedOwnerId !== null
        ? serverOptions.auth.roles?.get(authedBearer) ?? 'admin'
        : null;
    const requireMoneyRole = (): InjectResponse | null => {
      if (authedRole === null || MONEY_MOVING_ROLES.includes(authedRole)) {
        return null;
      }
      return reply(403, {
        success: false,
        error: 'FORBIDDEN_ROLE',
        detail: `Role '${authedRole}' cannot move money — approver or admin key required (maker-checker separation).`,
      });
    };
    // Resolves the request's owner identity: in authed mode the key's owner is
    // authoritative (missing body.ownerId defaults to it; mismatches -> null).
    const resolveOwnerId = (bodyOwnerId: unknown): string | null => {
      if (authedOwnerId === null) {
        return typeof bodyOwnerId === 'string' && bodyOwnerId.length > 0 ? bodyOwnerId : null;
      }
      if (typeof bodyOwnerId !== 'string' || bodyOwnerId.length === 0) {
        return authedOwnerId;
      }
      return bodyOwnerId === authedOwnerId ? bodyOwnerId : null;
    };

    // 1. Health & Readiness Routes
    if (options.method === 'GET' && options.url === '/readyz') {
      const ready = serverOptions.readinessCheck ? await serverOptions.readinessCheck() : true;
      return reply(ready ? 200 : 503, {
        status: ready ? 'ready' : 'not_ready',
        service: '@payguard/api',
        timestamp: new Date().toISOString(),
      });
    }

    if (options.method === 'GET' && (options.url === '/healthz' || options.url === '/health')) {
      const paypalSandboxReady = Boolean(serverOptions.paypalExecutor);
      // 'postgres' means durable real ledger; 'in_memory' is an explicit demo
      // fallback (seeded, lost on restart). The dashboard surfaces this so a
      // demo deployment never masquerades as live financial data.
      const ledgerStore = ledger instanceof PostgresLedger ? 'postgres' : 'in_memory';
      return reply(200, {
        status: 'ok',
        service: '@payguard/api',
        fiduciaryLaw: 'The LLM proposes; deterministic financial policies dispose.',
        paypalSandboxReady,
        executionMode: paypalSandboxReady ? 'paypal_sandbox' : 'in_memory_simulated',
        ledgerStore,
        demoLedger: ledgerStore === 'in_memory',
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Deterministic Policy Gate + Grounding Evaluation Route
    if (options.method === 'POST' && options.url === '/v1/evaluate') {
      const body = (options.payload ?? {}) as Partial<EvaluateRequestPayload>;
      const retryAfterSec = checkRateLimit(`evaluate:${authedOwnerId ?? (typeof body.ownerId === 'string' ? body.ownerId : 'anon')}`);
      if (retryAfterSec !== null) {
        return reply(429, { state: 'REJECTED', error: 'RATE_LIMITED', retryAfterSeconds: retryAfterSec }, { 'retry-after': String(retryAfterSec) });
      }
      const parsedProposal = OrderProposalSchema.safeParse(body.proposal);

      if (
        authedOwnerId !== null &&
        typeof body.ownerId === 'string' &&
        body.ownerId.length > 0 &&
        body.ownerId !== authedOwnerId
      ) {
        return reply(403, {
          state: 'REJECTED',
          reasonCode: ReasonCode.REJECT_SCHEMA_INVALID,
          error: 'FORBIDDEN_OWNER',
          decisionId: randomUUID(),
          evaluatedAt: new Date().toISOString(),
          issues: ['ownerId does not match the authenticated API key'],
        });
      }

      if (!parsedProposal.success || (typeof body.ownerId !== 'string' || body.ownerId.length === 0) && authedOwnerId === null) {
        const decisionId = randomUUID();
        return reply(400, {
          state: 'REJECTED',
          reasonCode: ReasonCode.REJECT_SCHEMA_INVALID,
          decisionId,
          evaluatedAt: new Date().toISOString(),
          issues: parsedProposal.success ? ['Missing ownerId'] : parsedProposal.error.issues,
        });
      }

      const proposal = parsedProposal.data;
      const ownerId = resolveOwnerId(body.ownerId) as string;
      const policyVersion = body.policyVersion ?? 'v2026.11';
      const idempotencyKey = body.idempotencyKey ?? `idem_${proposal.invoiceId}`;

      // 2a. Untrusted Prompt Injection Scan on Invoice Text
      if (typeof body.invoiceText === 'string' && body.invoiceText.trim().length > 0) {
        const injectionMatch = detectPromptInjection(body.invoiceText);
        if (injectionMatch) {
          pushAudit({
            id: `evt-${randomUUID().slice(0, 8)}`,
            timestamp: new Date().toISOString(),
            ownerId,
            action: 'EVALUATE',
            actor: ownerId,
            invoiceId: proposal.invoiceId,
            vendor: proposal.vendorName,
            amountMinor: Number(proposal.grandTotalMinor),
            decisionState: 'REJECTED',
            reasonCode: ReasonCode.REJECT_PROMPT_INJECTION,
            detail: `Blocked prompt injection ("${injectionMatch}") on ${proposal.invoiceId} (${proposal.vendorName}).`,
          });
          return reply(200, {
            decision: {
              state: 'REJECTED',
              reasonCode: ReasonCode.REJECT_PROMPT_INJECTION,
              decisionId: randomUUID(),
              evaluatedAt: new Date().toISOString(),
            },
            untrustedInjection: {
              detected: true,
              matchedPattern: injectionMatch,
              warning: 'Untrusted text cannot reach policy.',
            },
          });
        }
      }

      // 2b. Character-Offset Quote Grounding Check (Ticket #2 Kernel)
      if (typeof body.invoiceText === 'string' && body.citation) {
        const grounding = verifyQuoteGrounding(body.invoiceText, body.citation);
        if (!grounding.isGrounded) {
          return reply(200, {
            decision: {
              state: 'REJECTED',
              reasonCode: ReasonCode.REJECT_UNCATALOGUED_SKU,
              decisionId: randomUUID(),
              evaluatedAt: new Date().toISOString(),
            },
            grounding,
          });
        }
      }

      // 2c. Vendor Payout Destination Change Check. The trusted account is
      // server-authoritative: a client-supplied "trustedAccount" is NEVER used
      // as the baseline. Vendors without a registered account fail closed.
      if (body.vendorDestination) {
        const expectedTrustedAccount = defaultTrustedVendorAccounts[proposal.vendorName];
        if (expectedTrustedAccount === undefined) {
          return reply(200, {
            decision: {
              state: 'HOLD',
              reasonCode: ReasonCode.HOLD_VENDOR_UNTRUSTED,
              decisionId: randomUUID(),
              evaluatedAt: new Date().toISOString(),
            },
            vendorDestination: {
              trustedAccount: null,
              invoiceAccount: body.vendorDestination.invoiceAccount,
            },
          });
        }
        if (expectedTrustedAccount !== body.vendorDestination.invoiceAccount) {
          const decisionId = randomUUID();
          return reply(200, {
            decision: {
              state: 'HOLD',
              reasonCode: ReasonCode.HOLD_VENDOR_DESTINATION,
              decisionId,
              evaluatedAt: new Date().toISOString(),
            },
            vendorDestination: {
              trustedAccount: expectedTrustedAccount,
              invoiceAccount: body.vendorDestination.invoiceAccount,
            },
          });
        }
      }

      // Server-authoritative policy inputs (never trust client-supplied overrides).
      const trustedVendors = defaultTrustedVendors;
      const isDuplicateInvoice = settledInvoices.has(settledKey(ownerId, proposal.invoiceId));
      const hourlySpentMinor = await getHourlySpentMinor(ownerId);

      // 2d. Deterministic Policy Gate (Ticket #1 Kernel)
      const decision: PolicyDecision = evaluatePolicy({
        ownerId,
        proposal,
        trustedVendors,
        isDuplicateInvoice,
        hourlySpentMinor,
        policyVersion,
        idempotencyKey,
      });

      pushAudit({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'EVALUATE',
        actor: ownerId,
        invoiceId: proposal.invoiceId,
        vendor: proposal.vendorName,
        amountMinor: Number(proposal.grandTotalMinor),
        decisionState: decision.state,
        reasonCode: decision.reasonCode,
        detail: `Evaluated ${proposal.invoiceId} (${proposal.vendorName}) -> ${decision.state} (${decision.reasonCode})`,
      });

      if (decision.state === 'APPROVED') {
        capabilityVault.set(decision.approvedToken.approvalId, decision.approvedToken);
        return reply(200, {
          decision: toPublicPolicyDecision(decision),
          approvalId: decision.approvedToken.approvalId,
        });
      }

      if (decision.state === 'HOLD') {
        const qrCode = newQrCode();
        const qrRecord: QrApprovalRecord = {
          code: qrCode,
          ownerId,
          proposal,
          idempotencyKey,
          policyVersion,
          trustedVendors,
          hourlySpentMinor,
          initialReasonCode: decision.reasonCode,
          expiresAtMs: Date.now() + 10 * 60_000,
          ...(typeof body.invoiceText === 'string' ? { invoiceText: body.invoiceText } : {}),
          used: false,
        };
        qrApprovals.set(qrCode, qrRecord);
        if (durability) {
          void durability.saveQrApproval(qrRecord).catch(() => {});
        }
        return reply(200, {
          decision,
          qrApproval: {
            singleUseCode: qrCode,
            expiresInSeconds: 600,
          },
        });
      }

      return reply(200, { decision });
    }

    // 3. Financial Ledger Execution Route (Ticket #3 Kernel)
    if (options.method === 'POST' && options.url === '/v1/execute') {
      const body = (options.payload ?? {}) as Partial<ExecuteRequestPayload>;
      const retryAfterSec = checkRateLimit(`execute:${authedOwnerId ?? (typeof body.ownerId === 'string' ? body.ownerId : 'anon')}`);
      if (retryAfterSec !== null) {
        return reply(429, { success: false, error: 'RATE_LIMITED', retryAfterSeconds: retryAfterSec }, { 'retry-after': String(retryAfterSec) });
      }
      const parsedProposal = OrderProposalSchema.safeParse(body.proposal);

      const execOwnerId = resolveOwnerId(body.ownerId);
      if (!parsedProposal.success || !execOwnerId || !body.idempotencyKey) {
        if (parsedProposal.success && body.idempotencyKey && execOwnerId === null && body.ownerId !== undefined) {
          return reply(403, {
            success: false,
            error: 'FORBIDDEN_OWNER',
            detail: 'ownerId does not match the authenticated API key.',
          });
        }
        return reply(400, {
          success: false,
          error: 'INVALID_EXECUTE_PAYLOAD',
        });
      }

      const token =
        body.token ??
        (body.approvalId ? capabilityVault.get(body.approvalId) : undefined);

      const execIdempotencyKey = body.idempotencyKey;
      metrics.ownerId = execOwnerId;
      const execRoleBlocked = requireMoneyRole();
      if (execRoleBlocked) {
        return execRoleBlocked;
      }

      // Execute-time policy re-check (P1 fix): the token was minted at evaluate
      // time - velocity, duplicates and policy may have drifted since. The gate
      // disposes again right before money moves. Idempotent REPLAYS (same
      // owner+key already settled) skip the re-check and return the cached
      // receipt below - a replay is not a new money-moving decision.
      const isReplay = await ledger.isKnownIdempotencyKey(execOwnerId, execIdempotencyKey);
      if (!isReplay) {
        const execReEval = evaluatePolicy({
          ownerId: execOwnerId,
          proposal: parsedProposal.data,
          trustedVendors: defaultTrustedVendors,
          isDuplicateInvoice: settledInvoices.has(settledKey(execOwnerId, parsedProposal.data.invoiceId)),
          hourlySpentMinor: await getHourlySpentMinor(execOwnerId),
          policyVersion: 'v2026.11',
          idempotencyKey: execIdempotencyKey,
        });
        if (execReEval.state !== 'APPROVED') {
          return reply(422, {
            success: false,
            error: 'POLICY_DRIFTED',
            decision: toPublicPolicyDecision(execReEval),
            toastMessage: `Gate re-ran at execute-time: ${execReEval.state} (${execReEval.reasonCode})`,
          });
        }
      }

      const result: SettlementResult = await recordSpan(
        'ledger.settleOrder',
        () =>
          ledger.settleOrder({
            ownerId: execOwnerId,
            proposal: parsedProposal.data,
            token: token as ApprovedForExecution,
            idempotencyKey: execIdempotencyKey,
          }),
        (ms) => {
          metrics.dbMs = (metrics.dbMs ?? 0) + ms;
        },
      );

      if (!result.success) {
        const statusCode =
          result.error === 'FORBIDDEN_CAPABILITY'
            ? 403
            : result.error === 'IDEMPOTENCY_CONFLICT'
              ? 409
              : 422;
        return reply(statusCode, result);
      }

      const cachedEnvelope = settledExecutionEnvelopes.get(result.settlement.settlementId);
      if (cachedEnvelope) {
        return reply(200, { ...cachedEnvelope, replayed: true });
      }

      settledInvoices.add(settledKey(execOwnerId, parsedProposal.data.invoiceId));
      pushAudit({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        ownerId: execOwnerId,
        action: 'EXECUTE',
        actor: execOwnerId,
        invoiceId: parsedProposal.data.invoiceId,
        vendor: parsedProposal.data.vendorName,
        amountMinor: Number(parsedProposal.data.grandTotalMinor),
        decisionState: 'APPROVED',
        reasonCode: 'SETTLED',
        detail: `Settled ${parsedProposal.data.invoiceId} via /v1/execute.`,
      });

      // Ledger settled. Now move money on the configured rail (if any).
      let responseEnvelope: Record<string, unknown>;
      if (serverOptions.paypalExecutor) {
        const paypal: PayPalExecutionResult = await recordSpan(
          'paypal.execute',
          () => serverOptions.paypalExecutor!.execute(token as ApprovedForExecution),
          (ms) => {
            metrics.paypalMs = (metrics.paypalMs ?? 0) + ms;
          },
        );
        if (paypal.ok) {
          responseEnvelope = {
            ...result,
            paypalOrderId: paypal.paypalOrderId,
            paypal: { ok: true, status: paypal.status, captureId: paypal.captureId },
          };
        } else {
          // Fail visible, never fail open: settlement stands, the rail failure is reported.
          responseEnvelope = {
            ...result,
            paypalOrderId: `PP-SBX-${result.settlement.settlementId.slice(0, 8).toUpperCase()}`,
            paypal: { ok: false, stage: paypal.stage, errorCode: paypal.errorCode, message: paypal.message },
          };
        }
      } else {
        responseEnvelope = {
          ...result,
          paypalOrderId: `PP-SBX-${result.settlement.settlementId.slice(0, 8).toUpperCase()}`,
        };
      }

      settledExecutionEnvelopes.set(result.settlement.settlementId, responseEnvelope);
      return reply(200, responseEnvelope);
    }

    // 80% Shell Helper: Re-runs deterministic policy gate (TOCTOU check), mints capability token, and settles
    const settleApprovedQrRecord = async (record: QrApprovalRecord): Promise<InjectResponse> => {
      if (record.invoiceText) {
        const injectionMatch = detectPromptInjection(record.invoiceText);
        if (injectionMatch) {
          return reply(422, {
            success: false,
            gateReRan: true,
            error: ReasonCode.REJECT_PROMPT_INJECTION,
            toastMessage: `Gate re-ran: rejected (${ReasonCode.REJECT_PROMPT_INJECTION})`,
          });
        }
      }

      const reEval = evaluatePolicy({
        ownerId: record.ownerId,
        proposal: record.proposal,
        trustedVendors: record.trustedVendors,
        isDuplicateInvoice: settledInvoices.has(settledKey(record.ownerId, record.proposal.invoiceId)),
        hourlySpentMinor: Math.max(record.hourlySpentMinor, await getHourlySpentMinor(record.ownerId)),
        policyVersion: record.policyVersion,
        idempotencyKey: record.idempotencyKey,
      });

      if (reEval.state === 'REJECTED') {
        pushAudit({
          id: `evt-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          action: 'HITL_APPROVE',
          actor: record.ownerId,
          invoiceId: record.proposal.invoiceId,
          vendor: record.proposal.vendorName,
          amountMinor: Number(record.proposal.grandTotalMinor),
          decisionState: reEval.state,
          reasonCode: reEval.reasonCode,
          detail: `QR ${record.code} blocked on TOCTOU gate re-evaluation: ${reEval.reasonCode}.`,
        });
        return reply(422, {
          success: false,
          gateReRan: true,
          error: reEval.reasonCode,
          decision: reEval,
          toastMessage: `Gate re-ran: rejected (${reEval.reasonCode})`,
        });
      }

      if (reEval.state === 'HOLD' && reEval.reasonCode !== record.initialReasonCode) {
        pushAudit({
          id: `evt-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          action: 'HITL_APPROVE',
          actor: record.ownerId,
          invoiceId: record.proposal.invoiceId,
          vendor: record.proposal.vendorName,
          amountMinor: Number(record.proposal.grandTotalMinor),
          decisionState: reEval.state,
          reasonCode: reEval.reasonCode,
          detail: `QR ${record.code} blocked due to policy drift (${record.initialReasonCode} -> ${reEval.reasonCode}).`,
        });
        return reply(422, {
          success: false,
          gateReRan: true,
          error: 'POLICY_DRIFT_BLOCKED',
          decision: reEval,
          toastMessage: `Gate re-ran: policy drifted (${reEval.reasonCode})`,
        });
      }

      const freshToken =
        reEval.state === 'APPROVED'
          ? reEval.approvedToken
          : issueApprovedToken({
            ownerId: record.ownerId,
            proposal: record.proposal,
            idempotencyKey: record.idempotencyKey,
            policyVersion: record.policyVersion,
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          });

      capabilityVault.set(freshToken.approvalId, freshToken);

      const settlementResult = await ledger.settleOrder({
        ownerId: record.ownerId,
        proposal: record.proposal,
        token: freshToken,
        idempotencyKey: record.idempotencyKey,
        bypassVelocityCap: true,
      });

      if (!settlementResult.success) {
        return reply(422, settlementResult);
      }

      settledInvoices.add(settledKey(record.ownerId, record.proposal.invoiceId));

      let paypalOrderId = `PP-SBX-${settlementResult.settlement.settlementId.slice(0, 8).toUpperCase()}`;
      let paypalPayload: Record<string, unknown> | undefined;
      if (serverOptions.paypalExecutor) {
        const paypal = await serverOptions.paypalExecutor.execute(freshToken);
        if (paypal.ok) {
          paypalOrderId = paypal.paypalOrderId;
          paypalPayload = { ok: true, status: paypal.status, captureId: paypal.captureId };
        } else {
          paypalPayload = { ok: false, stage: paypal.stage, errorCode: paypal.errorCode, message: paypal.message };
        }
      }

      const matchedTx = transactions.find(
        (t) => t.qrCode === record.code || t.invoiceNumber === record.proposal.invoiceId,
      );
      if (matchedTx) {
        matchedTx.status = 'Paid';
        matchedTx.policyCode = 'AUTO_EXECUTED';
        matchedTx.canApproveReject = false;
        matchedTx.paypalOrderId = paypalOrderId;
      }

      pushAudit({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'HITL_APPROVE',
        actor: record.ownerId,
        invoiceId: record.proposal.invoiceId,
        vendor: record.proposal.vendorName,
        amountMinor: Number(record.proposal.grandTotalMinor),
        decisionState: 'APPROVED',
        reasonCode: reEval.reasonCode,
        detail: `QR ${record.code} approved after gate re-evaluation; settled (${paypalOrderId}).`,
      });

      return reply(200, {
        success: true,
        gateReRan: true,
        reEvaluatedDecision: { state: reEval.state, reasonCode: reEval.reasonCode },
        toastMessage: 'Gate re-ran, decision stood',
        settlement: settlementResult.settlement,
        paypalOrderId,
        ...(paypalPayload ? { paypal: paypalPayload } : {}),
      });
    };

    // 4. Single-Use QR / HITL Approval Route (Ticket #4: 20% Kernel)
    if (options.method === 'POST' && options.url === '/v1/hitl/approve') {
      const body = (options.payload ?? {}) as { readonly singleUseCode?: string };
      if (!body.singleUseCode) {
        return reply(400, { success: false, error: 'MISSING_QR_CODE' });
      }
      const hitlRoleBlocked = requireMoneyRole();
      if (hitlRoleBlocked) {
        return hitlRoleBlocked;
      }

      // Brute-force damper: 64-bit codes + a hard per-code rate limit.
      const hitlRetryAfterSec = checkRateLimit(`hitl:${body.singleUseCode}`);
      if (hitlRetryAfterSec !== null) {
        return reply(429, { success: false, error: 'RATE_LIMITED', retryAfterSeconds: hitlRetryAfterSec }, { 'retry-after': String(hitlRetryAfterSec) });
      }

      // 1. Lookup: unknown code -> 404.
      const approvalRecord = qrApprovals.get(body.singleUseCode);
      if (!approvalRecord) {
        return reply(404, { success: false, error: 'QR_CODE_NOT_FOUND' });
      }
      // 1b. Tenant isolation: cross-owner approval attempts are 404 (never reveal existence).
      if (authedOwnerId !== null && approvalRecord.ownerId !== authedOwnerId) {
        return reply(404, { success: false, error: 'QR_CODE_NOT_FOUND' });
      }
      // 2. Replay protection: consumed or in-flight code -> 409 Conflict.
      if (approvalRecord.used || inFlightQrCodes.has(body.singleUseCode)) {
        return reply(409, { success: false, error: 'QR_CODE_ALREADY_USED' });
      }
      // 3. Expiration: past expiry -> 410 Gone.
      if (Date.now() >= approvalRecord.expiresAtMs) {
        return reply(410, { success: false, error: 'QR_CODE_EXPIRED' });
      }
      // 4. Mark IN_FLIGHT before awaiting settlement; finalize used=true only on 200 so transient 422s don't brick the QR.
      inFlightQrCodes.add(body.singleUseCode);
      try {
        const result = await settleApprovedQrRecord(approvalRecord);
        if (result.statusCode === 200) {
          approvalRecord.used = true;
          approvalRecord.outcome = 'APPROVED';
          if (durability) {
            void durability.markQrUsed(body.singleUseCode).catch(() => {});
          }
        }
        return result;
      } finally {
        inFlightQrCodes.delete(body.singleUseCode);
      }
    }

    // 5. Catalog (read-only, owner-controlled data the agent may query).
    if (options.method === 'GET' && options.url === '/v1/catalog') {
      const items = catalog.search('', 1000);
      return reply(200, { items });
    }

    // 6. Agent route: the LLM proposes, the deterministic gate disposes.
    if (options.method === 'POST' && options.url === '/v1/agent/run') {
      const body = (options.payload ?? {}) as Partial<AgentRunRequestPayload>;
      const retryAfterSec = checkRateLimit(`agent:${authedOwnerId ?? (typeof body.ownerId === 'string' ? body.ownerId : 'anon')}`);
      if (retryAfterSec !== null) {
        return reply(429, { error: 'RATE_LIMITED', retryAfterSeconds: retryAfterSec }, { 'retry-after': String(retryAfterSec) });
      }
      const resolvedOwnerId = resolveOwnerId(body.ownerId);
      if (resolvedOwnerId === null && body.ownerId !== undefined) {
        return reply(403, {
          error: 'FORBIDDEN_OWNER',
          detail: 'ownerId does not match the authenticated API key.',
        });
      }
      const ownerId = resolvedOwnerId;
      const invoiceText = typeof body.invoiceText === 'string' ? body.invoiceText : '';
      const goal = typeof body.goal === 'string' && body.goal.trim().length > 0 ? body.goal.trim() : 'Pay this vendor invoice.';
      const idempotencyKey = body.idempotencyKey ?? `agent_${randomUUID().slice(0, 8)}`;
      const policyVersion = 'v2026.11';

      const MAX_INVOICE_TEXT_CHARS = 16_000;
      const MAX_GOAL_CHARS = 500;
      if (
        !ownerId ||
        invoiceText.trim().length === 0 ||
        invoiceText.length > MAX_INVOICE_TEXT_CHARS ||
        goal.length > MAX_GOAL_CHARS
      ) {
        return reply(400, {
          error: 'INVALID_AGENT_PAYLOAD',
          detail: 'ownerId and bounded invoiceText (<= 16000 chars) / goal (<= 500 chars) are required.',
        });
      }

      const thoughts: { round: number; tool: string | null; summary: string }[] = [];

      // 6a. Untrusted prompt-injection scan FIRST - injected text (invoice or goal) never reaches policy.
      const injectionMatch = detectPromptInjection(invoiceText) ?? detectPromptInjection(goal);
      if (injectionMatch) {
        pushAudit({
          id: `evt-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          ownerId,
          action: 'AGENT_RUN',
          actor: ownerId,
          invoiceId: 'UNTRUSTED-INPUT',
          vendor: 'Unknown vendor',
          amountMinor: 0,
          decisionState: 'REJECTED',
          reasonCode: ReasonCode.REJECT_PROMPT_INJECTION,
          detail: `Blocked prompt injection ("${injectionMatch}") before agent execution.`,
        });
        return reply(200, {
          decision: {
            state: 'REJECTED',
            reasonCode: ReasonCode.REJECT_PROMPT_INJECTION,
            decisionId: randomUUID(),
            evaluatedAt: new Date().toISOString(),
          },
          untrustedInjection: {
            detected: true,
            matchedPattern: injectionMatch,
            warning: 'Untrusted text cannot reach policy.',
          },
          thoughts,
          proposal: null,
        });
      }

      // 6b. Model routing: injected fn > explicit fixture > env providers.
      let chat: AgentChatFn | null;
      let provider: ProviderName;
      if (body.model === 'fixture') {
        chat = createFixtureChatFn();
        provider = 'fixture';
      } else if (serverOptions.agentChat !== undefined) {
        chat = serverOptions.agentChat;
        provider = serverOptions.agentProvider ?? (chat ? 'fixture' : 'gemini');
      } else {
        const routed = createProviderChatFn({
          geminiApiKey: process.env.GEMINI_API_KEY?.trim() || undefined,
          groqApiKey: process.env.GROQ_API_KEY?.trim() || undefined,
        });
        chat = routed?.chat ?? null;
        provider = routed?.provider ?? 'gemini';
      }

      // Fail closed: no model available -> HOLD, never approve.
      if (!chat) {
        return reply(200, {
          decision: {
            state: 'HOLD',
            reasonCode: ReasonCode.DEPENDENCY_UNAVAILABLE,
            decisionId: randomUUID(),
            evaluatedAt: new Date().toISOString(),
          },
          thoughts,
          proposal: null,
          model: provider,
          terminalReason: 'MODEL_UNAVAILABLE',
        });
      }

      metrics.ownerId = ownerId;
      const run: AgentRunResult = await recordSpan(
        `agent.run(${provider})`,
        () => runAgentLoop({ goal, invoiceText, chat, catalog }),
        (ms) => {
          metrics.llmMs = ms;
        },
      );
      thoughts.push(...run.thoughts);

      if (!run.proposal) {
        // MODEL_UNAVAILABLE is a dependency failure (fail closed); a round cap
        // or exhausted script means the agent could not complete - manual review.
        const noProposalReason =
          run.terminalReason === 'MODEL_UNAVAILABLE' ? ReasonCode.DEPENDENCY_UNAVAILABLE : ReasonCode.HOLD_MANUAL_REVIEW;
        return reply(200, {
          decision: {
            state: 'HOLD',
            reasonCode: noProposalReason,
            decisionId: randomUUID(),
            evaluatedAt: new Date().toISOString(),
          },
          thoughts,
          proposal: null,
          model: provider,
          roundsUsed: run.roundsUsed,
          terminalReason: run.terminalReason,
        });
      }

      // 6c. THE GATE disposes of the LLM proposal. Single decision authority.
      const decision: PolicyDecision = evaluatePolicy({
        ownerId,
        proposal: run.proposal,
        trustedVendors: defaultTrustedVendors,
        isDuplicateInvoice: settledInvoices.has(settledKey(ownerId, run.proposal.invoiceId)),
        hourlySpentMinor: await getHourlySpentMinor(ownerId),
        policyVersion,
        idempotencyKey,
      });

      if (decision.state === 'REJECTED') {
        return reply(200, { decision, thoughts, proposal: run.proposal, model: provider, roundsUsed: run.roundsUsed });
      }

      pushAudit({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'AGENT_RUN',
        actor: provider,
        invoiceId: run.proposal.invoiceId,
        vendor: run.proposal.vendorName,
        amountMinor: Number(run.proposal.grandTotalMinor),
        decisionState: decision.state,
        reasonCode: decision.reasonCode,
        detail: `Agent (${provider}, ${run.roundsUsed} rounds) proposed ${run.proposal.invoiceId} -> ${decision.state}.`,
      });

      if (decision.state === 'HOLD') {
        const qrCode = newQrCode();
        const qrRecord: QrApprovalRecord = {
          code: qrCode,
          ownerId,
          proposal: run.proposal,
          idempotencyKey,
          policyVersion,
          trustedVendors: defaultTrustedVendors,
          hourlySpentMinor: await getHourlySpentMinor(ownerId),
          initialReasonCode: decision.reasonCode,
          expiresAtMs: Date.now() + 10 * 60_000,
          invoiceText,
          used: false,
        };
        qrApprovals.set(qrCode, qrRecord);
        if (durability) {
          void durability.saveQrApproval(qrRecord).catch(() => {});
        }
        transactions.unshift({
          id: `tx-${randomUUID().slice(0, 8)}`,
          vendor: run.proposal.vendorName,
          invoiceNumber: run.proposal.invoiceId,
          amountFormatted: `$${(Number(run.proposal.grandTotalMinor) / 100).toFixed(2)}`,
          amountMinor: Number(run.proposal.grandTotalMinor),
          status: 'Review required',
          policyCode: decision.reasonCode,
          dateFormatted: 'Nov 16, 2026',
          canApproveReject: true,
          qrCode,
          proposal: run.proposal,
        });
        return reply(200, {
          decision,
          thoughts,
          proposal: run.proposal,
          model: provider,
          roundsUsed: run.roundsUsed,
          qrApproval: { singleUseCode: qrCode, expiresInSeconds: 600 },
        });
      }

      // APPROVED: minted token is stored, ledger settles, rail executes.
      capabilityVault.set(decision.approvedToken.approvalId, decision.approvedToken);
      const settlement: SettlementResult = await ledger.settleOrder({
        ownerId,
        proposal: run.proposal,
        token: decision.approvedToken,
        idempotencyKey,
      });

      if (!settlement.success) {
        return reply(422, { decision: toPublicPolicyDecision(decision), thoughts, proposal: run.proposal, settlement });
      }

      settledInvoices.add(settledKey(ownerId, run.proposal.invoiceId));

      let paypalOrderId = `PP-SBX-${settlement.settlement.settlementId.slice(0, 8).toUpperCase()}`;
      let paypalPayload: Record<string, unknown> | null = null;
      if (serverOptions.paypalExecutor) {
        const paypal: PayPalExecutionResult = await serverOptions.paypalExecutor.execute(decision.approvedToken);
        if (paypal.ok) {
          paypalOrderId = paypal.paypalOrderId;
          paypalPayload = { ok: true, status: paypal.status, captureId: paypal.captureId };
        } else {
          paypalPayload = { ok: false, stage: paypal.stage, errorCode: paypal.errorCode, message: paypal.message };
        }
      }

      settledExecutionEnvelopes.set(settlement.settlement.settlementId, {
        success: true,
        settlement: settlement.settlement,
        paypalOrderId,
        ...(paypalPayload ? { paypal: paypalPayload } : {}),
      });

      transactions.unshift({
        id: `tx-${randomUUID().slice(0, 8)}`,
        vendor: run.proposal.vendorName,
        invoiceNumber: run.proposal.invoiceId,
        amountFormatted: `$${(Number(run.proposal.grandTotalMinor) / 100).toFixed(2)}`,
        amountMinor: Number(run.proposal.grandTotalMinor),
        status: 'Paid',
        policyCode: 'AUTO_EXECUTED',
        dateFormatted: 'Nov 16, 2026',
        canApproveReject: false,
        paypalOrderId,
        proposal: run.proposal,
      });

      return reply(200, {
        decision: toPublicPolicyDecision(decision),
        thoughts,
        proposal: run.proposal,
        model: provider,
        roundsUsed: run.roundsUsed,
        settlement: settlement.settlement,
        paypalOrderId,
        ...(paypalPayload ? { paypal: paypalPayload } : {}),
      });
    }

    // 7. Ledger Transactions & Live Approve/Reject Routes (for UI Dashboard).
    // Durable mode: real settlements read from PostgreSQL. Demo mode: seed list.
    if (options.method === 'GET' && options.url === '/v1/transactions') {
      if (ledger instanceof PostgresLedger) {
        const entries = await ledger.listEntries(authedOwnerId);
        const nowMs = Date.now();
        const pendingApprovals = Array.from(qrApprovals.values())
          .filter((r) => !r.used && nowMs < r.expiresAtMs && (authedOwnerId === null || r.ownerId === authedOwnerId))
          .sort((a, b) => b.expiresAtMs - a.expiresAtMs)
          .map((r) => {
            const amountMinor = Number(r.proposal.grandTotalMinor);
            const vendorTrusted = r.trustedVendors.includes(r.proposal.vendorName);
            const withinAutoCap = amountMinor <= 10_000;
            const withinVelocity = r.hourlySpentMinor + amountMinor <= 20_000;
            return {
              id: `qr:${r.code}`,
              vendor: r.proposal.vendorName,
              invoiceNumber: r.proposal.invoiceId,
              amountFormatted: `$${(amountMinor / 100).toFixed(2)}`,
              amountMinor,
              status: 'Review required',
              policyCode: r.initialReasonCode,
              dateFormatted: 'Pending',
              canApproveReject: true,
              qrCode: r.code,
              qrExpiresAtMs: r.expiresAtMs,
              hourlySpentMinor: r.hourlySpentMinor,
              policyChecks: [
                {
                  title: 'Trusted vendor allowlist',
                  description: vendorTrusted
                    ? `${r.proposal.vendorName} is on the owner-controlled allowlist.`
                    : `${r.proposal.vendorName} is not on the trusted vendor allowlist (held for human review).`,
                  status: vendorTrusted ? 'passed' : 'warning',
                },
                {
                  title: 'Single-order auto-execute cap ($100.00)',
                  description: withinAutoCap
                    ? `$${(amountMinor / 100).toFixed(2)} is within the $100.00 auto-execute cap.`
                    : `$${(amountMinor / 100).toFixed(2)} exceeds the $100.00 auto-execute cap; single-use QR required.`,
                  status: withinAutoCap ? 'passed' : 'warning',
                },
                {
                  title: 'Rolling 60-min velocity cap ($200.00)',
                  description: withinVelocity
                    ? `$${(r.hourlySpentMinor / 100).toFixed(2)} spent + $${(amountMinor / 100).toFixed(2)} stays within $200.00/hr.`
                    : `$${(r.hourlySpentMinor / 100).toFixed(2)} spent + $${(amountMinor / 100).toFixed(2)} exceeds $200.00/hr.`,
                  status: withinVelocity ? 'passed' : 'warning',
                },
              ],
              proposal: null,
            };
          });
        const settledRows = entries.map((entry) => ({
          id: entry.settlementId,
          vendor: entry.vendorName,
          invoiceNumber: entry.invoiceId,
          amountFormatted: `$${(entry.amountMinor / 100).toFixed(2)}`,
          amountMinor: entry.amountMinor,
          status: 'Paid',
          policyCode: 'AUTO_EXECUTED',
          dateFormatted: new Date(entry.settledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          canApproveReject: false,
          proposal: null,
        }));
        return reply(200, {
          transactions: [...pendingApprovals, ...settledRows],
          executionMode: serverOptions.paypalExecutor ? 'paypal_sandbox' : 'in_memory_simulated',
          paypalSandboxReady: Boolean(serverOptions.paypalExecutor),
          source: 'postgres',
        });
      }
      return reply(200, {
        transactions,
        executionMode: serverOptions.paypalExecutor ? 'paypal_sandbox' : 'in_memory_simulated',
        paypalSandboxReady: Boolean(serverOptions.paypalExecutor),
        source: 'in_memory_demo',
      });
    }

    const txApproveMatch = options.url.match(/^\/v1\/transactions\/([^/]+)\/approve$/);
    if (options.method === 'POST' && txApproveMatch) {
      const txApproveRoleBlocked = requireMoneyRole();
      if (txApproveRoleBlocked) {
        return txApproveRoleBlocked;
      }
      const txId = decodeURIComponent(txApproveMatch[1] ?? '');
      if (txId.startsWith('qr:')) {
        const qrCode = txId.slice(3);
        const approvalRecord = qrApprovals.get(qrCode);
        if (!approvalRecord || (authedOwnerId !== null && approvalRecord.ownerId !== authedOwnerId)) {
          return reply(404, { success: false, error: 'TRANSACTION_NOT_FOUND' });
        }
        if (approvalRecord.used || inFlightQrCodes.has(qrCode)) {
          return reply(409, { success: false, error: 'TRANSACTION_ALREADY_FINALIZED' });
        }
        if (Date.now() >= approvalRecord.expiresAtMs) {
          return reply(410, { success: false, error: 'QR_CODE_EXPIRED' });
        }
        inFlightQrCodes.add(qrCode);
        try {
          const result = await settleApprovedQrRecord(approvalRecord);
          if (result.statusCode === 200) {
            approvalRecord.used = true;
            approvalRecord.outcome = 'APPROVED';
            if (durability) {
              void durability.markQrUsed(qrCode).catch(() => {});
            }
          }
          return result;
        } finally {
          inFlightQrCodes.delete(qrCode);
        }
      }
      const tx = transactions.find((t) => t.id === txId);
      if (!tx) {
        return reply(404, { success: false, error: 'TRANSACTION_NOT_FOUND' });
      }
      if (!tx.canApproveReject || tx.status === 'Paid') {
        return reply(409, { success: false, error: 'TRANSACTION_ALREADY_FINALIZED', transaction: tx });
      }

      // Identity comes from the API key in authed mode; demo fallback stays
      // pinned to the seed owner for backward compatibility.
      const txOwnerId = authedOwnerId ?? 'owner_northstar';

      // Atomically claim the transaction before any await to prevent concurrent double-execution.
      tx.canApproveReject = false;

      let settled = false;
      try {
        const reEval = evaluatePolicy({
          ownerId: txOwnerId,
          proposal: tx.proposal,
          trustedVendors: defaultTrustedVendors,
          isDuplicateInvoice: settledInvoices.has(settledKey(txOwnerId, tx.proposal.invoiceId)),
          hourlySpentMinor: await getHourlySpentMinor(txOwnerId),
          policyVersion: 'v2026.11',
          idempotencyKey: `idem_tx_${tx.id}`,
        });

        if (reEval.state === 'REJECTED') {
          return reply(422, {
            success: false,
            gateReRan: true,
            error: reEval.reasonCode,
            toastMessage: `Gate re-ran: rejected (${reEval.reasonCode})`,
          });
        }

        const freshToken =
          reEval.state === 'APPROVED'
            ? reEval.approvedToken
            : issueApprovedToken({
              ownerId: txOwnerId,
              proposal: tx.proposal,
              idempotencyKey: `idem_tx_${tx.id}`,
              policyVersion: 'v2026.11',
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            });

        capabilityVault.set(freshToken.approvalId, freshToken);
        const settlementResult = await ledger.settleOrder({
          ownerId: txOwnerId,
          proposal: tx.proposal,
          token: freshToken,
          idempotencyKey: `idem_tx_${tx.id}`,
          bypassVelocityCap: true,
        });

        if (!settlementResult.success) {
          return reply(422, settlementResult);
        }

        settled = true;
        settledInvoices.add(settledKey(txOwnerId, tx.proposal.invoiceId));
        if (tx.qrCode) {
          const qrRec = qrApprovals.get(tx.qrCode);
          if (qrRec) {
            qrRec.used = true;
            qrRec.outcome = 'APPROVED';
          }
          if (durability) {
            void durability.markQrUsed(tx.qrCode).catch(() => {});
          }
        }

        let paypalOrderId = `PP-SBX-${settlementResult.settlement.settlementId.slice(0, 8).toUpperCase()}`;
        if (serverOptions.paypalExecutor) {
          const paypal = await serverOptions.paypalExecutor.execute(freshToken);
          if (paypal.ok) paypalOrderId = paypal.paypalOrderId;
        }

        tx.status = 'Paid';
        tx.policyCode = 'AUTO_EXECUTED';
        tx.canApproveReject = false;
        tx.paypalOrderId = paypalOrderId;

        pushAudit({
          id: `evt-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          action: 'TX_APPROVE',
          actor: authedOwnerId !== null ? `key:${authedOwnerId}` : 'Jordan Diaz (Finance Admin)',
          invoiceId: tx.invoiceNumber,
          vendor: tx.vendor,
          amountMinor: tx.amountMinor,
          decisionState: 'APPROVED',
          reasonCode: 'AUTO_EXECUTED',
          detail: `Approved ${tx.invoiceNumber} after gate re-evaluation; settled (${paypalOrderId}).`,
        });

        return reply(200, {
          success: true,
          gateReRan: true,
          toastMessage: 'Gate re-ran, decision stood',
          transaction: tx,
          settlement: settlementResult.settlement,
          paypalOrderId,
        });
      } finally {
        if (!settled) {
          tx.canApproveReject = true;
        }
      }
    }

    const txRejectMatch = options.url.match(/^\/v1\/transactions\/([^/]+)\/reject$/);
    if (options.method === 'POST' && txRejectMatch) {
      const txRejectRoleBlocked = requireMoneyRole();
      if (txRejectRoleBlocked) {
        return txRejectRoleBlocked;
      }
      const txId = decodeURIComponent(txRejectMatch[1] ?? '');
      if (txId.startsWith('qr:')) {
        const qrCode = txId.slice(3);
        const approvalRecord = qrApprovals.get(qrCode);
        if (!approvalRecord || (authedOwnerId !== null && approvalRecord.ownerId !== authedOwnerId)) {
          return reply(404, { success: false, error: 'TRANSACTION_NOT_FOUND' });
        }
        if (approvalRecord.used || inFlightQrCodes.has(qrCode)) {
          return reply(409, { success: false, error: 'TRANSACTION_ALREADY_FINALIZED' });
        }
        approvalRecord.used = true;
        approvalRecord.outcome = 'REJECTED';
        if (durability) {
          void durability.markQrUsed(qrCode).catch(() => {});
        }
        pushAudit({
          id: `evt-${randomUUID().slice(0, 8)}`,
          timestamp: new Date().toISOString(),
          action: 'TX_REJECT',
          actor: authedOwnerId !== null ? `key:${authedOwnerId}` : 'Jordan Diaz (Finance Admin)',
          invoiceId: approvalRecord.proposal.invoiceId,
          vendor: approvalRecord.proposal.vendorName,
          amountMinor: Number(approvalRecord.proposal.grandTotalMinor),
          decisionState: 'REJECTED',
          reasonCode: approvalRecord.initialReasonCode,
          detail: `Rejected ${approvalRecord.proposal.invoiceId} (${approvalRecord.proposal.vendorName}).`,
        });
        return reply(200, {
          success: true,
          transaction: {
            id: txId,
            vendor: approvalRecord.proposal.vendorName,
            invoiceNumber: approvalRecord.proposal.invoiceId,
            amountFormatted: `$${(Number(approvalRecord.proposal.grandTotalMinor) / 100).toFixed(2)}`,
            amountMinor: Number(approvalRecord.proposal.grandTotalMinor),
            status: 'Blocked',
            policyCode: approvalRecord.initialReasonCode,
            dateFormatted: 'Rejected',
            canApproveReject: false,
            proposal: null,
          },
        });
      }
      const tx = transactions.find((t) => t.id === txId);
      if (!tx) {
        return reply(404, { success: false, error: 'TRANSACTION_NOT_FOUND' });
      }
      if (!tx.canApproveReject) {
        return reply(409, { success: false, error: 'TRANSACTION_ALREADY_FINALIZED', transaction: tx });
      }

      tx.status = 'Blocked';
      tx.canApproveReject = false;
      if (tx.qrCode) {
        const qrRec = qrApprovals.get(tx.qrCode);
        if (qrRec) {
          qrRec.used = true;
          qrRec.outcome = 'REJECTED';
        }
        if (durability) {
          void durability.markQrUsed(tx.qrCode).catch(() => {});
        }
      }

      pushAudit({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'TX_REJECT',
        actor: authedOwnerId !== null ? `key:${authedOwnerId}` : 'Jordan Diaz (Finance Admin)',
        invoiceId: tx.invoiceNumber,
        vendor: tx.vendor,
        amountMinor: tx.amountMinor,
        decisionState: 'REJECTED',
        reasonCode: tx.policyCode,
        detail: `Rejected ${tx.invoiceNumber} (${tx.vendor}).`,
      });

      return reply(200, {
        success: true,
        transaction: tx,
      });
    }

    // 8. Approvals, Vendors, Audit Trail Routes
    if (options.method === 'GET' && options.url === '/v1/approvals') {
      const resolveOutcome = (r: QrApprovalRecord): 'APPROVED' | 'REJECTED' | null => {
        if (r.outcome) return r.outcome;
        if (!r.used) return null;
        const match = auditEvents.find(
          (e) =>
            e.invoiceId === r.proposal.invoiceId &&
            (e.action === 'TX_REJECT' || e.action === 'HITL_APPROVE' || e.action === 'TX_APPROVE'),
        );
        if (match?.action === 'TX_REJECT') return 'REJECTED';
        if (match?.action === 'HITL_APPROVE' || match?.action === 'TX_APPROVE') return 'APPROVED';
        return null;
      };
      const nowMs = Date.now();
      const approvals = Array.from(qrApprovals.values())
        .filter((r) => authedOwnerId === null || r.ownerId === authedOwnerId)
        .sort((a, b) => {
          const aPending = !a.used && nowMs < a.expiresAtMs ? 0 : 1;
          const bPending = !b.used && nowMs < b.expiresAtMs ? 0 : 1;
          if (aPending !== bPending) return aPending - bPending;
          return b.expiresAtMs - a.expiresAtMs;
        })
        .map((r) => ({
          code: r.code,
          ownerId: r.ownerId,
          invoiceId: r.proposal.invoiceId,
          vendorName: r.proposal.vendorName,
          amountMinor: Number(r.proposal.grandTotalMinor),
          reasonCode: r.initialReasonCode,
          used: r.used,
          outcome: resolveOutcome(r),
          expired: nowMs >= r.expiresAtMs,
          expiresAt: new Date(r.expiresAtMs).toISOString(),
        }));
      return reply(200, { approvals });
    }

    if (options.method === 'GET' && options.url === '/v1/vendors') {
      const trustedSet = new Set(defaultTrustedVendors);
      if (ledger instanceof PostgresLedger) {
        const entries = await ledger.listEntries(authedOwnerId, 1000);
        const nowMs = Date.now();
        const activeApprovals = Array.from(qrApprovals.values()).filter(
          (r) => !r.used && nowMs < r.expiresAtMs && (authedOwnerId === null || r.ownerId === authedOwnerId),
        );
        const allNames = new Set<string>(defaultTrustedVendors);
        for (const entry of entries) allNames.add(entry.vendorName);
        for (const approval of activeApprovals) allNames.add(approval.proposal.vendorName);

        const vendors = Array.from(allNames).map((name) => {
          const vendorEntries = entries.filter((entry) => entry.vendorName === name);
          const pendingCount = activeApprovals.filter((r) => r.proposal.vendorName === name).length;
          const settledMinor = vendorEntries
            .filter((entry) => entry.status === 'SETTLED')
            .reduce((sum, entry) => sum + entry.amountMinor, 0);
          return {
            name,
            trusted: trustedSet.has(name),
            transactionCount: vendorEntries.length + pendingCount,
            settledMinor,
          };
        });
        return reply(200, { vendors, source: 'postgres' });
      }
      const allNames = new Set<string>(defaultTrustedVendors);
      for (const tx of transactions) allNames.add(tx.vendor);
      const vendors = Array.from(allNames).map((name) => {
        const vendorTxs = transactions.filter((t) => t.vendor === name);
        const totalMinor = vendorTxs.reduce((sum, t) => sum + (t.status === 'Paid' ? t.amountMinor : 0), 0);
        return {
          name,
          trusted: trustedSet.has(name),
          transactionCount: vendorTxs.length,
          settledMinor: totalMinor,
        };
      });
      return reply(200, { vendors, source: 'in_memory_demo' });
    }

    if (options.method === 'GET' && options.url === '/v1/audit') {
      const visibleEvents =
        authedOwnerId === null
          ? auditEvents
          : auditEvents.filter((e) => !e.ownerId || e.ownerId === authedOwnerId);
      return reply(200, { events: visibleEvents });
    }

    // 9. PayPal Webhook Receiver (public; PayPal's verified signature is the identity).
    // Reconciliation source of truth: rail state must eventually match the ledger.
    if (options.method === 'POST' && options.url === '/v1/webhooks/paypal') {
      if (!serverOptions.paypalWebhook) {
        return reply(503, { error: 'WEBHOOK_NOT_CONFIGURED', detail: 'PayPal client + PAYPAL_WEBHOOK_ID required.' });
      }
      if (!durability) {
        // Rail state is only trustworthy if it survives restarts - fail closed.
        return reply(503, { error: 'WEBHOOKS_REQUIRE_DURABLE_STORE', detail: 'PostgreSQL durability required for webhook reconciliation.' });
      }

      const verify = await verifyPayPalWebhookSignature(serverOptions.paypalWebhook, {
        headers: {
          authAlgo: options.headers?.['paypal-auth-algo'],
          certUrl: options.headers?.['paypal-cert-url'],
          transmissionId: options.headers?.['paypal-transmission-id'],
          transmissionSig: options.headers?.['paypal-transmission-sig'],
          transmissionTime: options.headers?.['paypal-transmission-time'],
        },
        event: options.payload,
        ...(typeof options.rawBody === 'string' && options.rawBody.trim().length > 0
          ? { rawEventBody: options.rawBody }
          : {}),
      });
      if (!verify.verified) {
        // Fail closed: anything that is not provably PayPal is rejected.
        return reply(401, { error: 'WEBHOOK_VERIFICATION_FAILED', reason: verify.reason });
      }

      const event: PayPalWebhookEvent = verify.event;
      const persistResult = await durability.saveRailEvent(event);
      if (persistResult === 'duplicate') {
        return reply(200, { status: 'duplicate_ignored', eventId: event.id });
      }

      const action = classifyCaptureEvent(event.event_type);
      // Webhook -> ledger linkage: custom_id (set at order creation) is what
      // PayPal reliably surfaces on capture events; reference_id kept as a
      // fallback. Both carry our idempotency key.
      const rawReference =
        typeof event.resource?.custom_id === 'string' && event.resource.custom_id.length > 0
          ? event.resource.custom_id
          : typeof event.resource?.reference_id === 'string' && event.resource.reference_id.length > 0
            ? event.resource.reference_id
            : undefined;
      const railUpdate = await durability.applyRailAction({ referenceId: rawReference, action });

      pushAudit({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'EVALUATE',
        actor: 'paypal-webhook',
        invoiceId: rawReference ?? (typeof event.resource?.id === 'string' ? event.resource.id : 'unknown'),
        vendor: 'PayPal rail',
        amountMinor: 0,
        decisionState: action,
        reasonCode: event.event_type ?? 'UNKNOWN_EVENT',
        detail: `Webhook ${event.id} (${event.event_type}) verified; ${railUpdate.updated} ledger entr${railUpdate.updated === 1 ? 'y' : 'ies'} updated to ${action}.`,
      });

      return reply(200, { status: 'processed', action, ledgerEntriesUpdated: railUpdate.updated });
    }

    // 10. Reconciliation report (authed): where ledger and rail disagree.
    if (options.method === 'GET' && options.url === '/v1/reconciliation') {
      if (!durability) {
        return reply(200, {
          mode: 'in_memory',
          detail: 'Durable reconciliation requires PostgreSQL; in-memory mode has no rail state to reconcile.',
          unconfirmedEntries: [],
          failedOrRefundedEntries: [],
          recentEvents: [],
        });
      }
      const report = await durability.getRailStateReport();
      return reply(200, { mode: 'postgres', ...report });
    }

    return reply(404, { error: 'NOT_FOUND', path: options.url });
  }

  return {
    ledger,
    capabilityVault,
    qrApprovals,
    inject: <T = unknown>(options: InjectOptions) =>
      handleRequest(options) as Promise<InjectResponse<T>>,
    hydrate: async () => {
      if (durability) {
        try {
          const pending = await durability.loadPendingQrApprovals();
          for (const record of pending) {
            if (!qrApprovals.has(record.code)) {
              qrApprovals.set(record.code, record);
            }
          }
        } catch {
          // Fail visible at boot via log below; the server still starts.
          console.error('QR approval hydration from durable store failed; starting with empty approvals.');
        }
        try {
          const persisted = await durability.loadAuditEvents(200);
          for (const event of persisted) {
            if (!auditEvents.some((existing) => existing.id === event.id)) {
              auditEvents.push(event);
            }
          }
        } catch {
          console.error('Audit history hydration from durable store failed; starting with empty audit history.');
        }
      }
      if (ledger instanceof PostgresLedger) {
        try {
          for (const key of await ledger.listSettledInvoiceKeys()) {
            settledInvoices.add(key);
          }
        } catch {
          console.error('Settled-invoice hydration failed; PostgreSQL uniqueness still guards execution.');
        }
      }
    },
    listen: (port = 4000) =>
      new Promise((resolve) => {
        const httpServer: Server = createServer(
          (req: IncomingMessage, res: ServerResponse) => {
            const MAX_BODY_BYTES = 1_048_576; // 1 MiB limit (OWASP API4:2023)
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            let tooLarge = false;

            req.on('data', (chunk: Buffer) => {
              if (tooLarge) return;
              totalBytes += chunk.length;
              if (totalBytes > MAX_BODY_BYTES) {
                tooLarge = true;
                const body = JSON.stringify({ error: 'PAYLOAD_TOO_LARGE' });
                res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
                res.end(body);
                req.destroy();
                return;
              }
              chunks.push(chunk);
            });

            req.on('end', () => {
              if (tooLarge) return;
              void (async () => {
                let payload: unknown = undefined;
                const raw = Buffer.concat(chunks).toString('utf-8');
                if (raw.trim().length > 0) {
                  try {
                    payload = JSON.parse(raw);
                  } catch {
                    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'INVALID_JSON' }));
                    return;
                  }
                }

                const method = (req.method ?? 'GET') as 'GET' | 'POST' | 'OPTIONS';
                const rawUrl = req.url ?? '/';
                const url = rawUrl.split('?')[0] || '/';
                const incomingRequestId = req.headers['x-request-id'];
                const requestId = Array.isArray(incomingRequestId) ? incomingRequestId[0] : incomingRequestId;
                // Forward identity + webhook-signature headers (lowercased by Node).
                const forwardedHeaders: Record<string, string> = {};
                const FORWARDABLE = [
                  'authorization',
                  'paypal-auth-algo',
                  'paypal-cert-url',
                  'paypal-transmission-id',
                  'paypal-transmission-sig',
                  'paypal-transmission-time',
                ] as const;
                for (const name of FORWARDABLE) {
                  const value = req.headers[name];
                  const first = Array.isArray(value) ? value[0] : value;
                  if (typeof first === 'string') {
                    forwardedHeaders[name] = first;
                  }
                }
                const response = await handleRequest({
                  method,
                  url,
                  payload,
                  ...(raw.trim().length > 0 ? { rawBody: raw } : {}),
                  headers: {
                    ...(requestId ? { 'x-request-id': requestId } : {}),
                    ...forwardedHeaders,
                  },
                });

                res.writeHead(response.statusCode, response.headers);
                res.end(response.body);
              })().catch(() => {
                if (!res.headersSent) {
                  res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                  res.end(JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }));
                }
              });
            });
          },
        );

        httpServer.listen(port, () => {
          const addr = httpServer.address();
          const boundPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve({
            port: boundPort,
            close: () =>
              new Promise<void>((resClose, rejClose) =>
                httpServer.close((err) => (err ? rejClose(err) : resClose())),
              ),
          });
        });
      }),
  };
}
