import React from 'react';

export function KeyboardShortcutsBar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 md:left-56 2xl:right-96 bg-[#101915]/95 backdrop-blur-md border-t border-[rgba(222,242,227,0.12)] px-3 sm:px-6 2xl:px-8 py-2.5 flex items-center gap-4 sm:gap-6 overflow-x-auto text-xs text-[#9aa9a0] z-10 select-none">
      <span className="hidden sm:inline font-medium text-[#eaf0eb]">Keyboard shortcuts</span>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#15211b] border border-[rgba(222,242,227,0.18)] rounded text-[#c8f169]">
          /
        </kbd>
        <span>Search</span>
      </div>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#15211b] border border-[rgba(222,242,227,0.18)] rounded text-[#c8f169]">
          A
        </kbd>
        <span>Approve</span>
      </div>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#15211b] border border-[rgba(222,242,227,0.18)] rounded text-[#c8f169]">
          R
        </kbd>
        <span>Reject</span>
      </div>
      <div className="flex items-center gap-1.5">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#15211b] border border-[rgba(222,242,227,0.18)] rounded text-[#c8f169]">
          Q
        </kbd>
        <span>QR</span>
      </div>
    </div>
  );
}
