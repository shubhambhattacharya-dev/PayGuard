'use client';

import React, { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { AppShell } from '../../components/AppShell';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface AuditEventRow {
  id: string;
  timestamp: string;
  action: string;
  actor: string;
  invoiceId: string;
  vendor: string;
  amountMinor: number;
  decisionState: string;
  reasonCode: string;
  detail: string;
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEventRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/audit`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { events?: AuditEventRow[] }) => setEvents(data.events ?? []))
      .catch(() => setError('API unreachable — start @payguard/api on port 4000 to view the live audit trail.'));
  }, []);

  return (
    <AppShell
      title="Audit trail"
      subtitle="Immutable chronological record of policy gate evaluations, HITL approvals, and ledger settlements."
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-surface-border shadow-sm divide-y divide-surface-border">
        {events.length === 0 && !error ? (
          <div className="p-6 text-xs text-slate-500">No audit events recorded.</div>
        ) : (
          events.map((evt) => (
            <div key={evt.id} className="p-4 flex items-start justify-between gap-4 text-xs">
              <div className="flex items-start gap-3">
                <History className="w-4 h-4 text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-semibold text-slate-900">{evt.action}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]">
                      {evt.reasonCode}
                    </span>
                    <span className="text-slate-500">· {evt.invoiceId} ({evt.vendor})</span>
                  </div>
                  <p className="text-slate-600">{evt.detail}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-semibold text-slate-900">${(evt.amountMinor / 100).toFixed(2)}</div>
                <div className="text-[11px] text-slate-400 font-mono">{new Date(evt.timestamp).toLocaleString()}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

