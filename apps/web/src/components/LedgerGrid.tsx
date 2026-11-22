'use client';

import React from 'react';
import { Transaction } from '../lib/types';
import { ChevronDown, ChevronRight, QrCode } from 'lucide-react';

interface LedgerGridProps {
  transactions: Transaction[];
  selectedTxId: string;
  onSelectTx: (tx: Transaction) => void;
  expandedTxIds: Set<string>;
  onToggleExpand: (txId: string) => void;
  onApprove: (tx: Transaction) => void;
  onReject: (tx: Transaction) => void;
  onOpenQr: (tx: Transaction) => void;
}

export function LedgerGrid({
  transactions,
  selectedTxId,
  onSelectTx,
  expandedTxIds,
  onToggleExpand,
  onApprove,
  onReject,
  onOpenQr,
}: LedgerGridProps) {
  const getStatusBadge = (status: Transaction['status']) => {
    switch (status) {
      case 'Review required':
        return 'bg-[rgba(255,184,107,0.14)] text-[#ffc477] border-[rgba(255,184,107,0.3)]';
      case 'Paid':
        return 'bg-[rgba(40,187,131,0.14)] text-[#84e5b3] border-[rgba(40,187,131,0.3)]';
      case 'On hold':
        return 'bg-[rgba(255,123,130,0.12)] text-[#ff959a] border-[rgba(255,123,130,0.28)]';
      case 'Blocked':
        return 'bg-[rgba(255,123,130,0.18)] text-[#ff8f97] border-[rgba(255,123,130,0.35)]';
      default:
        return 'bg-[#15211b] text-[#9aa9a0] border-[rgba(222,242,227,0.14)]';
    }
  };

  const getPolicyCodeBadge = (code: Transaction['policyCode']) => {
    switch (code) {
      case 'AUTO_EXECUTED':
        return 'bg-[rgba(40,187,131,0.12)] text-[#84e5b3] border-[rgba(40,187,131,0.25)]';
      case 'HOLD_OVER_CAP':
      case 'HOLD_VENDOR_DESTINATION':
      case 'HOLD_VENDOR_UNTRUSTED':
        return 'bg-[#15211b] text-[#b8c4bb] border-[rgba(222,242,227,0.14)]';
      case 'REJECT_PROMPT_INJECTION':
      case 'REJECT_UNCATALOGUED_SKU':
      case 'REJECT_MATH_MISMATCH':
        return 'bg-[rgba(255,123,130,0.12)] text-[#ff959a] border-[rgba(255,123,130,0.28)]';
    }
  };

  return (
    <div className="bg-[#111b17]/85 backdrop-blur-xl rounded-2xl border border-[rgba(222,242,227,0.12)] shadow-sm overflow-hidden">
      <div className="divide-y divide-[rgba(222,242,227,0.08)] md:hidden">
        {transactions.map((tx) => {
          const isSelected = tx.id === selectedTxId;
          const isExpanded = expandedTxIds.has(tx.id);

          return (
            <article key={tx.id} className={`p-4 ${isSelected ? 'bg-[#1c3428]/70' : ''}`}>
              <button
                type="button"
                onClick={() => onSelectTx(tx)}
                className="w-full min-w-0 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8f169]"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#eaf0eb]">{tx.vendor}</span>
                    <span className="mt-1 block font-mono text-xs text-[#9aa9a0]">{tx.invoiceNumber}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-semibold text-[#eaf0eb]">{tx.amountFormatted}</span>
                    <span className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${getStatusBadge(tx.status)}`}>
                      {tx.status}
                    </span>
                  </span>
                </span>
              </button>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className={`min-w-0 truncate rounded-md border px-2 py-1 font-mono text-[10px] ${getPolicyCodeBadge(tx.policyCode)}`}>
                  {tx.policyCode}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleExpand(tx.id)}
                  aria-expanded={isExpanded}
                  className="shrink-0 rounded px-2 py-1 text-xs font-medium text-[#9aa9a0] hover:text-[#c8f169] hover:bg-[#1c3428] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c8f169]"
                >
                  {isExpanded ? 'Hide details' : 'Details'}
                </button>
              </div>

              {tx.canApproveReject && (
                <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
                  <button
                    type="button"
                    onClick={() => onApprove(tx)}
                    className="min-h-10 rounded-xl bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onReject(tx)}
                    className="min-h-10 rounded-xl bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenQr(tx)}
                    aria-label={`Open QR approval for ${tx.invoiceNumber}`}
                    className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-[#1d2d25] text-[#9aa9a0] hover:text-[#c8f169] hover:bg-[#1c3428]"
                  >
                    <QrCode className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}

              {isExpanded && tx.reasoningSteps.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-[#1d2d25] pt-4">
                  <h3 className="text-xs font-semibold text-[#c8f169]">Agent reasoning</h3>
                  {tx.reasoningSteps.map((step) => (
                    <div key={step.round} className="flex items-start gap-3 text-xs">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${step.round === 4 && tx.status === 'Review required' ? 'border-amber-500/30 bg-amber-950/60 text-amber-300' : 'border-[#2b4c3b] bg-[#1c3428] text-[#c8f169]'}`}>
                        R{step.round}
                      </span>
                      <span className="min-w-0 text-[#9aa9a0]">
                        <span className="font-semibold text-[#eaf0eb]">{step.name}: </span>{step.summary}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="hidden md:block">
        {/* Table Header (No forced horizontal scrollbar) */}
        <div className="grid grid-cols-12 gap-2.5 px-4 py-3 border-b border-[rgba(222,242,227,0.12)] bg-[#101914]/90 text-[11px] font-semibold text-[#9aa9a0] uppercase tracking-wider select-none">
          <div className="col-span-3">Vendor</div>
          <div className="col-span-2">Invoice #</div>
          <div className="col-span-1">Amount</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Policy code</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-[rgba(222,242,227,0.08)]">
          {transactions.map((tx) => {
            const isSelected = tx.id === selectedTxId;
            const isExpanded = expandedTxIds.has(tx.id);

            return (
              <div key={tx.id} className="transition-colors">
                {/* Main Row */}
                <div
                  onClick={() => onSelectTx(tx)}
                  className={`grid grid-cols-12 gap-2.5 px-4 py-3.5 items-center text-xs cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#1c3428]/70' : 'hover:bg-[#15211b]/80'
                  }`}
                >
                  {/* Vendor Column with Expand Caret */}
                  <div className="col-span-3 flex items-center gap-2 min-w-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(tx.id);
                      }}
                      className="p-1 hover:bg-[#1c3428] rounded-md text-[#6e7d74] hover:text-[#c8f169] shrink-0"
                      aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <span className="font-semibold text-[#eaf0eb] truncate">{tx.vendor}</span>
                  </div>

                  {/* Invoice # */}
                  <div className="col-span-2 font-mono text-[#9aa9a0] truncate">{tx.invoiceNumber}</div>

                  {/* Amount */}
                  <div className="col-span-1 font-semibold text-[#eaf0eb] tabular-nums">{tx.amountFormatted}</div>

                  {/* Status Pill */}
                  <div className="col-span-2">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadge(
                        tx.status,
                      )}`}
                    >
                      {tx.status}
                    </span>
                  </div>

                  {/* Policy Code Pill */}
                  <div className="col-span-2 min-w-0">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-mono border truncate max-w-full ${getPolicyCodeBadge(
                        tx.policyCode,
                      )}`}
                    >
                      {tx.policyCode}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="col-span-2 flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {tx.canApproveReject ? (
                      <>
                        <button
                          onClick={() => onApprove(tx)}
                          className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-[11px] rounded-lg transition-colors shadow-xs"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => onReject(tx)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-[11px] rounded-lg transition-colors shadow-xs"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => onOpenQr(tx)}
                          className="p-1 text-[#9aa9a0] hover:text-[#c8f169] hover:bg-[#1c3428] rounded-lg transition-colors"
                          title="One-Time Mobile QR Approval"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <span className="text-[#6e7d74] font-mono pr-2">—</span>
                    )}
                  </div>
                </div>

                {/* Master-Detail Expanded Reasoning Drawer */}
                {isExpanded && tx.reasoningSteps.length > 0 && (
                  <div className="bg-[#0e1713]/90 px-10 py-3.5 border-t border-[rgba(222,242,227,0.08)]">
                    <div className="text-[11px] font-semibold text-[#eaf0eb] uppercase tracking-wider mb-2.5">
                      Agent reasoning ({tx.reasoningSteps.length} rounds)
                    </div>
                    <div className="space-y-2">
                      {tx.reasoningSteps.map((step) => {
                        const badgeColor =
                          step.round === tx.reasoningSteps.length && tx.status === 'Review required'
                            ? 'bg-[rgba(255,184,107,0.14)] text-[#ffc477] border-[rgba(255,184,107,0.3)]'
                            : 'bg-[rgba(40,187,131,0.14)] text-[#84e5b3] border-[rgba(40,187,131,0.3)]';

                        return (
                          <div key={step.round} className="flex items-start gap-3 text-xs">
                            <span
                              className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] border shrink-0 ${badgeColor}`}
                            >
                              R{step.round}
                            </span>
                            <div className="flex-1 min-w-0">
                              <span className="font-semibold text-[#c8f169] mr-2 font-mono">{step.name}</span>
                              <span className="text-[#9aa9a0]">{step.summary}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
