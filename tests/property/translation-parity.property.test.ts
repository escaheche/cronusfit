import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Property 7: Translation key parity between languages
 *
 * For any translation key present in the Spanish (es.json) translation file,
 * there SHALL exist a corresponding key with the same path in the English (en.json)
 * translation file, and vice versa.
 *
 * **Validates: Requirements 3.1, 3.6**
 */
describe('Property 7: Translation key parity between languages', () => {
  const esPath = path.join(process.cwd(), 'exhibition-site/i18n/es.json');
  const enPath = path.join(process.cwd(), 'exhibition-site/i18n/en.json');

  const esTranslations: Record<string, string> = JSON.parse(
    fs.readFileSync(esPath, 'utf-8')
  );
  const enTranslations: Record<string, string> = JSON.parse(
    fs.readFileSync(enPath, 'utf-8')
  );

  const esKeys = Object.keys(esTranslations);
  const enKeys = Object.keys(enTranslations);

  it('every key in es.json exists in en.json', () => {
    for (const key of esKeys) {
      expect(enTranslations).toHaveProperty(key);
    }
  });

  it('every key in en.json exists in es.json', () => {
    for (const key of enKeys) {
      expect(esTranslations).toHaveProperty(key);
    }
  });

  it('both files have the same number of keys', () => {
    expect(esKeys.length).toBe(enKeys.length);
  });

  it('for any randomly sampled key from es.json, it exists in en.json with a non-empty string value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: esKeys.length - 1 }),
        (index) => {
          const key = esKeys[index];
          expect(enTranslations).toHaveProperty(key);
          expect(typeof enTranslations[key]).toBe('string');
          expect(enTranslations[key].length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any randomly sampled key from en.json, it exists in es.json with a non-empty string value', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: enKeys.length - 1 }),
        (index) => {
          const key = enKeys[index];
          expect(esTranslations).toHaveProperty(key);
          expect(typeof esTranslations[key]).toBe('string');
          expect(esTranslations[key].length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
