import React from 'react';

export function KeyboardShortcutsBar() {
  return (
    <div className="fixed bottom-0 left-64 right-80 lg:right-96 bg-white/95 backdrop-blur-xs border-t border-surface-border px-8 py-2.5 flex items-center gap-6 text-xs text-slate-500 z-10 select-none">
      <span className="font-medium text-slate-700">Keyboard shortcuts</span>
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
