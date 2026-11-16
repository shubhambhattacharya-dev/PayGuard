'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Menu,
  Play,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';

type PreviewTab = 'payments' | 'evidence' | 'audit';
type DemoScenarioKey = 'under_cap' | 'over_cap' | 'injection';

interface DemoScenario {
  readonly key: DemoScenarioKey;
  readonly label: string;
  readonly vendor: string;
  readonly invoiceId: string;
  readonly amount: string;
  readonly policyCheck: string;
  readonly verdict: 'APPROVED' | 'HOLD' | 'REJECTED';
  readonly reasonCode: string;
  readonly outcome: string;
}

const DEMO_SCENARIOS: Record<DemoScenarioKey, DemoScenario> = {
  under_cap: {
    key: 'under_cap',
    label: 'Cedar Supply · $64.00',
    vendor: 'Cedar Supply',
    invoiceId: 'INV-3156',
    amount: '$64.00',
    policyCheck: 'Trusted vendor · $64.00 <= $100.00 auto-cap · Non-duplicate',
    verdict: 'APPROVED',
    reasonCode: 'OK_AUTO',
    outcome: 'Capability token minted -> Postgres ledger settled ($64.00)',
  },
  over_cap: {
    key: 'over_cap',
    label: 'Lumen Office · $442.00',
    vendor: 'Lumen Office',
    invoiceId: 'INV-1182',
    amount: '$442.00',
    policyCheck: 'Trusted vendor · $442.00 > $100.00 auto-cap',
    verdict: 'HOLD',
    reasonCode: 'HOLD_OVER_CAP',
    outcome: 'Execution blocked -> Single-use QR approval issued (10m TTL)',
  },
  injection: {
    key: 'injection',
    label: 'Untrusted Prompt · $842.50',
    vendor: 'Aster Cloud',
    invoiceId: 'INV-9901',
    amount: '$842.50',
    policyCheck: 'NFKC + zero-width scan detected "ignore all previous instructions"',
    verdict: 'REJECTED',
    reasonCode: 'REJECT_PROMPT_INJECTION',
    outcome: 'Blocked before model/policy execution -> Logged to audit trail',
  },
};

export function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [previewTab, setPreviewTab] = useState<PreviewTab>('payments');
  const [selectedScenario, setSelectedScenario] = useState<DemoScenarioKey>('over_cap');
  const [demoStep, setDemoStep] = useState<number>(3);
  const [workflowVisible, setWorkflowVisible] = useState(false);
  const workflowRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const el = workflowRef.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setWorkflowVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setWorkflowVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const triggerDemo = (key: DemoScenarioKey) => {
    setSelectedScenario(key);
    setDemoStep(1);
    setTimeout(() => setDemoStep(2), 260);
    setTimeout(() => setDemoStep(3), 560);
  };

  const scenario = DEMO_SCENARIOS[selectedScenario];

  return (
    <div className="min-h-screen bg-[#0b1210] text-[#eaf0eb] selection:bg-[#c8f169] selection:text-[#10170d]">
      {/* Sticky Header */}
      <header className="h-[72px] sticky top-0 z-40 border-b border-[rgba(229,245,232,0.09)] bg-[rgba(11,18,16,0.85)] backdrop-blur-md">
        <nav className="max-w-[1200px] mx-auto px-5 sm:px-7 h-full flex items-center justify-between gap-6" aria-label="Main navigation">
          <Link href="/" className="inline-flex items-center gap-2.5 font-extrabold text-base tracking-[-0.04em]">
            <span className="w-8 h-8 grid place-items-center rounded-[9px] border border-[rgba(200,241,105,0.35)] bg-[rgba(200,241,105,0.08)] text-[#c8f169]">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <span>
              PayGuard
              <small className="block text-[8px] font-medium tracking-[0.12em] uppercase text-[#84938a] mt-0.5">
                Payment control layer
              </small>
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-8 text-xs font-semibold text-[#b3bfb7]">
            <a href="#controls" className="hover:text-[#c8f169] transition-colors">Controls</a>
            <a href="#workflow" className="hover:text-[#c8f169] transition-colors">How it works</a>
            <a href="#architecture" className="hover:text-[#c8f169] transition-colors">Architecture</a>
            <a href="#demo" className="hover:text-[#c8f169] transition-colors">Interactive Demo</a>
          </div>

          <div className="hidden md:flex items-center gap-4 text-[11px] font-bold">
            <Link href="/overview" className="text-[#c0cbc3] hover:text-[#c8f169] transition-colors">
              Overview
            </Link>
            <Link
              href="/payments"
              className="min-h-[40px] inline-flex items-center gap-2 px-4 rounded-[7px] bg-[#c8f169] text-[#10170d] hover:bg-[#d6f68d] transition-all hover:-translate-y-0.5"
            >
              Open workspace
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="md:hidden p-2 rounded-lg border border-[rgba(222,242,227,0.16)] text-[#eaf0eb] hover:border-[#c8f169]"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </nav>

        {/* Keyboard-Accessible Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-[rgba(222,242,227,0.12)] bg-[#111b17] px-5 py-4 space-y-3 text-xs font-semibold">
            <a href="#controls" onClick={() => setMobileMenuOpen(false)} className="block py-1.5 text-[#c0cbc3] hover:text-[#c8f169]">Controls</a>
            <a href="#workflow" onClick={() => setMobileMenuOpen(false)} className="block py-1.5 text-[#c0cbc3] hover:text-[#c8f169]">How it works</a>
            <a href="#architecture" onClick={() => setMobileMenuOpen(false)} className="block py-1.5 text-[#c0cbc3] hover:text-[#c8f169]">Architecture</a>
            <a href="#demo" onClick={() => setMobileMenuOpen(false)} className="block py-1.5 text-[#c0cbc3] hover:text-[#c8f169]">Interactive Demo</a>
            <div className="pt-2 border-t border-[rgba(222,242,227,0.1)] flex items-center gap-3">
              <Link href="/overview" className="flex-1 text-center py-2.5 rounded-lg border border-[rgba(232,243,233,0.2)] text-[#eaf0eb]">
                Overview
              </Link>
              <Link href="/payments" className="flex-1 text-center py-2.5 rounded-lg bg-[#c8f169] text-[#10170d] font-extrabold">
                Open workspace
              </Link>
            </div>
          </div>
        )}
      </header>

      <main id="top">
        {/* Hero Section with Subtle Grid + Ambient Glow + Explorable Preview */}
        <section className="relative isolate overflow-hidden py-16 md:py-24 bg-[radial-gradient(ellipse_at_79%_41%,rgba(52,117,80,0.18),transparent_42%),linear-gradient(180deg,#0b1210_0%,#0c1511_100%)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 opacity-25"
            style={{
              backgroundImage:
                'linear-gradient(rgba(215,240,221,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(215,240,221,0.06) 1px, transparent 1px)',
              backgroundSize: '58px 58px',
            }}
          />

          <div className="max-w-[1200px] mx-auto px-5 sm:px-7 grid grid-cols-1 lg:grid-cols-[0.92fr_1.08fr] gap-12 lg:gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2.5 font-mono text-[10px] tracking-[0.11em] uppercase text-[#c8f169]">
                <span className="w-5 h-px bg-[#c8f169]" />
                Payment control for AI workflows
              </div>
              <h1 className="mt-5 mb-4 text-4xl sm:text-6xl lg:text-[68px] font-bold leading-[0.98] tracking-[-0.055em]">
                Let AI move faster. <span className="text-[#c8f169]">Keep money in check.</span>
              </h1>
              <p className="max-w-[490px] text-sm text-[#a4b1a9] leading-[1.8]">
                PayGuard puts a deterministic policy gate between an agent&apos;s payment proposal and execution. Route exceptions to a person, then keep the decision visible in your ledger.
              </p>

              <div className="flex flex-wrap gap-3 mt-7">
                <a
                  href="#demo"
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-[7px] bg-[#c8f169] text-[#10170d] text-xs font-extrabold hover:bg-[#d6f68d] transition-all hover:-translate-y-0.5"
                >
                  Try interactive demo
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
                <Link
                  href="/payments"
                  className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-[7px] border border-[rgba(232,243,233,0.23)] text-[#eaf0eb] text-xs font-bold hover:bg-white/5 transition-colors"
                >
                  Open live workspace
                </Link>
              </div>

              <div className="flex items-center gap-2.5 mt-7 text-[11px] text-[#829087]">
                <ShieldCheck className="w-4 h-4 text-[#c8f169] shrink-0" />
                <span>
                  <strong className="text-[#cbd5cd] font-semibold">Propose.</strong> Evaluate. Approve. Record.
                </span>
              </div>
            </div>

            {/* Explorable Tilted Dashboard Preview */}
            <div className="relative lg:perspective-[1200px]" id="product">
              <div className="relative overflow-hidden rounded-[13px] border border-[rgba(224,243,227,0.17)] bg-[#101915] shadow-[0_35px_95px_rgba(0,0,0,0.45)] lg:[transform:rotateY(-4deg)_rotateX(2deg)] hover:[transform:rotateY(0)_rotateX(0)] transition-transform duration-500">
                {/* Window Bar + Explorable Tab Switcher */}
                <div className="min-h-[38px] px-3 py-1.5 border-b border-[rgba(222,242,227,0.12)] flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-[#6f8076]">
                  <div className="flex items-center gap-3">
                    <span className="flex gap-1">
                      <i className="w-1.5 h-1.5 rounded-full bg-[#46554b]" />
                      <i className="w-1.5 h-1.5 rounded-full bg-[#46554b]" />
                      <i className="w-1.5 h-1.5 rounded-full bg-[#46554b]" />
                    </span>
                    <span className="hidden sm:inline">PAYGUARD / WORKSPACE</span>
                  </div>
                  <div className="flex items-center gap-1" role="tablist" aria-label="Dashboard preview views">
                    {([
                      ['payments', 'Payments'],
                      ['evidence', 'Invoice Evidence'],
                      ['audit', 'Audit Trail'],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={previewTab === key}
                        onClick={() => setPreviewTab(key)}
                        className={`px-2 py-1 rounded text-[10px] transition-colors ${
                          previewTab === key
                            ? 'bg-[#1c3428] text-[#c8f169] font-medium'
                            : 'text-[#84938a] hover:text-[#eaf0eb]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Explorable Body */}
                <div className="p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-[#eaf0eb]">
                        {previewTab === 'payments'
                          ? 'Payments ledger'
                          : previewTab === 'evidence'
                            ? 'Invoice evidence & quote offsets'
                            : 'Append-only audit trail'}
                      </div>
                      <div className="text-[11px] text-[#84938a]">
                        {previewTab === 'payments'
                          ? 'Deterministic disposition per invoice'
                          : previewTab === 'evidence'
                            ? 'Character-offset quote match & catalog verification'
                            : 'Chronological record of gate verdicts & settlements'}
                      </div>
                    </div>
                    <span className="px-2 py-1 rounded border border-[rgba(222,242,227,0.12)] font-mono text-[9px] text-[#99a89e]">
                      DEMO PREVIEW
                    </span>
                  </div>

                  {previewTab === 'payments' && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="p-2.5 rounded-md border border-[rgba(222,242,227,0.12)] bg-[#131e18]">
                          <span className="text-[10px] text-[#829087]">Needs review</span>
                          <strong className="block mt-1 text-xs font-bold text-[#ffb86b] tabular-nums">1 · $442</strong>
                        </div>
                        <div className="p-2.5 rounded-md border border-[rgba(222,242,227,0.12)] bg-[#131e18]">
                          <span className="text-[10px] text-[#829087]">Awaiting approval</span>
                          <strong className="block mt-1 text-xs font-bold text-[#eaf0eb] tabular-nums">2 bills</strong>
                        </div>
                        <div className="p-2.5 rounded-md border border-[rgba(222,242,227,0.12)] bg-[#131e18]">
                          <span className="text-[10px] text-[#829087]">Auto-executed</span>
                          <strong className="block mt-1 text-xs font-bold text-[#6ee2a8] tabular-nums">3 bills</strong>
                        </div>
                        <div className="p-2.5 rounded-md border border-[rgba(222,242,227,0.12)] bg-[#131e18]">
                          <span className="text-[10px] text-[#829087]">Blocked</span>
                          <strong className="block mt-1 text-xs font-bold text-[#ff8f97] tabular-nums">1 bill</strong>
                        </div>
                      </div>

                      <div className="border border-[rgba(222,242,227,0.12)] rounded-md overflow-hidden bg-[#101914] text-[11px]">
                        <div className="grid grid-cols-[1.3fr_0.8fr_0.7fr_0.75fr] px-3 py-2 border-b border-[rgba(222,242,227,0.12)] font-mono text-[9px] uppercase text-[#6f8075]">
                          <span>Vendor</span><span>Invoice</span><span>Amount</span><span>Status</span>
                        </div>
                        {[
                          ['Aster Cloud', 'INV-2048', '$842.50', 'PAID', 'text-[#84e5b3] bg-[rgba(40,187,131,0.12)]'],
                          ['Lumen Office', 'INV-1182', '$442.00', 'REVIEW', 'text-[#ffc477] bg-[rgba(255,184,107,0.12)]'],
                          ['Cedar Supply', 'INV-3150', '$64.00', 'PAID', 'text-[#84e5b3] bg-[rgba(40,187,131,0.12)]'],
                          ['Bluebird Log.', 'INV-0907', '$117.00', 'ON HOLD', 'text-[#ff959a] bg-[rgba(255,123,130,0.11)]'],
                        ].map(([vendor, inv, amt, st, cls]) => (
                          <div key={inv} className="grid grid-cols-[1.3fr_0.8fr_0.7fr_0.75fr] items-center px-3 py-2 border-b last:border-0 border-[rgba(224,243,227,0.07)] text-[#b8c4bb]">
                            <span className="font-semibold text-[#dce5de] truncate">{vendor}</span>
                            <span className="font-mono text-[10px]">{inv}</span>
                            <span className="font-mono tabular-nums">{amt}</span>
                            <span className={`w-max px-1.5 py-0.5 rounded font-mono text-[9px] ${cls}`}>{st}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {previewTab === 'evidence' && (
                    <div className="space-y-2.5 text-[11px]">
                      <div className="p-3 rounded-md border border-[rgba(222,242,227,0.12)] bg-[#131e18] font-mono text-[10px] text-[#b8c4bb]">
                        <div className="text-[#c8f169] mb-1">quote-matcher.ts · source.slice(24, 52) === exactQuote</div>
                        <div className="text-[#9aa9a0]">&quot;Office Paper Reams x4 @ $16.00 | Total $64.00&quot;</div>
                      </div>
                      <div className="p-3 rounded-md border border-[rgba(200,241,105,0.2)] bg-[rgba(200,241,105,0.05)] flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-[#eaf0eb]">Catalog Price Match: CED-PPR-01</div>
                          <div className="text-[10px] text-[#84938a]">Unit price 1600 minor units verified against owner catalog</div>
                        </div>
                        <span className="font-mono text-[10px] text-[#84e5b3]">GROUNDED</span>
                      </div>
                    </div>
                  )}

                  {previewTab === 'audit' && (
                    <div className="space-y-2 text-[11px]">
                      {[
                        ['HITL_APPROVE', 'INV-2048 · Gate re-ran, decision stood', '$842.50'],
                        ['EXECUTE', 'INV-3150 · Postgres SELECT FOR UPDATE settled', '$64.00'],
                        ['EVALUATE', 'INV-1182 · Held above $100.00 auto-cap', '$442.00'],
                      ].map(([act, msg, amt]) => (
                        <div key={msg} className="p-2.5 rounded-md border border-[rgba(222,242,227,0.12)] bg-[#131e18] flex items-center justify-between gap-2">
                          <div>
                            <span className="font-mono text-[10px] text-[#c8f169] mr-2">{act}</span>
                            <span className="text-[#cbd5cd]">{msg}</span>
                          </div>
                          <span className="font-mono text-[10px] text-[#9aa9a0] shrink-0">{amt}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="p-2.5 rounded-md border border-[rgba(200,241,105,0.18)] bg-[rgba(200,241,105,0.045)] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-[#c8f169] shrink-0" />
                      <div className="text-[11px]">
                        <div className="font-semibold text-[#d8e3d9]">Policy gate · Human review required</div>
                        <div className="text-[10px] text-[#839187]">Amount exceeds the $100.00 auto-execute cap.</div>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-[#c8f169]">HOLD_OVER_CAP</span>
                  </div>
                </div>
              </div>

              {/* Floating Decision Recorded Card */}
              <div className="hidden sm:flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg border border-[rgba(226,244,229,0.17)] bg-[#17231c] shadow-xl absolute -right-3 bottom-6">
                <span className="w-6 h-6 rounded-md bg-[#c8f169] text-[#10170d] grid place-items-center">
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                </span>
                <div className="text-[11px]">
                  <strong className="block text-[#eaf0eb]">Decision recorded</strong>
                  <small className="text-[#95a49a] text-[10px]">Policy outcome · approval trail</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Principles Bar */}
        <div className="border-y border-[rgba(222,242,227,0.12)] bg-[#0e1713]">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-7 py-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
            <div className="text-xs text-[#839188]">Designed to make the boundary between proposal and payment explicit.</div>
            <div className="flex items-center gap-2.5 text-xs font-semibold text-[#cad5cc]">
              <ShieldCheck className="w-4 h-4 text-[#c8f169] shrink-0" />
              Policy-based decisions
            </div>
            <div className="flex items-center gap-2.5 text-xs font-semibold text-[#cad5cc]">
              <Clock className="w-4 h-4 text-[#c8f169] shrink-0" />
              Human approval path
            </div>
            <div className="flex items-center gap-2.5 text-xs font-semibold text-[#cad5cc]">
              <FileText className="w-4 h-4 text-[#c8f169] shrink-0" />
              Inspectable audit history
            </div>
          </div>
        </div>

        {/* 01 Controls */}
        <section id="controls" className="py-20 md:py-24">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-7">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                <div className="font-mono text-[10px] tracking-[0.11em] uppercase text-[#c8f169]">01 / Control surface</div>
                <h2 className="mt-3 text-3xl sm:text-5xl font-bold tracking-[-0.04em]">Autonomy with a clear boundary.</h2>
              </div>
              <p className="max-w-[340px] text-xs text-[#96a49a] leading-relaxed">
                AI can prepare a payment proposal. PayGuard evaluates it against deterministic rules, holds exceptions, and records the outcome.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                ['CONTROL 01', ShieldCheck, 'Rules before execution', 'Check vendor trust, BigInt amount thresholds, and rolling 60m velocity limits before money moves.'],
                ['CONTROL 02', Clock, 'People for the exceptions', 'Hold over-cap or flagged payments for review, then authorize via single-use QR with TOCTOU re-check.'],
                ['CONTROL 03', FileText, 'Evidence with the decision', 'Bring invoice quote offsets, catalog price verification, and Postgres ledger receipts into one trail.'],
              ].map(([idx, Icon, title, desc]) => {
                const IconComp = Icon as typeof ShieldCheck;
                return (
                  <article
                    key={title as string}
                    className="relative overflow-hidden p-6 rounded-[9px] border border-[rgba(222,242,227,0.12)] bg-gradient-to-br from-[#121d17] to-[#0f1713] hover:border-[rgba(200,241,105,0.35)] transition-colors"
                  >
                    <span className="absolute top-6 right-6 font-mono text-[10px] text-[#607066]">{idx as string}</span>
                    <span className="w-9 h-9 rounded-lg border border-[rgba(200,241,105,0.18)] bg-[rgba(200,241,105,0.06)] text-[#c8f169] grid place-items-center">
                      <IconComp className="w-4 h-4" />
                    </span>
                    <h3 className="mt-6 mb-2 text-base font-bold tracking-[-0.02em]">{title as string}</h3>
                    <p className="text-xs text-[#92a097] leading-relaxed">{desc as string}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* 02 Scroll-Animated 4-Step Workflow */}
        <section ref={workflowRef} id="workflow" className="py-20 border-y border-[rgba(222,242,227,0.12)] bg-[#101a15]">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-7">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
              <div>
                <div className="font-mono text-[10px] tracking-[0.11em] uppercase text-[#c8f169]">02 / Decision flow</div>
                <h2 className="mt-3 text-3xl sm:text-5xl font-bold tracking-[-0.04em]">Four steps. One visible trail.</h2>
              </div>
              <p className="max-w-[340px] text-xs text-[#8d9c92] leading-relaxed">
                Keep the proposal, deterministic policy result, capability token, and final Postgres ledger state connected.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-0">
              {[
                ['01 PROPOSE', 'Prepare the payment', 'An agent or operator submits vendor, invoice, and line-item details.'],
                ['02 EVALUATE', 'Run policy checks', 'The gate applies configured rules and returns a clear disposition.'],
                ['03 AUTHORIZE', 'Review exceptions', 'A person reviews and approves held payments via single-use QR.'],
                ['04 RECORD', 'Inspect what happened', 'Postgres SELECT FOR UPDATE ledger and audit trail record the state.'],
              ].map(([stepLabel, title, desc], i) => (
                <article
                  key={stepLabel}
                  style={{ transitionDelay: `${i * 90}ms` }}
                  className={`lg:px-6 lg:first:pl-0 lg:border-l lg:first:border-l-0 border-[rgba(226,244,229,0.14)] transition-all duration-500 ${
                    workflowVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
                  }`}
                >
                  <div className="flex items-center gap-2.5 font-mono text-[10px] text-[#c8f169]">
                    <span>{stepLabel}</span>
                    <span className="h-px flex-1 bg-[rgba(200,241,105,0.25)]" />
                  </div>
                  <h3 className="mt-4 mb-2 text-sm font-bold">{title}</h3>
                  <p className="text-xs text-[#91a096] leading-relaxed">{desc}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 03 Interactive Sample Payment Demo */}
        <section id="demo" className="py-20">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-7">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
              <div>
                <div className="font-mono text-[10px] tracking-[0.11em] uppercase text-[#c8f169]">03 / Interactive demo (Simulated)</div>
                <h2 className="mt-2 text-2xl sm:text-4xl font-bold tracking-[-0.04em]">Trigger a sample payment.</h2>
              </div>
              <span className="px-2.5 py-1 rounded border border-[rgba(200,241,105,0.25)] bg-[rgba(200,241,105,0.06)] font-mono text-[10px] text-[#c8f169] w-max">
                DEMO MODE · No live money moved
              </span>
            </div>

            <div className="p-5 sm:p-6 rounded-xl border border-[rgba(222,242,227,0.15)] bg-[#111b17] space-y-6">
              <div className="flex flex-wrap gap-2.5">
                {(Object.values(DEMO_SCENARIOS)).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => triggerDemo(item.key)}
                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                      selectedScenario === item.key
                        ? 'bg-[#c8f169] text-[#10170d] border-[#c8f169]'
                        : 'bg-[#15211b] text-[#eaf0eb] border-[rgba(222,242,227,0.14)] hover:border-[rgba(200,241,105,0.4)]'
                    }`}
                  >
                    <Play className="w-3 h-3" />
                    {item.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className={`p-4 rounded-lg border transition-opacity duration-300 ${demoStep >= 1 ? 'opacity-100 border-[rgba(222,242,227,0.18)] bg-[#15211b]' : 'opacity-40 border-[rgba(222,242,227,0.08)]'}`}>
                  <div className="font-mono text-[10px] text-[#84938a] mb-1">STEP 1 · PROPOSAL</div>
                  <div className="text-sm font-bold text-[#eaf0eb]">{scenario.vendor} · {scenario.amount}</div>
                  <div className="text-xs text-[#9aa9a0] mt-1 font-mono">{scenario.invoiceId}</div>
                </div>

                <div className={`p-4 rounded-lg border transition-opacity duration-300 ${demoStep >= 2 ? 'opacity-100 border-[rgba(222,242,227,0.18)] bg-[#15211b]' : 'opacity-40 border-[rgba(222,242,227,0.08)]'}`}>
                  <div className="font-mono text-[10px] text-[#84938a] mb-1">STEP 2 · POLICY CHECK</div>
                  <div className="text-xs text-[#dce5de] leading-relaxed">{scenario.policyCheck}</div>
                </div>

                <div className={`p-4 rounded-lg border transition-opacity duration-300 ${demoStep >= 3 ? 'opacity-100 border-[rgba(200,241,105,0.3)] bg-[#15211b]' : 'opacity-40 border-[rgba(222,242,227,0.08)]'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] text-[#84938a]">STEP 3 · DISPOSITION</span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                      scenario.verdict === 'APPROVED'
                        ? 'text-[#84e5b3] bg-[rgba(40,187,131,0.14)]'
                        : scenario.verdict === 'HOLD'
                          ? 'text-[#ffc477] bg-[rgba(255,184,107,0.14)]'
                          : 'text-[#ff959a] bg-[rgba(255,123,130,0.14)]'
                    }`}>
                      {scenario.reasonCode}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-[#eaf0eb] flex items-start gap-1.5 mt-1">
                    {scenario.verdict === 'REJECTED' ? (
                      <ShieldAlert className="w-4 h-4 text-[#ff959a] shrink-0 mt-0.5" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-[#c8f169] shrink-0 mt-0.5" />
                    )}
                    <span>{scenario.outcome}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 04 Real Engineering Evidence & Architecture (Zero Invented Logos) */}
        <section id="architecture" className="py-16 border-t border-[rgba(222,242,227,0.12)] bg-[#0e1713]">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-7 space-y-8">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
              <div>
                <div className="font-mono text-[10px] tracking-[0.11em] uppercase text-[#c8f169]">04 / Verified architecture</div>
                <h2 className="mt-2 text-2xl sm:text-3xl font-bold tracking-[-0.03em]">LLM proposes; deterministic code disposes.</h2>
              </div>
              <Link href="/payments" className="text-xs font-mono text-[#c8f169] hover:underline">
                Inspect live ledger workspace →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {[
                ['1. Untrusted Input Fence', 'NFKC + zero-width normalization + nonce-fenced vendor docs before any model call.'],
                ['2. BigInt + Banker Rounding', 'OrderProposalSchema .strict() + catalog unit-price verification (roundHalfEven).'],
                ['3. WeakSet Capability Token', 'Branded ApprovedForExecution token bound to ownerId, amount, and idempotencyKey.'],
                ['4. Postgres SELECT FOR UPDATE', 'Row-locked atomic settlement + idempotent replay guard + Langfuse telemetry.'],
              ].map(([title, body]) => (
                <div key={title} className="p-4 rounded-lg border border-[rgba(222,242,227,0.12)] bg-[#111b17]">
                  <div className="flex items-center gap-2 font-semibold text-[#eaf0eb] mb-1.5">
                    <Lock className="w-3.5 h-3.5 text-[#c8f169]" />
                    <span>{title}</span>
                  </div>
                  <p className="text-[11px] text-[#9aa9a0] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="py-20">
          <div className="max-w-[1200px] mx-auto px-5 sm:px-7">
            <div className="p-8 sm:p-11 rounded-[10px] border border-[rgba(200,241,105,0.23)] bg-[radial-gradient(ellipse_at_88%_40%,rgba(200,241,105,0.12),transparent_35%),linear-gradient(110deg,#14221a,#101a15)] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
              <div>
                <div className="font-mono text-[10px] tracking-[0.11em] uppercase text-[#c8f169]">PayGuard / Sandbox workspace</div>
                <h2 className="mt-2 text-2xl sm:text-4xl font-bold tracking-[-0.04em]">See the control layer in context.</h2>
                <p className="mt-2 text-xs text-[#9aa99f]">Explore the live ledger, inspect policy verdicts, and test single-use QR approvals.</p>
              </div>
              <Link
                href="/payments"
                className="min-h-[44px] inline-flex items-center gap-2 px-5 rounded-[7px] bg-[#c8f169] text-[#10170d] text-xs font-extrabold hover:bg-[#d6f68d] transition-colors shrink-0"
              >
                Open PayGuard workspace
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[rgba(222,242,227,0.12)]">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-7 py-6 flex flex-wrap items-center justify-between gap-4 text-[11px] text-[#75847a]">
          <span className="font-bold text-[#eaf0eb]">PayGuard</span>
          <span>Payments with a deterministic policy layer.</span>
          <div className="flex gap-5">
            <Link href="/payments" className="hover:text-[#c8f169]">Payments</Link>
            <Link href="/overview" className="hover:text-[#c8f169]">Overview</Link>
            <Link href="/audit" className="hover:text-[#c8f169]">Audit trail</Link>
          </div>
          <span>135 automated tests · TypeScript + Postgres</span>
        </div>
      </footer>
    </div>
  );
}
