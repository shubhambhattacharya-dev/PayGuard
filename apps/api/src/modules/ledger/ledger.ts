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
      readonly error:
        | 'FORBIDDEN_CAPABILITY'
        | 'INSUFFICIENT_FUNDS'
        | 'DUPLICATE_INVOICE'
        | 'VELOCITY_CAP_EXCEEDED'
        | 'IDEMPOTENCY_CONFLICT';
    };

export interface SettleOrderInput {
  readonly ownerId: string;
  readonly proposal: OrderProposal;
  readonly token: ApprovedForExecution;
  readonly idempotencyKey: string;
  readonly bypassVelocityCap?: boolean;
}

export interface LedgerStore {
  seedAccount(ownerId: string, initialBalanceMinor: number): void | Promise<void>;
  getBalance(ownerId: string): number | Promise<number>;
  getHourlySpentMinor(ownerId: string): number | Promise<number>;
  isKnownIdempotencyKey(ownerId: string, idempotencyKey: string): boolean | Promise<boolean>;
  settleOrder(input: SettleOrderInput): Promise<SettlementResult>;
}

export class InMemoryLedger implements LedgerStore {
  private readonly accounts = new Map<string, number>();
  private readonly idempotencyReceipts = new Map<string, SettlementReceipt>();
  private readonly settledInvoiceIds = new Set<string>();
  private readonly accountLocks = new Map<string, Promise<void>>();

  public constructor(private readonly hourlyVelocityCapMinor?: number) {}

  public seedAccount(ownerId: string, initialBalanceMinor: number): void {
    this.accounts.set(ownerId, initialBalanceMinor);
  }

  public getBalance(ownerId: string): number {
    return this.accounts.get(ownerId) ?? 0;
  }

  public getHourlySpentMinor(ownerId: string): number {
    const cutoffMs = Date.now() - 60 * 60_000;
    let sum = 0;
    for (const receipt of this.idempotencyReceipts.values()) {
      if (receipt.ownerId === ownerId && Date.parse(receipt.settledAt) >= cutoffMs) {
        sum += receipt.amountMinor;
      }
    }
    return sum;
  }

  public isKnownIdempotencyKey(ownerId: string, idempotencyKey: string): boolean {
    return this.idempotencyReceipts.has(`${ownerId}:${idempotencyKey}`);
  }

  public async settleOrder(input: SettleOrderInput): Promise<SettlementResult> {
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
      try {
        assertApprovedForExecution(input.token);
        if (
          input.token.ownerId !== input.ownerId ||
          input.token.idempotencyKey !== input.idempotencyKey ||
          input.token.authorizedTotalMinor !== input.proposal.grandTotalMinor ||
          input.token.proposal.invoiceId !== input.proposal.invoiceId
        ) {
          return { success: false, error: 'FORBIDDEN_CAPABILITY' };
        }
      } catch {
        return { success: false, error: 'FORBIDDEN_CAPABILITY' };
      }

      const cacheKey = `${input.ownerId}:${input.idempotencyKey}`;
      const existing = this.idempotencyReceipts.get(cacheKey);
      if (existing !== undefined) {
        return { success: true, settlement: existing };
      }

      if (this.settledInvoiceIds.has(input.proposal.invoiceId)) {
        return { success: false, error: 'DUPLICATE_INVOICE' };
      }

      if (
        !input.bypassVelocityCap &&
        this.hourlyVelocityCapMinor !== undefined &&
        this.getHourlySpentMinor(input.ownerId) + input.proposal.grandTotalMinor >
          this.hourlyVelocityCapMinor
      ) {
        return { success: false, error: 'VELOCITY_CAP_EXCEEDED' };
      }

      const balance = this.accounts.get(input.ownerId) ?? 0;
      if (balance < input.proposal.grandTotalMinor) {
        return { success: false, error: 'INSUFFICIENT_FUNDS' };
      }

      const newBalance = balance - input.proposal.grandTotalMinor;
      this.accounts.set(input.ownerId, newBalance);
      const receipt: SettlementReceipt = {
        settlementId: randomUUID(),
        ownerId: input.ownerId,
        invoiceId: input.proposal.invoiceId,
        amountMinor: input.proposal.grandTotalMinor,
        remainingBalanceMinor: newBalance,
        settledAt: new Date().toISOString(),
        status: 'SETTLED',
      };
      this.settledInvoiceIds.add(input.proposal.invoiceId);
      this.idempotencyReceipts.set(cacheKey, receipt);
      return { success: true, settlement: receipt };
    } finally {
      releaseLock();
    }
  }
}

