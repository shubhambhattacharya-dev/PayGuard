import { randomUUID } from 'node:crypto';
import {
  ReasonCode,
  type PolicyDecision,
  type OrderProposal,
  issueApprovedToken,
  createDependencyHold,
} from '@payguard/contracts';

export const AUTO_EXECUTE_CAP_MINOR = 10000; // $100.00 in integer cents
export const HOURLY_VELOCITY_CAP_MINOR = 20000; // $200.00 in integer cents

export interface PolicyEvaluationInput {
  readonly ownerId: string;
  readonly proposal: OrderProposal;
  readonly trustedVendors: readonly string[];
  readonly isDuplicateInvoice: boolean;
  readonly hourlySpentMinor: number;
  readonly policyVersion: string;
  readonly idempotencyKey: string;
  readonly expiresAt?: string;
}

/**
 * Deterministic Financial Policy Gate (Centaur 80/20 Kernel)
 */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyDecision {
  const decisionId = randomUUID();
  const evaluatedAt = new Date().toISOString();
  const expiresAt = input.expiresAt ?? new Date(Date.now() + 15 * 60_000).toISOString();

  try {
    // 1. Duplicate invoice -> Reject (replay protection).
    if (input.isDuplicateInvoice) {
      return { state: 'REJECTED', reasonCode: ReasonCode.REJECT_DUPLICATE_INVOICE, decisionId, evaluatedAt };
    }
    // 2. Vendor not in the trusted list -> Hold for review.
    if (!input.trustedVendors.includes(input.proposal.vendorName)) {
      return { state: 'HOLD', reasonCode: ReasonCode.HOLD_VENDOR_UNTRUSTED, decisionId, evaluatedAt };
    }
    // 3. Order grand total above the single-order auto cap -> Hold (HITL).
    if (input.proposal.grandTotalMinor > AUTO_EXECUTE_CAP_MINOR) {
      return { state: 'HOLD', reasonCode: ReasonCode.HOLD_OVER_CAP, decisionId, evaluatedAt };
    }
    // 4. Hourly spend plus this order above the velocity cap -> Hold.
    if (input.hourlySpentMinor + input.proposal.grandTotalMinor > HOURLY_VELOCITY_CAP_MINOR) {
      return { state: 'HOLD', reasonCode: ReasonCode.HOLD_VELOCITY_LIMIT, decisionId, evaluatedAt };
    }
    // 5. All checks passed -> mint the capability token and approve.
    const approvedToken = issueApprovedToken({
      ownerId: input.ownerId,
      proposal: input.proposal,
      idempotencyKey: input.idempotencyKey,
      policyVersion: input.policyVersion,
      expiresAt,
    });
    return { state: 'APPROVED', reasonCode: ReasonCode.OK_AUTO, approvedToken, decisionId, evaluatedAt };
  } catch (_err) {
    // Fail closed: any unexpected branch collapses to a dependency HOLD.
    return createDependencyHold(decisionId);
  }
}
