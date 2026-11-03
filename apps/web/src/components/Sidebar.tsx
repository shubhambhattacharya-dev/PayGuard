'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShieldCheck,
  Building2,
  LayoutDashboard,
  CheckCircle2,
  CreditCard,
  CheckSquare,
  Users2,
  History,
  ChevronDown,
  LucideIcon,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Overview', href: '/overview', icon: LayoutDashboard },
  { name: 'Evaluations', href: '/evaluations', icon: CheckCircle2 },
  { name: 'Payments', href: '/payments', icon: CreditCard },
  { name: 'Approvals', href: '/approvals', icon: CheckSquare },
  { name: 'Vendors', href: '/vendors', icon: Users2 },
  { name: 'Audit trail', href: '/audit', icon: History },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-forest-900 text-white flex flex-col justify-between h-screen fixed left-0 top-0 select-none z-30">
      {/* Top Branding & Workspace */}
      <div>
        {/* Brand */}
        <div className="p-5 flex items-center gap-3 border-b border-forest-850">
          <div className="w-9 h-9 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <div className="font-semibold text-sm leading-tight text-white tracking-tight">PayGuard</div>
            <div className="text-xs text-emerald-400 font-medium">Payments</div>
          </div>
        </div>

        {/* Workspace Selector */}
        <div className="px-3 pt-3">
          <button className="w-full flex items-center justify-between p-2.5 rounded-lg bg-forest-850/60 hover:bg-forest-850 border border-forest-800/80 text-left transition-colors">
            <div className="flex items-center gap-2.5">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <span className="text-xs font-medium text-slate-100">Northstar Finance</span>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="px-3 pt-5 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href) || (item.href === '/payments' && pathname === '/');
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-forest-800 text-white border-l-2 border-emerald-400 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-forest-850/50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User Avatar at Bottom */}
      <div className="p-3 border-t border-forest-850">
        <button className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-forest-850/60 transition-colors">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-forest-700 border border-forest-600 flex items-center justify-center text-xs font-semibold text-emerald-200">
              JD
            </div>
            <div className="text-left">
              <div className="text-xs font-medium text-slate-100 leading-tight">Jordan Diaz</div>
              <div className="text-[11px] text-slate-400">Finance Admin</div>
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    </aside>
  );
}
