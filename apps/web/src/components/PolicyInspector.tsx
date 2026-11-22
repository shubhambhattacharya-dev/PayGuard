'use client';

import React from 'react';
import { Transaction } from '../lib/types';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCheck2,
  FileWarning,
  QrCode,
  ShieldCheck,
} from 'lucide-react';

interface PolicyInspectorProps {
  className?: string;
  transaction: Transaction | null;
  onOpenQr: (tx: Transaction) => void;
  onApprove: (tx: Transaction) => void;
}

export function PolicyInspector({ transaction, onOpenQr, onApprove, className = '' }: PolicyInspectorProps) {
  if (!transaction) {
    return (
      <div className={`w-full bg-[#101915]/85 backdrop-blur-xl border-t xl:border-t-0 xl:border-l border-[rgba(222,242,227,0.12)] p-6 flex flex-col items-center justify-center text-center text-[#9aa9a0] ${className}`}>
        <ShieldCheck className="w-8 h-8 text-[#6e7d74] mb-2" />
        <p className="text-xs">Select an invoice to inspect its deterministic policy verification.</p>
      </div>
    );
  }

  return (
    <aside
      aria-label="Policy verification inspector"
      className={`w-full min-w-0 bg-[#101915]/85 backdrop-blur-xl border-t xl:border-t-0 xl:border-l border-[rgba(222,242,227,0.12)] p-4 sm:p-5 flex flex-col justify-between overflow-x-hidden xl:min-h-[calc(100vh-3.5rem)] z-10 ${className}`}
    >
      <div className="flex-1 flex flex-col justify-between gap-5 min-w-0">
        {/* Header: Vendor, Amount, Status Badge */}
        <header className="min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1 min-w-0">
            <h2 className="text-base font-semibold text-[#eaf0eb] tracking-tight truncate">{transaction.vendor}</h2>
            <span className="text-base font-bold text-[#eaf0eb] tabular-nums shrink-0">{transaction.amountFormatted}</span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9aa9a0]">
            <span className="font-mono">
              {transaction.invoiceNumber} · {transaction.dateFormatted}
            </span>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[rgba(255,184,107,0.14)] text-[#ffc477] border border-[rgba(255,184,107,0.3)] shrink-0">
              {transaction.status === 'Paid'
                ? 'Settled'
                : transaction.status === 'Blocked'
                  ? 'Blocked by policy'
                  : 'Requires human approval'}
            </span>
          </div>
        </header>

        {/* Policy Checks List */}
        <section aria-labelledby="policy-checks-heading" className="min-w-0">
          <h3 id="policy-checks-heading" className="text-xs font-semibold text-[#eaf0eb] uppercase tracking-wider mb-2.5">
            Policy checks
          </h3>
          <ul className="space-y-3">
            {transaction.policyChecks.map((check, idx) => {
              const Icon =
                check.status === 'passed'
                  ? CheckCircle2
                  : check.status === 'warning'
                  ? AlertTriangle
                  : XCircle;
              const iconColor =
                check.status === 'passed'
                  ? 'text-[#84e5b3]'
                  : check.status === 'warning'
                  ? 'text-[#ffc477]'
                  : 'text-[#ff959a]';

              return (
                <li key={idx} className="flex items-start gap-2.5 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-[#eaf0eb] leading-tight break-words">{check.title}</div>
                    <div className="text-[11px] text-[#9aa9a0] leading-normal mt-0.5 break-words">{check.description}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Invoice Evidence (Dual Box: Green Verified vs Red Untrusted Injection) */}
        <section aria-labelledby="invoice-evidence-heading" className="min-w-0">
          <h3 id="invoice-evidence-heading" className="text-xs font-semibold text-[#eaf0eb] uppercase tracking-wider mb-2">
            Invoice evidence
          </h3>

          {/* Green Verified Box */}
          {transaction.verifiedQuote && (
            <div className="p-3 rounded-xl bg-[rgba(40,187,131,0.1)] backdrop-blur-sm border border-[rgba(40,187,131,0.28)] mb-2.5 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#84e5b3] mb-1">
                <FileCheck2 className="w-3.5 h-3.5 text-[#84e5b3] shrink-0" />
                <span>Verified quote (from vendor catalog)</span>
              </div>
              <div className="text-xs text-[#eaf0eb] font-medium break-words">{transaction.verifiedQuote.description}</div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-[#9aa9a0] font-mono mt-1">
                <span className="truncate">{transaction.verifiedQuote.sku}</span>
                <span className="font-semibold text-[#eaf0eb] tabular-nums shrink-0">{transaction.verifiedQuote.amountFormatted}</span>
              </div>
            </div>
          )}

          {/* Red Untrusted Injection Box */}
          {transaction.untrustedInjection && (
            <div className="p-3 rounded-xl bg-[rgba(255,123,130,0.1)] backdrop-blur-sm border border-[rgba(255,123,130,0.28)] min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-[#ff959a] mb-1">
                <FileWarning className="w-3.5 h-3.5 text-[#ff959a] shrink-0" />
                <span>Untrusted prompt-injection text (from invoice PDF)</span>
              </div>
              <p className="text-[11px] text-[#eaf0eb] font-mono bg-[#0b1210] p-2 rounded-lg border border-[rgba(255,123,130,0.25)] break-all select-text">
                {transaction.untrustedInjection.text}
              </p>
              <div className="text-[11px] text-[#ff959a] font-medium mt-1.5">
                {transaction.untrustedInjection.warning}
              </div>
            </div>
          )}
        </section>

        {/* Policy Limits & Velocity Progress Bar */}
        <section aria-label="Policy limits and velocity" className="grid grid-cols-2 gap-3 p-3 bg-[#15211b]/80 backdrop-blur-sm rounded-xl border border-[rgba(222,242,227,0.12)] text-xs min-w-0">
          <dl className="min-w-0">
            <dt className="text-[11px] text-[#9aa9a0] mb-0.5">Policy limits</dt>
            <dd className="text-xs font-medium text-[#dce5de]">Auto-execute cap</dd>
            <dd className="text-sm font-bold text-[#eaf0eb] mt-0.5 tabular-nums">
              {transaction.policyLimits.autoExecuteCap}
            </dd>
          </dl>
          <dl className="min-w-0">
            <dt className="text-[11px] text-[#9aa9a0] mb-0.5">Velocity (this vendor)</dt>
            <dd className="text-xs font-bold text-[#eaf0eb] tabular-nums">
              {transaction.policyLimits.vendorVelocitySpent} of {transaction.policyLimits.vendorVelocityLimit}
            </dd>
            <div className="w-full bg-[#0b1210] h-1.5 rounded-full mt-1.5 overflow-hidden">
              <div className="bg-[#c8f169] h-1.5 rounded-full" style={{ width: '71%' }}></div>
            </div>
            <dd className="text-[10px] text-[#6e7d74] mt-1">{transaction.policyLimits.velocityWindow}</dd>
          </dl>
        </section>

        {/* Vendor Destination Check */}
        {transaction.vendorDestination && (
          <section aria-label="Vendor destination check" className="p-3 rounded-xl border border-[rgba(222,242,227,0.12)] bg-[#15211b]/80 backdrop-blur-sm text-xs min-w-0">
            <div className="font-semibold text-[#eaf0eb] text-[11px] uppercase tracking-wider mb-2">
              Vendor destination check
            </div>
            <div className="text-[11px] text-[#9aa9a0] mb-2">{transaction.vendor}</div>
            <dl className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#9aa9a0] truncate">Previous (trusted)</dt>
                <dd className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[#eaf0eb] font-semibold">{transaction.vendorDestination.previous}</span>
                  <span className="bg-[rgba(40,187,131,0.14)] text-[#84e5b3] text-[10px] px-1.5 py-0.5 rounded font-sans font-medium">
                    Trusted
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-[#9aa9a0] truncate">New (in invoice)</dt>
                <dd className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[#eaf0eb] font-semibold">{transaction.vendorDestination.newInInvoice}</span>
                  <span className="bg-[rgba(255,123,130,0.14)] text-[#ff959a] text-[10px] px-1.5 py-0.5 rounded font-sans font-medium">
                    New destination
                  </span>
                </dd>
              </div>
            </dl>
          </section>
        )}

        {/* One-Time Approval (QR) Mini Card */}
        {transaction.qrCode && (
          <div
            onClick={() => onOpenQr(transaction)}
            className="p-3 rounded-xl border border-[rgba(222,242,227,0.14)] bg-[#15211b]/80 backdrop-blur-sm hover:border-[#c8f169]/40 cursor-pointer transition-colors"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-[#eaf0eb] uppercase tracking-wider">
                One-time approval (QR)
              </span>
              <span className="text-[11px] text-[#c8f169] hover:underline">Open QR</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-[#0b1210] rounded-lg border border-[rgba(222,242,227,0.16)] p-1 flex items-center justify-center shrink-0">
                <QrCode className="w-9 h-9 text-[#c8f169]" />
              </div>
              <div className="text-xs">
                <div className="text-[11px] text-[#9aa9a0]">Single-use code</div>
                <div className="font-mono font-bold text-[#eaf0eb]">{transaction.qrCode.singleUseCode}</div>
                <div className="text-[10px] text-[#ffc477] font-medium">10m TTL</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Approve Button or Final Disposition Footer at Bottom */}
      {transaction.canApproveReject ? (
        <div className="pt-4 border-t border-[rgba(222,242,227,0.12)] mt-5">
          <button
            onClick={() => onApprove(transaction)}
            className="w-full bg-[#c8f169] hover:bg-[#d6f68d] text-[#10170d] font-bold text-xs py-2.5 rounded-xl transition-colors text-center shadow-sm"
          >
            Approve proposal
          </button>
          <p className="text-[10px] text-[#6e7d74] text-center mt-1.5">
            Full policy gate runs again before payment.
          </p>
        </div>
      ) : (
        <div className="pt-4 border-t border-[rgba(222,242,227,0.12)] mt-5 flex items-center justify-between text-[11px] font-mono text-[#9aa9a0]">
          <span>Gate disposition</span>
          <span className="text-[#c8f169]">{transaction.policyCode}</span>
        </div>
      )}
    </aside>
  );
}
