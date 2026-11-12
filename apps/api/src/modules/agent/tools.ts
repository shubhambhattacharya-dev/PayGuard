import { z } from 'zod';
import { OrderProposalSchema, toMoneyMinor, type OrderProposal } from '@payguard/contracts';
import type { CatalogStore } from './catalog.js';

// =====================================================
// TOOL SCHEMAS - the only capabilities the model can invoke
// =====================================================

export const SearchCatalogArgsSchema = z
  .object({ query: z.string().trim().min(1, 'Query must not be empty').max(120, 'Query must not exceed 120 characters') })
  .strict();

export const CalculateTotalArgsSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            sku: z.string().trim().min(1).max(64),
            quantity: z.number().int().positive('Quantity must be at least 1').max(10_000),
            unitPriceMinor: z.number().int().nonnegative('Unit price cannot be negative'),
          })
          .strict(),
      )
      .min(1, 'At least one item is required')
      .max(50, 'Exceeded maximum 50 line items limit'),
  })
  .strict();

const DraftLineArgsSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    description: z.string().trim().min(1).max(256),
    quantity: z.number().int().positive('Quantity must be at least 1').max(10_000),
    unitPriceMinor: z.number().int().nonnegative('Unit price cannot be negative'),
    taxBps: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const DraftOrderArgsSchema = z
  .object({
    invoiceId: z.string().trim().min(1, 'Invoice ID must not be empty').max(128),
    vendorName: z.string().trim().min(1, 'Vendor name must not be empty').max(128),
    currency: z.literal('USD'),
    lines: z.array(DraftLineArgsSchema).min(1, 'At least one line is required').max(50, 'Exceeded maximum 50 lines limit'),
  })
  .strict();

export type DraftOrderArgs = z.infer<typeof DraftOrderArgsSchema>;

export type ToolName = 'search_catalog' | 'calculate_total' | 'draft_order';

export interface ParsedToolCall {
  readonly tool: ToolName;
  readonly args: unknown;
}

const TOOL_NAMES: readonly ToolName[] = ['search_catalog', 'calculate_total', 'draft_order'];

/**
 * Parse a model assistant message into a registered tool call.
 * Accepts raw JSON or a ```json fenced block; anything else returns null
 * and the loop feeds back a synthetic tool-error observation.
 */
export function parseToolCall(assistantText: string): ParsedToolCall | null {
  const fenced = assistantText.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? assistantText).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as { tool?: unknown; args?: unknown };
  const tool = record.tool;
  if (typeof tool === 'string' && (TOOL_NAMES as readonly string[]).includes(tool)) {
    return { tool: tool as ToolName, args: record.args };
  }
  return null;
}

// =====================================================
// TOOL OBSERVATIONS - every deviation lands here as typed text
// =====================================================

export interface ToolObservation {
  readonly ok: boolean;
  readonly tool: ToolName | null;
  readonly terminal: boolean;
  readonly proposal: OrderProposal | null;
  readonly summary: string;
  readonly detail: string;
}

function observationError(tool: ToolName | null, summary: string, detail: string): ToolObservation {
  return { ok: false, tool, terminal: false, proposal: null, summary, detail };
}

function zodSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
    .slice(0, 300);
}

const MAX_SAFE_MONEY = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Integer money math: tax = roundHalfUp(lineTotal * taxBps / 10000) computed
 * in BigInt so no float ever touches a monetary amount.
 */
function taxMinorFor(lineTotalMinor: bigint, taxBps: number): bigint {
  if (taxBps === 0) {
    return 0n;
  }
  return (lineTotalMinor * BigInt(taxBps) + 5000n) / 10000n;
}

function buildProposalFromDraft(
  draft: DraftOrderArgs,
): { ok: true; value: OrderProposal } | { ok: false; error: string } {
  let subtotal = 0n;
  let taxTotal = 0n;
  const lineItems: OrderProposal['lineItems'] = [];

  for (const line of draft.lines) {
    const lineTotal = BigInt(line.quantity) * BigInt(line.unitPriceMinor);
    if (lineTotal > MAX_SAFE_MONEY) {
      return { ok: false, error: `Line ${line.sku}: line total exceeds the safe money range` };
    }
    const tax = taxMinorFor(lineTotal, line.taxBps ?? 0);
    subtotal += lineTotal;
    taxTotal += tax;
    lineItems.push({
      sku: line.sku,
      description: line.description,
      quantity: line.quantity,
      unitPriceMinor: toMoneyMinor(line.unitPriceMinor),
      taxBps: line.taxBps ?? 0,
      lineTotalMinor: toMoneyMinor(Number(lineTotal)),
    });
  }

  const grandTotal = subtotal + taxTotal;
  if (grandTotal > MAX_SAFE_MONEY) {
    return { ok: false, error: 'Grand total exceeds the safe money range' };
  }

  return {
    ok: true,
    value: {
      invoiceId: draft.invoiceId,
      vendorName: draft.vendorName,
      currency: 'USD',
      lineItems,
      subtotalMinor: toMoneyMinor(Number(subtotal)),
      taxTotalMinor: toMoneyMinor(Number(taxTotal)),
      grandTotalMinor: toMoneyMinor(Number(grandTotal)),
    },
  };
}

/**
 * Dispatch a parsed tool call against the catalog. Server-side re-validation
 * happens on every call: valid-echoing model JSON is never trusted.
 */
export function dispatchToolCall(call: ParsedToolCall | null, catalog: CatalogStore): ToolObservation {
  if (call === null) {
    return observationError(
      null,
      'No registered tool call',
      'Assistant output did not contain a registered tool call. Emit exactly one JSON object: {"tool":"search_catalog|calculate_total|draft_order","args":{...}}',
    );
  }

  switch (call.tool) {
    case 'search_catalog': {
      const parsed = SearchCatalogArgsSchema.safeParse(call.args);
      if (!parsed.success) {
        return observationError('search_catalog', 'Invalid search_catalog arguments', zodSummary(parsed.error));
      }
      const items = catalog.search(parsed.data.query, 5);
      return {
        ok: true,
        tool: 'search_catalog',
        terminal: false,
        proposal: null,
        summary: `search_catalog · ${items.length} items`,
        detail: JSON.stringify({ query: parsed.data.query, items }),
      };
    }

    case 'calculate_total': {
      const parsed = CalculateTotalArgsSchema.safeParse(call.args);
      if (!parsed.success) {
        return observationError('calculate_total', 'Invalid calculate_total arguments', zodSummary(parsed.error));
      }
      let total = 0n;
      for (const item of parsed.data.items) {
        total += BigInt(item.quantity) * BigInt(item.unitPriceMinor);
      }
      if (total > MAX_SAFE_MONEY) {
        return observationError('calculate_total', 'Total exceeds the safe money range', 'Reduce quantity or price.');
      }
      return {
        ok: true,
        tool: 'calculate_total',
        terminal: false,
        proposal: null,
        summary: `calculate_total · ${total.toString()} cents`,
        detail: JSON.stringify({ verifiedTotalMinor: total.toString() }),
      };
    }

    case 'draft_order': {
      const parsed = DraftOrderArgsSchema.safeParse(call.args);
      if (!parsed.success) {
        return observationError('draft_order', 'Invalid draft_order arguments', zodSummary(parsed.error));
      }
      const built = buildProposalFromDraft(parsed.data);
      if (!built.ok) {
        return observationError('draft_order', 'Proposal rejected before validation', built.error);
      }
      const validated = OrderProposalSchema.safeParse(built.value);
      if (!validated.success) {
        return observationError('draft_order', 'Proposal failed contract validation (totals must reconcile)', zodSummary(validated.error));
      }
      return {
        ok: true,
        tool: 'draft_order',
        terminal: true,
        proposal: validated.data,
        summary: `draft_order · ${validated.data.grandTotalMinor} cents proposed`,
        detail: JSON.stringify({ proposed: validated.data }),
      };
    }
  }
}
