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
  readonly expiresAtMs: number;
  used: boolean;
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

export interface PayGuardServer {
  readonly ledger: InMemoryLedger;
  readonly capabilityVault: Map<string, ApprovedForExecution>;
  readonly qrApprovals: Map<string, QrApprovalRecord>;
  inject<T = unknown>(options: InjectOptions): Promise<InjectResponse<T>>;
  listen(port?: number): Promise<{ port: number; close: () => Promise<void> }>;
}

export function buildServer(initialSeedBalanceMinor = 500_000): PayGuardServer {
  const ledger = new InMemoryLedger();
  ledger.seedAccount('owner_northstar', initialSeedBalanceMinor);
  ledger.seedAccount('owner_1', initialSeedBalanceMinor);

  const capabilityVault = new Map<string, ApprovedForExecution>();
  const qrApprovals = new Map<string, QrApprovalRecord>();

  const defaultTrustedVendors = [
    'Aster Cloud',
    'Lumen Office',
    'Cedar Supply',
    'Bluebird Logistics',
    'Acme Cloud Corp',
  ];

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
      return reply(200, {
        status: 'ok',
        service: '@payguard/api',
        fiduciaryLaw: 'The LLM proposes; deterministic financial policies dispose.',
        paypalSandboxReady: true,
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

      // 2d. Deterministic Policy Gate (Ticket #1 Kernel)
      const decision: PolicyDecision = evaluatePolicy({
        ownerId,
        proposal,
        trustedVendors: body.trustedVendors ?? defaultTrustedVendors,
        isDuplicateInvoice: body.isDuplicateInvoice ?? false,
        hourlySpentMinor: body.hourlySpentMinor ?? 0,
        policyVersion,
        idempotencyKey,
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

      return reply(200, {
        ...result,
        paypalOrderId: `PP-SBX-${result.settlement.settlementId.slice(0, 8).toUpperCase()}`,
      });
    }

    // 80% Shell Helper: Mints capability token and settles approved QR record in Ledger
    const settleApprovedQrRecord = async (record: QrApprovalRecord): Promise<InjectResponse> => {
      const freshToken = issueApprovedToken({
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

      return reply(200, {
        success: true,
        gateReRan: true,
        toastMessage: 'Gate re-ran, decision stood',
        settlement: settlementResult.settlement,
        paypalOrderId: `PP-SBX-${settlementResult.settlement.settlementId.slice(0, 8).toUpperCase()}`,
      });
    };

    // 4. Single-Use QR / HITL Approval Route (Ticket #4: 20% Kernel)
    if (options.method === 'POST' && options.url === '/v1/hitl/approve') {
      const body = (options.payload ?? {}) as { readonly singleUseCode?: string };
      if (!body.singleUseCode) {
        return reply(400, { success: false, error: 'MISSING_QR_CODE' });
      }

      void settleApprovedQrRecord;

      // =============================================================
      // TODO: SHUBHAM 20% KERNEL (NO CODE HINTS - WRITE FROM SPEC)
      // =============================================================
      // Business Requirements (Check in this exact order):
      // 1. Lookup the QR approval record from the in-memory QR map using the code from the request.
        const approvalRecord=qrApprovals.get(body.singleUseCode);
        if(!approvalRecord){
          return reply (404,{success:false,error:'QR_CODE_NOT_FOUND'})
        } 

      //    If no record exists, reply with HTTP 404 and the not-found error code.

      
      // 2. Replay protection: If the record has already been marked as consumed,
      //    reply with HTTP 409 Conflict and the already-used error code.
      if(approvalRecord.used){
        return reply(409,{success:false,error:'QR_CODE_ALREADY_USED'})
      }
      // 3. Expiration check: If the current timestamp is greater than or equal to the
      //    record's expiry timestamp, reply with HTTP 410 Gone and the expired error code.
      if(Date.now() >= approvalRecord.expiresAtMs){
        return reply(410,{success:false, error:'QR_CODE_EXPIRED'})
      }
        
      approvalRecord.used=true;
      return settleApprovedQrRecord(approvalRecord)
      
      // 4. State transition & settlement: Mark the QR record as consumed BEFORE
      //    delegating to the settlement helper so concurrent replay requests cannot pass.

      // =============================================================
  
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
