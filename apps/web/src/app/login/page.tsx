'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    params.get('locked') !== null ? 'Dashboard is locked — PAYGUARD_DASHBOARD_PASSWORD is not configured on the server.' : null,
  );
  const [busy, setBusy] = useState<'demo' | 'password' | null>(null);

  const redirectNext = () => {
    const next = params.get('next') ?? '/payments';
    window.location.href = next.startsWith('/') ? next : '/payments';
  };

  async function unlockSandboxDemo() {
    setBusy('demo');
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demo: true }),
      });
      if (res.ok) {
        redirectNext();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(body.detail ?? 'Sandbox demo login is disabled on this deployment.');
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy('password');
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        redirectNext();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      setError(
        body.error === 'INVALID_PASSWORD'
          ? 'Wrong password.'
          : body.detail ?? 'Login failed — try again.',
      );
    } catch {
      setError('Network error — try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#0b1210] text-[#eaf0eb] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#111b17] border border-[rgba(222,242,227,0.14)] rounded-2xl p-7 space-y-5 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <div>
            <h1 className="text-lg font-semibold">PayGuard Console</h1>
            <p className="text-xs text-[#9aa9a0]">Maker-checker session gate (PayPal Sandbox)</p>
          </div>
        </div>

        {error !== null && (
          <div className="rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs px-3 py-2">{error}</div>
        )}

        <div className="p-3.5 rounded-xl bg-[#15211b] border border-[rgba(200,241,105,0.28)] space-y-2.5">
          <div className="text-xs font-semibold text-[#c8f169]">Trying PayGuard as a founder or reviewer?</div>
          <p className="text-[11px] text-[#b8c4bb] leading-relaxed">
            Unlock a 2-hour Sandbox Approver session in one click to test live QR approvals, ledger settlement, and TOCTOU gate re-verification.
          </p>
          <button
            type="button"
            onClick={() => void unlockSandboxDemo()}
            disabled={busy !== null}
            className="w-full rounded-xl bg-[#c8f169] hover:bg-[#d6f68d] disabled:opacity-50 text-[#10170d] text-xs font-bold py-2.5 transition-colors"
          >
            {busy === 'demo' ? 'Unlocking Sandbox Approver…' : 'Continue as Sandbox Approver (1-Click)'}
          </button>
        </div>

        <div className="relative flex items-center py-1">
          <div className="flex-grow border-t border-[rgba(222,242,227,0.1)]" />
          <span className="shrink-0 px-2.5 text-[10px] uppercase tracking-wider text-[#6e7d74]">or admin password</span>
          <div className="flex-grow border-t border-[rgba(222,242,227,0.1)]" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block text-xs">
            <span className="text-[#9aa9a0]">Finance Admin Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl bg-[#0b1210] border border-[rgba(222,242,227,0.18)] px-3 py-2 text-xs outline-none focus:border-[#c8f169]"
              placeholder="••••••••••"
            />
          </label>

          <button
            type="submit"
            disabled={busy !== null || password.length === 0}
            className="w-full rounded-xl bg-[#1c3428] border border-[rgba(200,241,105,0.3)] hover:bg-[#234232] disabled:opacity-40 text-[#c8f169] text-xs font-semibold py-2 transition"
          >
            {busy === 'password' ? 'Signing in…' : 'Sign in with password'}
          </button>
        </form>

        <p className="text-[11px] text-[#6e7d74] leading-relaxed">
          Every approval re-runs the deterministic policy gate before moving sandbox funds.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0b1210]" />}>
      <LoginForm />
    </Suspense>
  );
}
