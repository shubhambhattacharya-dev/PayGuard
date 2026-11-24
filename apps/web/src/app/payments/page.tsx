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
import { mapApiTransactions } from '../../lib/apiTransactions';
import { Transaction } from '../../lib/types';

const API_URL = '/api/payguard';

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedTxId, setSelectedTxId] = useState<string>('');
  const [expandedTxIds, setExpandedTxIds] = useState<Set<string>>(new Set());
  const [qrModalTx, setQrModalTx] = useState<Transaction | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ledgerSource, setLedgerSource] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(true);

  const selectedTx = transactions.find((t) => t.id === selectedTxId) || null;

  const refreshTransactions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/v1/transactions`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Transactions request failed (${res.status})`);
      const data = (await res.json()) as { transactions?: unknown; source?: unknown } | null;
      const rows = mapApiTransactions(data?.transactions);
      setTransactions(rows);
      setLedgerSource(typeof data?.source === 'string' ? data.source : null);
      setSelectedTxId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '');
      setExpandedTxIds((current) => new Set([...current].filter((id) => rows.some((row) => row.id === id))));
      setLoadError(null);
    } catch {
      setTransactions((prev) => {
        if (prev.length === 0) {
          setSelectedTxId('');
          setExpandedTxIds(new Set());
          setLedgerSource(null);
          setLoadError('Live API unavailable — no ledger data is shown. Demo transactions are disabled in the workspace.');
        }
        return prev;
      });
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
              ? 'View-only mode — click "View-Only · Unlock Approver" in the top bar (or sign in at /login) to approve payments.'
              : (data.toastMessage ?? data.error ?? `Approve failed (HTTP ${res.status})`),
          );
          return;
        }
        markPaidLocally(tx.id, data.toastMessage ?? 'Gate re-ran, decision stood');
      } catch {
        setActionError('Live API unreachable — approval is unavailable right now.');
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
            ? 'View-only mode — click "View-Only · Unlock Approver" in the top bar (or sign in at /login) to reject payments.'
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
      setActionError('Live API unreachable — rejection is unavailable right now.');
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
        if (selectedTx.qrCode?.singleUseCode) {
          setQrModalTx(selectedTx);
        } else {
          setActionError('This ledger row has no live QR approval code.');
        }
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

            {loadError && !isLoading && (
              <div
                role="alert"
                className="mb-4 px-4 py-2.5 rounded-xl bg-[rgba(255,184,107,0.12)] border border-[rgba(255,184,107,0.3)] text-xs text-[#ffc477]"
              >
                {loadError}
              </div>
            )}

            {ledgerSource === 'in_memory_demo' && !isLoading && (
              <div
                role="status"
                className="mb-4 px-4 py-2.5 rounded-xl bg-[#15211b] border border-[rgba(255,184,107,0.35)] text-xs text-[#ffc477]"
              >
                This API is serving an in-memory demo ledger — these rows are seeded and reset on
                restart. Set <span className="font-mono">DATABASE_URL</span> on the API service for
                durable real settlement data.
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
                  onOpenQr={(tx) => {
                    if (tx.qrCode?.singleUseCode) {
                      setQrModalTx(tx);
                    } else {
                      setActionError('This ledger row has no live QR approval code.');
                    }
                  }}
                />
                {transactions.length === 0 && !loadError && (
                  <p className="mt-4 text-center text-xs text-[#9aa9a0]">
                    No live transactions yet — run the agent or settle an invoice to populate the ledger.
                  </p>
                )}
              </>
            )}
          </main>

          {/* Right Sliding Policy Inspector Window (visible on xl+ laptops or when toggled) */}
          {inspectorOpen && (
            <PolicyInspector
              className="xl:w-96 shrink-0 transition-all duration-300 ease-in-out"
              transaction={selectedTx}
              onOpenQr={(tx) => {
                if (tx.qrCode?.singleUseCode) {
                  setQrModalTx(tx);
                } else {
                  setActionError('This ledger row has no live QR approval code.');
                }
              }}
              onApprove={(tx) => void handleApprove(tx)}
            />
          )}
        </div>

        {/* Bottom Keyboard Shortcuts Strip */}
        <KeyboardShortcutsBar />
      </div>

      {/* Single-Use QR Mobile Approval Modal */}
      {qrModalTx?.qrCode && (
        <QrApprovalModal
          isOpen={true}
          onClose={() => setQrModalTx(null)}
          singleUseCode={qrModalTx.qrCode.singleUseCode}
          vendorName={qrModalTx.vendor}
          amountFormatted={qrModalTx.amountFormatted}
          expiresAtMs={qrModalTx.qrCode.expiresAtMs}
          expiresInSeconds={qrModalTx.qrCode.expiresInSeconds}
          onApproveSuccess={(msg) => {
            markPaidLocally(qrModalTx.id, msg ?? 'Gate re-ran, decision stood');
            void refreshTransactions();
          }}
        />
      )}
    </div>
  );
}
