import { describe, it, expect } from 'vitest';
import { verifyQuoteGrounding } from './quote-matcher.js';

describe('verifyQuoteGrounding (ContractLens Line 42 Character-Offset Gate)', () => {
  const sampleContract =
    'Clause 4.2: Late payments incur a 2% monthly fee. Total due: $95.00.';

  it('rejects empty or whitespace-only quotes with EMPTY_QUOTE', () => {
    const result = verifyQuoteGrounding(sampleContract, {
      claim: 'There is a late fee',
      exactQuote: '   ',
      startOffset: 0,
      endOffset: 10,
    });

    expect(result).toEqual({
      isGrounded: false,
      reason: 'EMPTY_QUOTE',
    });
  });

  it('rejects out-of-bounds or inverted character offsets with OUT_OF_BOUNDS', () => {
    const negativeStart = verifyQuoteGrounding(sampleContract, {
      claim: 'Late fee is 2%',
      exactQuote: 'Clause 4.2',
      startOffset: -1,
      endOffset: 10,
    });
    expect(negativeStart).toEqual({
      isGrounded: false,
      reason: 'OUT_OF_BOUNDS',
    });

    const pastEnd = verifyQuoteGrounding(sampleContract, {
      claim: 'Total is $95',
      exactQuote: '$95.00.',
      startOffset: 50,
      endOffset: 999,
    });
    expect(pastEnd).toEqual({
      isGrounded: false,
      reason: 'OUT_OF_BOUNDS',
    });

    const invertedRange = verifyQuoteGrounding(sampleContract, {
      claim: 'Late fee',
      exactQuote: 'Late',
      startOffset: 20,
      endOffset: 12,
    });
    expect(invertedRange).toEqual({
      isGrounded: false,
      reason: 'OUT_OF_BOUNDS',
    });
  });

  it('rejects hallucinated quotes that do not match sourceText[startOffset..endOffset] with OFFSET_MISMATCH', () => {
    // Index 12..48 is "Late payments incur a 2% monthly fee", but LLM claims "5% monthly fee"
    const result = verifyQuoteGrounding(sampleContract, {
      claim: 'Late fee is 5%',
      exactQuote: 'Late payments incur a 5% monthly fee',
      startOffset: 12,
      endOffset: 48,
    });

    expect(result).toEqual({
      isGrounded: false,
      reason: 'OFFSET_MISMATCH',
    });
  });

  it('approves grounded quotes when sourceText.slice(startOffset, endOffset) strictly matches exactQuote', () => {
    // Index 12..48 in sampleContract is exactly "Late payments incur a 2% monthly fee"
    const result = verifyQuoteGrounding(sampleContract, {
      claim: 'Late fee is 2% per month',
      exactQuote: 'Late payments incur a 2% monthly fee',
      startOffset: 12,
      endOffset: 48,
    });

    expect(result).toEqual({
      isGrounded: true,
      verifiedQuote: 'Late payments incur a 2% monthly fee',
    });
  });
});
