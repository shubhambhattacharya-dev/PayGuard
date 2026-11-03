'use client';

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, ShieldCheck, Clock, CheckCircle2 } from 'lucide-react';

interface QrApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  singleUseCode: string;
  vendorName: string;
  amountFormatted: string;
  onApproveSuccess: () => void;
}

export function QrApprovalModal({
  isOpen,
  onClose,
  singleUseCode,
  vendorName,
  amountFormatted,
  onApproveSuccess,
}: QrApprovalModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState(598); // 09:58

  useEffect(() => {
    if (!isOpen) return;

    // Generate real QR code image
    const approvalUrl = `https://payguard.sandbox.app/approve?t=${singleUseCode}&nonce=${Date.now()}`;
    QRCode.toDataURL(approvalUrl, { width: 180, margin: 1 })
      .then((url) => setQrDataUrl(url))
      .catch((err) => console.error('Failed to generate QR', err));

    const timer = setInterval(() => {
      setTimeLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, singleUseCode]);

  if (!isOpen) return null;

  const minutes = Math.floor(timeLeft / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (timeLeft % 60).toString().padStart(2, '0');

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-surface-border relative animate-scale-up">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-emerald-600" />
          <h3 className="font-semibold text-sm text-slate-900">One-time mobile approval</h3>
        </div>
        <p className="text-xs text-slate-500 mb-5">
          Scan with your phone camera to review and authorize. Full policy gate re-validates at scan time.
        </p>

        {/* Invoice Summary Box */}
        <div className="bg-surface-subtle p-3 rounded-lg flex items-center justify-between mb-4 border border-surface-border">
          <div>
            <div className="text-xs font-medium text-slate-800">{vendorName}</div>
            <div className="text-[11px] text-slate-500">Single-use nonce</div>
          </div>
          <div className="text-sm font-semibold text-slate-900">{amountFormatted}</div>
        </div>

        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center py-2 mb-4 bg-white rounded-xl border border-dashed border-slate-200">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="Approval QR Code" className="w-40 h-40 rounded-lg shadow-sm" />
          ) : (
            <div className="w-40 h-40 bg-slate-100 animate-pulse rounded-lg flex items-center justify-center text-xs text-slate-400">
              Generating QR...
            </div>
          )}

          <div className="mt-3 text-center">
            <span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-1 rounded">
              {singleUseCode}
            </span>
          </div>
        </div>

        {/* Timer */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-amber-700 font-medium mb-5 bg-amber-50 py-1.5 rounded-lg border border-amber-200/60">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>
            Expires in {minutes}:{seconds}
          </span>
        </div>

        {/* Quick Demo Simulate Scan Button */}
        <button
          onClick={() => {
            onApproveSuccess();
            onClose();
          }}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs py-2.5 rounded-lg shadow transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>Simulate mobile scan approval</span>
        </button>
      </div>
    </div>
  );
}
