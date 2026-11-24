import { describe, it, expect } from 'vitest';
import { InvoiceFormSchema, VendorOnboardingFormSchema } from './forms.js';

describe('Shared Zod form schemas (forms.ts)', () => {
  it('accepts valid string vendor/item names and rejects numbers-only or symbol-only names', () => {
    expect(
      InvoiceFormSchema.safeParse({
        vendorName: 'Cedar Supply',
        itemName: 'Office Paper Reams',
        quantity: 4,
        unitPriceUsd: '16.00',
        optionalNote: '',
      }).success,
    ).toBe(true);

    expect(
      InvoiceFormSchema.safeParse({
        vendorName: '123456',
        itemName: 'Office Paper Reams',
        quantity: 1,
        unitPriceUsd: '16.00',
      }).success,
    ).toBe(false);

    expect(
      InvoiceFormSchema.safeParse({
        vendorName: 'Cedar Supply',
        itemName: '99999',
        quantity: 1,
        unitPriceUsd: '16.00',
      }).success,
    ).toBe(false);
  });

  it('validates WhatsApp numbers and optional catalog items in VendorOnboardingFormSchema', () => {
    expect(
      VendorOnboardingFormSchema.safeParse({
        vendorName: 'Shubham Cloud Services',
        whatsappNumber: '+919876543210',
        itemName: 'API Credits Pack',
        unitPriceUsd: '45.00',
      }).success,
    ).toBe(true);

    expect(
      VendorOnboardingFormSchema.safeParse({
        vendorName: 'Shubham Cloud Services',
        whatsappNumber: 'not-a-phone',
      }).success,
    ).toBe(false);
  });
});
