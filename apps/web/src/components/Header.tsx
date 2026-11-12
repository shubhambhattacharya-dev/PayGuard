'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, X, ChevronDown } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

interface HeaderProps {
  toastMessage?: string | null | undefined;
  onDismissToast?: (() => void) | undefined;
}

export function Header({ toastMessage, onDismissToast }: HeaderProps) {
  const [railState, setRailState] = useState<'checking' | 'sandbox' | 'simulated' | 'offline'>('checking');

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/healthz`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { paypalSandboxReady?: boolean } | null) => {
        if (cancelled) return;
        if (!data) {
          setRailState('offline');
        } else {
          setRailState(data.paypalSandboxReady ? 'sandbox' : 'simulated');
        }
      })
      .catch(() => {
        if (!cancelled) setRailState('offline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const badge =
    railState === 'sandbox'
      ? { dot: 'bg-emerald-600 animate-pulse', label: 'PayPal Sandbox Connected' }
      : railState === 'simulated'
        ? { dot: 'bg-amber-500', label: 'Simulated Ledger (No PayPal Creds)' }
        : railState === 'offline'
          ? { dot: 'bg-rose-500', label: 'API Offline (Demo Seed)' }
          : { dot: 'bg-slate-400 animate-pulse', label: 'Checking API...' };

  return (
    <header className="min-h-14 bg-white border-b border-surface-border px-4 sm:px-6 md:px-8 py-2 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-20">
      {/* Left: Date & Sandbox Status */}
      <div className="flex items-center gap-6">
        <span className="text-xs font-medium text-slate-500">Nov 1, 2026</span>
        <div className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-surface-subtle px-2.5 py-1 rounded-md border border-surface-border">
          <span className={`w-2 h-2 rounded-full ${badge.dot}`}></span>
          <span>{badge.label}</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </div>
      </div>

      {/* Right: TOCTOU Verification Toast (only shown after real gate re-evaluation) */}
      {toastMessage && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-1.5 rounded-lg shadow-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
          {onDismissToast && (
            <button
              onClick={onDismissToast}
              className="ml-2 text-emerald-600 hover:text-emerald-900 rounded p-0.5"
              aria-label="Dismiss notification"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </header>
  );
}
