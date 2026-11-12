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
      <div className={`w-full bg-white border-t 2xl:border-t-0 2xl:border-l border-surface-border p-6 flex flex-col items-center justify-center text-center text-slate-400 ${className}`}>
        <ShieldCheck className="w-8 h-8 text-slate-300 mb-2" />
        <p className="text-xs">Select an invoice to inspect its deterministic policy verification.</p>
      </div>
    );
  }

  return (
    <aside className={`w-full bg-white border-t 2xl:border-t-0 2xl:border-l border-surface-border p-4 sm:p-5 flex flex-col justify-between overflow-visible 2xl:overflow-y-auto 2xl:max-h-[calc(100vh-3.5rem)] z-10 ${className}`}>
      <div className="space-y-5">
        {/* Header: Vendor, Amount, Status Badge */}
        <div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <h2 className="text-base font-semibold text-slate-900 tracking-tight">{transaction.vendor}</h2>
            <div className="text-right">
              <span className="text-base font-bold text-slate-900">{transaction.amountFormatted}</span>
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {transaction.invoiceNumber} · {transaction.dateFormatted}
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200/80">
              Requires human approval
            </span>
          </div>
        </div>

        {/* Policy Checks List */}
        <div>
          <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-2.5">Policy checks</h3>
          <div className="space-y-3">
            {transaction.policyChecks.map((check, idx) => {
              const Icon =
                check.status === 'passed'
                  ? CheckCircle2
                  : check.status === 'warning'
                  ? AlertTriangle
                  : XCircle;
              const iconColor =
                check.status === 'passed'
                  ? 'text-emerald-600'
                  : check.status === 'warning'
                  ? 'text-amber-600'
                  : 'text-rose-600';

              return (
                <div key={idx} className="flex items-start gap-2.5">
                  <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconColor}`} />
                  <div>
                    <div className="text-xs font-medium text-slate-800 leading-tight">{check.title}</div>
                    <div className="text-[11px] text-slate-500 leading-normal mt-0.5">{check.description}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Invoice Evidence (Dual Box: Green Verified vs Red Untrusted Injection) */}
        <div>
          <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider mb-2">Invoice evidence</h3>

          {/* Green Verified Box */}
          {transaction.verifiedQuote && (
            <div className="p-3 rounded-lg bg-emerald-50/70 border border-emerald-200 mb-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-900 mb-1">
                <FileCheck2 className="w-3.5 h-3.5 text-emerald-700" />
                <span>Verified quote (from vendor catalog)</span>
              </div>
              <div className="text-xs text-slate-800 font-medium">{transaction.verifiedQuote.description}</div>
              <div className="flex items-center justify-between text-[11px] text-slate-600 font-mono mt-1">
                <span>{transaction.verifiedQuote.sku}</span>
                <span className="font-semibold text-slate-900">{transaction.verifiedQuote.amountFormatted}</span>
              </div>
            </div>
          )}

          {/* Red Untrusted Injection Box */}
          {transaction.untrustedInjection && (
            <div className="p-3 rounded-lg bg-rose-50/70 border border-rose-200">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-900 mb-1">
                <FileWarning className="w-3.5 h-3.5 text-rose-700" />
                <span>Untrusted prompt-injection text (from invoice PDF)</span>
              </div>
              <p className="text-[11px] text-slate-700 font-mono bg-white/80 p-2 rounded border border-rose-200/60 break-words select-text">
                {transaction.untrustedInjection.text}
              </p>
              <div className="text-[11px] text-rose-700 font-medium mt-1.5">
                {transaction.untrustedInjection.warning}
              </div>
            </div>
          )}
        </div>

        {/* Policy Limits & Velocity Progress Bar */}
        <div className="grid grid-cols-2 gap-3 p-3 bg-surface-subtle rounded-lg border border-surface-border text-xs">
          <div>
            <div className="text-[11px] text-slate-500 mb-0.5">Policy limits</div>
            <div className="text-xs font-medium text-slate-800">Auto-execute cap</div>
            <div className="text-sm font-bold text-slate-900 mt-0.5">
              {transaction.policyLimits.autoExecuteCap}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-0.5">Velocity (this vendor)</div>
            <div className="text-xs font-bold text-slate-900">
              {transaction.policyLimits.vendorVelocitySpent} of {transaction.policyLimits.vendorVelocityLimit}
            </div>
            {/* Visual Progress Meter */}
            <div className="w-full bg-slate-200 h-1.5 rounded-full mt-1.5 overflow-hidden">
              <div className="bg-emerald-600 h-1.5 rounded-full" style={{ width: '71%' }}></div>
            </div>
            <div className="text-[10px] text-slate-400 mt-1">{transaction.policyLimits.velocityWindow}</div>
          </div>
        </div>

        {/* Vendor Destination Check */}
        {transaction.vendorDestination && (
          <div className="p-3 rounded-lg border border-surface-border bg-white text-xs">
            <div className="font-semibold text-slate-800 text-[11px] uppercase tracking-wider mb-2">
              Vendor destination check
            </div>
            <div className="text-[11px] text-slate-500 mb-2">{transaction.vendor}</div>
            <div className="space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Previous (trusted)</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-800 font-semibold">{transaction.vendorDestination.previous}</span>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] px-1.5 py-0.5 rounded font-sans font-medium">
                    Trusted
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">New (in invoice)</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-800 font-semibold">{transaction.vendorDestination.newInInvoice}</span>
                  <span className="bg-rose-100 text-rose-800 text-[10px] px-1.5 py-0.5 rounded font-sans font-medium">
                    New destination
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* One-Time Approval (QR) Mini Card */}
        {transaction.qrCode && (
          <div
            onClick={() => onOpenQr(transaction)}
            className="p-3 rounded-lg border border-slate-200 bg-surface-subtle hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-slate-800 uppercase tracking-wider">
                One-time approval (QR)
              </span>
              <span className="text-[11px] text-emerald-700 hover:underline">Show example (expired)</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-white rounded border border-slate-200 p-1 flex items-center justify-center shrink-0">
                <QrCode className="w-10 h-10 text-slate-800" />
              </div>
              <div className="text-xs">
                <div className="text-[11px] text-slate-500">Single-use code</div>
                <div className="font-mono font-bold text-slate-900">{transaction.qrCode.singleUseCode}</div>
                <div className="text-[10px] text-amber-700 font-medium">Expires in 09:58</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Approve Button at Bottom */}
      {transaction.canApproveReject && (
        <div className="pt-4 border-t border-surface-border mt-4">
          <button
            onClick={() => onApprove(transaction)}
            className="w-full bg-forest-900 hover:bg-forest-850 text-white font-medium text-xs py-2.5 rounded-lg shadow-sm transition-colors text-center"
          >
            Approve proposal
          </button>
          <p className="text-[10px] text-slate-400 text-center mt-1.5">
            Full policy gate runs again before payment.
          </p>
        </div>
      )}
    </aside>
  );
}
