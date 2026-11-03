'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { Header } from '../../components/Header';
import { KpiStrip } from '../../components/KpiStrip';
import { LedgerGrid } from '../../components/LedgerGrid';
import { PolicyInspector } from '../../components/PolicyInspector';
import { QrApprovalModal } from '../../components/QrApprovalModal';
import { KeyboardShortcutsBar } from '../../components/KeyboardShortcutsBar';
import { INITIAL_TRANSACTIONS } from '../../lib/mockData';
import { Transaction } from '../../lib/types';

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [selectedTxId, setSelectedTxId] = useState<string>(INITIAL_TRANSACTIONS[0]?.id ?? '');
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set([INITIAL_TRANSACTIONS[0]?.id ?? '']));
  const [qrModalTx, setQrModalTx] = useState<Transaction | null>(null);

  const selectedTx = transactions.find((t) => t.id === selectedTxId) || null;

  const handleToggleExpand = (txId: string) => {
    setExpandedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const handleApprove = useCallback((tx: Transaction) => {
    setTransactions((prev) =>
      prev.map((item) => {
        if (item.id === tx.id) {
          return {
            ...item,
            status: 'Paid',
            policyCode: 'AUTO_EXECUTED',
            canApproveReject: false,
          };
        }
        return item;
      })
    );
  }, []);

  const handleReject = useCallback((tx: Transaction) => {
    setTransactions((prev) =>
      prev.map((item) => {
        if (item.id === tx.id) {
          return {
            ...item,
            status: 'Blocked',
            canApproveReject: false,
          };
        }
        return item;
      })
    );
  }, []);

  // Global Keyboard Shortcuts (A, R, Q)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (!selectedTx || !selectedTx.canApproveReject) return;

      if (e.key === 'a' || e.key === 'A') {
        handleApprove(selectedTx);
      } else if (e.key === 'r' || e.key === 'R') {
        handleReject(selectedTx);
      } else if (e.key === 'q' || e.key === 'Q') {
        setQrModalTx(selectedTx);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTx, handleApprove, handleReject]);

  return (
    <div className="min-h-screen bg-surface-canvas flex">
      {/* Fixed Left Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 ml-64 flex flex-col min-h-screen">
        <Header />

        <div className="flex-1 flex overflow-hidden">
          {/* Center Ledger View */}
          <main className="flex-1 p-8 pb-16 overflow-y-auto">
            {/* Title & Core Architectural Law */}
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Payments</h1>
              <p className="text-xs text-slate-500 font-normal mt-0.5">
                LLM proposes; deterministic policy disposes.
              </p>
            </div>

            {/* Top KPI Cards */}
            <KpiStrip />

            {/* AG Grid Transaction Ledger */}
            <LedgerGrid
              transactions={transactions}
              selectedTxId={selectedTxId}
              onSelectTx={(tx) => setSelectedTxId(tx.id)}
              expandedTxIds={expandedTxIds}
              onToggleExpand={handleToggleExpand}
              onApprove={handleApprove}
              onReject={handleReject}
              onOpenQr={(tx) => setQrModalTx(tx)}
            />
          </main>

          {/* Right Policy Inspector Drawer */}
          <PolicyInspector
            transaction={selectedTx}
            onOpenQr={(tx) => setQrModalTx(tx)}
            onApprove={handleApprove}
          />
        </div>

        {/* Bottom Keyboard Shortcuts Strip */}
        <KeyboardShortcutsBar />
      </div>

      {/* Single-Use QR Mobile Approval Modal */}
      {qrModalTx && (
        <QrApprovalModal
          isOpen={true}
          onClose={() => setQrModalTx(null)}
          singleUseCode={qrModalTx.qrCode?.singleUseCode || 'PG-7F3K-9D2L'}
          vendorName={qrModalTx.vendor}
          amountFormatted={qrModalTx.amountFormatted}
          onApproveSuccess={() => handleApprove(qrModalTx)}
        />
      )}
    </div>
  );
}
