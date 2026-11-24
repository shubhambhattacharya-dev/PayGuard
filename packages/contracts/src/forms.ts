import { z } from 'zod';

/**
 * Strict user-facing form schemas shared between @payguard/web and @payguard/api.
 * Enforces letter-containing names (blocks numbers-only or symbol garbage),
 * bounded quantities/prices, and E.164-compatible WhatsApp numbers.
 */

export const VendorNameFieldSchema = z
  .string()
  .trim()
  .min(2, 'Vendor name must be at least 2 characters.')
  .max(80, 'Vendor name must not exceed 80 characters.')
  .regex(
    /^(?=.*[A-Za-z])[A-Za-z0-9 &.,'-]+$/,
    'Vendor name must be valid text with letters (numbers-only or special symbols are not allowed).',
  );

export const ItemNameFieldSchema = z
  .string()
  .trim()
  .min(2, 'Item name must be at least 2 characters.')
  .max(120, 'Item name must not exceed 120 characters.')
  .regex(
    /^(?=.*[A-Za-z])[A-Za-z0-9 &.,'()/-]+$/,
    'Item name must be valid text with letters (numbers-only is not allowed).',
  );

export const QuantityFieldSchema = z
  .number({ invalid_type_error: 'Enter a whole number quantity.' })
  .int('Quantity must be a whole number.')
  .min(1, 'Quantity must be at least 1.')
  .max(1000, 'Quantity must not exceed 1,000.');

export const UnitPriceUsdFieldSchema = z
  .string()
  .trim()
  .regex(/^(?:[1-9]\d*|0)(?:\.\d{1,2})?$/, 'Enter a valid USD amount (e.g. 16.00).')
  .refine((val) => {
    const num = Number(val);
    return Number.isFinite(num) && num >= 0.01 && num <= 50_000;
  }, 'Unit price must be between $0.01 and $50,000.00.');

export const WhatsAppPhoneFieldSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{9,14}$/, 'Enter a valid 10–15 digit WhatsApp number (e.g. +919876543210).');

export const OtpSixDigitSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit verification code.');

export const InvoiceFormSchema = z.object({
  vendorName: VendorNameFieldSchema,
  itemName: ItemNameFieldSchema,
  quantity: QuantityFieldSchema,
  unitPriceUsd: UnitPriceUsdFieldSchema,
  optionalNote: z.string().max(500, 'Note must not exceed 500 characters.').optional(),
});

export type InvoiceFormValues = z.infer<typeof InvoiceFormSchema>;

export const VendorOnboardingFormSchema = z.object({
  vendorName: VendorNameFieldSchema,
  whatsappNumber: WhatsAppPhoneFieldSchema,
  itemName: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || val.length === 0 || ItemNameFieldSchema.safeParse(val).success,
      'Item name must contain letters (at least 2 characters).',
    ),
  unitPriceUsd: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || val.length === 0 || UnitPriceUsdFieldSchema.safeParse(val).success,
      'Enter a valid USD price (e.g. 45.00).',
    ),
});

export function extractFieldErrors(error: z.ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!map[key]) {
      map[key] = issue.message;
    }
  }
  return map;
}
