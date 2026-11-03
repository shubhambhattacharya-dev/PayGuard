/**
 * PayGuard — Money Contract
 *
 * Invariants (PDF Table 7-2 & Chapter 23.4):
 * - Monetary values are integer minor units (e.g. cents).
 * - Floating-point arithmetic is strictly forbidden for money.
 * - Decimal parsing uses strict regex and BigInt.
 * - Intermediate math uses BigInt to prevent 64-bit overflow.
 * - Tax calculation uses Banker's Rounding (round half to even).
 * - Domain errors use stable, machine-readable MoneyErrorCode enums.
 */

const MINOR_UNITS_PER_MAJOR = 100n;
const BASIS_POINTS_DENOMINATOR = 10_000n;

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

const MAX_AMOUNT_MINOR = MAX_SAFE_BIGINT;
const MAX_QUANTITY = 1_000_000;
const MAX_TAX_BPS = 10_000;
const MAX_AMOUNT_STRING_LENGTH = 32;

export type MoneyMinor = number & {
  readonly __brand: "MoneyMinor";
};

export interface LineTotal {
  readonly subtotalMinor: MoneyMinor;
  readonly taxMinor: MoneyMinor;
  readonly totalMinor: MoneyMinor;
}

export type MoneyErrorCode =
  | "INVALID_AMOUNT_TYPE"
  | "INVALID_AMOUNT_FORMAT"
  | "INVALID_INTEGER"
  | "AMOUNT_OUT_OF_RANGE"
  | "INVALID_QUANTITY"
  | "INVALID_TAX_RATE"
  | "INVALID_ROUNDING_DENOMINATOR"
  | "ARITHMETIC_OVERFLOW";

export class MoneyValidationError extends TypeError {
  constructor(
    public readonly code: MoneyErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "MoneyValidationError";
  }
}

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyValidationError("INVALID_INTEGER", `${field} must be a safe integer.`);
  }
}

function toSafeNumber(value: bigint, field: string): number {
  if (value < MIN_SAFE_BIGINT || value > MAX_SAFE_BIGINT) {
    throw new MoneyValidationError("ARITHMETIC_OVERFLOW", `${field} exceeds the safe integer range.`);
  }
  return Number(value);
}

function validateMoneyRange(value: bigint): void {
  if (value < -BigInt(MAX_AMOUNT_MINOR) || value > BigInt(MAX_AMOUNT_MINOR)) {
    throw new MoneyValidationError("AMOUNT_OUT_OF_RANGE", "Amount exceeds the supported limit.");
  }
}

export function toMoneyMinor(value: number): MoneyMinor {
  assertSafeInteger(value, "Money amount");
  validateMoneyRange(BigInt(value));
  return value as MoneyMinor;
}

export function toMajorString(minor: MoneyMinor): string {
  assertSafeInteger(minor, "Money amount");
  validateMoneyRange(BigInt(minor));

  const value = BigInt(minor);
  const negative = value < 0n;
  const absolute = negative ? -value : value;

  const whole = absolute / MINOR_UNITS_PER_MAJOR;
  const fraction = (absolute % MINOR_UNITS_PER_MAJOR).toString().padStart(2, "0");

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function roundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new MoneyValidationError("INVALID_ROUNDING_DENOMINATOR", "Rounding denominator must be positive.");
  }

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;

  const comparison = absoluteRemainder * 2n - denominator;

  if (comparison < 0n) return quotient;
  const direction = numerator < 0n ? -1n : 1n;
  if (comparison > 0n) return quotient + direction;

  // Exact tie: choose the nearest even integer
  return quotient % 2n === 0n ? quotient : quotient + direction;
}

/**
 * Parses a decimal string (e.g. "100.00", "45.5", "-12.25") into integer minor units.
 */
export function fromMajorString(amount: string): MoneyMinor {
  if (typeof amount !== "string") {
    throw new MoneyValidationError("INVALID_AMOUNT_TYPE", "Amount must be a decimal string.");
  }

  // ReDoS protection: bound length before regex
  if (amount.length > MAX_AMOUNT_STRING_LENGTH) {
    throw new MoneyValidationError("AMOUNT_OUT_OF_RANGE", "Amount string exceeds the supported length.");
  }

  const trimmed = amount.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);

  if (!match) {
    throw new MoneyValidationError("INVALID_AMOUNT_FORMAT", "Use a decimal amount with at most two decimal places.");
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2]!);
  const fraction = BigInt((match[3] ?? "").padEnd(2, "0"));
  const absoluteMinor = whole * MINOR_UNITS_PER_MAJOR + fraction;
  const minor = sign * absoluteMinor;

  validateMoneyRange(minor);
  return toMoneyMinor(toSafeNumber(minor, "Parsed amount"));
}

/**
 * Calculates a line item's subtotal, tax, and total.
 */
export function calculateLineTotal(
  unitPriceMinor: MoneyMinor,
  quantity: number,
  taxBps = 0
): LineTotal {
  assertSafeInteger(unitPriceMinor, "Unit price");
  assertSafeInteger(quantity, "Quantity");
  assertSafeInteger(taxBps, "Tax rate");
  validateMoneyRange(BigInt(unitPriceMinor));

  if (quantity < 0 || quantity > MAX_QUANTITY) {
    throw new MoneyValidationError("INVALID_QUANTITY", `Quantity must be between 0 and ${MAX_QUANTITY}.`);
  }

  if (taxBps < 0 || taxBps > MAX_TAX_BPS) {
    throw new MoneyValidationError("INVALID_TAX_RATE", `Tax rate must be between 0 and ${MAX_TAX_BPS} basis points.`);
  }

  const subtotal = BigInt(unitPriceMinor) * BigInt(quantity);
  const tax = roundHalfEven(subtotal * BigInt(taxBps), BASIS_POINTS_DENOMINATOR);
  const total = subtotal + tax;

  validateMoneyRange(subtotal);
  validateMoneyRange(tax);
  validateMoneyRange(total);

  return {
    subtotalMinor: toMoneyMinor(toSafeNumber(subtotal, "Subtotal")),
    taxMinor: toMoneyMinor(toSafeNumber(tax, "Tax")),
    totalMinor: toMoneyMinor(toSafeNumber(total, "Total")),
  };
}
