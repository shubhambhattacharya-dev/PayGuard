import { PolicyReasonCode, Transaction, TransactionStatus } from './types';

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
  hourlySpentMinor?: unknown;
  policyChecks?: unknown;
  untrustedInjection?: unknown;
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

export function mapApiTransactionRow(row: ApiTransactionRow): Transaction | null {
  if (!isValidApiTransactionRow(row)) return null;
  const amountMinor = (row.amountMinor as number | undefined) ?? 0;
  const parsedPolicyChecks: Transaction['policyChecks'] = Array.isArray(row.policyChecks)
    ? row.policyChecks
        .filter(
          (c): c is { title: string; description: string; status: 'passed' | 'warning' | 'failed' } =>
            typeof c === 'object' &&
            c !== null &&
            isNonEmptyString((c as { title?: unknown }).title) &&
            isNonEmptyString((c as { description?: unknown }).description) &&
            ['passed', 'warning', 'failed'].includes(String((c as { status?: unknown }).status)),
        )
        .map((c) => ({ title: c.title, description: c.description, status: c.status }))
    : [];
  const hasVelocity =
    typeof row.hourlySpentMinor === 'number' &&
    Number.isSafeInteger(row.hourlySpentMinor) &&
    row.hourlySpentMinor >= 0;
  const rawInj = row.untrustedInjection as { text?: unknown; warning?: unknown } | undefined;
  const parsedInjection =
    typeof rawInj === 'object' &&
    rawInj !== null &&
    isNonEmptyString(rawInj.text) &&
    isNonEmptyString(rawInj.warning)
      ? { text: rawInj.text, warning: rawInj.warning }
      : undefined;
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
    policyChecks: parsedPolicyChecks,
    ...(parsedInjection ? { untrustedInjection: parsedInjection } : {}),
    policyLimits: {
      ...KNOWN_POLICY_LIMITS,
      ...(hasVelocity ? { vendorVelocitySpent: formatMinorUsd(row.hourlySpentMinor as number) } : {}),
    },
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

export function mapApiTransactions(rows: unknown): Transaction[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => mapApiTransactionRow(row as ApiTransactionRow))
    .filter((row): row is Transaction => row !== null);
}

export { formatMinorUsd };
