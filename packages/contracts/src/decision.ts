import { randomUUID } from 'node:crypto';
import type { MoneyMinor } from './money.js';
import { OrderProposalSchema, type OrderProposal } from './order.js';

// =====================================================
// DECISION STATES
// =====================================================

export type DecisionState = 'APPROVED' | 'HOLD' | 'REJECTED';

// =====================================================
// STABLE REASON CODES (PDF Table 4-1 & Section 7.2)
// =====================================================

export enum ReasonCode {
  // Approval
  OK_AUTO = 'OK_AUTO',

  // Human review
  HOLD_OVER_CAP = 'HOLD_OVER_CAP',
  HOLD_VELOCITY_LIMIT = 'HOLD_VELOCITY_LIMIT',
  HOLD_DAILY_CAP_EXCEEDED = 'HOLD_DAILY_CAP_EXCEEDED',
  HOLD_VENDOR_DESTINATION = 'HOLD_VENDOR_DESTINATION',
  HOLD_VENDOR_UNTRUSTED = 'HOLD_VENDOR_UNTRUSTED',
  HOLD_MANUAL_REVIEW = 'HOLD_MANUAL_REVIEW',

  // Rejection
  REJECT_SCHEMA_INVALID = 'REJECT_SCHEMA_INVALID',
  REJECT_PROMPT_INJECTION = 'REJECT_PROMPT_INJECTION',
  REJECT_UNCATALOGUED_SKU = 'REJECT_UNCATALOGUED_SKU',
  REJECT_PRICE_MISMATCH = 'REJECT_PRICE_MISMATCH',
  REJECT_MATH_MISMATCH = 'REJECT_MATH_MISMATCH',
  REJECT_DUPLICATE_INVOICE = 'REJECT_DUPLICATE_INVOICE',
  REJECT_TENANT_MISMATCH = 'REJECT_TENANT_MISMATCH',

  // Dependency failure: fail closed
  DEPENDENCY_UNAVAILABLE = 'DEPENDENCY_UNAVAILABLE',

  // Execution outcomes
  AUTO_EXECUTED = 'AUTO_EXECUTED',
}

// =====================================================
// DEEP READONLY
// =====================================================

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

// =====================================================
// APPROVAL CAPABILITY
// =====================================================

declare const ApprovedForExecutionBrand: unique symbol;

export type ApprovedForExecution = {
  readonly [ApprovedForExecutionBrand]: true;
  readonly approvalId: string;
  readonly proposal: DeepReadonly<OrderProposal>;
  readonly ownerId: string;
  readonly authorizedAt: string;
  readonly expiresAt: string;
  readonly authorizedTotalMinor: MoneyMinor;
  readonly idempotencyKey: string;
  readonly policyVersion: string;
};

// =====================================================
// REASON CODE GROUPS
// =====================================================

export type ApprovedReasonCode = ReasonCode.OK_AUTO;

export type HoldReasonCode =
  | ReasonCode.HOLD_OVER_CAP
  | ReasonCode.HOLD_VELOCITY_LIMIT
  | ReasonCode.HOLD_DAILY_CAP_EXCEEDED
  | ReasonCode.HOLD_VENDOR_DESTINATION
  | ReasonCode.HOLD_VENDOR_UNTRUSTED
  | ReasonCode.HOLD_MANUAL_REVIEW
  | ReasonCode.DEPENDENCY_UNAVAILABLE;

export type RejectedReasonCode =
  | ReasonCode.REJECT_SCHEMA_INVALID
  | ReasonCode.REJECT_PROMPT_INJECTION
  | ReasonCode.REJECT_UNCATALOGUED_SKU
  | ReasonCode.REJECT_PRICE_MISMATCH
  | ReasonCode.REJECT_MATH_MISMATCH
  | ReasonCode.REJECT_DUPLICATE_INVOICE
  | ReasonCode.REJECT_TENANT_MISMATCH;

// =====================================================
// DECISION METADATA
// =====================================================

export type DecisionMetadata = {
  readonly decisionId: string;
  readonly evaluatedAt: string;
};

// =====================================================
// INTERNAL POLICY DECISION
// =====================================================

export type PolicyDecision =
  | (DecisionMetadata & {
      readonly state: 'APPROVED';
      readonly reasonCode: ApprovedReasonCode;
      readonly approvedToken: ApprovedForExecution;
    })
  | (DecisionMetadata & {
      readonly state: 'HOLD';
      readonly reasonCode: HoldReasonCode;
    })
  | (DecisionMetadata & {
      readonly state: 'REJECTED';
      readonly reasonCode: RejectedReasonCode;
    });

// =====================================================
// PUBLIC API DECISION
// =====================================================

export type PublicPolicyDecision =
  | (DecisionMetadata & {
      readonly state: 'APPROVED';
      readonly reasonCode: ApprovedReasonCode;
    })
  | (DecisionMetadata & {
      readonly state: 'HOLD';
      readonly reasonCode: HoldReasonCode;
    })
  | (DecisionMetadata & {
      readonly state: 'REJECTED';
      readonly reasonCode: RejectedReasonCode;
    });

// =====================================================
// POLICY ERROR CONTRACT
// =====================================================

export type PolicyEvaluationErrorCode =
  | 'POLICY_EVALUATION_FAILED'
  | 'POLICY_CONFIGURATION_INVALID';

export type PolicyEvaluationError = {
  readonly code: PolicyEvaluationErrorCode;
  readonly incidentId: string;
  readonly retryable: boolean;
};

export type PolicyEvaluationResult =
  | {
      readonly ok: true;
      readonly decision: PolicyDecision;
    }
  | {
      readonly ok: false;
      readonly error: PolicyEvaluationError;
    };

// =====================================================
// PAYMENT EXECUTION RESULT
// =====================================================

export type PaymentExecutionResult =
  | {
      readonly state: 'EXECUTED';
      readonly reasonCode: ReasonCode.AUTO_EXECUTED;
      readonly executionId: string;
      readonly executedAt: string;
      readonly providerReference: string;
    }
  | {
      readonly state: 'FAILED';
      readonly errorCode:
        | 'PAYMENT_DECLINED'
        | 'PAYMENT_PROVIDER_UNAVAILABLE'
        | 'PAYMENT_EXECUTION_UNKNOWN';
      readonly incidentId: string;
      readonly retryable: boolean;
    };

// =====================================================
// 1. PRIVATE RUNTIME CAPABILITY REGISTRY
// =====================================================

const issuedTokens = new WeakSet<object>();

// =====================================================
// 2. CONTROLLED CAPABILITY ERRORS
// =====================================================

export type CapabilityErrorCode =
  | 'APPROVAL_CAPABILITY_INVALID'
  | 'APPROVAL_CAPABILITY_EXPIRED';

export class CapabilityError extends Error {
  constructor(public readonly code: CapabilityErrorCode) {
    super(code);
    this.name = 'CapabilityError';
  }
}

// =====================================================
// 3. DEEP FREEZE
// =====================================================

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function createProposalSnapshot(proposal: OrderProposal): DeepReadonly<OrderProposal> {
  const snapshot: OrderProposal = {
    ...proposal,
    lineItems: proposal.lineItems.map((item) => ({ ...item })),
  };
  return deepFreeze(snapshot);
}

// =====================================================
// 5. APPROVAL INPUT
// =====================================================

export type ApprovalInput = {
  readonly ownerId: string;
  readonly proposal: OrderProposal;
  readonly idempotencyKey: string;
  readonly policyVersion: string;
  readonly expiresAt: string;
};

// =====================================================
// 6. ISSUE AN APPROVAL CAPABILITY
// =====================================================

export function issueApprovedToken(input: ApprovalInput): ApprovedForExecution {
  const parsed = OrderProposalSchema.safeParse(input.proposal);

  if (!parsed.success) {
    throw new CapabilityError('APPROVAL_CAPABILITY_INVALID');
  }

  if (!input.ownerId.trim() || input.ownerId.length > 128) {
    throw new CapabilityError('APPROVAL_CAPABILITY_INVALID');
  }

  if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 255) {
    throw new CapabilityError('APPROVAL_CAPABILITY_INVALID');
  }

  if (!input.policyVersion.trim() || input.policyVersion.length > 64) {
    throw new CapabilityError('APPROVAL_CAPABILITY_INVALID');
  }

  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new CapabilityError('APPROVAL_CAPABILITY_EXPIRED');
  }

  const proposal = createProposalSnapshot(parsed.data);

  const token = Object.freeze({
    approvalId: randomUUID(),
    proposal,
    ownerId: input.ownerId,
    authorizedAt: new Date().toISOString(),
    expiresAt: new Date(expiry).toISOString(),
    authorizedTotalMinor: proposal.grandTotalMinor,
    idempotencyKey: input.idempotencyKey,
    policyVersion: input.policyVersion,
  }) as unknown as ApprovedForExecution;

  issuedTokens.add(token as object);
  return token;
}

// =====================================================
// 7. VERIFY A TOKEN AT RUNTIME
// =====================================================

export function assertApprovedForExecution(value: unknown): asserts value is ApprovedForExecution {
  if (typeof value !== 'object' || value === null || !issuedTokens.has(value)) {
    throw new CapabilityError('APPROVAL_CAPABILITY_INVALID');
  }

  const token = value as ApprovedForExecution;
  const expiry = Date.parse(token.expiresAt);

  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new CapabilityError('APPROVAL_CAPABILITY_EXPIRED');
  }

  if (token.authorizedTotalMinor !== token.proposal.grandTotalMinor) {
    throw new CapabilityError('APPROVAL_CAPABILITY_INVALID');
  }
}

// =====================================================
// 8. SAFE PUBLIC DECISION MAPPING
// =====================================================

export function toPublicPolicyDecision(decision: PolicyDecision): PublicPolicyDecision {
  if (decision.state === 'APPROVED') {
    const { approvedToken: _internalCapability, ...publicDecision } = decision;
    return publicDecision;
  }
  return decision;
}

// =====================================================
// 9. EXPLICIT HOLD RESULT FOR DEPENDENCY FAILURE
// =====================================================

export function createDependencyHold(decisionId = randomUUID()): PolicyDecision {
  return {
    state: 'HOLD',
    reasonCode: ReasonCode.DEPENDENCY_UNAVAILABLE,
    decisionId,
    evaluatedAt: new Date().toISOString(),
  };
}