import React from 'react';

export function KeyboardShortcutsBar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-64 2xl:right-96 bg-white/95 backdrop-blur-xs border-t border-surface-border px-3 sm:px-6 2xl:px-8 py-2.5 flex items-center gap-4 sm:gap-6 overflow-x-auto text-xs text-slate-500 z-10 select-none">
      <span className="hidden sm:inline font-medium text-slate-700">Keyboard shortcuts</span>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 border border-slate-300 rounded text-slate-700 shadow-2xs">
          /
        </kbd>
        <span>Search</span>
      </div>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 border border-slate-300 rounded text-slate-700 shadow-2xs">
          A
        </kbd>
        <span>Approve</span>
      </div>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 border border-slate-300 rounded text-slate-700 shadow-2xs">
          R
        </kbd>
        <span>Reject</span>
      </div>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-slate-100 border border-slate-300 rounded text-slate-700 shadow-2xs">
          Q
        </kbd>
        <span>QR</span>
      </div>
    </div>
  );
}
