'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Play, ShieldCheck, Wifi, WifiOff, Zap } from 'lucide-react';

const API_URL = '/api/payguard';

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
  if (state === 'APPROVED') return 'text-[#84e5b3] bg-[rgba(40,187,131,0.14)] border-[rgba(40,187,131,0.3)]';
  if (state === 'HOLD') return 'text-[#ffc477] bg-[rgba(255,184,107,0.14)] border-[rgba(255,184,107,0.3)]';
  if (state === 'REJECTED') return 'text-[#ff959a] bg-[rgba(255,123,130,0.14)] border-[rgba(255,123,130,0.3)]';
  return 'text-[#9aa9a0] bg-[#15211b] border-[rgba(222,242,227,0.16)]';
}

interface LiveGatePanelProps {
  onAfterRun?: () => void;
}

export function LiveGatePanel({ onAfterRun }: LiveGatePanelProps = {}) {
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
      onAfterRun?.();
    } catch {
      setBackend('offline');
    } finally {
      setBusy(null);
    }
  }, [onAfterRun]);

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
      if (res.ok) onAfterRun?.();
    } catch {
      setBackend('offline');
    } finally {
      setBusy(null);
    }
  }, [qrInput, onAfterRun]);

  return (
    <section className="mb-6 p-4 rounded-2xl border border-[rgba(222,242,227,0.12)] bg-[#111b17]/80 backdrop-blur-xl shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[#c8f169]" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-[#eaf0eb]">Live backend — LLM proposes, gate disposes</h2>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
            backend === 'online'
              ? 'text-[#84e5b3] bg-[rgba(40,187,131,0.12)] border-[rgba(40,187,131,0.3)]'
              : backend === 'offline'
                ? 'text-[#ff959a] bg-[rgba(255,123,130,0.12)] border-[rgba(255,123,130,0.3)]'
                : 'text-[#9aa9a0] bg-[#15211b] border-[rgba(222,242,227,0.12)]'
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
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl bg-[#c8f169] text-[#10170d] hover:bg-[#d6f68d] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          <Play className="w-3.5 h-3.5" aria-hidden="true" />
          {busy === 'agent' ? 'Running 4-round agent…' : 'Run live AI agent (Gemini/Groq)'}
        </button>
        <button
          type="button"
          onClick={() => void runAgent('fixture')}
          disabled={busy !== null || backend === 'offline'}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] bg-[#15211b]/80 hover:border-[#c8f169] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-[#c8f169]" aria-hidden="true" />
          Run recorded fixture agent (offline, deterministic)
        </button>
      </div>

      {result && (
        <div className="text-xs space-y-2 p-3 rounded-xl bg-[#15211b]/80 border border-[rgba(222,242,227,0.1)] mb-3" aria-live="polite">
          <div className={`inline-flex px-2.5 py-1 rounded-lg border font-semibold ${statusTone(result.decision?.state)}`}>
            Gate verdict: {result.decision?.state ?? '—'} · {result.decision?.reasonCode ?? result.error ?? '—'}
          </div>
          {result.untrustedInjection?.detected && (
            <p className="text-[#ff959a]">
              Injection blocked: “{result.untrustedInjection.matchedPattern}” — untrusted text cannot reach policy.
            </p>
          )}
          {result.thoughts && result.thoughts.length > 0 && (
            <ol className="space-y-1 text-[#b8c4bb] font-mono text-[11px]">
              {result.thoughts.map((thought) => (
                <li key={thought.round}>
                  <span className="text-[#c8f169] font-semibold">R{thought.round}</span> · {thought.tool ?? 'none'} — {thought.summary}
                </li>
              ))}
            </ol>
          )}
          {result.terminalReason === 'ROUND_CAP_REACHED' && (
            <p className="text-[#ffc477]">Round cap reached at 4 — no money moved (fail closed).</p>
          )}
          {result.settlement && (
            <p className="text-[#84e5b3] font-medium">
              Settled ${(result.settlement.amountMinor / 100).toFixed(2)} · ref {result.paypalOrderId} · model: {result.model}
            </p>
          )}
          {result.qrApproval && (
            <p className="text-[#ffc477]">
              Held for human approval — single-use QR code:{' '}
              <code className="px-1.5 py-0.5 bg-[#0b1210] border border-[rgba(255,184,107,0.3)] rounded font-mono">{result.qrApproval.singleUseCode}</code> (paste below to approve)
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
          className="text-xs px-3 py-2 rounded-xl bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] placeholder:text-[#6e7d74] focus:outline-none focus:ring-2 focus:ring-[#c8f169] w-40 font-mono uppercase"
        />
        <button
          type="button"
          onClick={() => void approveQr()}
          disabled={busy !== null || backend === 'offline' || qrInput.trim().length === 0}
          className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#1c3428] border border-[rgba(200,241,105,0.3)] text-[#c8f169] hover:bg-[#234232] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy === 'qr' ? 'Approving…' : 'Approve via QR (re-runs full gate)'}
        </button>
        {qrResult && (
          <span className={`text-xs font-medium ${qrResult.startsWith('Gate') ? 'text-[#84e5b3]' : 'text-[#ff959a]'}`}>
            {qrResult}
          </span>
        )}
      </div>
    </section>
  );
}
