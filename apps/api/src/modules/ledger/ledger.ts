import { randomUUID } from 'node:crypto';
import {
  type OrderProposal,
  type ApprovedForExecution,
  assertApprovedForExecution,
} from '@payguard/contracts';

export interface SettlementReceipt {
  readonly settlementId: string;
  readonly ownerId: string;
  readonly invoiceId: string;
  readonly amountMinor: number;
  readonly remainingBalanceMinor: number;
  readonly settledAt: string;
  readonly status: 'SETTLED';
}

export type SettlementResult =
  | { readonly success: true; readonly settlement: SettlementReceipt }
  | {
      readonly success: false;
      readonly error: 'FORBIDDEN_CAPABILITY' | 'INSUFFICIENT_FUNDS';
    };

export interface SettleOrderInput {
  readonly ownerId: string;
  readonly proposal: OrderProposal;
  readonly token: ApprovedForExecution;
  readonly idempotencyKey: string;
}

export class InMemoryLedger {
  private readonly accounts = new Map<string, number>();
  private readonly idempotencyReceipts = new Map<string, SettlementReceipt>();
  // Mutex lock map to prevent race conditions on parallel requests for the same owner
  private readonly accountLocks = new Map<string, Promise<void>>();

  public seedAccount(ownerId: string, initialBalanceMinor: number): void {
    this.accounts.set(ownerId, initialBalanceMinor);
  }

  public getBalance(ownerId: string): number {
    return this.accounts.get(ownerId) ?? 0;
  }

  /**
   * Settle an approved order with pessimistic account locking and idempotency caching.
   */
  public async settleOrder(input: SettleOrderInput): Promise<SettlementResult> {
    // Acquire per-account lock to guarantee serial execution
    let releaseLock: () => void = () => {};
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const currentLock = this.accountLocks.get(input.ownerId) ?? Promise.resolve();
    this.accountLocks.set(
      input.ownerId,
      currentLock.then(() => lockPromise),
    );

    await currentLock;

    try {
      // =============================================================
      // TODO: SHUBHAM 20% KERNEL (NO CODE HINTS - WRITE FROM SPEC)
      // =============================================================
      // Business Requirements (Check in this exact order):
      //
      // 1. Verify capability token:
      //    Call assertCanExecuteOrder(input.token) inside a try/catch.
      //    If it throws, return { success: false, error: 'FORBIDDEN_CAPABILITY' }
        try{
        assertApprovedForExecution(input.token)

        }catch{
           return { success: false, error: 'FORBIDDEN_CAPABILITY' }
        }
      
      // 2. Idempotency check:
      //    Build cache key `${input.ownerId}:${input.idempotencyKey}`.
      //    If this.idempotencyReceipts has this key, return
      //    { success: true, settlement: existingReceipt }
      const cacheKey=`${input.ownerId}:${input.idempotencyKey}`;
      if(this.idempotencyReceipts.has(cacheKey)){
        const existingReceipt=this.idempotencyReceipts.get(cacheKey)!;
        return { success: true, settlement: existingReceipt }
      }

      //
      // 3. Balance check:
      //    Look up current balance from this.accounts.
      //    If current balance < input.proposal.grandTotalMinor,
      //    return { success: false, error: 'INSUFFICIENT_FUNDS' }
      const balance =this.accounts.get(input.ownerId)??0
      if( balance < input.proposal.grandTotalMinor){
         return { success: false, error: 'INSUFFICIENT_FUNDS' }

      }
      //
      // 4. Atomic decrement & Receipt creation:
      //    newBalance = currentBalance - input.proposal.grandTotalMinor
      //    Save newBalance in this.accounts.
      //    Create receipt with randomUUID(), settledAt ISO string, etc.
      //    Store in this.idempotencyReceipts.
      //    Return { success: true, settlement: receipt }
      // =============================================================
     const  newBalance=balance - input.proposal.grandTotalMinor;
     this.accounts.set(input.ownerId,newBalance)
     const receipt:SettlementReceipt={
      settlementId:randomUUID(),
      ownerId:input.ownerId,
      invoiceId:input.proposal.invoiceId,
      amountMinor:input.proposal.grandTotalMinor,
      remainingBalanceMinor:newBalance,
      settledAt:new Date().toISOString(),
      status:'SETTLED'

     }
     this.idempotencyReceipts.set(cacheKey,receipt)
    return { success: true, settlement: receipt };




      
    } finally {
      releaseLock();
    }
  }
}

