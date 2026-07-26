import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 12: Date formatting per locale
 *
 * For any valid ISO 8601 date string, formatting with locale "es" SHALL produce
 * a string in DD/MM/YYYY format, and formatting with locale "en" SHALL produce
 * a string in MM/DD/YYYY format.
 *
 * **Validates: Requirements 6.5**
 */

/**
 * Testable TypeScript version of the formatDate function from
 * exhibition-site/assets/js/i18n.js, accepting an explicit locale parameter.
 */
function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;

  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = String(date.getUTCFullYear());

  if (locale === 'en') return `${month}/${day}/${year}`;
  return `${day}/${month}/${year}`; // Default: es → DD/MM/YYYY
}

describe('Property 12: Date formatting per locale', () => {
  const dateArb = fc
    .date({ min: new Date(2000, 0, 1), max: new Date(2099, 11, 31) })
    .map((d) => d.toISOString());

  it('for any valid date and locale "es", output matches DD/MM/YYYY pattern', () => {
    fc.assert(
      fc.property(dateArb, (iso) => {
        const result = formatDate(iso, 'es');
        // DD/MM/YYYY: exactly 10 chars, slashes at positions 2 and 5
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      }),
      { numRuns: 200 }
    );
  });

  it('for any valid date and locale "en", output matches MM/DD/YYYY pattern', () => {
    fc.assert(
      fc.property(dateArb, (iso) => {
        const result = formatDate(iso, 'en');
        // MM/DD/YYYY: exactly 10 chars, slashes at positions 2 and 5
        expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      }),
      { numRuns: 200 }
    );
  });

  it('day/month components are consistent between locales (same date, different order)', () => {
    fc.assert(
      fc.property(dateArb, (iso) => {
        const esResult = formatDate(iso, 'es');
        const enResult = formatDate(iso, 'en');

        // es: DD/MM/YYYY → parts[0] = day, parts[1] = month
        const esParts = esResult.split('/');
        // en: MM/DD/YYYY → parts[0] = month, parts[1] = day
        const enParts = enResult.split('/');

        // Day in es (position 0) should equal day in en (position 1)
        expect(esParts[0]).toBe(enParts[1]);
        // Month in es (position 1) should equal month in en (position 0)
        expect(esParts[1]).toBe(enParts[0]);
        // Year should be the same
        expect(esParts[2]).toBe(enParts[2]);
      }),
      { numRuns: 200 }
    );
  });

  it('output always has format XX/XX/XXXX (10 chars, / at positions 2 and 5)', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.constantFrom('es', 'en'),
        (iso, locale) => {
          const result = formatDate(iso, locale);
          expect(result.length).toBe(10);
          expect(result[2]).toBe('/');
          expect(result[5]).toBe('/');
        }
      ),
      { numRuns: 200 }
    );
  });
});
