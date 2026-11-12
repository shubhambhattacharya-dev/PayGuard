'use client';

import React from 'react';
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
  return (
    <div className="min-h-screen bg-surface-canvas flex flex-col md:flex-row">
      <Sidebar />
      <div className="flex-1 md:ml-64 flex flex-col min-h-screen min-w-0">
        <Header toastMessage={toastMessage} onDismissToast={onDismissToast} />
        <main className="flex-1 p-4 sm:p-6 md:p-8 pb-16 overflow-y-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
            <p className="text-xs text-slate-500 font-normal mt-0.5">{subtitle}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

