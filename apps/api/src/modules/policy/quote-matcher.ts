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
  // =============================================================
  // TODO: SHUBHAM 20% KERNEL (NO CODE HINTS - WRITE FROM SPEC)
  // =============================================================
  // Business Requirements (Check in this exact order):
  // 1. Empty quote check -> If citation.exactQuote.trim().length === 0,
  //    return { isGrounded: false, reason: 'EMPTY_QUOTE' }
  if(citation.exactQuote.trim().length===0){
    return {isGrounded:false, reason:'EMPTY_QUOTE' }

  }
  //
  // 2. Bounds check -> If citation.startOffset < 0 OR
  //    citation.endOffset > sourceText.length OR
  //    citation.startOffset >= citation.endOffset,
  //    return { isGrounded: false, reason: 'OUT_OF_BOUNDS' }
if(citation.startOffset < 0 || citation.endOffset > sourceText.length ||citation.startOffset >= citation.endOffset){
  return  { isGrounded: false, reason: 'OUT_OF_BOUNDS' }
}

  //
  // 3. Character-offset slice check -> Slice sourceText from startOffset to endOffset.
  //    If the sliced string !== citation.exactQuote,
  //    return { isGrounded: false, reason: 'OFFSET_MISMATCH' }
 const acutualSlice=sourceText.slice(citation.startOffset,citation.endOffset)
  if(acutualSlice !=citation.exactQuote){
     return { isGrounded: false, reason: 'OFFSET_MISMATCH' }
  }
 
  //
  // 4. All passed -> Return { isGrounded: true, verifiedQuote: citation.exactQuote }
  // =============================================================

    return { isGrounded: true, verifiedQuote: citation.exactQuote }

 
}
