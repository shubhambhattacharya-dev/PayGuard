'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Finance-console login. The password is checked server-side
 * (PAYGUARD_DASHBOARD_PASSWORD); success mints an httpOnly session cookie.
 */

function LoginForm() {
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(
    params.get('locked') !== null ? 'Dashboard is locked — PAYGUARD_DASHBOARD_PASSWORD is not configured on the server.' : null,
  );
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const next = params.get('next') ?? '/payments';
        window.location.href = next.startsWith('/') ? next : '/payments';
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
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-xl p-8 space-y-5">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🛡️</span>
          <div>
            <h1 className="text-lg font-semibold">PayGuard Console</h1>
            <p className="text-xs text-slate-400">Finance admin sign-in</p>
          </div>
        </div>

        {error !== null && (
          <div className="rounded-lg bg-rose-950/60 border border-rose-800 text-rose-200 text-sm px-3 py-2">{error}</div>
        )}

        <label className="block text-sm">
          <span className="text-slate-300">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 outline-none focus:border-emerald-500"
            placeholder="••••••••••"
          />
        </label>

        <button
          type="submit"
          disabled={busy || password.length === 0}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium py-2 transition"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-[11px] text-slate-500 leading-relaxed">
          Every approval re-runs the deterministic policy gate. Sessions expire after 8 hours.
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginForm />
    </Suspense>
  );
}
