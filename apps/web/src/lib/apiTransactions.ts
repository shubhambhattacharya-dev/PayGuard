import { PolicyReasonCode, Transaction, TransactionStatus } from './types';

/**
 * Shape returned by GET /v1/transactions. Every field except `id`, `status`,
 * `policyCode` and `canApproveReject` is optional because the durable ledger
 * only guarantees the settlement columns it actually persists.
 */
export interface ApiTransactionRow {
  id?: unknown;
  vendor?: unknown;
  invoiceNumber?: unknown;
  amountFormatted?: unknown;
  amountMinor?: unknown;
  status?: unknown;
  policyCode?: unknown;
  dateFormatted?: unknown;
  canApproveReject?: unknown;
  qrCode?: unknown;
  qrExpiresAtMs?: unknown;
}

const VALID_STATUSES: ReadonlySet<TransactionStatus> = new Set<TransactionStatus>([
  'Review required',
  'Paid',
  'On hold',
  'Blocked',
]);

const VALID_POLICY_CODES: ReadonlySet<PolicyReasonCode> = new Set<PolicyReasonCode>([
  'AUTO_EXECUTED',
  'OK_AUTO',
  'HOLD_OVER_CAP',
  'HOLD_VELOCITY_LIMIT',
  'HOLD_DAILY_CAP_EXCEEDED',
  'HOLD_VENDOR_DESTINATION',
  'HOLD_VENDOR_UNTRUSTED',
  'HOLD_MANUAL_REVIEW',
  'REJECT_PROMPT_INJECTION',
  'REJECT_UNCATALOGUED_SKU',
  'REJECT_PRICE_MISMATCH',
  'REJECT_MATH_MISMATCH',
  'REJECT_DUPLICATE_INVOICE',
  'REJECT_SCHEMA_INVALID',
  'REJECT_TENANT_MISMATCH',
  'DEPENDENCY_UNAVAILABLE',
]);

/**
 * Static policy constants shown in the inspector. Vendor velocity is deliberately
 * marked as unavailable: the durable ledger endpoint does not return it, and
 * inventing a number here would misrepresent live data.
 */
export const KNOWN_POLICY_LIMITS = {
  autoExecuteCap: '$100.00',
  vendorVelocitySpent: '—',
  vendorVelocityLimit: '$200.00',
  velocityWindow: '60 min rolling window',
} as const satisfies Transaction['policyLimits'];

function formatMinorUsd(minor: number): string {
  return `$${(minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidApiTransactionRow(value: unknown): value is ApiTransactionRow & {
  id: string;
  status: TransactionStatus;
  policyCode: PolicyReasonCode;
  canApproveReject: boolean;
} {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as ApiTransactionRow;
  return (
    isNonEmptyString(row.id) &&
    typeof row.status === 'string' &&
    VALID_STATUSES.has(row.status as TransactionStatus) &&
    typeof row.policyCode === 'string' &&
    VALID_POLICY_CODES.has(row.policyCode as PolicyReasonCode) &&
    typeof row.canApproveReject === 'boolean' &&
    (row.amountMinor === undefined ||
      (Number.isSafeInteger(row.amountMinor) && (row.amountMinor as number) >= 0))
  );
}

/**
 * Converts a validated API row into the richer UI model. Fields the API does not
 * persist (reasoning trace, quote evidence, per-rule checks) stay empty instead
 * of falling back to demo values.
 */
export function mapApiTransactionRow(row: ApiTransactionRow): Transaction | null {
  if (!isValidApiTransactionRow(row)) return null;
  const amountMinor = (row.amountMinor as number | undefined) ?? 0;
  return {
    id: row.id,
    vendor: isNonEmptyString(row.vendor) ? row.vendor : 'Unknown vendor',
    invoiceNumber: isNonEmptyString(row.invoiceNumber) ? row.invoiceNumber : row.id,
    amountFormatted: isNonEmptyString(row.amountFormatted)
      ? row.amountFormatted
      : formatMinorUsd(amountMinor),
    amountMinor,
    status: row.status,
    policyCode: row.policyCode,
    dateFormatted: isNonEmptyString(row.dateFormatted) ? row.dateFormatted : '—',
    canApproveReject: row.canApproveReject,
    reasoningSteps: [],
    policyChecks: [],
    policyLimits: { ...KNOWN_POLICY_LIMITS },
    ...(isNonEmptyString(row.qrCode)
      ? {
          qrCode: {
            singleUseCode: row.qrCode,
            expiresInSeconds:
              typeof row.qrExpiresAtMs === 'number' && Number.isFinite(row.qrExpiresAtMs)
                ? Math.max(0, Math.floor((row.qrExpiresAtMs - Date.now()) / 1000))
                : 600,
            ...(typeof row.qrExpiresAtMs === 'number' && Number.isFinite(row.qrExpiresAtMs)
              ? { expiresAtMs: row.qrExpiresAtMs }
              : {}),
          },
        }
      : {}),
  };
}

/** Filters out malformed rows so one bad record cannot blank the whole ledger. */
export function mapApiTransactions(rows: unknown): Transaction[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => mapApiTransactionRow(row as ApiTransactionRow))
    .filter((row): row is Transaction => row !== null);
}

export { formatMinorUsd };
