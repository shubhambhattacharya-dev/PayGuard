'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, ArrowRight, Server, Lock } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { KpiStrip } from '../../components/KpiStrip';
import { mapApiTransactions } from '../../lib/apiTransactions';
import { Transaction } from '../../lib/types';

const API_URL = '/api/payguard';

type LiveState = 'loading' | 'live' | 'offline';

export default function OverviewPage() {
  // Never seed the workspace with demo transactions: when the API is down we
  // show an honest empty state instead of invented money data.
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [liveState, setLiveState] = useState<LiveState>('loading');
  const [health, setHealth] = useState<{
    status?: string;
    paypalSandboxReady?: boolean;
    executionMode?: string;
    fiduciaryLaw?: string;
    ledgerStore?: 'postgres' | 'in_memory';
    demoLedger?: boolean;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/healthz`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setHealth(d);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });

    fetch(`${API_URL}/v1/transactions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { transactions?: unknown } | null) => {
        if (cancelled) return;
        // API rows are the only source of truth — no local merge, no mock seed.
        setTransactions(mapApiTransactions(d?.transactions));
        setLiveState('live');
      })
      .catch(() => {
        if (cancelled) return;
        setTransactions([]);
        setLiveState('offline');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell
      title="Overview"
      subtitle="Fiduciary gateway health, active policy caps, and live ledger posture."
    >
      {liveState === 'offline' && (
        <div
          role="alert"
          className="mb-4 px-4 py-3 rounded-xl bg-[rgba(255,184,107,0.12)] border border-[rgba(255,184,107,0.3)] text-xs text-[#ffc477]"
        >
          Live API is unavailable, so no ledger data is shown. Demo transactions are disabled in the
          workspace — start the API or check <span className="font-mono">PAYGUARD_API_URL</span> and{' '}
          <span className="font-mono">PAYGUARD_API_KEY</span> on the dashboard deployment.
        </div>
      )}

      {health?.demoLedger && (
        <div
          role="status"
          className="mb-4 px-4 py-3 rounded-xl bg-[#15211b] border border-[rgba(255,184,107,0.35)] text-xs text-[#ffc477]"
        >
          This API is running in in-memory demo mode — rows below are seeded and reset whenever the
          API restarts. Set <span className="font-mono">DATABASE_URL</span> on the API service (Render)
          to persist and serve real ledger data.
        </div>
      )}

      {liveState === 'live' && transactions.length === 0 && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-[#15211b] border border-[rgba(222,242,227,0.12)] text-xs text-[#9aa9a0]">
          API connected. No transactions have been recorded yet — run the agent or settle an invoice
          to populate the live ledger.
        </div>
      )}

      <KpiStrip transactions={transactions} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-5 rounded-xl border border-[rgba(222,242,227,0.12)] bg-[#111b17]">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-[#c8f169]" />
            <h2 className="text-sm font-semibold text-[#eaf0eb]">API & Rail Posture</h2>
          </div>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Gateway status</dt>
              <dd className="font-mono font-medium text-[#eaf0eb]">
                {health ? 'ONLINE (200 OK)' : liveState === 'loading' ? 'CHECKING' : 'OFFLINE'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">PayPal Sandbox executor</dt>
              <dd className="font-mono font-medium text-[#eaf0eb]">
                {health ? (health.paypalSandboxReady ? 'CONNECTED' : 'NOT CONFIGURED') : 'UNKNOWN'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Execution mode</dt>
              <dd className="font-mono font-medium text-[#eaf0eb]">
                {health?.executionMode ?? (liveState === 'loading' ? 'checking' : 'unavailable')}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Ledger store</dt>
              <dd className="font-mono font-medium text-[#eaf0eb]">
                {health?.ledgerStore === 'postgres'
                  ? 'POSTGRESQL (DURABLE)'
                  : health?.ledgerStore === 'in_memory'
                    ? 'IN-MEMORY DEMO'
                    : liveState === 'loading'
                      ? 'CHECKING'
                      : 'UNAVAILABLE'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="p-5 rounded-xl border border-[rgba(222,242,227,0.12)] bg-[#111b17]">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-4 h-4 text-[#c8f169]" />
            <h2 className="text-sm font-semibold text-[#eaf0eb]">Deterministic Policy Caps</h2>
          </div>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Single-order auto-execute cap</dt>
              <dd className="font-mono font-semibold text-[#eaf0eb]">$100.00 (10,000 cents)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Rolling 60-min velocity cap</dt>
              <dd className="font-mono font-semibold text-[#eaf0eb]">$200.00 (20,000 cents)</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Capability token law</dt>
              <dd className="font-mono text-[#c8f169]">Branded ApprovedForExecution</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="p-5 rounded-xl border border-[rgba(222,242,227,0.12)] bg-[#111b17] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-[#c8f169]" />
          <div>
            <div className="text-sm font-semibold text-[#eaf0eb]">Ready to inspect or approve payments?</div>
            <div className="text-xs text-[#9aa9a0]">
              Review held invoices, run the capped ReAct agent, or authorize single-use QR approvals.
            </div>
          </div>
        </div>
        <Link
          href="/payments"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#c8f169] hover:bg-[#d6f68d] text-[#10170d] text-xs font-bold transition-colors"
        >
          <span>Open Payments Ledger</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </AppShell>
  );
}
