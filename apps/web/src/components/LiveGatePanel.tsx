'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Play, ShieldCheck, Wifi, WifiOff, Zap } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? (typeof window !== 'undefined' ? '' : 'http://localhost:4000');

interface AgentThought {
  round: number;
  tool: string | null;
  summary: string;
}

interface AgentRunResponse {
  decision?: { state: string; reasonCode: string };
  untrustedInjection?: { detected: boolean; matchedPattern: string };
  thoughts?: AgentThought[];
  proposal?: { grandTotalMinor: number } | null;
  model?: string;
  roundsUsed?: number;
  terminalReason?: string;
  settlement?: { amountMinor: number };
  paypalOrderId?: string;
  qrApproval?: { singleUseCode: string };
  error?: string;
}

type BackendState = 'checking' | 'online' | 'offline';

function statusTone(state: string | undefined): string {
  if (state === 'APPROVED') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (state === 'HOLD') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (state === 'REJECTED') return 'text-rose-700 bg-rose-50 border-rose-200';
  return 'text-slate-600 bg-slate-50 border-slate-200';
}

/**
 * Live bridge to the PayGuard API: runs the capped ReAct agent against a
 * seeded invoice, shows the deterministic gate verdict, and settles QR-held
 * orders. Falls back to a clear offline hint when the API is not running.
 */
export function LiveGatePanel() {
  const [backend, setBackend] = useState<BackendState>('checking');
  const [busy, setBusy] = useState<'agent' | 'qr' | null>(null);
  const [result, setResult] = useState<AgentRunResponse | null>(null);
  const [qrInput, setQrInput] = useState('');
  const [qrResult, setQrResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/healthz`)
      .then((res) => {
        if (!cancelled) setBackend(res.ok ? 'online' : 'offline');
      })
      .catch(() => {
        if (!cancelled) setBackend('offline');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runAgent = useCallback(async (model: 'auto' | 'fixture') => {
    setBusy('agent');
    setResult(null);
    setQrResult(null);
    try {
      const res = await fetch(`${API_URL}/v1/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: 'owner_northstar',
          model,
          goal: 'Pay the Cedar Supply invoice INV-3155',
          invoiceText:
            'Vendor: Cedar Supply | Invoice INV-3155 | Office Paper Reams x4 @ $16.00 | Total $64.00',
          idempotencyKey: `ui-${Date.now()}`,
        }),
      });
      setResult((await res.json()) as AgentRunResponse);
    } catch {
      setBackend('offline');
    } finally {
      setBusy(null);
    }
  }, []);

  const approveQr = useCallback(async () => {
    const code = qrInput.trim().toUpperCase();
    if (!code) return;
    setBusy('qr');
    setQrResult(null);
    try {
      const res = await fetch(`${API_URL}/v1/hitl/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ singleUseCode: code }),
      });
      const body = (await res.json()) as { toastMessage?: string; error?: string };
      setQrResult(res.ok ? (body.toastMessage ?? 'Approved') : (body.error ?? `HTTP ${res.status}`));
    } catch {
      setBackend('offline');
    } finally {
      setBusy(null);
    }
  }, [qrInput]);

  return (
    <section className="mb-6 p-4 rounded-xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-sky-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">Live backend — LLM proposes, gate disposes</h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md border ${
            backend === 'online'
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : backend === 'offline'
                ? 'text-rose-700 bg-rose-50 border-rose-200'
                : 'text-slate-500 bg-slate-50 border-slate-200'
          }`}
        >
          {backend === 'online' ? (
            <Wifi className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          {backend === 'online' ? 'API connected' : backend === 'offline' ? 'API offline — start it with pnpm --filter @payguard/api start' : 'checking…'}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => void runAgent('auto')}
          disabled={busy !== null || backend === 'offline'}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Play className="w-3.5 h-3.5" aria-hidden="true" />
          {busy === 'agent' ? 'Running 4-round agent…' : 'Run live AI agent (Gemini/Groq)'}
        </button>
        <button
          type="button"
          onClick={() => void runAgent('fixture')}
          disabled={busy !== null || backend === 'offline'}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          Run recorded fixture agent (offline, deterministic)
        </button>
      </div>

      {result && (
        <div className="text-xs space-y-2" aria-live="polite">
          <div className={`inline-flex px-2.5 py-1.5 rounded-md border font-semibold ${statusTone(result.decision?.state)}`}>
            Gate verdict: {result.decision?.state ?? '—'} · {result.decision?.reasonCode ?? result.error ?? '—'}
          </div>
          {result.untrustedInjection?.detected && (
            <p className="text-rose-700">
              Injection blocked: “{result.untrustedInjection.matchedPattern}” — untrusted text cannot reach policy.
            </p>
          )}
          {result.thoughts && result.thoughts.length > 0 && (
            <ol className="space-y-1 text-slate-600">
              {result.thoughts.map((thought) => (
                <li key={thought.round}>
                  R{thought.round} · {thought.tool ?? 'none'} — {thought.summary}
                </li>
              ))}
            </ol>
          )}
          {result.terminalReason === 'ROUND_CAP_REACHED' && (
            <p className="text-amber-700">Round cap reached at 4 — no money moved (fail closed).</p>
          )}
          {result.settlement && (
            <p className="text-emerald-700">
              Settled ${(result.settlement.amountMinor / 100).toFixed(2)} · ref {result.paypalOrderId} · model: {result.model}
            </p>
          )}
          {result.qrApproval && (
            <p className="text-amber-700">
              Held for human approval — single-use QR code:{' '}
              <code className="px-1 py-0.5 bg-amber-50 rounded">{result.qrApproval.singleUseCode}</code> (paste below to approve)
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <input
          type="text"
          value={qrInput}
          onChange={(event) => setQrInput(event.target.value)}
          placeholder="PG-XXXX-XXXX"
          aria-label="Single-use QR approval code"
          className="text-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-sky-500 w-40 font-mono uppercase"
        />
        <button
          type="button"
          onClick={() => void approveQr()}
          disabled={busy !== null || backend === 'offline' || qrInput.trim().length === 0}
          className="text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'qr' ? 'Approving…' : 'Approve via QR (re-runs full gate)'}
        </button>
        {qrResult && (
          <span className={`text-xs font-medium ${qrResult.startsWith('Gate') ? 'text-emerald-700' : 'text-rose-700'}`}>
            {qrResult}
          </span>
        )}
      </div>
    </section>
  );
}
