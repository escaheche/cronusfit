import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property 8: Product field language fallback
 *
 * For any product with a missing translation for a field in the target language (English),
 * the i18n system SHALL return the Spanish version of that field without any error indicator.
 *
 * **Validates: Requirements 3.7**
 */

/**
 * Mirrors the logic from exhibition-site/assets/js/i18n.js getProductField().
 * This is extracted here for testability since i18n.js is vanilla browser JS.
 */
function getProductField(
  fieldObj: { es?: string; en?: string } | null | undefined,
  currentLanguage: string
): string {
  if (!fieldObj || typeof fieldObj !== 'object') {
    return '';
  }

  const value = fieldObj[currentLanguage as keyof typeof fieldObj];
  if (value && value.trim() !== '') {
    return value;
  }

  // Fallback to Spanish silently (no error indicator)
  return fieldObj.es || '';
}

describe('Property 8: Product field language fallback', () => {
  const nonEmptyString = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim() !== '');
  const optionalString = fc.option(fc.string({ minLength: 0, maxLength: 50 }));

  it('when English translation is present and non-empty, language "en" returns English value', () => {
    fc.assert(
      fc.property(nonEmptyString, nonEmptyString, (esValue, enValue) => {
        const fieldObj = { es: esValue, en: enValue };
        const result = getProductField(fieldObj, 'en');
        expect(result).toBe(enValue);
      }),
      { numRuns: 200 }
    );
  });

  it('when English translation is undefined, language "en" falls back to Spanish value', () => {
    fc.assert(
      fc.property(nonEmptyString, (esValue) => {
        const fieldObj = { es: esValue };
        const result = getProductField(fieldObj, 'en');
        expect(result).toBe(esValue);
      }),
      { numRuns: 200 }
    );
  });

  it('when English translation is empty string, language "en" falls back to Spanish value', () => {
    fc.assert(
      fc.property(nonEmptyString, (esValue) => {
        const fieldObj = { es: esValue, en: '' };
        const result = getProductField(fieldObj, 'en');
        expect(result).toBe(esValue);
      }),
      { numRuns: 200 }
    );
  });

  it('when English translation is whitespace-only, language "en" falls back to Spanish value', () => {
    const whitespace = fc.constantFrom(' ', '  ', '\t', '\n', ' \t\n ');
    fc.assert(
      fc.property(nonEmptyString, whitespace, (esValue, wsValue) => {
        const fieldObj = { es: esValue, en: wsValue };
        const result = getProductField(fieldObj, 'en');
        expect(result).toBe(esValue);
      }),
      { numRuns: 200 }
    );
  });

  it('when language is "es", always returns Spanish value', () => {
    fc.assert(
      fc.property(nonEmptyString, optionalString, (esValue, enValue) => {
        const fieldObj: { es: string; en?: string } = { es: esValue };
        if (enValue !== null) {
          fieldObj.en = enValue;
        }
        const result = getProductField(fieldObj, 'es');
        expect(result).toBe(esValue);
      }),
      { numRuns: 200 }
    );
  });

  it('when both translations are empty/undefined, returns empty string', () => {
    const emptyOrUndefined = fc.constantFrom('', undefined);
    fc.assert(
      fc.property(emptyOrUndefined, emptyOrUndefined, (esValue, enValue) => {
        const fieldObj: { es?: string; en?: string } = {};
        if (esValue !== undefined) fieldObj.es = esValue;
        if (enValue !== undefined) fieldObj.en = enValue;
        const result = getProductField(fieldObj, 'en');
        expect(result).toBe('');
      }),
      { numRuns: 100 }
    );
  });

  it('fallback never throws an error for any input', () => {
    const arbitraryFieldObj = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.record({
        es: optionalString.map((v) => v ?? undefined),
        en: optionalString.map((v) => v ?? undefined),
      }),
      fc.constant({}),
      fc.constant({ es: '', en: '' })
    );

    const arbitraryLang = fc.constantFrom('es', 'en', 'fr', 'de', '', 'invalid');

    fc.assert(
      fc.property(arbitraryFieldObj, arbitraryLang, (fieldObj, lang) => {
        expect(() => {
          getProductField(fieldObj as { es?: string; en?: string } | null | undefined, lang);
        }).not.toThrow();
      }),
      { numRuns: 200 }
    );
  });

  it('for any product with missing English translation, Spanish version is returned without error', () => {
    // The core property: missing English → Spanish fallback, no error/exception
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim() !== ''),
        fc.option(
          fc.string({ minLength: 0, maxLength: 50 }).filter((s) => s.trim() === ''),
          { nil: undefined }
        ),
        (esValue, enValue) => {
          const fieldObj: { es: string; en?: string } = { es: esValue };
          if (enValue !== undefined) {
            fieldObj.en = enValue;
          }
          const result = getProductField(fieldObj, 'en');
          // Should always get the Spanish fallback
          expect(result).toBe(esValue);
          // Should be a non-empty string (no error indicator)
          expect(result.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 200 }
    );
  });
});
