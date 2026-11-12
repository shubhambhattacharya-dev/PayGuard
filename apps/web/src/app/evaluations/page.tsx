'use client';

import React, { useState } from 'react';
import { ShieldAlert, Play } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { LiveGatePanel } from '../../components/LiveGatePanel';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function EvaluationsPage() {
  const [vendorName, setVendorName] = useState('Aster Cloud');
  const [amountDollars, setAmountDollars] = useState('145.00');
  const [invoiceText, setInvoiceText] = useState('Vendor: Aster Cloud | Item: Pro Plan | Total: $145.00');
  const [evalResult, setEvalResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const runDirectEval = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setEvalResult(null);
    const minor = Math.round(Number.parseFloat(amountDollars || '0') * 100);
    const invoiceId = `INV-EVAL-${Date.now().toString().slice(-4)}`;
    try {
      const res = await fetch(`${API_URL}/v1/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: 'owner_northstar',
          invoiceText,
          idempotencyKey: `eval-${Date.now()}`,
          proposal: {
            invoiceId,
            vendorName,
            lineItems: [
              {
                sku: 'EVAL-SKU-01',
                description: 'Evaluated Service Line',
                quantity: 1,
                unitPriceMinor: minor,
                taxBps: 0,
                lineTotalMinor: minor,
              },
            ],
            currency: 'USD',
            subtotalMinor: minor,
            taxTotalMinor: 0,
            grandTotalMinor: minor,
          },
        }),
      });
      const json = await res.json();
      setEvalResult(JSON.stringify(json, null, 2));
    } catch {
      setEvalResult('API unreachable — start @payguard/api on port 4000.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Evaluations"
      subtitle="Run the capped ReAct agent or test the deterministic policy gate directly."
    >
      <LiveGatePanel />

      <div className="p-5 rounded-xl border border-surface-border bg-white shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <h2 className="text-sm font-semibold text-slate-900">Direct Policy Gate Sandbox (/v1/evaluate)</h2>
        </div>

        <form onSubmit={runDirectEval} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Vendor Name</label>
            <input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-surface-border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Amount (USD)</label>
            <input
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-surface-border rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Untrusted Invoice Text</label>
            <input
              value={invoiceText}
              onChange={(e) => setInvoiceText(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-surface-border rounded-lg"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{busy ? 'Evaluating...' : 'Evaluate against Policy Gate'}</span>
            </button>
          </div>
        </form>

        {evalResult && (
          <pre className="p-3 rounded-lg bg-slate-950 text-emerald-300 text-[11px] font-mono overflow-x-auto">
            {evalResult}
          </pre>
        )}
      </div>
    </AppShell>
  );
}

