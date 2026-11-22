import { describe, it, expect } from 'vitest';
import { mapApiTransactions } from '../src/lib/apiTransactions';

describe('apps/web: API transaction mapper', () => {
  it('returns an empty ledger instead of demo rows when the API payload is missing', () => {
    expect(mapApiTransactions(undefined)).toEqual([]);
    expect(mapApiTransactions(null)).toEqual([]);
    expect(mapApiTransactions({ transactions: [] })).toEqual([]);
  });

  it('drops rows with an unknown status, unknown policy code, or unsafe amount', () => {
    const rows = mapApiTransactions([
      { id: 'tx-1', status: 'Paid', policyCode: 'AUTO_EXECUTED', canApproveReject: false, amountMinor: 6400 },
      { id: 'tx-2', status: 'Made up', policyCode: 'AUTO_EXECUTED', canApproveReject: false },
      { id: 'tx-3', status: 'Paid', policyCode: 'NOT_A_CODE', canApproveReject: false },
      { id: 'tx-4', status: 'Paid', policyCode: 'AUTO_EXECUTED', canApproveReject: false, amountMinor: -1 },
      { id: '', status: 'Paid', policyCode: 'AUTO_EXECUTED', canApproveReject: false },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('tx-1');
  });

  it('maps a settled ledger row without inventing evidence or velocity values', () => {
    const [row] = mapApiTransactions([
      {
        id: 'settlement-1',
        vendor: 'Cedar Supply',
        invoiceNumber: 'INV-3150',
        amountMinor: 6400,
        status: 'Paid',
        policyCode: 'AUTO_EXECUTED',
        canApproveReject: false,
      },
    ]);

    expect(row).toMatchObject({
      id: 'settlement-1',
      vendor: 'Cedar Supply',
      invoiceNumber: 'INV-3150',
      amountFormatted: '$64.00',
      amountMinor: 6400,
      status: 'Paid',
      policyCode: 'AUTO_EXECUTED',
      canApproveReject: false,
      reasoningSteps: [],
      policyChecks: [],
    });
    expect(row?.verifiedQuote).toBeUndefined();
    expect(row?.untrustedInjection).toBeUndefined();
    expect(row?.qrCode).toBeUndefined();
    expect(row?.policyLimits.vendorVelocitySpent).toBe('—');
  });
});
