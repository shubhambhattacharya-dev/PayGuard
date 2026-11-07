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
    // =============================================================
    // TODO: SHUBHAM 20% KERNEL (NO CODE HINTS - WRITE FROM SPEC)
    // =============================================================
    // Business Requirements (Check in this order):
     // 1. Duplicate invoice -> Reject
     if(input.isDuplicateInvoice){
      return {state:"REJECTED", reasonCode: ReasonCode.REJECT_DUPLICATE_INVOICE, decisionId,
      evaluatedAt}
     }
   
    // 2. Vendor not in trusted list -> Hold
   
    if(!input.trustedVendors.includes(input.proposal.vendorName)){
      return {state:"HOLD", reasonCode:ReasonCode.HOLD_VENDOR_UNTRUSTED,  decisionId,
      evaluatedAt}
    }
    // 3. Order grand total exceeds single-order cap -> Hold
    if(input.proposal.grandTotalMinor > AUTO_EXECUTE_CAP_MINOR){
      return {
        state:"HOLD",reasonCode:ReasonCode.HOLD_OVER_CAP,decisionId,
      evaluatedAt
      }
    }
    // 4. Hourly spent + current order exceeds hourly velocity cap -> Hold
    if(input.hourlySpentMinor + input.proposal.grandTotalMinor> HOURLY_VELOCITY_CAP_MINOR ){
      return { state:"HOLD", reasonCode:ReasonCode.HOLD_VELOCITY_LIMIT, decisionId,
      evaluatedAt}

    }
    // 5. All passed -> Mint capability token and Approve

    const approvedToken=issueApprovedToken({ownerId:input.ownerId,proposal:input.proposal,idempotencyKey:input.idempotencyKey,policyVersion:input.policyVersion,expiresAt})
    return { state: 'APPROVED', reasonCode: ReasonCode.OK_AUTO, approvedToken: approvedToken, decisionId, evaluatedAt };
    
    
    // ================================= ============================

  } catch (_err) {
    return createDependencyHold(decisionId);
  }
}
