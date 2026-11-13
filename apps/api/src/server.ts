import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
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
import { InMemoryLedger, type SettlementResult } from './modules/ledger/ledger.js';
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

export interface InjectOptions {
  readonly method: 'GET' | 'POST' | 'OPTIONS';
  readonly url: string;
  readonly payload?: unknown;
  readonly headers?: Record<string, string>;
}

export interface InjectResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
  json(): T;
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
  used: boolean;
}

export interface AuditEvent {
  readonly id: string;
  readonly timestamp: string;
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
  /ignore\s+all\s+previous\s+instructions/i,
  /disregard\s+(all\s+)?(policy|limits|instructions)/i,
  /system\s+override/i,
  /pre-approved\s+for\s+\$/i,
  /auto-approval\s+limit\s+raised/i,
];

export function detectPromptInjection(text: string): string | null {
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

export interface BuildServerOptions {
  /**
   * PayPal rail behind the policy gate. When omitted, /v1/execute settles the
   * in-memory ledger and returns a simulated sandbox reference (offline demo).
   */
  readonly paypalExecutor?: PayPalExecutor;
  /**
   * Agent chat function. `undefined` = auto (Gemini -> Groq from env keys);
   * `null` = no model available, agent route fails closed to HOLD;
   * a function = injected model (tests / recorded fixture replay).
   */
  readonly agentChat?: AgentChatFn | null;
  readonly agentProvider?: ProviderName;
  readonly catalog?: CatalogStore;
}

export interface AgentRunRequestPayload {
  readonly ownerId: string;
  readonly invoiceText: string;
  readonly goal?: string;
  readonly idempotencyKey?: string;
  readonly model?: 'auto' | 'fixture';
}

export interface PayGuardServer {
  readonly ledger: InMemoryLedger;
  readonly capabilityVault: Map<string, ApprovedForExecution>;
  readonly qrApprovals: Map<string, QrApprovalRecord>;
  inject<T = unknown>(options: InjectOptions): Promise<InjectResponse<T>>;
  listen(port?: number): Promise<{ port: number; close: () => Promise<void> }>;
}

export function buildServer(initialSeedBalanceMinor = 500_000, serverOptions: BuildServerOptions = {}): PayGuardServer {
  const ledger = new InMemoryLedger();
  ledger.seedAccount('owner_northstar', initialSeedBalanceMinor);
  ledger.seedAccount('owner_1', initialSeedBalanceMinor);

  const capabilityVault = new Map<string, ApprovedForExecution>();
  const qrApprovals = new Map<string, QrApprovalRecord>();
  const settledInvoices = new Set<string>(['INV-3155']);
  const auditEvents: AuditEvent[] = [
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
      detail: 'Amount $842.50 exceeds $100.00 auto-cap; single-use QR PG-7F3K-9D2L issued.',
    },
    {
      id: 'evt-seed-2',
      timestamp: '2026-11-01T09:22:00.000Z',
      action: 'EVALUATE',
      actor: 'policy-gate',
      invoiceId: 'INV-1182',
      vendor: 'Lumen Office',
      amountMinor: 44200,
      decisionState: 'HOLD',
      reasonCode: ReasonCode.HOLD_OVER_CAP,
      detail: 'Amount $442.00 exceeds $100.00 auto-cap; single-use QR PG-4M9A-2B1C issued.',
    },
    {
      id: 'evt-seed-3',
      timestamp: '2026-11-01T09:30:00.000Z',
      action: 'EXECUTE',
      actor: 'policy-gate',
      invoiceId: 'INV-3155',
      vendor: 'Cedar Supply',
      amountMinor: 6400,
      decisionState: 'APPROVED',
      reasonCode: ReasonCode.OK_AUTO,
      detail: 'Auto-executed under $100.00 cap.',
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

  const transactions: LedgerTransactionRecord[] = [
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
    {
      id: 'tx-2',
      vendor: 'Lumen Office',
      invoiceNumber: 'INV-1182',
      amountFormatted: '$442.00',
      amountMinor: 44200,
      status: 'Review required',
      policyCode: 'HOLD_OVER_CAP',
      dateFormatted: 'Nov 1, 2026',
      canApproveReject: true,
      qrCode: 'PG-4M9A-2B1C',
      proposal: makeSeedProposal('INV-1182', 'Lumen Office', 'LO-SUP-102', 'Lumen Office Annual Suite', 44200),
    },
    {
      id: 'tx-3',
      vendor: 'Cedar Supply',
      invoiceNumber: 'INV-3155',
      amountFormatted: '$64.00',
      amountMinor: 6400,
      status: 'Paid',
      policyCode: 'AUTO_EXECUTED',
      dateFormatted: 'Nov 1, 2026',
      canApproveReject: false,
      proposal: makeSeedProposal('INV-3155', 'Cedar Supply', 'CED-PPR-01', 'Office Paper Reams', 6400),
    },
    {
      id: 'tx-4',
      vendor: 'Bluebird Logistics',
      invoiceNumber: 'INV-0907',
      amountFormatted: '$117.00',
      amountMinor: 11700,
      status: 'On hold',
      policyCode: 'HOLD_VENDOR_DESTINATION',
      dateFormatted: 'Nov 1, 2026',
      canApproveReject: false,
      proposal: makeSeedProposal('INV-0907', 'Bluebird Logistics', 'BL-EXP-09', 'Express Courier Batch', 11700),
    },
    {
      id: 'tx-5',
      vendor: 'Unknown Vendor',
      invoiceNumber: 'INV-5510',
      amountFormatted: '$5,000.00',
      amountMinor: 500000,
      status: 'Blocked',
      policyCode: 'HOLD_VENDOR_UNTRUSTED',
      dateFormatted: 'Nov 1, 2026',
      canApproveReject: false,
      proposal: makeSeedProposal('INV-5510', 'Unknown Vendor', 'UNK-FRT-01', 'Unverified Bulk Hardware', 500000),
    },
    {
      id: 'tx-6',
      vendor: 'Aster Cloud',
      invoiceNumber: 'INV-2099',
      amountFormatted: '$5,000.00',
      amountMinor: 500000,
      status: 'Blocked',
      policyCode: 'REJECT_PROMPT_INJECTION',
      dateFormatted: 'Nov 1, 2026',
      canApproveReject: false,
      proposal: makeSeedProposal('INV-2099', 'Aster Cloud', 'AC-ENT-99', 'Injected Override Claim', 500000),
    },
  ];

  if (transactions[0]) {
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

  if (transactions[1]) {
    qrApprovals.set('PG-4M9A-2B1C', {
      code: 'PG-4M9A-2B1C',
      ownerId: 'owner_northstar',
      proposal: transactions[1].proposal,
      idempotencyKey: 'idem_seed_tx2',
      policyVersion: 'v2026.11',
      trustedVendors: defaultTrustedVendors,
      hourlySpentMinor: 0,
      initialReasonCode: ReasonCode.HOLD_OVER_CAP,
      expiresAtMs: Date.now() + 24 * 60 * 60_000,
      used: false,
    });
  }

  async function handleRequest(options: InjectOptions): Promise<InjectResponse> {
    const corsHeaders: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization, x-idempotency-key',
    };

    const reply = (statusCode: number, data: unknown): InjectResponse => {
      const body = JSON.stringify(data);
      return {
        statusCode,
        headers: corsHeaders,
        body,
        json: <T>() => JSON.parse(body) as T,
      };
    };

    if (options.method === 'OPTIONS') {
      return reply(204, {});
    }

    // 1. Health Check Route
    if (options.method === 'GET' && (options.url === '/healthz' || options.url === '/health')) {
      const paypalSandboxReady = Boolean(serverOptions.paypalExecutor);
      return reply(200, {
        status: 'ok',
        service: '@payguard/api',
        fiduciaryLaw: 'The LLM proposes; deterministic financial policies dispose.',
        paypalSandboxReady,
        executionMode: paypalSandboxReady ? 'paypal_sandbox' : 'in_memory_simulated',
        timestamp: new Date().toISOString(),
      });
    }

    // 2. Deterministic Policy Gate + Grounding Evaluation Route
    if (options.method === 'POST' && options.url === '/v1/evaluate') {
      const body = (options.payload ?? {}) as Partial<EvaluateRequestPayload>;
      const parsedProposal = OrderProposalSchema.safeParse(body.proposal);

      if (!parsedProposal.success || !body.ownerId) {
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
      const ownerId = body.ownerId;
      const policyVersion = body.policyVersion ?? 'v2026.11';
      const idempotencyKey = body.idempotencyKey ?? `idem_${proposal.invoiceId}`;

      // 2a. Untrusted Prompt Injection Scan on Invoice Text
      if (typeof body.invoiceText === 'string' && body.invoiceText.trim().length > 0) {
        const injectionMatch = detectPromptInjection(body.invoiceText);
        if (injectionMatch) {
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

      // 2c. Vendor Payout Destination Change Check (UI Inspector Gap #3)
      if (
        body.vendorDestination &&
        body.vendorDestination.trustedAccount !== body.vendorDestination.invoiceAccount
      ) {
        const decisionId = randomUUID();
        return reply(200, {
          decision: {
            state: 'HOLD',
            reasonCode: ReasonCode.HOLD_VENDOR_DESTINATION,
            decisionId,
            evaluatedAt: new Date().toISOString(),
          },
          vendorDestination: body.vendorDestination,
        });
      }

      const trustedVendors = body.trustedVendors ?? defaultTrustedVendors;
      const isDuplicateInvoice = body.isDuplicateInvoice ?? false;
      const hourlySpentMinor = body.hourlySpentMinor ?? 0;

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

      auditEvents.unshift({
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
        const qrCode = `PG-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
        qrApprovals.set(qrCode, {
          code: qrCode,
          ownerId,
          proposal,
          idempotencyKey,
          policyVersion,
          trustedVendors,
          hourlySpentMinor,
          initialReasonCode: decision.reasonCode,
          expiresAtMs: Date.now() + 10 * 60_000,
          used: false,
        });
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
      const parsedProposal = OrderProposalSchema.safeParse(body.proposal);

      if (!parsedProposal.success || !body.ownerId || !body.idempotencyKey) {
        return reply(400, {
          success: false,
          error: 'INVALID_EXECUTE_PAYLOAD',
        });
      }

      const token =
        body.token ??
        (body.approvalId ? capabilityVault.get(body.approvalId) : undefined);

      const result: SettlementResult = await ledger.settleOrder({
        ownerId: body.ownerId,
        proposal: parsedProposal.data,
        token: token as ApprovedForExecution,
        idempotencyKey: body.idempotencyKey,
      });

      if (!result.success) {
        const statusCode = result.error === 'FORBIDDEN_CAPABILITY' ? 403 : 422;
        return reply(statusCode, result);
      }

      settledInvoices.add(parsedProposal.data.invoiceId);
      auditEvents.unshift({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'EXECUTE',
        actor: body.ownerId,
        invoiceId: parsedProposal.data.invoiceId,
        vendor: parsedProposal.data.vendorName,
        amountMinor: Number(parsedProposal.data.grandTotalMinor),
        decisionState: 'APPROVED',
        reasonCode: 'SETTLED',
        detail: `Settled ${parsedProposal.data.invoiceId} via /v1/execute.`,
      });

      // Ledger settled. Now move money on the configured rail (if any).
      if (serverOptions.paypalExecutor) {
        const paypal: PayPalExecutionResult = await serverOptions.paypalExecutor.execute(token as ApprovedForExecution);
        if (paypal.ok) {
          return reply(200, {
            ...result,
            paypalOrderId: paypal.paypalOrderId,
            paypal: { ok: true, status: paypal.status, captureId: paypal.captureId },
          });
        }
        // Fail visible, never fail open: settlement stands, the rail failure is reported.
        return reply(200, {
          ...result,
          paypalOrderId: `PP-SBX-${result.settlement.settlementId.slice(0, 8).toUpperCase()}`,
          paypal: { ok: false, stage: paypal.stage, errorCode: paypal.errorCode, message: paypal.message },
        });
      }

      return reply(200, {
        ...result,
        paypalOrderId: `PP-SBX-${result.settlement.settlementId.slice(0, 8).toUpperCase()}`,
      });
    }

    // 80% Shell Helper: Re-runs deterministic policy gate (TOCTOU check), mints capability token, and settles
    const settleApprovedQrRecord = async (record: QrApprovalRecord): Promise<InjectResponse> => {
      const reEval = evaluatePolicy({
        ownerId: record.ownerId,
        proposal: record.proposal,
        trustedVendors: record.trustedVendors,
        isDuplicateInvoice: settledInvoices.has(record.proposal.invoiceId),
        hourlySpentMinor: record.hourlySpentMinor,
        policyVersion: record.policyVersion,
        idempotencyKey: record.idempotencyKey,
      });

      if (reEval.state === 'REJECTED') {
        auditEvents.unshift({
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
        auditEvents.unshift({
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
      });

      if (!settlementResult.success) {
        return reply(422, settlementResult);
      }

      settledInvoices.add(record.proposal.invoiceId);

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

      auditEvents.unshift({
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

      // 1. Lookup: unknown code -> 404.
      const approvalRecord = qrApprovals.get(body.singleUseCode);
      if (!approvalRecord) {
        return reply(404, { success: false, error: 'QR_CODE_NOT_FOUND' });
      }
      // 2. Replay protection: consumed code -> 409 Conflict.
      if (approvalRecord.used) {
        return reply(409, { success: false, error: 'QR_CODE_ALREADY_USED' });
      }
      // 3. Expiration: past expiry -> 410 Gone.
      if (Date.now() >= approvalRecord.expiresAtMs) {
        return reply(410, { success: false, error: 'QR_CODE_EXPIRED' });
      }
      // 4. Consume BEFORE settling so concurrent replays cannot double-spend.
      approvalRecord.used = true;
      return settleApprovedQrRecord(approvalRecord);
    }

    // 5. Catalog (read-only, owner-controlled data the agent may query).
    if (options.method === 'GET' && options.url === '/v1/catalog') {
      const items = catalog.search('', 1000);
      return reply(200, { items });
    }

    // 6. Agent route: the LLM proposes, the deterministic gate disposes.
    if (options.method === 'POST' && options.url === '/v1/agent/run') {
      const body = (options.payload ?? {}) as Partial<AgentRunRequestPayload>;
      const ownerId = body.ownerId;
      const invoiceText = typeof body.invoiceText === 'string' ? body.invoiceText : '';
      const goal = typeof body.goal === 'string' && body.goal.trim().length > 0 ? body.goal.trim() : 'Pay this vendor invoice.';
      const idempotencyKey = body.idempotencyKey ?? `agent_${randomUUID().slice(0, 8)}`;
      const policyVersion = 'v2026.11';

      if (!ownerId || invoiceText.trim().length === 0) {
        return reply(400, { error: 'INVALID_AGENT_PAYLOAD', detail: 'ownerId and invoiceText are required.' });
      }

      const thoughts: { round: number; tool: string | null; summary: string }[] = [];

      // 6a. Untrusted prompt-injection scan FIRST - injected text never reaches policy.
      const injectionMatch = detectPromptInjection(invoiceText);
      if (injectionMatch) {
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

      const run: AgentRunResult = await runAgentLoop({ goal, invoiceText, chat, catalog });
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
        isDuplicateInvoice: false,
        hourlySpentMinor: 0,
        policyVersion,
        idempotencyKey,
      });

      if (decision.state === 'REJECTED') {
        return reply(200, { decision, thoughts, proposal: run.proposal, model: provider, roundsUsed: run.roundsUsed });
      }

      auditEvents.unshift({
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
        const qrCode = `PG-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
        qrApprovals.set(qrCode, {
          code: qrCode,
          ownerId,
          proposal: run.proposal,
          idempotencyKey,
          policyVersion,
          trustedVendors: defaultTrustedVendors,
          hourlySpentMinor: 0,
          initialReasonCode: decision.reasonCode,
          expiresAtMs: Date.now() + 10 * 60_000,
          used: false,
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

      settledInvoices.add(run.proposal.invoiceId);

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

    // 7. Ledger Transactions & Live Approve/Reject Routes (for UI Dashboard)
    if (options.method === 'GET' && options.url === '/v1/transactions') {
      return reply(200, {
        transactions,
        executionMode: serverOptions.paypalExecutor ? 'paypal_sandbox' : 'in_memory_simulated',
        paypalSandboxReady: Boolean(serverOptions.paypalExecutor),
      });
    }

    const txApproveMatch = options.url.match(/^\/v1\/transactions\/([^/]+)\/approve$/);
    if (options.method === 'POST' && txApproveMatch) {
      const txId = txApproveMatch[1];
      const tx = transactions.find((t) => t.id === txId);
      if (!tx) {
        return reply(404, { success: false, error: 'TRANSACTION_NOT_FOUND' });
      }
      if (!tx.canApproveReject || tx.status === 'Paid') {
        return reply(409, { success: false, error: 'TRANSACTION_ALREADY_FINALIZED', transaction: tx });
      }

      const reEval = evaluatePolicy({
        ownerId: 'owner_northstar',
        proposal: tx.proposal,
        trustedVendors: defaultTrustedVendors,
        isDuplicateInvoice: settledInvoices.has(tx.proposal.invoiceId),
        hourlySpentMinor: 0,
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
              ownerId: 'owner_northstar',
              proposal: tx.proposal,
              idempotencyKey: `idem_tx_${tx.id}`,
              policyVersion: 'v2026.11',
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            });

      capabilityVault.set(freshToken.approvalId, freshToken);
      const settlementResult = await ledger.settleOrder({
        ownerId: 'owner_northstar',
        proposal: tx.proposal,
        token: freshToken,
        idempotencyKey: `idem_tx_${tx.id}`,
      });

      if (!settlementResult.success) {
        return reply(422, settlementResult);
      }

      settledInvoices.add(tx.proposal.invoiceId);
      if (tx.qrCode) {
        const qrRec = qrApprovals.get(tx.qrCode);
        if (qrRec) qrRec.used = true;
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

      auditEvents.unshift({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'TX_APPROVE',
        actor: 'Jordan Diaz (Finance Admin)',
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
    }

    const txRejectMatch = options.url.match(/^\/v1\/transactions\/([^/]+)\/reject$/);
    if (options.method === 'POST' && txRejectMatch) {
      const txId = txRejectMatch[1];
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
        if (qrRec) qrRec.used = true;
      }

      auditEvents.unshift({
        id: `evt-${randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        action: 'TX_REJECT',
        actor: 'Jordan Diaz (Finance Admin)',
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
      const approvals = Array.from(qrApprovals.values()).map((r) => ({
        code: r.code,
        ownerId: r.ownerId,
        invoiceId: r.proposal.invoiceId,
        vendorName: r.proposal.vendorName,
        amountMinor: Number(r.proposal.grandTotalMinor),
        reasonCode: r.initialReasonCode,
        used: r.used,
        expired: Date.now() >= r.expiresAtMs,
        expiresAt: new Date(r.expiresAtMs).toISOString(),
      }));
      return reply(200, { approvals });
    }

    if (options.method === 'GET' && options.url === '/v1/vendors') {
      const vendors = defaultTrustedVendors.map((name) => {
        const vendorTxs = transactions.filter((t) => t.vendor === name);
        const totalMinor = vendorTxs.reduce((sum, t) => sum + (t.status === 'Paid' ? t.amountMinor : 0), 0);
        return {
          name,
          trusted: true,
          transactionCount: vendorTxs.length,
          settledMinor: totalMinor,
        };
      });
      return reply(200, { vendors });
    }

    if (options.method === 'GET' && options.url === '/v1/audit') {
      return reply(200, { events: auditEvents });
    }

    return reply(404, { error: 'NOT_FOUND', path: options.url });
  }

  return {
    ledger,
    capabilityVault,
    qrApprovals,
    inject: <T = unknown>(options: InjectOptions) =>
      handleRequest(options) as Promise<InjectResponse<T>>,
    listen: (port = 4000) =>
      new Promise((resolve) => {
        const httpServer: Server = createServer(
          (req: IncomingMessage, res: ServerResponse) => {
            const chunks: Buffer[] = [];
            req.on('data', (chunk: Buffer) => chunks.push(chunk));
            req.on('end', async () => {
              let payload: unknown = undefined;
              const raw = Buffer.concat(chunks).toString('utf-8');
              if (raw.trim().length > 0) {
                try {
                  payload = JSON.parse(raw);
                } catch {
                  payload = undefined;
                }
              }

              const method = (req.method ?? 'GET') as 'GET' | 'POST' | 'OPTIONS';
              const url = req.url ?? '/';
              const response = await handleRequest({ method, url, payload });

              res.writeHead(response.statusCode, response.headers);
              res.end(response.body);
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
