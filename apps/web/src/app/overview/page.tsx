'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, ArrowRight, Server, Lock } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { KpiStrip } from '../../components/KpiStrip';
import { INITIAL_TRANSACTIONS } from '../../lib/mockData';
import { PolicyReasonCode, Transaction, TransactionStatus } from '../../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function OverviewPage() {
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [health, setHealth] = useState<{
    status?: string;
    paypalSandboxReady?: boolean;
    executionMode?: string;
    fiduciaryLaw?: string;
  } | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/healthz`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHealth(d))
      .catch(() => setHealth(null));

    fetch(`${API_URL}/v1/transactions`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          d: {
            transactions?: { id: string; status: TransactionStatus; policyCode: PolicyReasonCode; canApproveReject: boolean }[];
          } | null,
        ) => {
          if (!d?.transactions) return;
          const byId = new Map(d.transactions.map((t) => [t.id, t]));
          setTransactions((prev) =>
            prev.map((item) => {
              const live = byId.get(item.id);
              return live ? { ...item, ...live } : item;
            }),
          );
        },
      )
      .catch(() => {});
  }, []);

  return (
    <AppShell
      title="Overview"
      subtitle="Fiduciary gateway health, active policy caps, and live ledger posture."
    >
      <KpiStrip transactions={transactions} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-5 rounded-xl border border-surface-border bg-white shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-semibold text-slate-900">API & Rail Posture</h2>
          </div>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Gateway status</dt>
              <dd className="font-mono font-medium text-slate-900">{health ? 'ONLINE (200 OK)' : 'OFFLINE'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">PayPal Sandbox executor</dt>
              <dd className="font-mono font-medium text-slate-900">
                {health ? (health.paypalSandboxReady ? 'CONNECTED' : 'NOT CONFIGURED') : 'UNKNOWN'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Execution mode</dt>
              <dd className="font-mono font-medium text-slate-900">{health?.executionMode ?? 'offline_demo'}</dd>
            </div>
          </dl>
        </div>

        <div className="p-5 rounded-xl border border-surface-border bg-white shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-4 h-4 text-sky-600" />
            <h2 className="text-sm font-semibold text-slate-900">Deterministic Policy Caps</h2>
          </div>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-slate-500">Single-order auto-execute cap</dt>
              <dd className="font-mono font-semibold text-slate-900">$100.00 (10,000 cents)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Rolling 60-min velocity cap</dt>
              <dd className="font-mono font-semibold text-slate-900">$200.00 (20,000 cents)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Capability token law</dt>
              <dd className="font-mono text-emerald-700">Branded ApprovedForExecution</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="p-5 rounded-xl border border-surface-border bg-white shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <div>
            <div className="text-sm font-semibold text-slate-900">Ready to inspect or approve payments?</div>
            <div className="text-xs text-slate-500">
              Review held invoices, run the capped ReAct agent, or authorize single-use QR approvals.
            </div>
          </div>
        </div>
        <Link
          href="/payments"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium transition-colors"
        >
          <span>Open Payments Ledger</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </AppShell>
  );
}

