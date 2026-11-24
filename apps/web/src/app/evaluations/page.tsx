'use client';

import React, { useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { LiveGatePanel } from '../../components/LiveGatePanel';
import { VendorOnboardingCard } from '../../components/VendorOnboardingCard';

export default function EvaluationsPage() {
  const [refreshCounter, setRefreshCounter] = useState(0);

  return (
    <AppShell
      title="Evaluations"
      subtitle="Simple Zod-validated invoice form — pick from trusted vendors/items or type your own, test prompt injections, and verify new vendors via free WhatsApp Sandbox OTP."
    >
      <LiveGatePanel
        showBankTamperOption={true}
        refreshKey={refreshCounter}
      />

      <VendorOnboardingCard
        onVendorVerified={() => setRefreshCounter((c) => c + 1)}
      />
    </AppShell>
  );
}
