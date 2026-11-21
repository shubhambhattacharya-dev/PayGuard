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
  expiresAtMs?: number;
  expiresInSeconds?: number;
  onApproveSuccess: (toastMessage?: string) => void;
}

const API_URL = '/api/payguard';

export function QrApprovalModal({
  isOpen,
  onClose,
  singleUseCode,
  vendorName,
  amountFormatted,
  expiresAtMs,
  expiresInSeconds = 600,
  onApproveSuccess,
}: QrApprovalModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [timeLeft, setTimeLeft] = useState(expiresInSeconds);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const initialRemaining = expiresAtMs
      ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
      : expiresInSeconds;
    setTimeLeft(initialRemaining);
    setErrorMsg(null);

    // Generate real QR code image pointing to the live /approvals page
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    const approvalUrl = `${origin}/approvals?code=${encodeURIComponent(singleUseCode)}`;
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
    <div className="fixed inset-0 bg-[#0b1210]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        className="bg-[#111b17] rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-[rgba(222,242,227,0.16)] relative text-[#eaf0eb]"
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-[#9aa9a0] hover:text-[#c8f169] p-1 rounded-lg transition-colors"
          aria-label="Close modal"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title */}
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck className="w-5 h-5 text-[#c8f169]" />
          <h3 id="qr-modal-title" className="font-semibold text-sm text-[#eaf0eb]">
            One-time mobile approval
          </h3>
        </div>
        <p className="text-xs text-[#9aa9a0] leading-relaxed mb-5">
          Scan with your phone camera to review and authorize. Full policy gate re-validates at scan time.
        </p>

        {/* Invoice Summary Box */}
        <div className="bg-[#15211b] p-3 rounded-lg flex items-center justify-between mb-4 border border-[rgba(222,242,227,0.12)]">
          <div>
            <div className="text-xs font-medium text-[#eaf0eb]">{vendorName}</div>
            <div className="text-[11px] text-[#9aa9a0]">Single-use nonce</div>
          </div>
          <div className="text-sm font-semibold text-[#eaf0eb] tabular-nums">{amountFormatted}</div>
        </div>

        {/* QR Code Container (white scan-pad inside dark frame for reliable camera contrast) */}
        <div className="flex flex-col items-center justify-center py-4 mb-4 bg-[#15211b] rounded-xl border border-dashed border-[rgba(222,242,227,0.18)]">
          {qrDataUrl ? (
            <div className="p-2 bg-white rounded-xl shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Approval QR Code" className="w-36 h-36 rounded-md" />
            </div>
          ) : (
            <div className="w-40 h-40 pg-skeleton rounded-lg flex items-center justify-center text-xs text-[#9aa9a0]">
              Generating QR...
            </div>
          )}

          <div className="mt-3 text-center">
            <span className="font-mono text-xs font-semibold text-[#c8f169] bg-[#0b1210] border border-[rgba(200,241,105,0.25)] px-2.5 py-1 rounded">
              {singleUseCode}
            </span>
          </div>
        </div>

        {/* Timer */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-[#ffc477] font-medium mb-5 bg-[rgba(255,184,107,0.12)] py-1.5 rounded-lg border border-[rgba(255,184,107,0.28)] tabular-nums">
          <Clock className="w-3.5 h-3.5 text-[#ffc477]" />
          <span>
            Expires in {minutes}:{seconds}
          </span>
        </div>

        {errorMsg && (
          <div className="mb-3 p-2.5 rounded-lg bg-[rgba(255,123,130,0.12)] border border-[rgba(255,123,130,0.3)] text-[#ff959a] text-xs">
            {errorMsg}
          </div>
        )}

        {/* Live API QR Scan Approval Button */}
        <button
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            setErrorMsg(null);
            try {
              const res = await fetch(`${API_URL}/v1/hitl/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ singleUseCode }),
              });
              const data = (await res.json()) as {
                success?: boolean;
                toastMessage?: string;
                error?: string;
              };
              if (!res.ok || !data.success) {
                setErrorMsg(data.toastMessage ?? data.error ?? `HTTP ${res.status}`);
                return;
              }
              onApproveSuccess(data.toastMessage ?? 'Gate re-ran, decision stood');
              onClose();
            } catch {
              setErrorMsg('API unreachable — start @payguard/api on port 4000');
            } finally {
              setSubmitting(false);
            }
          }}
          className="w-full flex items-center justify-center gap-2 bg-[#c8f169] hover:bg-[#d6f68d] disabled:opacity-60 text-[#10170d] font-bold text-xs py-2.5 rounded-lg transition-colors"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>{submitting ? 'Re-running policy gate...' : 'Authorize via /v1/hitl/approve'}</span>
        </button>
      </div>
    </div>
  );
}
