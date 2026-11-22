export type TransactionStatus = 'Review required' | 'Paid' | 'On hold' | 'Blocked';

export type PolicyReasonCode =
  | 'AUTO_EXECUTED'
  | 'OK_AUTO'
  | 'HOLD_OVER_CAP'
  | 'HOLD_VELOCITY_LIMIT'
  | 'HOLD_DAILY_CAP_EXCEEDED'
  | 'HOLD_VENDOR_DESTINATION'
  | 'HOLD_VENDOR_UNTRUSTED'
  | 'HOLD_MANUAL_REVIEW'
  | 'REJECT_PROMPT_INJECTION'
  | 'REJECT_UNCATALOGUED_SKU'
  | 'REJECT_PRICE_MISMATCH'
  | 'REJECT_MATH_MISMATCH'
  | 'REJECT_DUPLICATE_INVOICE'
  | 'REJECT_SCHEMA_INVALID'
  | 'REJECT_TENANT_MISMATCH'
  | 'DEPENDENCY_UNAVAILABLE';

export interface ReasoningStep {
  round: number; // 1, 2, 3, 4
  name: string; // "search_catalog", "calculator", "draft_order", "policy gate"
  summary: string;
  detail: string;
}

export interface PolicyCheck {
  title: string;
  description: string;
  status: 'passed' | 'warning' | 'failed';
}

export interface VendorDestination {
  previous: string;
  isPreviousTrusted: boolean;
  newInInvoice: string;
  isNewTrusted: boolean;
}

export interface Transaction {
  id: string;
  vendor: string;
  invoiceNumber: string;
  amountFormatted: string;
  amountMinor: number;
  status: TransactionStatus;
  policyCode: PolicyReasonCode;
  dateFormatted: string;
  canApproveReject: boolean;
  reasoningSteps: ReasoningStep[];
  policyChecks: PolicyCheck[];
  verifiedQuote?: {
    sku: string;
    description: string;
    amountFormatted: string;
  };
  untrustedInjection?: {
    text: string;
    warning: string;
  };
  policyLimits: {
    autoExecuteCap: string;
    vendorVelocitySpent: string;
    vendorVelocityLimit: string;
    velocityWindow: string;
  };
  vendorDestination?: VendorDestination;
  qrCode?: {
    singleUseCode: string;
    expiresInSeconds: number;
    expiresAtMs?: number;
  };
}
