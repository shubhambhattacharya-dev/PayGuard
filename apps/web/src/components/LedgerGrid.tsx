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
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'Paid':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'On hold':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'Blocked':
        return 'bg-rose-100/70 text-rose-800 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getPolicyCodeBadge = (code: Transaction['policyCode']) => {
    switch (code) {
      case 'AUTO_EXECUTED':
        return 'bg-emerald-50/60 text-emerald-800 border-emerald-200/60';
      case 'HOLD_OVER_CAP':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'HOLD_VENDOR_DESTINATION':
      case 'HOLD_VENDOR_UNTRUSTED':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'REJECT_PROMPT_INJECTION':
      case 'REJECT_UNCATALOGUED_SKU':
      case 'REJECT_MATH_MISMATCH':
        return 'bg-rose-50 text-rose-700 border-rose-200';
    }
  };

  return (
    <div className="bg-white rounded-xl border border-surface-border overflow-x-auto shadow-sm">
      <div className="min-w-[760px]">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-surface-border bg-white text-[11px] font-medium text-slate-500 uppercase tracking-wider select-none">
          <div className="col-span-3">Vendor</div>
          <div className="col-span-2">Invoice #</div>
          <div className="col-span-1">Amount</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Policy code</div>
          <div className="col-span-2 text-right">Actions</div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-surface-border">
          {transactions.map((tx) => {
            const isSelected = tx.id === selectedTxId;
            const isExpanded = expandedTxIds.has(tx.id);

            return (
              <div key={tx.id} className="transition-colors">
                {/* Main Row */}
                <div
                  onClick={() => onSelectTx(tx)}
                  className={`grid grid-cols-12 gap-3 px-5 py-3.5 items-center text-xs cursor-pointer ${
                    isSelected ? 'bg-forest-50/70' : 'hover:bg-slate-50/70'
                  }`}
                >
                  {/* Vendor Column with Expand Caret */}
                  <div className="col-span-3 flex items-center gap-2.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(tx.id);
                      }}
                      className="p-1 hover:bg-slate-200/60 rounded text-slate-400 hover:text-slate-700"
                      aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                    >
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <span className="font-semibold text-slate-900 truncate">{tx.vendor}</span>
                  </div>

                  {/* Invoice # */}
                  <div className="col-span-2 font-mono text-slate-600">{tx.invoiceNumber}</div>

                  {/* Amount */}
                  <div className="col-span-1 font-medium text-slate-900">{tx.amountFormatted}</div>

                  {/* Status Pill */}
                  <div className="col-span-2">
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-medium border ${getStatusBadge(
                        tx.status
                      )}`}
                    >
                      {tx.status}
                    </span>
                  </div>

                  {/* Policy Code Pill */}
                  <div className="col-span-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono border truncate max-w-full ${getPolicyCodeBadge(
                        tx.policyCode
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
                          className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-medium text-[11px] rounded transition-colors shadow-xs"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => onReject(tx)}
                          className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white font-medium text-[11px] rounded transition-colors shadow-xs"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => onOpenQr(tx)}
                          className="p-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded"
                          title="One-Time Mobile QR Approval"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <span className="text-slate-300 font-mono pr-2">—</span>
                    )}
                  </div>
                </div>

                {/* Master-Detail Expanded Reasoning Drawer (Agent reasoning 4 rounds) */}
                {isExpanded && tx.reasoningSteps.length > 0 && (
                  <div className="bg-surface-subtle/80 px-12 py-4 border-t border-surface-border animate-fade-in">
                    <div className="text-xs font-semibold text-slate-800 mb-3">Agent reasoning (4 rounds)</div>
                    <div className="space-y-2.5">
                      {tx.reasoningSteps.map((step) => {
                        const badgeColor =
                          step.round === 4 && tx.status === 'Review required'
                            ? 'bg-amber-100 text-amber-800 border-amber-300'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-300';

                        return (
                          <div key={step.round} className="flex items-start gap-4 text-xs">
                            <span
                              className={`w-6 h-6 rounded flex items-center justify-center font-bold text-[10px] border shrink-0 ${badgeColor}`}
                            >
                              R{step.round}
                            </span>
                            <div className="flex-1">
                              <span className="font-semibold text-slate-900 mr-2 font-mono">{step.name}</span>
                              <span className="text-slate-600">{step.summary}</span>
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
