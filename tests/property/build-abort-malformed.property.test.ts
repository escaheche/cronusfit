/**
 * Property-based tests for build abort on malformed product data.
 *
 * **Validates: Requirements 1.9**
 *
 * Property 5: Build abort on malformed product data
 * For any product data set containing at least one malformed record (missing required fields,
 * invalid types, or corrupted image references), the Site_Builder SHALL return a failure result
 * without producing any output files.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateProductData } from '../../src/modules/exhibition/site-builder.js';

/**
 * Generator for a valid product record that passes all validation.
 */
const validProductArb = fc.record({
  id: fc.uuid(),
  productName: fc.record({
    es: fc.string({ minLength: 1, maxLength: 50 }),
    en: fc.string({ minLength: 1, maxLength: 50 }),
  }),
  garmentType: fc.constantFrom('jersey', 'shorts', 'tank_top', 'leggings', 'hoodie', 'jacket'),
  ageGroup: fc.constantFrom('children', 'adult'),
  availableSizes: fc.array(
    fc.constantFrom('XS', 'S', 'M', 'L', 'XL', '2XL', '2T', '3T', '4T'),
    { minLength: 1, maxLength: 5 },
  ),
  frontImageS3Key: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  backImageS3Key: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
});

describe('Property 5: Build abort on malformed product data', () => {
  it('for any product missing "id" → validateProductData returns errors', () => {
    fc.assert(
      fc.property(
        validProductArb.map((product) => {
          const { id: _removed, ...rest } = product;
          return rest;
        }),
        (malformedProduct) => {
          const errors = validateProductData(malformedProduct);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e) => e.message.includes('id'))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any product missing "productName" → validateProductData returns errors', () => {
    fc.assert(
      fc.property(
        validProductArb.map((product) => {
          const { productName: _removed, ...rest } = product;
          return rest;
        }),
        (malformedProduct) => {
          const errors = validateProductData(malformedProduct);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e) => e.message.includes('productName'))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any product with productName missing "es" property → validateProductData returns errors', () => {
    fc.assert(
      fc.property(
        validProductArb.map((product) => ({
          ...product,
          productName: { en: product.productName.en },
        })),
        (malformedProduct) => {
          const errors = validateProductData(malformedProduct);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e) => e.message.includes('productName'))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any product missing "garmentType" → validateProductData returns errors', () => {
    fc.assert(
      fc.property(
        validProductArb.map((product) => {
          const { garmentType: _removed, ...rest } = product;
          return rest;
        }),
        (malformedProduct) => {
          const errors = validateProductData(malformedProduct);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e) => e.message.includes('garmentType'))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any product missing "ageGroup" → validateProductData returns errors', () => {
    fc.assert(
      fc.property(
        validProductArb.map((product) => {
          const { ageGroup: _removed, ...rest } = product;
          return rest;
        }),
        (malformedProduct) => {
          const errors = validateProductData(malformedProduct);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e) => e.message.includes('ageGroup'))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any product with empty "availableSizes" array → validateProductData returns errors', () => {
    fc.assert(
      fc.property(
        validProductArb.map((product) => ({
          ...product,
          availableSizes: [],
        })),
        (malformedProduct) => {
          const errors = validateProductData(malformedProduct);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e) => e.message.includes('availableSizes'))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any product missing image keys → validateProductData returns errors', () => {
    fc.assert(
      fc.property(
        validProductArb.chain((product) =>
          fc.constantFrom('frontImageS3Key', 'backImageS3Key').map((keyToRemove) => {
            const copy = { ...product } as Record<string, unknown>;
            delete copy[keyToRemove];
            return { product: copy, removedKey: keyToRemove };
          }),
        ),
        ({ product, removedKey }) => {
          const errors = validateProductData(product);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((e) => e.message.includes(removedKey))).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a valid product always returns empty errors array', () => {
    fc.assert(
      fc.property(validProductArb, (product) => {
        const errors = validateProductData(product);
        expect(errors).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it('for any product with randomly removed required fields → validateProductData returns errors', () => {
    const requiredFields = [
      'id',
      'productName',
      'garmentType',
      'ageGroup',
      'availableSizes',
      'frontImageS3Key',
      'backImageS3Key',
    ];

    fc.assert(
      fc.property(
        validProductArb,
        fc.subarray(requiredFields, { minLength: 1 }),
        (product, fieldsToRemove) => {
          const malformed = { ...product } as Record<string, unknown>;
          for (const field of fieldsToRemove) {
            delete malformed[field];
          }

          const errors = validateProductData(malformed);
          expect(errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
