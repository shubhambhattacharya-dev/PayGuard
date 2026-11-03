import React from 'react';
import { FileText, Clock, CheckCircle2, Ban, LucideIcon } from 'lucide-react';

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

export function KpiStrip() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 mb-6">
      <KpiCard
        label="Needs review"
        countText="2 bills · $1,284.50"
        icon={FileText}
        accentColor="amber"
      />
      <KpiCard
        label="Awaiting approval"
        countText="2 bills · $1,284.50"
        icon={Clock}
        accentColor="blue"
      />
      <KpiCard
        label="Auto-executed"
        countText="8 bills"
        icon={CheckCircle2}
        accentColor="green"
      />
      <KpiCard
        label="Blocked by policy"
        countText="2 bills"
        icon={Ban}
        accentColor="red"
      />
    </div>
  );
}
