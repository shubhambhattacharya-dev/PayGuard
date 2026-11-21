'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, QrCode } from 'lucide-react';
import { AppShell } from '../../components/AppShell';

const API_URL = '/api/payguard';

interface ApprovalItem {
  code: string;
  ownerId: string;
  invoiceId: string;
  vendorName: string;
  amountMinor: number;
  reasonCode: string;
  used: boolean;
  expired: boolean;
}

function ApprovalsContent() {
  const searchParams = useSearchParams();
  const targetCode = searchParams.get('code')?.trim().toUpperCase() ?? null;

  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/v1/approvals`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { approvals?: ApprovalItem[] };
      setApprovals(data.approvals ?? []);
      setError(null);
    } catch {
      setError('API unreachable — start @payguard/api on port 4000 to view live QR approvals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  const handleAuthorize = async (code: string) => {
    setError(null);
    try {
      const res = await fetch(`${API_URL}/v1/hitl/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ singleUseCode: code }),
      });
      const data = (await res.json()) as { success?: boolean; toastMessage?: string; error?: string };
      if (!res.ok || !data.success) {
        setError(
          data.error === 'LOGIN_REQUIRED'
            ? 'View-only demo — sign in at /login to approve payments.'
            : (data.toastMessage ?? data.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      setToast(data.toastMessage ?? 'Gate re-ran, decision stood');
      await loadApprovals();
    } catch {
      setError('API unreachable.');
    }
  };

  const scannedItem = targetCode ? approvals.find((a) => a.code === targetCode) : null;

  return (
    <AppShell
      title="Approvals"
      subtitle="Single-use HITL QR nonces. Each authorization re-runs the deterministic policy gate."
      toastMessage={toast}
      onDismissToast={() => setToast(null)}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[rgba(255,123,130,0.12)] border border-[rgba(255,123,130,0.3)] text-xs text-[#ff959a]">
          {error}
        </div>
      )}

      {targetCode && scannedItem && !scannedItem.used && !scannedItem.expired && (
        <div className="mb-4 p-4 rounded-xl bg-[rgba(40,187,131,0.12)] border border-[rgba(40,187,131,0.3)] flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-[#eaf0eb]">
            <span className="font-semibold text-[#c8f169]">QR Scanned:</span>{' '}
            <span className="font-mono font-bold text-[#c8f169]">{scannedItem.code}</span> — {scannedItem.vendorName} (
            {scannedItem.invoiceId}) for ${(scannedItem.amountMinor / 100).toFixed(2)}
          </div>
          <button
            onClick={() => void handleAuthorize(scannedItem.code)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c8f169] hover:bg-[#d6f68d] text-[#10170d] text-xs font-bold transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Authorize Now</span>
          </button>
        </div>
      )}

      <div className="bg-[#111b17] rounded-xl border border-[rgba(222,242,227,0.12)] overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-[rgba(222,242,227,0.12)] bg-[#101914] text-[11px] font-medium text-[#9aa9a0] uppercase tracking-wider">
            <div className="col-span-2">QR Code</div>
            <div className="col-span-3">Vendor</div>
            <div className="col-span-2">Invoice</div>
            <div className="col-span-2">Amount</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2 text-right">Action</div>
          </div>
          {loading ? (
            <div className="p-6 text-xs text-[#9aa9a0]">Loading approvals...</div>
          ) : approvals.length === 0 ? (
            <div className="p-6 text-xs text-[#9aa9a0]">No QR approvals recorded yet.</div>
          ) : (
            <div className="divide-y divide-[rgba(222,242,227,0.08)]">
              {approvals.map((item) => {
                const isTarget = targetCode === item.code;
                return (
                  <div
                    key={item.code}
                    className={`grid grid-cols-12 gap-3 px-5 py-3.5 items-center text-xs ${
                      isTarget ? 'bg-[#1c3428]/70' : 'hover:bg-[#15211b]'
                    }`}
                  >
                    <div className="col-span-2 font-mono font-semibold text-[#c8f169] flex items-center gap-1.5">
                      <QrCode className="w-3.5 h-3.5 text-[#c8f169] shrink-0" />
                      <span className="truncate">{item.code}</span>
                    </div>
                    <div className="col-span-3 font-medium text-[#eaf0eb] truncate">{item.vendorName}</div>
                    <div className="col-span-2 font-mono text-[#9aa9a0]">{item.invoiceId}</div>
                    <div className="col-span-2 font-medium text-[#eaf0eb] tabular-nums">
                      ${(item.amountMinor / 100).toFixed(2)}
                    </div>
                    <div className="col-span-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${
                          item.used
                            ? 'bg-[rgba(40,187,131,0.14)] text-[#84e5b3] border-[rgba(40,187,131,0.3)]'
                            : item.expired
                              ? 'bg-[#15211b] text-[#6e7d74] border-[rgba(222,242,227,0.12)]'
                              : 'bg-[rgba(255,184,107,0.14)] text-[#ffc477] border-[rgba(255,184,107,0.3)]'
                        }`}
                      >
                        {item.used ? 'Used' : item.expired ? 'Expired' : 'Pending'}
                      </span>
                    </div>
                    <div className="col-span-2 text-right">
                      {!item.used && !item.expired ? (
                        <button
                          onClick={() => void handleAuthorize(item.code)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#c8f169] hover:bg-[#d6f68d] text-[#10170d] text-[11px] font-bold transition-colors"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Approve</span>
                        </button>
                      ) : (
                        <span className="text-[#6e7d74] font-mono">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default function ApprovalsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-xs text-slate-500">Loading approvals...</div>}>
      <ApprovalsContent />
    </Suspense>
  );
}
