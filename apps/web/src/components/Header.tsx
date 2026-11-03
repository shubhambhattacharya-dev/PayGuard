'use client';

import React, { useState } from 'react';
import { CheckCircle2, X, ChevronDown } from 'lucide-react';

export function Header() {
  const [showToast, setShowToast] = useState(true);

  return (
    <header className="h-14 bg-white border-b border-surface-border px-8 flex items-center justify-between sticky top-0 z-20">
      {/* Left: Date & Sandbox Status */}
      <div className="flex items-center gap-6">
        <span className="text-xs font-medium text-slate-500">Nov 1, 2026</span>
        <button className="flex items-center gap-2 text-xs font-medium text-slate-700 bg-surface-subtle px-2.5 py-1 rounded-md border border-surface-border hover:bg-slate-100 transition-colors">
          <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
          <span>PayPal Sandbox</span>
          <ChevronDown className="w-3 h-3 text-slate-400" />
        </button>
      </div>

      {/* Right: TOCTOU Verification Toast */}
      {showToast && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs px-3 py-1.5 rounded-lg shadow-sm animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="font-medium">Gate re-ran, decision stood</span>
          <button
            onClick={() => setShowToast(false)}
            className="ml-2 text-emerald-600 hover:text-emerald-900 rounded p-0.5"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </header>
  );
}
