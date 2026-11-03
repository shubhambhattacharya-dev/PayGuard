
import { describe, it, expect } from 'vitest';
import {
  OrderProposalSchema,
  LineItemSchema,
} from './order.js';

// =====================================================
// 1. VALID TEST FIXTURES
// =====================================================

const validLineItem = {
  sku: 'AC-PRO-001',
  description: 'Aster Cloud - Professional Plan',
  quantity: 1,
  unitPriceMinor: 84250, // $842.50
  taxBps: 0,
  lineTotalMinor: 84250,
};

const validProposal = {
  invoiceId: 'INV-2048',
  vendorName: 'Aster Cloud',
  currency: 'USD' as const,
  lineItems: [validLineItem],
  subtotalMinor: 84250,
  taxTotalMinor: 0,
  grandTotalMinor: 84250,
  notes: 'Monthly subscription',
};

// =====================================================
// 2. HELPER: ASSERT A SPECIFIC VALIDATION ERROR
// =====================================================

type SchemaResult =
  | ReturnType<typeof OrderProposalSchema.safeParse>
  | ReturnType<typeof LineItemSchema.safeParse>;

function expectIssueAt(
  result: SchemaResult,
  expectedPath: (string | number)[],
  expectedMessage: RegExp,
): void {
  if (result.success) {
    throw new Error(
      'Expected validation to fail, but it passed',
    );
  }

  const matchingIssue = result.error.issues.find(
    (issue) => {
      const samePath =
        issue.path.length === expectedPath.length &&
        issue.path.every(
          (part, index) => part === expectedPath[index],
        );

      const correctMessage =
        expectedMessage.test(issue.message);

      return samePath && correctMessage;
    },
  );

  expect(
    matchingIssue,
    `Expected validation issue at ${expectedPath.join('.')}`,
  ).toBeDefined();
}

// =====================================================
// 3. BASIC ORDER VALIDATION
// =====================================================

describe('Order Proposal: Basic Validation', () => {
  it('accepts a correct order proposal', () => {
    const parsed =
      OrderProposalSchema.parse(validProposal);

    expect(parsed.invoiceId).toBe('INV-2048');
    expect(parsed.vendorName).toBe('Aster Cloud');
    expect(parsed.lineItems).toHaveLength(1);
    expect(parsed.subtotalMinor).toBe(84250);
    expect(parsed.taxTotalMinor).toBe(0);
    expect(parsed.grandTotalMinor).toBe(84250);
  });

  it('trims whitespace from invoice ID and vendor name', () => {
    const proposal = {
      ...validProposal,
      invoiceId: '  INV-2048  ',
      vendorName: '  Aster Cloud  ',
    };

    const parsed =
      OrderProposalSchema.parse(proposal);

    expect(parsed.invoiceId).toBe('INV-2048');
    expect(parsed.vendorName).toBe('Aster Cloud');
  });

  it('rejects an empty invoice ID', () => {
    const proposal = {
      ...validProposal,
      invoiceId: '   ',
    };

    expect(() =>
      OrderProposalSchema.parse(proposal),
    ).toThrow();
  });

  it('rejects an empty vendor name', () => {
    const proposal = {
      ...validProposal,
      vendorName: '   ',
    };

    expect(() =>
      OrderProposalSchema.parse(proposal),
    ).toThrow();
  });

  it('rejects unsupported currencies', () => {
    const proposal = {
      ...validProposal,
      currency: 'EUR',
    };

    expect(() =>
      OrderProposalSchema.parse(proposal),
    ).toThrow();
  });

  it('rejects an empty line items array', () => {
    const proposal = {
      ...validProposal,
      lineItems: [],
    };

    expect(() =>
      OrderProposalSchema.parse(proposal),
    ).toThrow(
      /at least one line item/,
    );
  });

  it('applies default tax rate when taxBps is missing', () => {
    const itemWithoutTax = {
      sku: 'AC-001',
      description: 'Cloud Plan',
      quantity: 1,
      unitPriceMinor: 84250,
      lineTotalMinor: 84250,
    };

    const proposal = {
      ...validProposal,
      lineItems: [itemWithoutTax],
    };

    const parsed =
      OrderProposalSchema.parse(proposal);

    expect(parsed.lineItems[0]?.taxBps).toBe(0);
    expect(parsed.taxTotalMinor).toBe(0);
  });

  it('rejects notes exceeding 1000 characters', () => {
    const proposal = {
      ...validProposal,
      notes: 'A'.repeat(1001),
    };

    expect(() =>
      OrderProposalSchema.parse(proposal),
    ).toThrow();
  });
});

// =====================================================
// 4. SECURITY VALIDATION
// =====================================================

describe('Order Proposal: Security Validation', () => {
  it('rejects unknown root-level properties', () => {
    const maliciousProposal = {
      ...validProposal,
      adminBypass: true,
      ownerId: 'victim-tenant-id',
    };

    expect(() =>
      OrderProposalSchema.parse(maliciousProposal),
    ).toThrow();
  });

  it('rejects injected privileged properties', () => {
    const maliciousProposal = {
      ...validProposal,
      status: 'APPROVED',
      paypalCaptureId: 'fake-capture-id',
      ownerId: 'attacker-tenant-id',
    };

    const result =
      OrderProposalSchema.safeParse(maliciousProposal);

    expect(result.success).toBe(false);
  });

  it('rejects unknown properties inside line items', () => {
    const maliciousItem = {
      ...validLineItem,
      adminBypass: true,
      internalPriceOverride: 1,
    };

    const proposal = {
      ...validProposal,
      lineItems: [maliciousItem],
    };

    const result =
      OrderProposalSchema.safeParse(proposal);

    expect(result.success).toBe(false);
  });

  it('rejects more than 50 line items', () => {
    const oversizedLines = Array.from(
      { length: 51 },
      (_, index) => ({
        ...validLineItem,
        sku: `SKU-${index}`,
      }),
    );

    const proposal = {
      ...validProposal,
      lineItems: oversizedLines,
    };

    expect(() =>
      OrderProposalSchema.parse(proposal),
    ).toThrow(
      /Exceeded maximum 50 line items limit/,
    );
  });

  it('accepts exactly 50 valid line items', () => {
    const lines = Array.from(
      { length: 50 },
      (_, index) => ({
        ...validLineItem,
        sku: `SKU-${index}`,
      }),
    );

    const total = 84250 * 50;

    const proposal = {
      ...validProposal,
      lineItems: lines,
      subtotalMinor: total,
      taxTotalMinor: 0,
      grandTotalMinor: total,
    };

    const parsed =
      OrderProposalSchema.parse(proposal);

    expect(parsed.lineItems).toHaveLength(50);
    expect(parsed.subtotalMinor).toBe(total);
  });
});

// =====================================================
// 5. LINE ITEM VALIDATION
// =====================================================

describe('Line Item: Validation', () => {
  it('accepts a valid line item', () => {
    const parsed =
      LineItemSchema.parse(validLineItem);

    expect(parsed.sku).toBe('AC-PRO-001');
    expect(parsed.quantity).toBe(1);
    expect(parsed.lineTotalMinor).toBe(84250);
  });

  it('trims SKU and description', () => {
    const item = {
      ...validLineItem,
      sku: '  AC-PRO-001  ',
      description: '  Cloud Plan  ',
    };

    const parsed = LineItemSchema.parse(item);

    expect(parsed.sku).toBe('AC-PRO-001');
    expect(parsed.description).toBe('Cloud Plan');
  });

  it('rejects empty SKU', () => {
    expect(() =>
      LineItemSchema.parse({
        ...validLineItem,
        sku: '   ',
      }),
    ).toThrow();
  });

  it('rejects empty description', () => {
    expect(() =>
      LineItemSchema.parse({
        ...validLineItem,
        description: '   ',
      }),
    ).toThrow();
  });
});

// =====================================================
// 6. QUANTITY VALIDATION
// =====================================================

describe('Line Item: Quantity Validation', () => {
  it('accepts the maximum allowed quantity', () => {
    const item = {
      ...validLineItem,
      quantity: 10000,
      lineTotalMinor: 842500000,
    };

    const parsed = LineItemSchema.parse(item);

    expect(parsed.quantity).toBe(10000);
  });

  it.each([
    { label: 'negative', value: -1 },
    { label: 'zero', value: 0 },
    { label: 'fractional', value: 1.5 },
    { label: 'above maximum', value: 10001 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  ])(
    'rejects $label quantity',
    ({ value }) => {
      expect(() =>
        LineItemSchema.parse({
          ...validLineItem,
          quantity: value,
        }),
      ).toThrow();
    },
  );
});

// =====================================================
// 7. MONEY VALIDATION
// =====================================================

describe('Line Item: Money Validation', () => {
  it('accepts a valid monetary value', () => {
    const parsed =
      LineItemSchema.parse(validLineItem);

    expect(parsed.unitPriceMinor).toBe(84250);
  });

  it('accepts zero monetary value', () => {
    const item = {
      ...validLineItem,
      unitPriceMinor: 0,
      lineTotalMinor: 0,
    };

    const parsed = LineItemSchema.parse(item);

    expect(parsed.unitPriceMinor).toBe(0);
    expect(parsed.lineTotalMinor).toBe(0);
  });

  it.each([
    { label: 'negative', value: -100 },
    { label: 'fractional', value: 100.5 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
    {
      label: 'unsafe integer',
      value: Number.MAX_SAFE_INTEGER + 1,
    },
  ])(
    'rejects $label monetary value',
    ({ value }) => {
      expect(() =>
        LineItemSchema.parse({
          ...validLineItem,
          unitPriceMinor: value,
        }),
      ).toThrow();
    },
  );
});

// =====================================================
// 8. LINE ITEM FINANCIAL INVARIANTS
// =====================================================

describe('Line Item: Financial Invariants', () => {
  it('accepts correct quantity multiplied by unit price', () => {
    const item = {
      ...validLineItem,
      quantity: 3,
      unitPriceMinor: 2500,
      lineTotalMinor: 7500,
    };

    const parsed = LineItemSchema.parse(item);

    expect(parsed.lineTotalMinor).toBe(7500);
  });

  it('rejects an incorrect line subtotal', () => {
    const item = {
      ...validLineItem,
      quantity: 2,
      unitPriceMinor: 10000,
      lineTotalMinor: 15000,
    };

    const result = LineItemSchema.safeParse(item);

    expectIssueAt(
      result,
      ['lineTotalMinor'],
      /Line subtotal must equal quantity multiplied by unit price/,
    );
  });

  it('rejects a line subtotal exceeding safe money range', () => {
    const item = {
      ...validLineItem,
      quantity: 2,
      unitPriceMinor: Number.MAX_SAFE_INTEGER,
      lineTotalMinor: Number.MAX_SAFE_INTEGER,
    };

    const result = LineItemSchema.safeParse(item);

    expectIssueAt(
      result,
      ['lineTotalMinor'],
      /Calculated line subtotal exceeds the safe money range/,
    );
  });
});

// =====================================================
// 9. TAX RATE VALIDATION
// =====================================================

describe('Line Item: Tax Rate Validation', () => {
  it('accepts a zero tax rate', () => {
    const parsed =
      LineItemSchema.parse(validLineItem);

    expect(parsed.taxBps).toBe(0);
  });

  it('accepts a 100 percent tax rate', () => {
    const item = {
      ...validLineItem,
      taxBps: 10000,
    };

    const parsed = LineItemSchema.parse(item);

    expect(parsed.taxBps).toBe(10000);
  });

  it.each([
    { label: 'negative', value: -1 },
    { label: 'fractional', value: 1.5 },
    { label: 'above 100 percent', value: 10001 },
    { label: 'NaN', value: Number.NaN },
    { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  ])(
    'rejects $label tax rate',
    ({ value }) => {
      expect(() =>
        LineItemSchema.parse({
          ...validLineItem,
          taxBps: value,
        }),
      ).toThrow();
    },
  );
});

// =====================================================
// 10. ORDER-LEVEL FINANCIAL INVARIANTS
// =====================================================

describe('Order Proposal: Financial Invariants', () => {
  it('accepts correct subtotal, tax and grand total', () => {
    const parsed =
      OrderProposalSchema.parse(validProposal);

    expect(parsed.subtotalMinor).toBe(84250);
    expect(parsed.taxTotalMinor).toBe(0);
    expect(parsed.grandTotalMinor).toBe(84250);
  });

  it('rejects incorrect order subtotal', () => {
    const proposal = {
      ...validProposal,
      subtotalMinor: 80000,
    };

    const result =
      OrderProposalSchema.safeParse(proposal);

    expectIssueAt(
      result,
      ['subtotalMinor'],
      /Subtotal does not match the sum of line subtotals/,
    );
  });

  it('rejects incorrect tax total', () => {
    const taxableItem = {
      ...validLineItem,
      taxBps: 1800,
    };

    const proposal = {
      ...validProposal,
      lineItems: [taxableItem],
      subtotalMinor: 84250,
      taxTotalMinor: 15000,
      grandTotalMinor: 99415,
    };

    const result =
      OrderProposalSchema.safeParse(proposal);

    expectIssueAt(
      result,
      ['taxTotalMinor'],
      /Tax total does not match the calculated line taxes/,
    );
  });

  it('rejects incorrect grand total', () => {
    const taxableItem = {
      ...validLineItem,
      taxBps: 1800,
    };

    const proposal = {
      ...validProposal,
      lineItems: [taxableItem],
      subtotalMinor: 84250,
      taxTotalMinor: 15165,
      grandTotalMinor: 90000,
    };

    const result =
      OrderProposalSchema.safeParse(proposal);

    expectIssueAt(
      result,
      ['grandTotalMinor'],
      /Grand total must equal subtotal plus tax/,
    );
  });
});

// =====================================================
// 11. TAX CALCULATION TESTS
// =====================================================

describe('Order Proposal: Tax Calculation', () => {
  it('validates an 18 percent tax calculation', () => {
    const taxableItem = {
      ...validLineItem,
      taxBps: 1800,
    };

    const proposal = {
      ...validProposal,
      lineItems: [taxableItem],
      subtotalMinor: 84250,
      taxTotalMinor: 15165,
      grandTotalMinor: 99415,
    };

    const parsed =
      OrderProposalSchema.parse(proposal);

    expect(parsed.taxTotalMinor).toBe(15165);
    expect(parsed.grandTotalMinor).toBe(99415);
  });

  it('calculates different tax rates for multiple items', () => {
    const laptop = {
      ...validLineItem,
      sku: 'LAPTOP-01',
      description: 'Laptop',
      quantity: 2,
      unitPriceMinor: 10000,
      taxBps: 1800,
      lineTotalMinor: 20000,
    };

    const mouse = {
      ...validLineItem,
      sku: 'MOUSE-01',
      description: 'Mouse',
      quantity: 1,
      unitPriceMinor: 5000,
      taxBps: 500,
      lineTotalMinor: 5000,
    };

    const proposal = {
      ...validProposal,
      lineItems: [laptop, mouse],
      subtotalMinor: 25000,
      taxTotalMinor: 3850,
      grandTotalMinor: 28850,
    };

    const parsed =
      OrderProposalSchema.parse(proposal);

    expect(parsed.subtotalMinor).toBe(25000);
    expect(parsed.taxTotalMinor).toBe(3850);
    expect(parsed.grandTotalMinor).toBe(28850);
  });

  it('uses half-even rounding correctly', () => {
    const firstItem = {
      ...validLineItem,
      sku: 'ROUND-001',
      quantity: 1,
      unitPriceMinor: 1,
      taxBps: 5000,
      lineTotalMinor: 1,
    };

    const secondItem = {
      ...validLineItem,
      sku: 'ROUND-002',
      quantity: 1,
      unitPriceMinor: 3,
      taxBps: 5000,
      lineTotalMinor: 3,
    };

    const proposal = {
      ...validProposal,
      lineItems: [firstItem, secondItem],
      subtotalMinor: 4,
      taxTotalMinor: 2,
      grandTotalMinor: 6,
    };

    const parsed =
      OrderProposalSchema.parse(proposal);

    // 0.5 cents -> 0 (nearest even)
    // 1.5 cents -> 2 (nearest even)

    expect(parsed.taxTotalMinor).toBe(2);
    expect(parsed.grandTotalMinor).toBe(6);
  });

  it('rounds tax separately for each line item', () => {
    const firstItem = {
      ...validLineItem,
      sku: 'HALF-001',
      quantity: 1,
      unitPriceMinor: 1,
      taxBps: 5000,
      lineTotalMinor: 1,
    };

    const secondItem = {
      ...validLineItem,
      sku: 'HALF-002',
      quantity: 1,
      unitPriceMinor: 1,
      taxBps: 5000,
      lineTotalMinor: 1,
    };

    const proposal = {
      ...validProposal,
      lineItems: [firstItem, secondItem],
      subtotalMinor: 2,
      taxTotalMinor: 0,
      grandTotalMinor: 2,
    };

    const parsed =
      OrderProposalSchema.parse(proposal);

    // Each line: 0.5 cents -> 0 cents.
    // Total line-level tax: 0 cents.

    expect(parsed.taxTotalMinor).toBe(0);
    expect(parsed.grandTotalMinor).toBe(2);
  });
});

// =====================================================
// 12. SAFE INTEGER AND OVERFLOW PROTECTION
// =====================================================

describe('Order Proposal: Numeric Boundary Validation', () => {
  it('rejects an order subtotal exceeding safe integer range', () => {
    const largeAmount = 4_503_599_627_370_496;

    const firstItem = {
      ...validLineItem,
      sku: 'LARGE-001',
      quantity: 1,
      unitPriceMinor: largeAmount,
      lineTotalMinor: largeAmount,
    };

    const secondItem = {
      ...validLineItem,
      sku: 'LARGE-002',
      quantity: 1,
      unitPriceMinor: largeAmount,
      lineTotalMinor: largeAmount,
    };

    const proposal = {
      ...validProposal,
      lineItems: [firstItem, secondItem],
      subtotalMinor: Number.MAX_SAFE_INTEGER,
      taxTotalMinor: 0,
      grandTotalMinor: Number.MAX_SAFE_INTEGER,
    };

    const result =
      OrderProposalSchema.safeParse(proposal);

    expectIssueAt(
      result,
      ['subtotalMinor'],
      /Calculated subtotal exceeds the safe money range/,
    );
  });

  it('rejects a grand total exceeding safe integer range', () => {
    const largeAmount = 4_600_000_000_000_000;

    const item = {
      ...validLineItem,
      quantity: 1,
      unitPriceMinor: largeAmount,
      taxBps: 10000,
      lineTotalMinor: largeAmount,
    };

    const proposal = {
      ...validProposal,
      lineItems: [item],
      subtotalMinor: largeAmount,
      taxTotalMinor: largeAmount,
      grandTotalMinor: Number.MAX_SAFE_INTEGER,
    };

    const result =
      OrderProposalSchema.safeParse(proposal);

    expectIssueAt(
      result,
      ['grandTotalMinor'],
      /Calculated grand total exceeds the safe money range/,
    );
  });
});
