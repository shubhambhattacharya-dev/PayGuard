import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from './gate.js';
import { ReasonCode } from '@payguard/contracts';
import type { OrderProposal } from '@payguard/contracts';
import { toMoneyMinor } from '@payguard/contracts';

const sampleProposal: OrderProposal = {
  invoiceId: 'inv_123',
  vendorName: 'Acme Cloud Services',
  currency: 'USD',
  lineItems: [
    {
      sku: 'SKU_SERVER',
      description: 'Linux VM 16GB',
      quantity: 1,
      unitPriceMinor: toMoneyMinor(6400),
      taxBps: 0,
      lineTotalMinor: toMoneyMinor(6400),
    },
  ],
  subtotalMinor: toMoneyMinor(6400),
  taxTotalMinor: toMoneyMinor(0),
  grandTotalMinor: toMoneyMinor(6400),
};

describe('evaluatePolicy (Deterministic Financial Gate)', () => {
  it('approves orders under or equal to $100.00 (10000 minor units)', () => {
    const result = evaluatePolicy({
      ownerId: 'owner_abc',
      proposal: sampleProposal,
      trustedVendors: ['Acme Cloud Services'],
      isDuplicateInvoice: false,
      hourlySpentMinor: 0,
      policyVersion: '1.0.0',
      idempotencyKey: 'idem_1',
    });

    expect(result.state).toBe('APPROVED');
    expect(result.reasonCode).toBe(ReasonCode.OK_AUTO);
    if (result.state === 'APPROVED') {
      expect(result.approvedToken).toBeDefined();
      expect(result.approvedToken.authorizedTotalMinor).toBe(6400);
    }
  });

  it('holds orders over $100.00 (e.g. $100.01 / 10001 cents) for human review', () => {
    const highProposal: OrderProposal = {
      ...sampleProposal,
      subtotalMinor: toMoneyMinor(10001),
      grandTotalMinor: toMoneyMinor(10001),
      lineItems: [
        {
          sku: 'SKU_EXPENSIVE',
          description: 'Expensive Service',
          quantity: 1,
          unitPriceMinor: toMoneyMinor(10001),
          taxBps: 0,
          lineTotalMinor: toMoneyMinor(10001),
        },
      ],
    };

    const result = evaluatePolicy({
      ownerId: 'owner_abc',
      proposal: highProposal,
      trustedVendors: ['Acme Cloud Services'],
      isDuplicateInvoice: false,
      hourlySpentMinor: 0,
      policyVersion: '1.0.0',
      idempotencyKey: 'idem_2',
    });

    expect(result.state).toBe('HOLD');
    expect(result.reasonCode).toBe(ReasonCode.HOLD_OVER_CAP);
  });

  it('rejects duplicate invoices immediately', () => {
    const result = evaluatePolicy({
      ownerId: 'owner_abc',
      proposal: sampleProposal,
      trustedVendors: ['Acme Cloud Services'],
      isDuplicateInvoice: true,
      hourlySpentMinor: 0,
      policyVersion: '1.0.0',
      idempotencyKey: 'idem_3',
    });

    expect(result.state).toBe('REJECTED');
    expect(result.reasonCode).toBe(ReasonCode.REJECT_DUPLICATE_INVOICE);
  });

  it('holds untrusted vendor proposals for manual review', () => {
    const result = evaluatePolicy({
      ownerId: 'owner_abc',
      proposal: sampleProposal,
      trustedVendors: ['Verified Vendor Ltd'], // Acme is not in trusted list
      isDuplicateInvoice: false,
      hourlySpentMinor: 0,
      policyVersion: '1.0.0',
      idempotencyKey: 'idem_4',
    });

    expect(result.state).toBe('HOLD');
    expect(result.reasonCode).toBe(ReasonCode.HOLD_VENDOR_UNTRUSTED);
  });

  it('holds order if hourly velocity cap ($200.00 / 20000 cents) is exceeded', () => {
    const result = evaluatePolicy({
      ownerId: 'owner_abc',
      proposal: sampleProposal, // 6400 cents
      trustedVendors: ['Acme Cloud Services'],
      isDuplicateInvoice: false,
      hourlySpentMinor: 15000, // 15000 + 6400 = 21400 > 20000 cap!
      policyVersion: '1.0.0',
      idempotencyKey: 'idem_5',
    });

    expect(result.state).toBe('HOLD');
    expect(result.reasonCode).toBe(ReasonCode.HOLD_VELOCITY_LIMIT);
  });
});
