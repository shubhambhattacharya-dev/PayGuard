import { describe, it, expect, beforeEach } from 'vitest';
import {
  type OrderProposal,
  issueApprovedToken,
  toMoneyMinor,
  type ApprovedForExecution,
} from '@payguard/contracts';
import { InMemoryLedger } from './ledger.js';

describe('InMemoryLedger (Atomic Settlement, Idempotency & Capability Verification)', () => {
  let ledger: InMemoryLedger;
  const ownerId = 'corp_finance_01';

  const sampleProposal: OrderProposal = {
    invoiceId: 'INV-2026-901',
    vendorName: 'Acme Cloud Services',
    lineItems: [
      {
        sku: 'HOST-01',
        description: 'Server Hosting',
        quantity: 1,
        unitPriceMinor: toMoneyMinor(5000),
        taxBps: 0,
        lineTotalMinor: toMoneyMinor(5000),
      },
    ],
    currency: 'USD',
    subtotalMinor: toMoneyMinor(5000),
    taxTotalMinor: toMoneyMinor(0),
    grandTotalMinor: toMoneyMinor(5000), // $50.00
  };

  beforeEach(() => {
    ledger = new InMemoryLedger();
    ledger.seedAccount(ownerId, 10000); // Initial balance $100.00 (10000 minor units)
  });

  it('rejects settlement when capability token is missing or forged (FORBIDDEN_CAPABILITY)', async () => {
    const unapprovedToken = {
      decisionId: 'fake-id',
      evaluatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as ApprovedForExecution;

    const result = await ledger.settleOrder({
      ownerId,
      proposal: sampleProposal,
      token: unapprovedToken,
      idempotencyKey: 'idemp-forge-test',
    });

    expect(result).toEqual({
      success: false,
      error: 'FORBIDDEN_CAPABILITY',
    });
    expect(ledger.getBalance(ownerId)).toBe(10000);
  });

  it('settles order atomically, decrements balance, and generates settlement receipt', async () => {
    const token = issueApprovedToken({
      ownerId,
      proposal: sampleProposal,
      idempotencyKey: 'idemp-success-01',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await ledger.settleOrder({
      ownerId,
      proposal: sampleProposal,
      token,
      idempotencyKey: 'idemp-success-01',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.settlement.amountMinor).toBe(5000);
      expect(result.settlement.remainingBalanceMinor).toBe(5000);
      expect(result.settlement.status).toBe('SETTLED');
    }
    expect(ledger.getBalance(ownerId)).toBe(5000);
  });

  it('returns cached receipt without double-charging on duplicate idempotency key (IDEMPOTENT_REPLAY)', async () => {
    const token = issueApprovedToken({
      ownerId,
      proposal: sampleProposal,
      idempotencyKey: 'idemp-replay-01',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    // First call
    const firstResult = await ledger.settleOrder({
      ownerId,
      proposal: sampleProposal,
      token,
      idempotencyKey: 'idemp-replay-01',
    });
    expect(firstResult.success).toBe(true);
    expect(ledger.getBalance(ownerId)).toBe(5000);

    // Duplicate call with same idempotency key
    const duplicateResult = await ledger.settleOrder({
      ownerId,
      proposal: sampleProposal,
      token,
      idempotencyKey: 'idemp-replay-01',
    });

    expect(duplicateResult.success).toBe(true);
    if (firstResult.success && duplicateResult.success) {
      expect(duplicateResult.settlement.settlementId).toBe(
        firstResult.settlement.settlementId,
      );
    }
    // Balance must not be deducted twice
    expect(ledger.getBalance(ownerId)).toBe(5000);
  });

  it('rejects when balance is insufficient (INSUFFICIENT_FUNDS)', async () => {
    const expensiveProposal: OrderProposal = {
      ...sampleProposal,
      lineItems: [
        {
          sku: 'HOST-01',
          description: 'Server Hosting',
          quantity: 1,
          unitPriceMinor: toMoneyMinor(15000),
          taxBps: 0,
          lineTotalMinor: toMoneyMinor(15000),
        },
      ],
      subtotalMinor: toMoneyMinor(15000),
      grandTotalMinor: toMoneyMinor(15000), // $150.00, but account has only $100.00
    };

    const token = issueApprovedToken({
      ownerId,
      proposal: expensiveProposal,
      idempotencyKey: 'idemp-overdraft-01',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await ledger.settleOrder({
      ownerId,
      proposal: expensiveProposal,
      token,
      idempotencyKey: 'idemp-overdraft-01',
    });

    expect(result).toEqual({
      success: false,
      error: 'INSUFFICIENT_FUNDS',
    });
    expect(ledger.getBalance(ownerId)).toBe(10000);
  });

  it('prevents race conditions: concurrent requests cannot overdraft account', async () => {
    // Initial balance is 10000 ($100.00). Each debit is 6000 ($60.00).
    // Firing 2 parallel debits: exactly 1 must succeed, 1 must fail with INSUFFICIENT_FUNDS.
    const proposalA: OrderProposal = {
      ...sampleProposal,
      lineItems: [
        {
          sku: 'HOST-01',
          description: 'Server Hosting',
          quantity: 1,
          unitPriceMinor: toMoneyMinor(6000),
          taxBps: 0,
          lineTotalMinor: toMoneyMinor(6000),
        },
      ],
      subtotalMinor: toMoneyMinor(6000),
      grandTotalMinor: toMoneyMinor(6000),
    };
    const proposalB: OrderProposal = {
      ...sampleProposal,
      invoiceId: 'INV-2026-902',
      lineItems: [
        {
          sku: 'HOST-01',
          description: 'Server Hosting',
          quantity: 1,
          unitPriceMinor: toMoneyMinor(6000),
          taxBps: 0,
          lineTotalMinor: toMoneyMinor(6000),
        },
      ],
      subtotalMinor: toMoneyMinor(6000),
      grandTotalMinor: toMoneyMinor(6000),
    };

    const tokenA = issueApprovedToken({
      ownerId,
      proposal: proposalA,
      idempotencyKey: 'idemp-concurrent-A',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const tokenB = issueApprovedToken({
      ownerId,
      proposal: proposalB,
      idempotencyKey: 'idemp-concurrent-B',
      policyVersion: '1.0.0',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const [resA, resB] = await Promise.all([
      ledger.settleOrder({
        ownerId,
        proposal: proposalA,
        token: tokenA,
        idempotencyKey: 'idemp-concurrent-A',
      }),
      ledger.settleOrder({
        ownerId,
        proposal: proposalB,
        token: tokenB,
        idempotencyKey: 'idemp-concurrent-B',
      }),
    ]);

    const successes = [resA, resB].filter((r) => r.success);
    const failures = [resA, resB].filter((r) => !r.success);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as { error: string }).error).toBe('INSUFFICIENT_FUNDS');
    expect(ledger.getBalance(ownerId)).toBe(4000); // 10000 - 6000 = 4000
  });
});
