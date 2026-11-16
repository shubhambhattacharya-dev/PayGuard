'use client';

import React from 'react';

interface SkeletonBlockProps {
  className?: string;
}

export function SkeletonBlock({ className = '' }: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={`pg-skeleton rounded-md bg-surface-subtle ${className}`}
    />
  );
}

export function LedgerWorkspaceSkeleton() {
  return (
    <div aria-label="Loading payments workspace" role="status" className="space-y-6">
      {/* KPI Strip Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="bg-[#111b17] rounded-xl border border-[rgba(222,242,227,0.12)] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-6 w-6 rounded-lg" />
            </div>
            <SkeletonBlock className="h-7 w-28" />
            <SkeletonBlock className="h-3 w-36" />
          </div>
        ))}
      </div>

      {/* Live Gate Bar Skeleton */}
      <div className="bg-[#111b17] rounded-xl border border-[rgba(222,242,227,0.12)] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <SkeletonBlock className="h-4 w-44" />
          <SkeletonBlock className="h-3 w-72" />
        </div>
        <div className="flex items-center gap-2">
          <SkeletonBlock className="h-9 w-32 rounded-lg" />
          <SkeletonBlock className="h-9 w-28 rounded-lg" />
        </div>
      </div>

      {/* Ledger Grid Skeleton */}
      <div className="bg-[#111b17] rounded-xl border border-[rgba(222,242,227,0.12)] overflow-hidden">
        <div className="h-11 px-4 border-b border-[rgba(222,242,227,0.12)] flex items-center justify-between bg-[#101914]">
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-3 w-20" />
          <SkeletonBlock className="h-3 w-16" />
          <SkeletonBlock className="h-3 w-24" />
          <SkeletonBlock className="h-3 w-20" />
        </div>
        <div className="divide-y divide-surface-border">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div key={idx} className="h-[52px] px-4 flex items-center justify-between gap-4">
              <SkeletonBlock className="h-4 w-32" />
              <SkeletonBlock className="h-4 w-20" />
              <SkeletonBlock className="h-4 w-16" />
              <SkeletonBlock className="h-6 w-24 rounded-full" />
              <SkeletonBlock className="h-4 w-24" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuditListSkeleton() {
  return (
    <div
      aria-label="Loading audit trail"
      role="status"
      className="bg-[#111b17] rounded-xl border border-[rgba(222,242,227,0.12)] divide-y divide-[rgba(222,242,227,0.12)]"
    >
      {Array.from({ length: 5 }).map((_, idx) => (
        <div key={idx} className="p-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            <SkeletonBlock className="w-4 h-4 rounded-full mt-0.5 shrink-0" />
            <div className="space-y-2 flex-1 max-w-xl">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-3.5 w-20" />
                <SkeletonBlock className="h-4 w-28" />
                <SkeletonBlock className="h-3 w-36" />
              </div>
              <SkeletonBlock className="h-3 w-3/4" />
            </div>
          </div>
          <div className="space-y-1.5 text-right shrink-0">
            <SkeletonBlock className="h-4 w-16 ml-auto" />
            <SkeletonBlock className="h-3 w-28 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  );
}
