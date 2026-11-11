# PayGuard Persistent Memory: Unmet Hackathon Rules & UI-to-Backend Feature Gaps

**Saved At**: 2026-11-10T00:09:30+05:30  
**Submission Target**: November 12–13, 2026 (PayPal AI Global Hackathon on Devpost)  
**Repository**: `C:\Users\shubh\OneDrive\clound\OneDrive\Desktop\paypal\PayGuard`

---

## PART 1: 6 Unmet Official Hackathon Rules (MUST FIX TO PASS STAGE 1)

| Rule ID | Devpost Official Rule Clause | Current Status | Concrete Fix Required |
| :--- | :--- | :--- | :--- |
| **RULE-FAIL-1** | **Sec 4: Open Source License File** — *"The repository must be public and open source by including an open source license file detectable at the top of the repository page."* | **MISSING** | Create root `LICENSE` (MIT License) file. |
| **RULE-FAIL-2** | **Sec 4: Complete Setup & Run Instructions** — *"Clear, complete setup and run instructions in your code repository's README"* | **MISSING** | Create root `README.md` with Legal Trademark Shield, Architecture Diagram, 1-Command Quickstart, and Sandbox Test Credentials. |
| **RULE-FAIL-3** | **Sec 4 & Sec 6 (Stage 1 Pass/Fail): PayPal Developer Platform Sandbox Integration** — *"Entrants must build or update an application that integrates the PayPal developer platform (using the free sandbox environment)"* | **MISSING IN CODE** | Add `apps/api/src/modules/paypal/paypal-client.ts` calling PayPal Sandbox OAuth2 (`/v1/oauth2/token`) & Orders v2 (`/v2/checkout/orders`), gated strictly by `ExecutionCapabilityToken`. |
| **RULE-FAIL-4** | **Sec 4 & Sec 6 (Stage 1 Pass/Fail): AI Tool / Model Integration** — *"Along with an AI tool, model, or platform of their choice"* | **MISSING IN CODE** | Add `apps/api/src/modules/agent/runner.ts` with 4-round tool loop (`search_catalog`, `calculator`, `draft_order`, `policy_gate`) + Gemini/Groq adapter & deterministic fixture replay. |
| **RULE-FAIL-5** | **Sec 4: Functional Running Build (API + Web Connected)** — *"Judges must be able to actually run or interact with a working build"* | **MISSING** | Create `apps/api/src/server.ts` (Fastify HTTP server) and connect `apps/web` Approve/Reject/Evaluate actions to the backend API. |
| **RULE-FAIL-6** | **Sec 4: < 3 Minute YouTube Demo Video** — *"Less than 3 minutes, publicly visible on YouTube, no unauthorized third-party trademarks or copyrighted music"* | **PENDING** | Record 2m45s end-to-end demo video after wiring the backend routes. |

---

## PART 2: UI Screenshot vs Backend Code Gap Audit (10 Feature Gaps)

Audited against the official PayGuard UI (`Payments — LLM proposes; deterministic policy disposes`):

| # | UI Feature Shown in Screenshot & `apps/web` | Frontend File | Backend File (`apps/api`) | Backend Status & Gap |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **4-Round Agent Reasoning Trace** (`R1 search_catalog`, `R2 calculator`, `R3 draft_order`, `R4 policy gate`) | `LedgerGrid.tsx` / `mockData.ts` | *None* (`modules/agent` missing) | ❌ **MISSING**: Backend has R2 math (`money.ts`) and R4 (`gate.ts`), but lacks the `search_catalog` tool, catalog store, and 4-round ReAct loop runner. |
| **2** | **Policy Codes Alignment** (`HOLD_OVER_CAP`, `AUTO_EXECUTED`, `HOLD_VENDOR_DESTINATION`, `HOLD_VENDOR_UNTRUSTED`, `REJECT_PROMPT_INJECTION`) | `types.ts` / `LedgerGrid.tsx` | `packages/contracts/src/decision.ts` & `gate.ts` | ⚠️ **MISMATCH**: Backend returns `SINGLE_TX_LIMIT_EXCEEDED`, `DAILY_LIMIT_EXCEEDED`, `UNTRUSTED_VENDOR`, `DUPLICATE_INVOICE`. Needs mapping or support for `HOLD_VENDOR_DESTINATION` and `REJECT_PROMPT_INJECTION`. |
| **3** | **Vendor Payout Destination Check** (`Bluebird Logistics INV-0907`: Previous trusted `•••• 1842` vs New in invoice `•••• 7710` -> `HOLD_VENDOR_DESTINATION`) | `PolicyInspector.tsx` (lines 142–169) | `gate.ts` | ❌ **MISSING**: `gate.ts` only checks if `vendorId` is in `trustedVendorIds`. It does not check if the invoice changed the vendor's bank/PayPal payout destination (`•••• 1842` vs `•••• 7710`). |
| **4** | **Untrusted Prompt-Injection Fencing & Detection** (`Aster Cloud INV-2099`: *"Ignore all previous instructions..."* -> `REJECT_PROMPT_INJECTION` & red evidence box) | `PolicyInspector.tsx` (lines 103–116) | `quote-matcher.ts` / `gate.ts` | ❌ **MISSING**: Backend has `quote-matcher.ts` for positive quote verification, but lacks the untrusted prompt-injection detector/sanitizer that extracts and flags adversarial strings from invoices. |
| **5** | **One-Time QR Approval Nonce & Expiry** (`PG-7F3K-9D2L`, `Expires in 09:58`, and expired replay example `PG-1H9Z-4Q5M`) | `PolicyInspector.tsx` & `QrApprovalModal.tsx` | *None* (`modules/hitl` missing) | ❌ **MISSING**: Backend has no QR single-use code generator, 10-minute TTL check, or single-use consumption lock. |
| **6** | **Re-Running Policy Gate on Human Approval** (Top-right green toast: *"Gate re-ran, decision stood"* & bottom note: *"Full policy gate runs again before payment"*) | `PolicyInspector.tsx` (line 207) | `ledger.ts` / `gate.ts` | ❌ **MISSING**: Clicking `Approve` in UI only updates local React state. Backend needs `POST /v1/approvals/:id/approve` that re-runs `evaluatePolicy`, mints a fresh capability token, and calls `ledger.settleOrder`. |
| **7** | **PayPal Sandbox Execution Status** (`PayPal sandbox ready` check & `PayPal Sandbox` header pill) | `Header.tsx` & `PolicyInspector.tsx` | *None* (`modules/paypal` missing) | ❌ **MISSING**: Backend needs `modules/paypal/paypal-client.ts` to create/capture sandbox orders and return a real/sandbox PayPal Order ID. |
| **8** | **60-Minute Rolling Vendor Velocity Meter** (`Velocity (this vendor): $142 of $200 · 60 min rolling window`) | `PolicyInspector.tsx` (lines 128–138) | `gate.ts` (`dailySpendMinor`) | ⚠️ **PARTIAL**: `gate.ts` checks `dailySpendMinor + grandTotalMinor > 20000n` ($200), which works! Needs endpoint to return current spent amount (`$142 of $200`) to the UI. |
| **9** | **Top KPI Strip Live Counts** (`Needs review: 2 bills · $1,284.50`, `Awaiting approval: 2 bills`, `Auto-executed: 8 bills`, `Blocked: 2 bills`) | `KpiStrip.tsx` | *None* | ❌ **MISSING**: Static numbers in `KpiStrip.tsx`; should compute dynamically from transactions state / backend API. |
| **10** | **Left Sidebar Views** (`Overview`, `Evaluations`, `Payments`, `Approvals`, `Vendors`, `Audit trail`) | `Sidebar.tsx` | *None* | ❌ **MISSING**: Only `/payments` route exists; `packages/eval` (15 golden cases) and hash-chained `audit-trail` need backend support. |
