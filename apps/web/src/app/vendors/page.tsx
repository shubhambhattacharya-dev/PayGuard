'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AppShell } from '../../components/AppShell';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface VendorRow {
  name: string;
  trusted: boolean;
  transactionCount: number;
  settledMinor: number;
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/vendors`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data: { vendors?: VendorRow[] }) => setVendors(data.vendors ?? []))
      .catch(() => setError('API unreachable — start @payguard/api on port 4000 to load trusted vendors.'));
  }, []);

  return (
    <AppShell
      title="Vendors"
      subtitle="Owner-controlled trusted vendor allowlist enforced by the deterministic policy gate."
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-surface-border shadow-sm overflow-x-auto">
        <div className="min-w-[540px]">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-surface-border text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            <div className="col-span-5">Vendor</div>
            <div className="col-span-3">Trust Status</div>
            <div className="col-span-2">Ledger Rows</div>
            <div className="col-span-2 text-right">Settled Total</div>
          </div>
          <div className="divide-y divide-surface-border">
            {vendors.map((v) => (
              <div key={v.name} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center text-xs">
                <div className="col-span-5 font-semibold text-slate-900">{v.name}</div>
                <div className="col-span-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium">
                    <ShieldCheck className="w-3 h-3" />
                    Trusted Allowlist
                  </span>
                </div>
                <div className="col-span-2 font-mono text-slate-600">{v.transactionCount}</div>
                <div className="col-span-2 text-right font-mono font-medium text-slate-900">
                  ${(v.settledMinor / 100).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

