import React from 'react';
import { FileText, Clock, CheckCircle2, Ban, LucideIcon } from 'lucide-react';
import { Transaction } from '../lib/types';

interface KpiCardProps {
  label: string;
  countText: string;
  icon: LucideIcon;
  accentColor: 'amber' | 'blue' | 'green' | 'red';
}

function KpiCard({ label, countText, accentColor }: KpiCardProps) {
  const dotMap = {
    amber: 'bg-[#ffb86b]',
    blue: 'bg-sky-400',
    green: 'bg-[#c8f169]',
    red: 'bg-[#ff7b82]',
  };

  return (
    <div className="p-4 rounded-2xl border border-[rgba(222,242,227,0.12)] bg-[#111b17]/80 backdrop-blur-xl shadow-sm flex flex-col justify-between gap-2 transition-all hover:border-[rgba(200,241,105,0.28)]">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotMap[accentColor]}`} />
        <span className="text-xs font-medium text-[#9aa9a0]">{label}</span>
      </div>
      <div className="text-base font-semibold text-[#eaf0eb] tracking-tight tabular-nums">
        {countText}
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
