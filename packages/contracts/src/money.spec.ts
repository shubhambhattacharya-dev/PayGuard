import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  fromMajorString,
  toMajorString,
  calculateLineTotal,
  toMoneyMinor,
} from './money.js';

describe('packages/contracts: money.ts financial invariant suite', () => {
  it('parses valid major currency strings into exact integer minor units', () => {
    expect(fromMajorString('100.00')).toBe(10000);
    expect(fromMajorString('64.00')).toBe(6400);
    expect(fromMajorString('250.50')).toBe(25050);
    expect(fromMajorString('0.05')).toBe(5);
    expect(fromMajorString('19.99')).toBe(1999);
    expect(fromMajorString('5000')).toBe(500000);
    expect(fromMajorString('-12.25')).toBe(-1225);
    expect(fromMajorString('+8.10')).toBe(810);
  });

  it('rejects invalid inputs with exact MoneyErrorCode', () => {
    expect(() => fromMajorString(123 as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'INVALID_AMOUNT_TYPE' })
    );

    expect(() => fromMajorString('1'.repeat(33))).toThrowError(
      expect.objectContaining({ code: 'AMOUNT_OUT_OF_RANGE' })
    );

    expect(() => fromMajorString('10.999')).toThrowError(
      expect.objectContaining({ code: 'INVALID_AMOUNT_FORMAT' })
    );

    expect(() => fromMajorString('abc')).toThrowError(
      expect.objectContaining({ code: 'INVALID_AMOUNT_FORMAT' })
    );
  });

  it('formats minor units to major string correctly without floating division', () => {
    expect(toMajorString(toMoneyMinor(10000))).toBe('100.00');
    expect(toMajorString(toMoneyMinor(6400))).toBe('64.00');
    expect(toMajorString(toMoneyMinor(5))).toBe('0.05');
    expect(toMajorString(toMoneyMinor(0))).toBe('0.00');
    expect(toMajorString(toMoneyMinor(-1225))).toBe('-12.25');
  });

  it('applies Banker Rounding (round half to even) accurately', () => {
    const res1 = calculateLineTotal(toMoneyMinor(2500), 1, 825);
    expect(res1.subtotalMinor).toBe(2500);
    expect(res1.taxMinor).toBe(206);
    expect(res1.totalMinor).toBe(2706);

    const res2 = calculateLineTotal(toMoneyMinor(1000), 1, 50);
    expect(res2.taxMinor).toBe(5);
  });

  it('enforces business limit guards on calculateLineTotal', () => {
    expect(() => calculateLineTotal(toMoneyMinor(1000), -1, 500)).toThrowError(
      expect.objectContaining({ code: 'INVALID_QUANTITY' })
    );

    expect(() => calculateLineTotal(toMoneyMinor(1000), 10, 15000)).toThrowError(
      expect.objectContaining({ code: 'INVALID_TAX_RATE' })
    );
  });

  it('Property test: fromMajorString and toMajorString are strictly bijective across 500 runs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (cents) => {
          const minor = toMoneyMinor(cents);
          const formatted = toMajorString(minor);
          const parsed = fromMajorString(formatted);
          return parsed === minor;
        }
      ),
      { numRuns: 500 }
    );
  });

  it('Property test: subtotal + tax strictly equals total across 500 random inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 0, max: 3000 }),
        (unitPrice, qty, taxBps) => {
          const res = calculateLineTotal(toMoneyMinor(unitPrice), qty, taxBps);
          return res.subtotalMinor + res.taxMinor === res.totalMinor;
        }
      ),
      { numRuns: 500 }
    );
  });
});
