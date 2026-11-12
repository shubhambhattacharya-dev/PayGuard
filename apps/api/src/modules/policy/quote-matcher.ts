export type GroundingFailureReason =
  | 'EMPTY_QUOTE'
  | 'OUT_OF_BOUNDS'
  | 'OFFSET_MISMATCH';

export interface QuoteCitation {
  readonly claim: string;
  readonly exactQuote: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export type GroundingVerificationResult =
  | {
      readonly isGrounded: true;
      readonly verifiedQuote: string;
    }
  | {
      readonly isGrounded: false;
      readonly reason: GroundingFailureReason;
    };

/**
 * Deterministic Character-Offset Quote Verifier (Centaur 80/20 Kernel - Ticket #2)
 * Mirrors ContractLens Line 42 & PayGuard Invoice Grounding Gate (OWASP LLM07:2026).
 */
export function verifyQuoteGrounding(
  sourceText: string,
  citation: QuoteCitation,
): GroundingVerificationResult {
  // 1. Empty quote -> fabricated reference.
  if (citation.exactQuote.trim().length === 0) {
    return { isGrounded: false, reason: 'EMPTY_QUOTE' };
  }
  // 2. Bounds check: the claimed span must exist inside the source text.
  if (
    citation.startOffset < 0 ||
    citation.endOffset > sourceText.length ||
    citation.startOffset >= citation.endOffset
  ) {
    return { isGrounded: false, reason: 'OUT_OF_BOUNDS' };
  }
  // 3. Character-offset slice check: slice(source, start, end) must equal the quote.
  const actualSlice = sourceText.slice(citation.startOffset, citation.endOffset);
  if (actualSlice !== citation.exactQuote) {
    return { isGrounded: false, reason: 'OFFSET_MISMATCH' };
  }
  // 4. Grounded: the quote is byte-verified against the deterministic extraction.
  return { isGrounded: true, verifiedQuote: citation.exactQuote };
}
