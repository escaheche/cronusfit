import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateTrackingNumber } from '../../src/validation/quote.js';

/**
 * Property 11: Tracking number validation
 *
 * For any string that is empty, whitespace-only, longer than 36 characters,
 * or contains non-alphanumeric characters, the tracking number validation
 * SHALL reject it. For any alphanumeric string of 1-36 characters, validation
 * SHALL accept it.
 *
 * **Validates: Requirements 6.1, 6.3**
 */
describe('Property 11: Tracking number validation', () => {
  const ALPHANUMERIC_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  it('any alphanumeric string of length 1-36 is always accepted', () => {
    fc.assert(
      fc.property(
        fc.stringOf(
          fc.constantFrom(...ALPHANUMERIC_CHARS),
          { minLength: 1, maxLength: 36 },
        ),
        fc.constantFrom('es' as const, 'en' as const),
        (trackingNumber, locale) => {
          const result = validateTrackingNumber(trackingNumber, locale);
          expect(result.valid).toBe(true);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('empty strings are always rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('es' as const, 'en' as const),
        (locale) => {
          const result = validateTrackingNumber('', locale);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 10 },
    );
  });

  it('whitespace-only strings are always rejected', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 50 }),
        fc.constantFrom('es' as const, 'en' as const),
        (whitespaceStr, locale) => {
          const result = validateTrackingNumber(whitespaceStr, locale);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('strings longer than 36 characters are always rejected', () => {
    fc.assert(
      fc.property(
        fc.stringOf(
          fc.constantFrom(...ALPHANUMERIC_CHARS),
          { minLength: 37, maxLength: 100 },
        ),
        fc.constantFrom('es' as const, 'en' as const),
        (longStr, locale) => {
          const result = validateTrackingNumber(longStr, locale);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 200 },
    );
  });

  it('strings containing non-alphanumeric characters are always rejected', () => {
    const nonAlphanumericChars = fc.constantFrom(
      '-', '_', ' ', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '.', ',', '/', '\\',
    );

    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringOf(fc.constantFrom(...ALPHANUMERIC_CHARS), { minLength: 0, maxLength: 17 }),
          nonAlphanumericChars,
          fc.stringOf(fc.constantFrom(...ALPHANUMERIC_CHARS), { minLength: 0, maxLength: 17 }),
        ),
        fc.constantFrom('es' as const, 'en' as const),
        ([prefix, specialChar, suffix], locale) => {
          const input = prefix + specialChar + suffix;
          // Only test if within 36 chars total to isolate the non-alphanumeric rejection
          if (input.length <= 36 && input.length > 0) {
            const result = validateTrackingNumber(input, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBeDefined();
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
