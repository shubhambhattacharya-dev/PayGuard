'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ShieldCheck,
  LayoutDashboard,
  CheckCircle2,
  CreditCard,
  CheckSquare,
  Users2,
  History,
  PanelLeftClose,
  LucideIcon,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Overview', href: '/overview', icon: LayoutDashboard },
  { name: 'Payments', href: '/payments', icon: CreditCard },
  { name: 'Approvals', href: '/approvals', icon: CheckSquare },
  { name: 'Evaluations', href: '/evaluations', icon: CheckCircle2 },
  { name: 'Vendors', href: '/vendors', icon: Users2 },
  { name: 'Audit trail', href: '/audit', icon: History },
];

interface SidebarProps {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({ collapsed = false, onToggleCollapse }: SidebarProps = {}) {
  const pathname = usePathname();

  return (
    <aside
      aria-label="Primary workspace sidebar"
      className={`w-full bg-[#101915]/85 backdrop-blur-xl text-[#eaf0eb] border-b md:border-b-0 md:border-r border-[rgba(222,242,227,0.12)] flex flex-col justify-between md:w-56 md:h-screen md:fixed md:left-0 md:top-0 select-none z-30 transition-all duration-300 ease-in-out ${
        collapsed ? 'md:-translate-x-full md:opacity-0 md:pointer-events-none' : 'md:translate-x-0 md:opacity-100'
      }`}
    >
      <div>
        <div className="px-4 h-14 flex items-center justify-between border-b border-[rgba(222,242,227,0.12)]">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[rgba(200,241,105,0.12)] border border-[rgba(200,241,105,0.35)] flex items-center justify-center text-[#c8f169] shadow-sm">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm tracking-tight text-[#eaf0eb]">PayGuard</span>
          </Link>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="hidden md:inline-flex p-1.5 rounded-lg text-[#84938a] hover:text-[#c8f169] hover:bg-[#15211b] transition-colors"
              aria-label="Hide sidebar"
              title="Hide sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        <nav aria-label="Primary navigation" className="flex gap-1 overflow-x-auto px-2.5 py-2.5 md:block md:space-y-1 md:overflow-visible md:py-4">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href) || (item.href === '/payments' && pathname === '/');
            const Icon = item.icon;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex shrink-0 items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] transition-all ${
                  isActive
                    ? 'bg-[#1c3428]/90 text-[#eaf0eb] font-semibold shadow-sm ring-1 ring-[rgba(200,241,105,0.22)]'
                    : 'text-[#9aa9a0] font-medium hover:text-[#eaf0eb] hover:bg-[#15211b]/80'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#c8f169]' : 'text-[#6e7d74]'}`} />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="hidden md:block p-3 space-y-2.5 border-t border-[rgba(222,242,227,0.12)]">
        <div className="p-3 rounded-xl bg-[#15211b]/80 backdrop-blur-md border border-[rgba(222,242,227,0.1)] space-y-2 text-[11px]">
          <div className="flex items-center justify-between text-[#9aa9a0]">
            <span>Auto-execute cap</span>
            <span className="font-mono font-semibold text-[#eaf0eb]">$100.00</span>
          </div>
          <div className="flex items-center justify-between text-[#9aa9a0]">
            <span>Velocity (60m)</span>
            <span className="font-mono font-semibold text-[#eaf0eb]">$200.00</span>
          </div>
          <div className="flex items-center justify-between text-[#9aa9a0]">
            <span>Gate version</span>
            <span className="font-mono text-[#c8f169]">v2026.11</span>
          </div>
        </div>
        <Link
          href="/"
          className="block text-center py-1.5 rounded-lg border border-[rgba(222,242,227,0.12)] text-[11px] font-medium text-[#9aa9a0] hover:text-[#c8f169] hover:border-[rgba(200,241,105,0.3)] transition-colors"
        >
          ← Back to landing page
        </Link>
      </div>
    </aside>
  );
}
