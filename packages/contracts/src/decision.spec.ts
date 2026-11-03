
import { describe, it, expect, vi } from 'vitest';
import {
  ReasonCode,
  issueApprovedToken,
  assertApprovedForExecution,
  CapabilityError,
  toPublicPolicyDecision,
  createDependencyHold,
} from './decision.js';
import { toMoneyMinor } from './money.js';
import type { OrderProposal } from './order.js';
import type { PolicyDecision } from './decision.js';

describe('packages/contracts: decision.ts capability & security suite', () => {
  const createValidProposal = (): OrderProposal => ({
    invoiceId: 'INV-101',
    vendorName: 'Aster Cloud',
    currency: 'USD',
    lineItems: [
      {
        sku: 'AC-PRO-001',
        description: 'Professional Plan',
        quantity: 1,
        unitPriceMinor: toMoneyMinor(6400),
        taxBps: 0,
        lineTotalMinor: toMoneyMinor(6400),
      },
    ],
    subtotalMinor: toMoneyMinor(6400),
    taxTotalMinor: toMoneyMinor(0),
    grandTotalMinor: toMoneyMinor(6400),
  });

  const createToken = (
    proposal: OrderProposal = createValidProposal(),
    expiresAt = new Date(Date.now() + 60_000).toISOString(),
  ) =>
    issueApprovedToken({
      ownerId: 'tenant-123',
      proposal,
      idempotencyKey: 'idemp-xyz',
      policyVersion: '1.0.0',
      expiresAt,
    });

  it('issues an authentic capability token', () => {
    const token = createToken();

    expect(() => assertApprovedForExecution(token)).not.toThrow();
  });

  it('rejects forged tokens even if they have the correct structure', () => {
    const forgedToken = {
      approvalId: 'fake-id',
      proposal: createValidProposal(),
      ownerId: 'tenant-123',
      authorizedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      authorizedTotalMinor: toMoneyMinor(6400),
      idempotencyKey: 'idemp-xyz',
      policyVersion: '1.0.0',
    };

    expect(() => assertApprovedForExecution(forgedToken)).toThrow(
      CapabilityError,
    );
  });

  it('rejects tokens that are already expired at issuance', () => {
    expect(() =>
      createToken(
        createValidProposal(),
        new Date(Date.now() - 1_000).toISOString(),
      ),
    ).toThrow(CapabilityError);
  });

  it('rejects a token that expires before execution validation', () => {
    vi.useFakeTimers();

    try {
      const token = createToken(
        createValidProposal(),
        new Date(Date.now() + 1_000).toISOString(),
      );

      // Move the clock beyond the token's expiry.
      vi.advanceTimersByTime(1_001);

      expect(() => assertApprovedForExecution(token)).toThrow(
        CapabilityError,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates an immutable token and deeply frozen proposal snapshot', () => {
    const token = createToken();

    expect(Object.isFrozen(token)).toBe(true);
    expect(Object.isFrozen(token.proposal)).toBe(true);
    expect(Object.isFrozen(token.proposal.lineItems)).toBe(true);
    expect(Object.isFrozen(token.proposal.lineItems[0])).toBe(true);
  });

  it('does not let changes to the original proposal alter the approved snapshot', () => {
    const originalProposal = createValidProposal();
    const token = createToken(originalProposal);

    

    // Simulate a caller trying to alter the original input after approval.
   const originalLineItem = originalProposal.lineItems[0];
const approvedLineItem = token.proposal.lineItems[0];

expect(originalLineItem).toBeDefined();
expect(approvedLineItem).toBeDefined();

if (!originalLineItem || !approvedLineItem) {
  throw new Error('Expected at least one line item');
}

const changed = Reflect.set(
  originalLineItem,
  'description',
  'Tampered Plan',
);

expect(changed).toBe(true);
expect(originalLineItem.description).toBe('Tampered Plan');

// Approved snapshot must remain unchanged.
expect(approvedLineItem.description).toBe('Professional Plan');
expect(() => assertApprovedForExecution(token)).not.toThrow();

    // The token must retain the independently copied approved snapshot.
   expect(approvedLineItem).toBeDefined();

if (approvedLineItem === undefined) {
  throw new Error('Expected an approved line item');
}

expect(approvedLineItem.description).toBe('Professional Plan');
expect(() => assertApprovedForExecution(token)).not.toThrow();
    expect(() => assertApprovedForExecution(token)).not.toThrow();
  });

  

  it('prevents mutation of the approved amount and expiration', () => {
    const token = createToken();
    const originalAmount = token.authorizedTotalMinor;
    const originalExpiry = token.expiresAt;

    const amountChanged = Reflect.set(
      token,
      'authorizedTotalMinor',
      toMoneyMinor(1),
    );

    const expiryChanged = Reflect.set(
      token,
      'expiresAt',
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    expect(amountChanged).toBe(false);
    expect(expiryChanged).toBe(false);

    expect(token.authorizedTotalMinor).toBe(originalAmount);
    expect(token.expiresAt).toBe(originalExpiry);
    expect(() => assertApprovedForExecution(token)).not.toThrow();
  });

  it('rejects an invalid proposal', () => {
    expect(() =>
      issueApprovedToken({
        ownerId: 'tenant-123',
        proposal: {} as OrderProposal,
        idempotencyKey: 'idemp-xyz',
        policyVersion: '1.0.0',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toThrow(CapabilityError);
  });

  it('rejects an empty owner ID', () => {
    expect(() =>
      issueApprovedToken({
        ownerId: '',
        proposal: createValidProposal(),
        idempotencyKey: 'idemp-xyz',
        policyVersion: '1.0.0',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toThrow(CapabilityError);
  });

  it('does not expose the internal approval token in public decisions', () => {
    const token = createToken();

  const internalDecision = {
  state: 'APPROVED',
  reasonCode: ReasonCode.OK_AUTO,
  approvedToken: token,
  decisionId: 'dec-1',
  evaluatedAt: new Date().toISOString(),
} satisfies PolicyDecision;

const publicDecision = toPublicPolicyDecision(internalDecision);

    
    expect(publicDecision.state).toBe('APPROVED');
    expect('approvedToken' in publicDecision).toBe(false);
  });

  it('creates a fail-closed dependency hold', () => {
    const hold = createDependencyHold();

    expect(hold.state).toBe('HOLD');
    expect(hold.reasonCode).toBe(ReasonCode.DEPENDENCY_UNAVAILABLE);
    expect('approvedToken' in hold).toBe(false);
  });
});
