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

export function verifyQuoteGrounding(
  sourceText: string,
  citation: QuoteCitation,
): GroundingVerificationResult {
  if (citation.exactQuote.trim().length === 0) {
    return { isGrounded: false, reason: 'EMPTY_QUOTE' };
  }
  if (
    citation.startOffset < 0 ||
    citation.endOffset > sourceText.length ||
    citation.startOffset >= citation.endOffset
  ) {
    return { isGrounded: false, reason: 'OUT_OF_BOUNDS' };
  }
  const actualSlice = sourceText.slice(citation.startOffset, citation.endOffset);
  if (actualSlice !== citation.exactQuote) {
    return { isGrounded: false, reason: 'OFFSET_MISMATCH' };
  }
  return { isGrounded: true, verifiedQuote: citation.exactQuote };
}
