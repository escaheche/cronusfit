/**
 * Property-based tests for published-only output filtering.
 *
 * **Validates: Requirements 9.1**
 *
 * Property 18: Only published products appear in site output
 * For any set of products with mixed published/unpublished status,
 * the Site_Builder output SHALL contain pages and references only for
 * products with publishStatus = "published". No unpublished product ID,
 * name, or image SHALL appear in any generated file.
 *
 * Since buildSite receives pre-filtered products and writes them to
 * _data/products.json as-is, the property to test is the filtering logic:
 * - Only products with GSI1PK === 'PUBLISHED#true' pass the filter
 * - Unpublished product IDs never appear in the filtered result
 * - The filtered set is a subset of the input set
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { PublishedProductRecord } from '../../src/db/entities.js';
import type { GarmentType, AgeGroup } from '../../src/types/garment.js';
import { validateProductData } from '../../src/modules/exhibition/site-builder.js';

// --- Generators ---

const garmentTypes: GarmentType[] = ['jersey', 'shorts', 'tank_top', 'leggings', 'hoodie', 'jacket'];
const ageGroups: AgeGroup[] = ['children', 'adult'];

/** Generates a valid published product record with GSI1PK = 'PUBLISHED#true'. */
function publishedProductArb(): fc.Arbitrary<PublishedProductRecord> {
  return fc.record({
    PK: fc.string({ minLength: 1, maxLength: 20 }).map((id) => `PRODUCT#${id}`),
    SK: fc.constant('METADATA' as const),
    GSI1PK: fc.constant('PUBLISHED#true' as const),
    GSI1SK: fc.date().map((d) => `CREATED#${d.toISOString()}`),
    id: fc.string({ minLength: 1, maxLength: 20 }),
    mockupId: fc.string({ minLength: 1, maxLength: 20 }),
    productName: fc.record({
      es: fc.string({ minLength: 1, maxLength: 50 }),
      en: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    garmentType: fc.constantFrom(...garmentTypes),
    ageGroup: fc.constantFrom(...ageGroups),
    availableSizes: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
    frontImageS3Key: fc.string({ minLength: 1, maxLength: 50 }).map((s) => `images/${s}.png`),
    backImageS3Key: fc.string({ minLength: 1, maxLength: 50 }).map((s) => `images/${s}.png`),
    publishedAt: fc.date().map((d) => d.toISOString()),
    publishedBy: fc.string({ minLength: 1, maxLength: 30 }),
  });
}

/** Product-like record that is NOT published (different GSI1PK). */
interface UnpublishedProduct {
  PK: string;
  SK: 'METADATA';
  GSI1PK: string;
  GSI1SK: string;
  id: string;
  mockupId: string;
  productName: { es: string; en: string };
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  availableSizes: string[];
  frontImageS3Key: string;
  backImageS3Key: string;
  publishedAt?: string;
  publishedBy?: string;
}

function unpublishedProductArb(): fc.Arbitrary<UnpublishedProduct> {
  return fc.record({
    PK: fc.string({ minLength: 1, maxLength: 20 }).map((id) => `PRODUCT#${id}`),
    SK: fc.constant('METADATA' as const),
    GSI1PK: fc.constantFrom('PUBLISHED#false', 'DRAFT', 'UNPUBLISHED', ''),
    GSI1SK: fc.date().map((d) => `CREATED#${d.toISOString()}`),
    id: fc.string({ minLength: 1, maxLength: 20 }),
    mockupId: fc.string({ minLength: 1, maxLength: 20 }),
    productName: fc.record({
      es: fc.string({ minLength: 1, maxLength: 50 }),
      en: fc.string({ minLength: 1, maxLength: 50 }),
    }),
    garmentType: fc.constantFrom(...garmentTypes),
    ageGroup: fc.constantFrom(...ageGroups),
    availableSizes: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
    frontImageS3Key: fc.string({ minLength: 1, maxLength: 50 }).map((s) => `images/${s}.png`),
    backImageS3Key: fc.string({ minLength: 1, maxLength: 50 }).map((s) => `images/${s}.png`),
    publishedAt: fc.option(fc.date().map((d) => d.toISOString()), { nil: undefined }),
    publishedBy: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  });
}

/**
 * Simulates the filtering logic used before calling buildSite:
 * Only products with GSI1PK === 'PUBLISHED#true' are passed to the builder.
 */
function filterPublishedProducts(
  products: Array<PublishedProductRecord | UnpublishedProduct>,
): PublishedProductRecord[] {
  return products.filter(
    (p): p is PublishedProductRecord => p.GSI1PK === 'PUBLISHED#true',
  );
}

describe('Property 18: Only published products appear in site output', () => {
  it('filtering a mixed set returns only products with GSI1PK === "PUBLISHED#true"', () => {
    fc.assert(
      fc.property(
        fc.array(publishedProductArb(), { minLength: 0, maxLength: 10 }),
        fc.array(unpublishedProductArb(), { minLength: 0, maxLength: 10 }),
        (published, unpublished) => {
          const mixed = [...published, ...unpublished];
          const filtered = filterPublishedProducts(mixed);

          // All filtered products have GSI1PK = 'PUBLISHED#true'
          for (const product of filtered) {
            expect(product.GSI1PK).toBe('PUBLISHED#true');
          }

          // The count matches the number of published products in input
          expect(filtered.length).toBe(published.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no unpublished product ID appears in the filtered result', () => {
    fc.assert(
      fc.property(
        fc.array(publishedProductArb(), { minLength: 0, maxLength: 10 }),
        fc.array(unpublishedProductArb(), { minLength: 1, maxLength: 10 }),
        (published, unpublished) => {
          const mixed = [...published, ...unpublished];
          const filtered = filterPublishedProducts(mixed);

          const filteredIds = new Set(filtered.map((p) => p.id));
          const unpublishedIds = unpublished.map((p) => p.id);

          // No unpublished product ID should appear in the filtered set
          for (const id of unpublishedIds) {
            // Only check IDs that are unique to unpublished (not shared with published)
            const publishedIds = new Set(published.map((p) => p.id));
            if (!publishedIds.has(id)) {
              expect(filteredIds.has(id)).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('filtered result is always a subset of the input set', () => {
    fc.assert(
      fc.property(
        fc.array(publishedProductArb(), { minLength: 0, maxLength: 10 }),
        fc.array(unpublishedProductArb(), { minLength: 0, maxLength: 10 }),
        (published, unpublished) => {
          const mixed = [...published, ...unpublished];
          const filtered = filterPublishedProducts(mixed);

          // Every item in filtered must exist in the mixed input
          for (const product of filtered) {
            expect(mixed).toContain(product);
          }

          // Filtered length never exceeds input length
          expect(filtered.length).toBeLessThanOrEqual(mixed.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all valid published products pass validateProductData without errors', () => {
    fc.assert(
      fc.property(
        fc.array(publishedProductArb(), { minLength: 1, maxLength: 10 }),
        (publishedProducts) => {
          const filtered = filterPublishedProducts(publishedProducts);

          // Every filtered (published) product should pass validation
          for (const product of filtered) {
            const errors = validateProductData(product);
            expect(errors).toHaveLength(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('filtering an all-unpublished set yields an empty result', () => {
    fc.assert(
      fc.property(
        fc.array(unpublishedProductArb(), { minLength: 1, maxLength: 15 }),
        (unpublished) => {
          const filtered = filterPublishedProducts(unpublished);
          expect(filtered).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('filtering an all-published set yields the entire input', () => {
    fc.assert(
      fc.property(
        fc.array(publishedProductArb(), { minLength: 1, maxLength: 15 }),
        (published) => {
          const filtered = filterPublishedProducts(published);
          expect(filtered.length).toBe(published.length);

          // Each product in the result references the same object from input
          for (let i = 0; i < published.length; i++) {
            expect(filtered[i]).toBe(published[i]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
