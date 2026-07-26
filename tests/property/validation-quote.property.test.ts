/**
 * Property-based tests for quote form input validation.
 *
 * **Validates: Requirements 5.1, 5.6**
 *
 * Property 9: Quote form input validation
 * For any input to the quote form fields:
 * - client name outside 1-100 characters SHALL be rejected
 * - email not matching RFC 5322 SHALL be rejected
 * - phone not matching E.164 (7-15 digits with country code) SHALL be rejected
 * - quantity outside 1-10000 SHALL be rejected
 * - the corresponding localized error message SHALL be returned in the client's selected language
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateClientName,
  validateEmail,
  validatePhone,
  validateQuantity,
} from '../../src/validation/quote.js';
import { getErrorMessage } from '../../src/validation/common.js';
import type { Locale } from '../../src/validation/common.js';

const locales: Locale[] = ['es', 'en'];

describe('Property 9: Quote form input validation', () => {
  describe('Client name validation', () => {
    it('names with length 0 (empty/whitespace-only) are always rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(''),
            fc.stringOf(fc.constant(' '), { minLength: 1, maxLength: 50 }),
            fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 20 }),
          ),
          fc.constantFrom(...locales),
          (name, locale) => {
            const result = validateClientName(name, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.required', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('names with length > 100 are always rejected', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 101, maxLength: 500 }),
          fc.constantFrom(...locales),
          (name, locale) => {
            const result = validateClientName(name, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.name_too_long', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid names (1-100 chars, non-whitespace content) are always accepted', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
          fc.constantFrom(...locales),
          (name, locale) => {
            const result = validateClientName(name, locale);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('null and undefined names are always rejected', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(null, undefined),
          fc.constantFrom(...locales),
          (name, locale) => {
            const result = validateClientName(name as string | null | undefined, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.required', locale));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Email validation', () => {
    it('strings without @ are always rejected as email', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('@') && s.trim().length > 0),
          fc.constantFrom(...locales),
          (email, locale) => {
            const result = validateEmail(email, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.email_invalid', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('empty/null/undefined emails are always rejected as required', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', null, undefined),
          fc.constantFrom(...locales),
          (email, locale) => {
            const result = validateEmail(email as string | null | undefined, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.required', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('well-formed emails (local@domain.tld) are accepted', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 20 }),
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 15 }),
            fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 2, maxLength: 6 }),
          ),
          fc.constantFrom(...locales),
          ([local, domain, tld], locale) => {
            const email = `${local}@${domain}.${tld}`;
            const result = validateEmail(email, locale);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Phone validation', () => {
    it('strings not matching E.164 pattern (^\\+\\d{7,15}$) are always rejected', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => {
            return s.trim().length > 0 && !/^\+\d{7,15}$/.test(s);
          }),
          fc.constantFrom(...locales),
          (phone, locale) => {
            const result = validatePhone(phone, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.phone_invalid', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('valid E.164 phones (+ followed by 7-15 digits) are always accepted', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 7, max: 15 }).chain((len) =>
            fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: len, maxLength: len })
              .map((digits) => `+${digits}`),
          ),
          fc.constantFrom(...locales),
          (phone, locale) => {
            const result = validatePhone(phone, locale);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('empty/null/undefined phones are always rejected as required', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('', null, undefined),
          fc.constantFrom(...locales),
          (phone, locale) => {
            const result = validatePhone(phone as string | null | undefined, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.required', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('phones with fewer than 7 digits or more than 15 digits are rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            // Too few digits (1-6)
            fc.integer({ min: 1, max: 6 }).chain((len) =>
              fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: len, maxLength: len })
                .map((digits) => `+${digits}`),
            ),
            // Too many digits (16-25)
            fc.integer({ min: 16, max: 25 }).chain((len) =>
              fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: len, maxLength: len })
                .map((digits) => `+${digits}`),
            ),
          ),
          fc.constantFrom(...locales),
          (phone, locale) => {
            const result = validatePhone(phone, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.phone_invalid', locale));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Quantity validation', () => {
    it('numbers outside [1, 10000] are always rejected', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.integer({ min: -1_000_000, max: 0 }),
            fc.integer({ min: 10001, max: 1_000_000 }),
          ),
          fc.constantFrom(...locales),
          (quantity, locale) => {
            const result = validateQuantity(quantity, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.quantity_invalid', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('non-integer numbers are always rejected', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.01), max: Math.fround(10000), noNaN: true }).filter((n) => !Number.isInteger(n)),
          fc.constantFrom(...locales),
          (quantity, locale) => {
            const result = validateQuantity(quantity, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.quantity_invalid', locale));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('integers within [1, 10000] are always accepted', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000 }),
          fc.constantFrom(...locales),
          (quantity, locale) => {
            const result = validateQuantity(quantity, locale);
            expect(result.valid).toBe(true);
            expect(result.error).toBeUndefined();
          },
        ),
        { numRuns: 100 },
      );
    });

    it('null and undefined quantities are always rejected', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(null, undefined),
          fc.constantFrom(...locales),
          (quantity, locale) => {
            const result = validateQuantity(quantity as number | null | undefined, locale);
            expect(result.valid).toBe(false);
            expect(result.error).toBe(getErrorMessage('quote.error.required', locale));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Localized error messages', () => {
    it('error messages match the expected locale (es/en) for all validation failures', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...locales),
          (locale) => {
            // Name too long → locale-specific message
            const nameResult = validateClientName('x'.repeat(101), locale);
            expect(nameResult.error).toBe(getErrorMessage('quote.error.name_too_long', locale));

            // Invalid email → locale-specific message
            const emailResult = validateEmail('not-an-email', locale);
            expect(emailResult.error).toBe(getErrorMessage('quote.error.email_invalid', locale));

            // Invalid phone → locale-specific message
            const phoneResult = validatePhone('12345', locale);
            expect(phoneResult.error).toBe(getErrorMessage('quote.error.phone_invalid', locale));

            // Invalid quantity → locale-specific message
            const quantityResult = validateQuantity(0, locale);
            expect(quantityResult.error).toBe(getErrorMessage('quote.error.quantity_invalid', locale));

            // Verify locale difference
            if (locale === 'es') {
              expect(nameResult.error).toContain('100 caracteres');
              expect(emailResult.error).toContain('correo electrónico');
              expect(phoneResult.error).toContain('teléfono válido');
              expect(quantityResult.error).toContain('número entero');
            } else {
              expect(nameResult.error).toContain('100 characters');
              expect(emailResult.error).toContain('valid email');
              expect(phoneResult.error).toContain('valid phone');
              expect(quantityResult.error).toContain('integer between');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
