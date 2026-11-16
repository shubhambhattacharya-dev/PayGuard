'use client';

import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

interface AppShellProps {
  title: string;
  subtitle: string;
  toastMessage?: string | null;
  onDismissToast?: () => void;
  children: React.ReactNode;
}

export function AppShell({ title, subtitle, toastMessage, onDismissToast, children }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col md:flex-row">
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed((c) => !c)} />
      <div
        className={`flex-1 flex flex-col min-h-screen min-w-0 transition-[margin] duration-200 ease-out ${
          sidebarCollapsed ? 'md:ml-0' : 'md:ml-56'
        }`}
      >
        <Header
          toastMessage={toastMessage}
          onDismissToast={onDismissToast}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((c) => !c)}
        />
        <main className="flex-1 p-4 sm:p-6 md:p-8 pb-16 overflow-y-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-[#eaf0eb] tracking-tight">{title}</h1>
            <p className="text-xs text-[#9aa9a0] font-normal mt-0.5">{subtitle}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

