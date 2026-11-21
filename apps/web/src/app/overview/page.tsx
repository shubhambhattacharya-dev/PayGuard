'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, ArrowRight, Server, Lock } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { KpiStrip } from '../../components/KpiStrip';
import { INITIAL_TRANSACTIONS } from '../../lib/mockData';
import { PolicyReasonCode, Transaction, TransactionStatus } from '../../lib/types';

const API_URL = '/api/payguard';

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
        <div className="p-5 rounded-xl border border-[rgba(222,242,227,0.12)] bg-[#111b17]">
          <div className="flex items-center gap-2 mb-3">
            <Server className="w-4 h-4 text-[#c8f169]" />
            <h2 className="text-sm font-semibold text-[#eaf0eb]">API & Rail Posture</h2>
          </div>
          <dl className="space-y-2 text-xs">
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Gateway status</dt>
              <dd className="font-mono font-medium text-[#eaf0eb]">{health ? 'ONLINE (200 OK)' : 'OFFLINE'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">PayPal Sandbox executor</dt>
              <dd className="font-mono font-medium text-[#eaf0eb]">
                {health ? (health.paypalSandboxReady ? 'CONNECTED' : 'NOT CONFIGURED') : 'UNKNOWN'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-[#9aa9a0]">Execution mode</dt>
              <dd className="font-mono font-medium text-[#eaf0eb]">{health?.executionMode ?? 'offline_demo'}</dd>
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

