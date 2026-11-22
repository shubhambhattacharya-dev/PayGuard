import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { KpiStrip } from '../src/components/KpiStrip';
import type { Transaction } from '../src/lib/types';

function transaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: 'tx-test',
    vendor: 'Test Vendor',
    invoiceNumber: 'INV-TEST-01',
    amountFormatted: '$100.00',
    amountMinor: 10000,
    status: 'Review required',
    policyCode: 'HOLD_OVER_CAP',
    dateFormatted: 'Nov 22, 2026',
    canApproveReject: true,
    reasoningSteps: [],
    policyChecks: [],
    policyLimits: {
      autoExecuteCap: '$100.00',
      vendorVelocitySpent: '—',
      vendorVelocityLimit: '$200.00',
      velocityWindow: '60 min rolling window',
    },
    ...overrides,
  };
}

describe('apps/web: KpiStrip Component Suite', () => {
  it('renders a zero state instead of demo counts when no live data is loaded', () => {
    render(<KpiStrip />);

    expect(screen.getByText('Needs review')).toBeDefined();
    expect(screen.getByText('Awaiting approval')).toBeDefined();
    expect(screen.getByText('Auto-executed')).toBeDefined();
    expect(screen.getByText('Blocked by policy')).toBeDefined();

    expect(screen.getAllByText('0 bills · $0.00')).toHaveLength(2);
    expect(screen.getAllByText('0 bills')).toHaveLength(2);
  });

  it('computes counts and amounts from live transactions', () => {
    render(
      <KpiStrip
        transactions={[
          transaction({ id: 'tx-review', status: 'Review required', amountMinor: 10000 }),
          transaction({
            id: 'tx-paid',
            status: 'Paid',
            policyCode: 'AUTO_EXECUTED',
            canApproveReject: false,
            amountFormatted: '$64.00',
            amountMinor: 6400,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText('1 bill · $100.00')).toHaveLength(2);
    expect(screen.getByText('1 bill')).toBeDefined();
    expect(screen.getByText('0 bills')).toBeDefined();
  });
});
