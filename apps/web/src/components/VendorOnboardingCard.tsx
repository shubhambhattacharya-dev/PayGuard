'use client';

import React, { useState } from 'react';
import {
  VendorOnboardingFormSchema,
  OtpSixDigitSchema,
  extractFieldErrors,
} from '@payguard/contracts';
import { CheckCircle2, MessageSquare, ShieldCheck } from 'lucide-react';

const API_URL = '/api/payguard';

function parseUsdToMinor(usd: string): number | undefined {
  const trimmed = usd.trim();
  if (!trimmed) return undefined;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return undefined;
  return Number.parseInt(match[1] ?? '0', 10) * 100 + Number.parseInt((match[2] ?? '').padEnd(2, '0'), 10);
}

interface VendorOnboardingCardProps {
  onVendorVerified?: () => void;
}

export function VendorOnboardingCard({ onVendorVerified }: VendorOnboardingCardProps) {
  const [vendorName, setVendorName] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('+919876543210');
  const [itemName, setItemName] = useState('');
  const [unitPriceUsd, setUnitPriceUsd] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [whatsappPreview, setWhatsappPreview] = useState<string | null>(null);
  const [sandboxOtp, setSandboxOtp] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [busy, setBusy] = useState<'request' | 'verify' | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [verifiedSuccess, setVerifiedSuccess] = useState<string | null>(null);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setApiError(null);
    setVerifiedSuccess(null);

    const parsed = VendorOnboardingFormSchema.safeParse({
      vendorName,
      whatsappNumber,
      itemName,
      unitPriceUsd,
    });
    if (!parsed.success) {
      setFieldErrors(extractFieldErrors(parsed.error));
      return;
    }
    setFieldErrors({});
    setBusy('request');
    try {
      const priceMinor = parseUsdToMinor(unitPriceUsd);
      const res = await fetch(`${API_URL}/v1/vendors/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorName: parsed.data.vendorName,
          whatsappNumber: parsed.data.whatsappNumber,
          ...(parsed.data.itemName && parsed.data.itemName.length > 0 && priceMinor
            ? { itemName: parsed.data.itemName, unitPriceMinor: priceMinor }
            : {}),
        }),
      });
      const body = (await res.json()) as {
        challengeId?: string;
        sandboxOtpPreview?: string;
        whatsappMessagePreview?: string;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.challengeId) {
        setApiError(
          body.error === 'LOGIN_REQUIRED'
            ? 'View-only mode — click "View-Only · Unlock Approver" in the top bar first to verify vendors.'
            : (body.detail ?? body.error ?? `HTTP ${res.status}`),
        );
        return;
      }
      setChallengeId(body.challengeId);
      setSandboxOtp(body.sandboxOtpPreview ?? null);
      setWhatsappPreview(body.whatsappMessagePreview ?? null);
      setOtpInput(body.sandboxOtpPreview ?? '');
    } catch {
      setApiError('API unreachable — could not send verification OTP.');
    } finally {
      setBusy(null);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challengeId) return;
    setApiError(null);

    const otpCheck = OtpSixDigitSchema.safeParse(otpInput);
    if (!otpCheck.success) {
      setFieldErrors({ otp: otpCheck.error.issues[0]?.message ?? 'Enter 6-digit OTP' });
      return;
    }
    setFieldErrors({});
    setBusy('verify');
    try {
      const res = await fetch(`${API_URL}/v1/vendors/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeId, otp: otpCheck.data }),
      });
      const body = (await res.json()) as {
        success?: boolean;
        vendor?: { name: string };
        catalogItem?: { sku: string; name: string };
        error?: string;
        detail?: string;
      };
      if (!res.ok || !body.success) {
        setApiError(body.detail ?? body.error ?? `Verification failed (HTTP ${res.status})`);
        return;
      }
      const itemInfo = body.catalogItem ? ` + catalog item "${body.catalogItem.name}" (${body.catalogItem.sku})` : '';
      setVerifiedSuccess(`"${body.vendor?.name}" is now a Verified Trusted Vendor${itemInfo}!`);
      setChallengeId(null);
      setSandboxOtp(null);
      setWhatsappPreview(null);
      setVendorName('');
      setItemName('');
      setUnitPriceUsd('');
      setOtpInput('');
      onVendorVerified?.();
    } catch {
      setApiError('API unreachable — could not verify OTP.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mb-6 p-5 rounded-2xl border border-[rgba(222,242,227,0.12)] bg-[#111b17]/85">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="w-4 h-4 text-[#c8f169]" />
        <h2 className="text-sm font-semibold text-[#eaf0eb]">Verify &amp; Trust a New Vendor (Free WhatsApp Sandbox OTP)</h2>
      </div>
      <p className="text-[11px] text-[#9aa9a0] mb-4">
        Want to make an unknown vendor trusted? Validate their details with Zod and complete the free 6-digit WhatsApp Sandbox OTP check.
      </p>

      {apiError && (
        <div className="mb-3 p-2.5 rounded-xl bg-[rgba(255,123,130,0.12)] border border-[rgba(255,123,130,0.3)] text-xs text-[#ff959a]">
          {apiError}
        </div>
      )}

      {verifiedSuccess && (
        <div className="mb-3 p-3 rounded-xl bg-[rgba(40,187,131,0.14)] border border-[rgba(40,187,131,0.3)] text-xs text-[#84e5b3] flex items-center gap-2 font-medium">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{verifiedSuccess}</span>
        </div>
      )}

      <form onSubmit={requestOtp} className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <div className="md:col-span-4">
          <label htmlFor="kyc-vendor" className="block text-xs font-medium text-[#dce5de] mb-1">
            Vendor Name
          </label>
          <input
            id="kyc-vendor"
            type="text"
            value={vendorName}
            onChange={(e) => {
              setVendorName(e.target.value);
              setFieldErrors((prev) => ({ ...prev, vendorName: '' }));
            }}
            placeholder="e.g. Shubham Cloud Services"
            className="w-full text-xs px-3 py-2.5 rounded-xl bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] placeholder:text-[#6e7d74] focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
          />
          {fieldErrors.vendorName && <p className="mt-1 text-[11px] text-[#ff959a]">{fieldErrors.vendorName}</p>}
        </div>

        <div className="md:col-span-3">
          <label htmlFor="kyc-whatsapp" className="block text-xs font-medium text-[#dce5de] mb-1">
            WhatsApp Number
          </label>
          <input
            id="kyc-whatsapp"
            type="tel"
            value={whatsappNumber}
            onChange={(e) => {
              setWhatsappNumber(e.target.value);
              setFieldErrors((prev) => ({ ...prev, whatsappNumber: '' }));
            }}
            placeholder="+919876543210"
            className="w-full text-xs px-3 py-2.5 rounded-xl bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] font-mono placeholder:text-[#6e7d74] focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
          />
          {fieldErrors.whatsappNumber && (
            <p className="mt-1 text-[11px] text-[#ff959a]">{fieldErrors.whatsappNumber}</p>
          )}
        </div>

        <div className="md:col-span-3">
          <label htmlFor="kyc-item" className="block text-xs font-medium text-[#dce5de] mb-1">
            Catalog Item <span className="text-[#6e7d74] font-normal">(optional)</span>
          </label>
          <input
            id="kyc-item"
            type="text"
            value={itemName}
            onChange={(e) => {
              setItemName(e.target.value);
              setFieldErrors((prev) => ({ ...prev, itemName: '' }));
            }}
            placeholder="e.g. API Credits Pack"
            className="w-full text-xs px-3 py-2.5 rounded-xl bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] placeholder:text-[#6e7d74] focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
          />
          {fieldErrors.itemName && <p className="mt-1 text-[11px] text-[#ff959a]">{fieldErrors.itemName}</p>}
        </div>

        <div className="md:col-span-2">
          <label htmlFor="kyc-price" className="block text-xs font-medium text-[#dce5de] mb-1">
            Price ($) <span className="text-[#6e7d74] font-normal">(opt)</span>
          </label>
          <input
            id="kyc-price"
            type="text"
            value={unitPriceUsd}
            onChange={(e) => {
              setUnitPriceUsd(e.target.value);
              setFieldErrors((prev) => ({ ...prev, unitPriceUsd: '' }));
            }}
            placeholder="45.00"
            className="w-full text-xs px-3 py-2.5 rounded-xl bg-[#0b1210] border border-[rgba(222,242,227,0.18)] text-[#eaf0eb] font-mono placeholder:text-[#6e7d74] focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
          />
          {fieldErrors.unitPriceUsd && <p className="mt-1 text-[11px] text-[#ff959a]">{fieldErrors.unitPriceUsd}</p>}
        </div>

        <div className="md:col-span-12">
          <button
            type="submit"
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl bg-[#1c3428] border border-[rgba(200,241,105,0.35)] text-[#c8f169] hover:bg-[#234232] disabled:opacity-50 transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>{busy === 'request' ? 'Sending OTP…' : 'Send Free WhatsApp Verification OTP'}</span>
          </button>
        </div>
      </form>

      {challengeId && (
        <form onSubmit={verifyOtp} className="mt-4 p-3.5 rounded-xl bg-[#15211b] border border-[rgba(40,187,131,0.35)] space-y-2.5">
          <div className="text-xs text-[#84e5b3] font-medium flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 shrink-0" />
            <span>Free Sandbox WhatsApp Simulator: {whatsappPreview}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              maxLength={6}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value)}
              placeholder="6-digit OTP"
              aria-label="6-digit vendor OTP"
              className="w-36 text-xs px-3 py-2 rounded-xl bg-[#0b1210] border border-[rgba(222,242,227,0.2)] text-[#eaf0eb] font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-[#c8f169]"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="text-xs font-bold px-4 py-2 rounded-xl bg-[#c8f169] text-[#10170d] hover:bg-[#d6f68d] disabled:opacity-50"
            >
              {busy === 'verify' ? 'Verifying…' : 'Verify OTP & Trust Vendor'}
            </button>
            {sandboxOtp && (
              <span className="text-[11px] text-[#9aa9a0]">
                (Auto-filled sandbox code <code className="font-mono text-[#c8f169]">{sandboxOtp}</code> · 5m TTL)
              </span>
            )}
          </div>
          {fieldErrors.otp && <p className="text-[11px] text-[#ff959a]">{fieldErrors.otp}</p>}
        </form>
      )}
    </div>
  );
}
