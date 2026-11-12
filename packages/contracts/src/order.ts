import { z } from 'zod';
import {
  type MoneyMinor,
  toMoneyMinor,
  roundHalfEven,
} from './money.js';

const BASIS_POINTS_DENOMINATOR = 10_000n;

/**
 * Money is represented as non-negative, safe integer minor units.
 * Example: $19.99 USD = 1999 cents.
 */
export const MoneyMinorSchema: z.ZodType<
  MoneyMinor,
  z.ZodTypeDef,
  number
> = z
  .number()
  .finite('Money amount must be finite')
  .int('Money amount must be an integer')
  .nonnegative('Money amount must be non-negative')
  .refine(
    Number.isSafeInteger,
    'Money amount exceeds the safe integer range',
  )
  .transform((value) => toMoneyMinor(value));

/**
 * Reusable Banker's Rounding tax helper importing verified logic from money.ts.
 * 10,000 basis points = 100%. 1 basis point = 0.01%.
 */
function calculateTaxMinor(
  taxableAmountMinor: number,
  taxBps: number,
): bigint {
  const numerator = BigInt(taxableAmountMinor) * BigInt(taxBps);
  return roundHalfEven(numerator, BASIS_POINTS_DENOMINATOR);
}

/**
 * Reject totals that cannot be represented safely as JS numbers.
 */
function isSafeMoneyTotal(value: bigint): boolean {
  return (
    value >= 0n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  );
}

/**
 * Single line item in an order proposal.
 * lineTotalMinor = quantity * unitPriceMinor, before tax.
 */
export const LineItemSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1, 'SKU must not be empty')
      .max(64, 'SKU must not exceed 64 characters'),

    description: z
      .string()
      .trim()
      .min(1, 'Description must not be empty')
      .max(256, 'Description must not exceed 256 characters'),

    quantity: z
      .number()
      .int('Quantity must be an integer')
      .positive('Quantity must be at least 1')
      .max(10_000, 'Quantity exceeds the maximum'),

    unitPriceMinor: MoneyMinorSchema,

    taxBps: z
      .number()
      .int('Tax rate must be an integer number of basis points')
      .min(0, 'Tax rate cannot be negative')
      .max(10_000, 'Tax rate cannot exceed 100%')
      .default(0),

    lineTotalMinor: MoneyMinorSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    const expectedLineTotal =
      BigInt(item.quantity) * BigInt(item.unitPriceMinor);

    if (!isSafeMoneyTotal(expectedLineTotal)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineTotalMinor'],
        message: 'Calculated line subtotal exceeds the safe money range',
      });
      return;
    }

    if (BigInt(item.lineTotalMinor) !== expectedLineTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lineTotalMinor'],
        message: 'Line subtotal must equal quantity multiplied by unit price',
      });
    }
  });

export type LineItem = z.infer<typeof LineItemSchema>;

/**
 * Order proposal produced by an untrusted AI agent.
 *
 * 1. Base object schema (without superRefine so it can be extended).
 */
const OrderProposalBaseSchema = z
  .object({
    invoiceId: z
      .string()
      .trim()
      .min(1, 'Invoice ID must not be empty')
      .max(128, 'Invoice ID must not exceed 128 characters'),

    vendorName: z
      .string()
      .trim()
      .min(1, 'Vendor name must not be empty')
      .max(128, 'Vendor name must not exceed 128 characters'),

    currency: z.literal('USD'),

    lineItems: z
      .array(LineItemSchema)
      .min(1, 'Proposal must contain at least one line item')
      .max(50, 'Exceeded maximum 50 line items limit'),

    subtotalMinor: MoneyMinorSchema,
    taxTotalMinor: MoneyMinorSchema,
    grandTotalMinor: MoneyMinorSchema,

    notes: z
      .string()
      .max(1000, 'Notes must not exceed 1000 characters')
      .optional(),
  })
  .strict();

/**
 * 2. Reusable math validation shared by both proposal and record schemas:
 * the server recomputes every total with integer math and rejects any drift.
 */
function validateOrderTotals(
  proposal: z.infer<typeof OrderProposalBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  let subtotal = 0n;
  let taxTotal = 0n;

  for (let index = 0; index < proposal.lineItems.length; index++) {
    const item = proposal.lineItems[index]!;
    subtotal += BigInt(item.lineTotalMinor);
    taxTotal += calculateTaxMinor(item.lineTotalMinor, item.taxBps);
  }

  const grandTotal = subtotal + taxTotal;

  if (!isSafeMoneyTotal(subtotal)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subtotalMinor'],
      message: 'Calculated subtotal exceeds the safe money range',
    });
  } else if (subtotal !== BigInt(proposal.subtotalMinor)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['subtotalMinor'],
      message: 'Subtotal does not match the sum of line subtotals',
    });
  }

  if (!isSafeMoneyTotal(taxTotal)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taxTotalMinor'],
      message: 'Calculated tax total exceeds the safe money range',
    });
  } else if (taxTotal !== BigInt(proposal.taxTotalMinor)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['taxTotalMinor'],
      message: 'Tax total does not match the calculated line taxes',
    });
  }

  if (!isSafeMoneyTotal(grandTotal)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['grandTotalMinor'],
      message: 'Calculated grand total exceeds the safe money range',
    });
  } else if (grandTotal !== BigInt(proposal.grandTotalMinor)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['grandTotalMinor'],
      message: 'Grand total must equal subtotal plus tax',
    });
  }
}

/**
 * 3. OrderProposalSchema: the base schema with totals validation applied.
 */
export const OrderProposalSchema =
  OrderProposalBaseSchema.superRefine(validateOrderTotals);

export type OrderProposal = z.infer<typeof OrderProposalSchema>;

/**
 * 4. OrderRecordSchema: base schema extended with persistence fields,
 * then strict + totals validation.
 */
export const OrderRecordSchema = OrderProposalBaseSchema.extend({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  status: z.enum([
    'PENDING',
    'APPROVED',
    'HOLD',
    'REJECTED',
    'SETTLED',
    'FAILED',
  ]),
  paypalOrderId: z.string().optional(),
  paypalCaptureId: z.string().optional(),
  decisionReasonCode: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
  .strict()
  .superRefine(validateOrderTotals);

export type OrderRecord = z.infer<typeof OrderRecordSchema>;