'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Sidebar } from '../../components/Sidebar';
import { Header } from '../../components/Header';
import { KpiStrip } from '../../components/KpiStrip';
import { LiveGatePanel } from '../../components/LiveGatePanel';
import { LedgerGrid } from '../../components/LedgerGrid';
import { PolicyInspector } from '../../components/PolicyInspector';
import { QrApprovalModal } from '../../components/QrApprovalModal';
import { KeyboardShortcutsBar } from '../../components/KeyboardShortcutsBar';
import { LedgerWorkspaceSkeleton } from '../../components/Skeleton';
import { INITIAL_TRANSACTIONS } from '../../lib/mockData';
import { PolicyReasonCode, Transaction, TransactionStatus } from '../../lib/types';

const API_URL = '/api/payguard';

interface ApiTransactionRow {
  id: string;
  vendor?: string;
  invoiceNumber?: string;
  amountFormatted?: string;
  amountMinor?: number;
  status: TransactionStatus;
  policyCode: PolicyReasonCode;
  dateFormatted?: string;
  canApproveReject: boolean;
  qrCode?: string;
}

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [selectedTxId, setSelectedTxId] = useState<string>(INITIAL_TRANSACTIONS[0]?.id ?? '');
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set([INITIAL_TRANSACTIONS[0]?.id ?? '']));
  const [qrModalTx, setQrModalTx] = useState<Transaction | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);

  const selectedTx = transactions.find((t) => t.id === selectedTxId) || null;

  const refreshTransactions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/v1/transactions`, {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { transactions?: ApiTransactionRow[] } | null;
      if (!data?.transactions) return;
      const apiTransactions = data.transactions;
      const apiById = new Map(apiTransactions.map((t) => [t.id, t]));
      setTransactions((prev) => {
        const prevIds = new Set(prev.map((p) => p.id));
        const updated = prev.map((item) => {
          const live = apiById.get(item.id);
          if (!live) return item;
          return {
            ...item,
            status: live.status,
            policyCode: live.policyCode,
            canApproveReject: live.canApproveReject,
          };
        });
        const dynamicRows: Transaction[] = apiTransactions
          .filter((live) => !prevIds.has(live.id) && live.vendor && live.invoiceNumber)
          .map((live) => ({
            id: live.id,
            vendor: live.vendor ?? 'Unknown Vendor',
            invoiceNumber: live.invoiceNumber ?? live.id,
            amountFormatted: live.amountFormatted ?? '$0.00',
            amountMinor: live.amountMinor ?? 0,
            status: live.status,
            policyCode: live.policyCode,
            dateFormatted: live.dateFormatted ?? 'Today',
            canApproveReject: live.canApproveReject,
            reasoningSteps: [],
            policyChecks: [],
            policyLimits: {
              autoExecuteCap: '$100.00',
              vendorVelocitySpent: '$0.00',
              vendorVelocityLimit: '$1,000.00',
              velocityWindow: '60m',
            },
            ...(live.qrCode
              ? { qrCode: { singleUseCode: live.qrCode, expiresInSeconds: 600 } }
              : {}),
          }));
        return [...dynamicRows, ...updated];
      });
    } catch {
      // API offline: keep seeded transactions visible with offline badge in Header
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshTransactions();
  }, [refreshTransactions]);

  const handleToggleExpand = (txId: string) => {
    setExpandedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const markPaidLocally = useCallback((txId: string, toast?: string) => {
    setTransactions((prev) =>
      prev.map((item) =>
        item.id === txId
          ? {
              ...item,
              status: 'Paid',
              policyCode: 'AUTO_EXECUTED',
              canApproveReject: false,
            }
          : item,
      ),
    );
    if (toast) setToastMessage(toast);
  }, []);

  const handleApprove = useCallback(
    async (tx: Transaction) => {
      setActionError(null);
      try {
        const res = await fetch(`${API_URL}/v1/transactions/${encodeURIComponent(tx.id)}/approve`, {
          method: 'POST',
        });
        const data = (await res.json()) as {
          success?: boolean;
          toastMessage?: string;
          error?: string;
        };
        if (!res.ok || !data.success) {
          setActionError(
            data.error === 'LOGIN_REQUIRED'
              ? 'View-only demo — sign in at /login to approve payments.'
              : (data.toastMessage ?? data.error ?? `Approve failed (HTTP ${res.status})`),
          );
          return;
        }
        markPaidLocally(tx.id, data.toastMessage ?? 'Gate re-ran, decision stood');
      } catch {
        setActionError('API unreachable — start @payguard/api on port 4000 to settle approvals.');
      }
    },
    [markPaidLocally],
  );

  const handleReject = useCallback(async (tx: Transaction) => {
    setActionError(null);
    try {
      const res = await fetch(`${API_URL}/v1/transactions/${encodeURIComponent(tx.id)}/reject`, {
        method: 'POST',
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setActionError(
          data.error === 'LOGIN_REQUIRED'
            ? 'View-only demo — sign in at /login to approve payments.'
            : (data.error ?? `Reject failed (HTTP ${res.status})`),
        );
        return;
      }
      setTransactions((prev) =>
        prev.map((item) =>
          item.id === tx.id
            ? {
                ...item,
                status: 'Blocked',
                canApproveReject: false,
              }
            : item,
        ),
      );
      setToastMessage(`Blocked ${tx.invoiceNumber} (${tx.vendor})`);
    } catch {
      setActionError('API unreachable — start @payguard/api on port 4000 to reject transactions.');
    }
  }, []);

  // Global Keyboard Shortcuts (A, R, Q)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      if (!selectedTx || !selectedTx.canApproveReject) return;

      if (e.key === 'a' || e.key === 'A') {
        void handleApprove(selectedTx);
      } else if (e.key === 'r' || e.key === 'R') {
        void handleReject(selectedTx);
      } else if (e.key === 'q' || e.key === 'Q') {
        setQrModalTx(selectedTx);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTx, handleApprove, handleReject]);

  return (
    <div className="relative min-h-screen bg-surface-canvas flex flex-col md:flex-row overflow-x-hidden">
      {/* Ambient radial frosted glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed -top-24 left-1/3 h-96 w-96 rounded-full bg-[#c8f169]/5 blur-3xl z-0"
      />

      {/* Collapsible Left Sidebar (desktop) / Top Nav (mobile) */}
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((c) => !c)} />

      {/* Main Content Area */}
      <div
        className={`relative z-10 flex-1 flex flex-col min-h-screen min-w-0 transition-[margin] duration-300 ease-in-out ${
          sidebarCollapsed ? 'md:ml-0' : 'md:ml-56'
        }`}
      >
        <Header
          toastMessage={toastMessage}
          onDismissToast={() => setToastMessage(null)}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
          inspectorOpen={inspectorOpen}
          onToggleInspector={() => setInspectorOpen((v) => !v)}
        />

        <div className="flex-1 flex flex-col xl:flex-row overflow-hidden">
          {/* Center Ledger View */}
          <main className="flex-1 p-4 sm:p-6 md:p-8 pb-20 overflow-y-auto min-w-0">
            {/* Title & Core Architectural Law */}
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-[#eaf0eb] tracking-tight">Payments</h1>
                <p className="text-xs text-[#9aa9a0] font-normal mt-0.5">
                  LLM proposes; deterministic policy disposes.
                </p>
              </div>
            </div>

            {actionError && (
              <div className="mb-4 px-4 py-2.5 rounded-xl bg-rose-500/15 backdrop-blur-md border border-rose-500/30 text-xs text-[#ff959a] flex items-center justify-between">
                <span>{actionError}</span>
                <button
                  onClick={() => setActionError(null)}
                  className="text-[#ff959a] hover:underline font-semibold ml-4"
                >
                  Dismiss
                </button>
              </div>
            )}

            {isLoading ? (
              <LedgerWorkspaceSkeleton />
            ) : (
              <>
                {/* Top KPI Cards */}
                <KpiStrip transactions={transactions} />

                {/* Live API bridge: capped ReAct agent + deterministic gate */}
                <LiveGatePanel onAfterRun={() => void refreshTransactions()} />

                {/* Transaction Ledger */}
                <LedgerGrid
                  transactions={transactions}
                  selectedTxId={selectedTxId}
                  onSelectTx={(tx) => {
                    setSelectedTxId(tx.id);
                    setInspectorOpen(true);
                  }}
                  expandedTxIds={expandedTxIds}
                  onToggleExpand={handleToggleExpand}
                  onApprove={(tx) => void handleApprove(tx)}
                  onReject={(tx) => void handleReject(tx)}
                  onOpenQr={(tx) => setQrModalTx(tx)}
                />
              </>
            )}
          </main>

          {/* Right Sliding Policy Inspector Window (visible on xl+ laptops or when toggled) */}
          {inspectorOpen && (
            <PolicyInspector
              className="xl:w-96 shrink-0 transition-all duration-300 ease-in-out"
              transaction={selectedTx}
              onOpenQr={(tx) => setQrModalTx(tx)}
              onApprove={(tx) => void handleApprove(tx)}
            />
          )}
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
          onApproveSuccess={(msg) => markPaidLocally(qrModalTx.id, msg ?? 'Gate re-ran, decision stood')}
        />
      )}
    </div>
  );
}
