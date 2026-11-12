import React from 'react';
import { FileText, Clock, CheckCircle2, Ban, LucideIcon } from 'lucide-react';
import { Transaction } from '../lib/types';

interface KpiCardProps {
  label: string;
  countText: string;
  icon: LucideIcon;
  accentColor: 'amber' | 'blue' | 'green' | 'red';
}

function KpiCard({ label, countText, icon: Icon, accentColor }: KpiCardProps) {
  const colorMap = {
    amber: {
      bg: 'bg-amber-50/60 border-amber-100',
      iconBg: 'bg-amber-100 text-amber-700',
    },
    blue: {
      bg: 'bg-sky-50/60 border-sky-100',
      iconBg: 'bg-sky-100 text-sky-700',
    },
    green: {
      bg: 'bg-emerald-50/60 border-emerald-100',
      iconBg: 'bg-emerald-100 text-emerald-700',
    },
    red: {
      bg: 'bg-rose-50/60 border-rose-100',
      iconBg: 'bg-rose-100 text-rose-700',
    },
  };

  const style = colorMap[accentColor];

  return (
    <div className={`p-4 rounded-xl border bg-white shadow-sm flex items-start gap-3.5 hover:shadow transition-shadow`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${style.iconBg}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-xs font-medium text-slate-500 mb-0.5">{label}</div>
        <div className="text-sm font-semibold text-slate-900 tracking-tight">{countText}</div>
      </div>
    </div>
  );
}

function formatMinorUsd(minor: number): string {
  return `$${(minor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function KpiStrip({ transactions }: { transactions?: Transaction[] }) {
  let needsReviewText = '2 bills · $1,284.50';
  let awaitingApprovalText = '2 bills · $1,284.50';
  let autoExecutedText = '8 bills';
  let blockedText = '2 bills';

  if (transactions) {
    const reviewRows = transactions.filter((t) => t.status === 'Review required');
    const holdRows = transactions.filter((t) => t.status === 'Review required' || t.status === 'On hold');
    const paidRows = transactions.filter((t) => t.status === 'Paid');
    const blockedRows = transactions.filter((t) => t.status === 'Blocked');

    const reviewTotal = reviewRows.reduce((sum, t) => sum + t.amountMinor, 0);
    const holdTotal = holdRows.reduce((sum, t) => sum + t.amountMinor, 0);

    needsReviewText = `${reviewRows.length} ${reviewRows.length === 1 ? 'bill' : 'bills'} · ${formatMinorUsd(reviewTotal)}`;
    awaitingApprovalText = `${holdRows.length} ${holdRows.length === 1 ? 'bill' : 'bills'} · ${formatMinorUsd(holdTotal)}`;
    autoExecutedText = `${paidRows.length} ${paidRows.length === 1 ? 'bill' : 'bills'}`;
    blockedText = `${blockedRows.length} ${blockedRows.length === 1 ? 'bill' : 'bills'}`;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
      <KpiCard
        label="Needs review"
        countText={needsReviewText}
        icon={FileText}
        accentColor="amber"
      />
      <KpiCard
        label="Awaiting approval"
        countText={awaitingApprovalText}
        icon={Clock}
        accentColor="blue"
      />
      <KpiCard
        label="Auto-executed"
        countText={autoExecutedText}
        icon={CheckCircle2}
        accentColor="green"
      />
      <KpiCard
        label="Blocked by policy"
        countText={blockedText}
        icon={Ban}
        accentColor="red"
      />
    </div>
  );
}
