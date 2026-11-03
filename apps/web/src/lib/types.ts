export type TransactionStatus = 'Review required' | 'Paid' | 'On hold' | 'Blocked';

export type PolicyReasonCode =
  | 'HOLD_OVER_CAP'
  | 'AUTO_EXECUTED'
  | 'HOLD_VENDOR_DESTINATION'
  | 'HOLD_VENDOR_UNTRUSTED'
  | 'REJECT_PROMPT_INJECTION'
  | 'REJECT_UNCATALOGUED_SKU'
  | 'REJECT_MATH_MISMATCH';

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
  };
}
