'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Lock, Moon, PanelLeftOpen, PanelRightClose, PanelRightOpen, Sun, Unlock, X } from 'lucide-react';

const API_URL = '/api/payguard';

interface HeaderProps {
  toastMessage?: string | null | undefined;
  onDismissToast?: (() => void) | undefined;
  sidebarCollapsed?: boolean | undefined;
  onToggleSidebar?: (() => void) | undefined;
  inspectorOpen?: boolean | undefined;
  onToggleInspector?: (() => void) | undefined;
}

export function Header({
  toastMessage,
  onDismissToast,
  sidebarCollapsed = false,
  onToggleSidebar,
  inspectorOpen,
  onToggleInspector,
}: HeaderProps) {
  const [railState, setRailState] = useState<'checking' | 'sandbox' | 'simulated' | 'demo' | 'offline'>('checking');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [todayLabel, setTodayLabel] = useState<string>('');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [approverUnlocked, setApproverUnlocked] = useState<boolean>(false);
  const [demoAllowed, setDemoAllowed] = useState<boolean>(true);
  const [authBusy, setAuthBusy] = useState<boolean>(false);

  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    );
    try {
      const current = document.documentElement.dataset.theme;
      if (current === 'light' || current === 'dark') {
        setTheme(current);
      }
    } catch {
      // ignore storage errors
    }
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch('/api/session');
      if (!res.ok) return;
      const data = (await res.json()) as { authenticated?: boolean; demoAllowed?: boolean };
      setApproverUnlocked(Boolean(data.authenticated));
      if (typeof data.demoAllowed === 'boolean') {
        setDemoAllowed(data.demoAllowed);
      }
    } catch {
      // ignore network errors
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const toggleApproverSession = async () => {
    setAuthBusy(true);
    try {
      if (approverUnlocked) {
        await fetch('/api/logout', { method: 'POST' });
        setApproverUnlocked(false);
      } else if (demoAllowed) {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ demo: true }),
        });
        if (res.ok) {
          setApproverUnlocked(true);
        } else {
          window.location.href = '/login';
        }
      } else {
        window.location.href = '/login';
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (meta) {
      meta.content = next;
    }
    try {
      localStorage.setItem('pg-color-scheme', next);
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    let cancelled = false;
    const started = performance.now();
    fetch(`${API_URL}/healthz`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { paypalSandboxReady?: boolean; demoLedger?: boolean } | null) => {
        if (cancelled) return;
        setLatencyMs(Math.max(1, Math.round(performance.now() - started)));
        if (!data) {
          setRailState('offline');
        } else if (data.demoLedger) {
          setRailState('demo');
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
      ? { dot: 'bg-emerald-500 animate-pulse', label: 'PayPal Sandbox Connected' }
      : railState === 'demo'
        ? { dot: 'bg-amber-500', label: 'In-Memory Demo Ledger (Not Durable)' }
        : railState === 'simulated'
          ? { dot: 'bg-amber-500', label: 'Simulated Ledger (No PayPal Creds)' }
          : railState === 'offline'
            ? { dot: 'bg-rose-500', label: 'API Offline — Live Data Unavailable' }
            : { dot: 'bg-slate-400 animate-pulse', label: 'Checking API...' };

  return (
    <header className="min-h-14 bg-[#0b1210]/85 backdrop-blur-xl border-b border-[rgba(222,242,227,0.12)] px-4 sm:px-6 md:px-8 py-2 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-20">
      {/* Left: Sidebar Toggle, Date & Sandbox Status */}
      <div className="flex items-center gap-3 sm:gap-4">
        {onToggleSidebar && sidebarCollapsed && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(222,242,227,0.16)] bg-[#111b17]/80 backdrop-blur-md hover:border-[#c8f169] text-xs font-semibold text-[#eaf0eb] transition-colors shadow-sm"
            aria-label="Show sidebar"
            title="Show sidebar"
          >
            <PanelLeftOpen className="w-3.5 h-3.5 text-[#c8f169]" />
            <span>Menu</span>
          </button>
        )}
        {todayLabel && (
          <span className="text-xs font-medium text-[#9aa9a0] font-mono" suppressHydrationWarning>
            {todayLabel}
          </span>
        )}
        <div className="flex items-center gap-2 text-xs font-medium text-[#dce5de] bg-[#111b17]/80 backdrop-blur-md px-3 py-1 rounded-full border border-[rgba(222,242,227,0.12)] shadow-sm">
          <span className={`w-2 h-2 rounded-full ${badge.dot}`}></span>
          <span>{badge.label}</span>
          {latencyMs !== null && railState !== 'offline' && (
            <span className="text-[11px] font-mono text-[#9aa9a0] pl-1.5 border-l border-[rgba(222,242,227,0.12)]">
              {latencyMs}ms
            </span>
          )}
        </div>
      </div>

      {/* Right: Toast + Role Switcher + Theme Toggle + Inspector Drawer Toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        {toastMessage && (
          <div className="flex items-center gap-2 bg-[rgba(40,187,131,0.14)] backdrop-blur-md border border-[rgba(40,187,131,0.3)] text-[#84e5b3] text-xs px-3 py-1.5 rounded-lg shadow-sm">
            <CheckCircle2 className="w-4 h-4 text-[#84e5b3] shrink-0" />
            <span className="font-medium">{toastMessage}</span>
            {onDismissToast && (
              <button
                onClick={onDismissToast}
                className="ml-2 text-[#84e5b3] hover:text-white rounded p-0.5"
                aria-label="Dismiss notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void toggleApproverSession()}
          disabled={authBusy}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors ${
            approverUnlocked
              ? 'border-[rgba(40,187,131,0.35)] bg-[rgba(40,187,131,0.14)] text-[#84e5b3] hover:bg-[rgba(40,187,131,0.22)]'
              : 'border-[rgba(200,241,105,0.4)] bg-[#c8f169] text-[#10170d] hover:bg-[#d6f68d]'
          }`}
          title={
            approverUnlocked
              ? 'Approver session active — click to switch back to View-Only mode'
              : 'View-only mode — click to unlock 1-click Sandbox Approver session'
          }
        >
          {approverUnlocked ? (
            <>
              <Unlock className="w-3.5 h-3.5 shrink-0" />
              <span>Approver Active · Lock</span>
            </>
          ) : (
            <>
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>{authBusy ? 'Unlocking…' : 'View-Only · Unlock Approver'}</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(222,242,227,0.14)] bg-[#111b17]/80 backdrop-blur-md hover:border-[#c8f169] text-xs font-medium text-[#eaf0eb] transition-colors"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <>
              <Sun className="w-3.5 h-3.5 text-[#c8f169]" />
              <span className="hidden sm:inline">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-3.5 h-3.5 text-[#c8f169]" />
              <span className="hidden sm:inline">Dark</span>
            </>
          )}
        </button>

        {onToggleInspector && (
          <button
            type="button"
            onClick={onToggleInspector}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[rgba(222,242,227,0.14)] bg-[#111b17]/80 backdrop-blur-md hover:border-[#c8f169] text-xs font-medium text-[#eaf0eb] transition-colors"
            aria-label={inspectorOpen ? 'Hide policy inspector' : 'Show policy inspector'}
            title={inspectorOpen ? 'Hide policy inspector' : 'Show policy inspector'}
          >
            {inspectorOpen ? (
              <>
                <PanelRightClose className="w-3.5 h-3.5 text-[#c8f169]" />
                <span className="hidden sm:inline">Hide Inspector</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="w-3.5 h-3.5 text-[#c8f169]" />
                <span className="hidden sm:inline">Inspector</span>
              </>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
