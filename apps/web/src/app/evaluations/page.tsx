'use client';

import React, { useState } from 'react';
import { ShieldAlert, Play } from 'lucide-react';
import { AppShell } from '../../components/AppShell';
import { LiveGatePanel } from '../../components/LiveGatePanel';

const API_URL = '/api/payguard';

function parseDollarsToMinor(raw: string): number {
  const cleaned = raw.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return 0;
  const whole = Number.parseInt(match[1] ?? '0', 10);
  const frac = (match[2] ?? '').padEnd(2, '0');
  const cents = Number.parseInt(frac, 10);
  return whole * 100 + cents;
}

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
    const minor = parseDollarsToMinor(amountDollars || '0');
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

      <div className="p-5 rounded-xl border border-[rgba(222,242,227,0.12)] bg-[#111b17]">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-4 h-4 text-[#ffc477]" />
          <h2 className="text-sm font-semibold text-[#eaf0eb]">Direct Policy Gate Sandbox (/v1/evaluate)</h2>
        </div>

        <form onSubmit={runDirectEval} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-[11px] font-medium text-[#9aa9a0] mb-1">Vendor Name</label>
            <input
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#9aa9a0] mb-1">Amount (USD)</label>
            <input
              value={amountDollars}
              onChange={(e) => setAmountDollars(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[#9aa9a0] mb-1">Untrusted Invoice Text</label>
            <input
              value={invoiceText}
              onChange={(e) => setInvoiceText(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#c8f169] hover:bg-[#d6f68d] text-[#10170d] text-xs font-bold disabled:opacity-50 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{busy ? 'Evaluating...' : 'Evaluate against Policy Gate'}</span>
            </button>
          </div>
        </form>

        {evalResult && (
          <pre className="p-3 rounded-lg bg-[#0b1210] border border-[rgba(222,242,227,0.12)] text-[#84e5b3] text-[11px] font-mono overflow-x-auto">
            {evalResult}
          </pre>
        )}
      </div>
    </AppShell>
  );
}

