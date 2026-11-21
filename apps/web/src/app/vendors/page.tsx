'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { AppShell } from '../../components/AppShell';

const API_URL = '/api/payguard';

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
        <div className="mb-4 p-3 rounded-lg bg-[rgba(255,123,130,0.12)] border border-[rgba(255,123,130,0.3)] text-xs text-[#ff959a]">
          {error}
        </div>
      )}

      <div className="bg-[#111b17] rounded-xl border border-[rgba(222,242,227,0.12)] overflow-x-auto">
        <div className="min-w-[540px]">
          <div className="grid grid-cols-12 gap-3 px-5 py-3 border-b border-[rgba(222,242,227,0.12)] bg-[#101914] text-[11px] font-medium text-[#9aa9a0] uppercase tracking-wider">
            <div className="col-span-5">Vendor</div>
            <div className="col-span-3">Trust Status</div>
            <div className="col-span-2">Ledger Rows</div>
            <div className="col-span-2 text-right">Settled Total</div>
          </div>
          <div className="divide-y divide-[rgba(222,242,227,0.08)]">
            {vendors.map((v) => (
              <div key={v.name} className="grid grid-cols-12 gap-3 px-5 py-3.5 items-center text-xs hover:bg-[#15211b] transition-colors">
                <div className="col-span-5 font-semibold text-[#eaf0eb]">{v.name}</div>
                <div className="col-span-3">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[rgba(40,187,131,0.14)] text-[#84e5b3] border border-[rgba(40,187,131,0.3)] text-[11px] font-medium">
                    <ShieldCheck className="w-3 h-3" />
                    Trusted Allowlist
                  </span>
                </div>
                <div className="col-span-2 font-mono text-[#9aa9a0]">{v.transactionCount}</div>
                <div className="col-span-2 text-right font-mono font-medium text-[#eaf0eb] tabular-nums">
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

