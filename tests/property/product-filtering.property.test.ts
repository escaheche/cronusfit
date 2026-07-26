/**
 * Property-based tests for client-side product filtering correctness.
 *
 * **Validates: Requirements 1.6, 4.5, 4.6**
 *
 * Property 4: Client-side product filtering correctness
 * For any set of published products and any combination of Garment_Type and
 * Age_Group filters (including no filters), the filtered result SHALL contain
 * exactly the products that match all applied filter criteria, and the displayed
 * count SHALL equal the length of the filtered result.
 *
 * This tests the pure filtering logic extracted from the client-side
 * products-filter.js module.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { GarmentType, AgeGroup } from '../../src/types/garment.js';

// --- Pure filtering function (extracted from exhibition-site/assets/js/products-filter.js) ---

interface Product {
  garmentType: GarmentType;
  ageGroup: AgeGroup;
}

/**
 * Pure product filtering logic matching the client-side implementation.
 * Filters products by garment type and/or age group.
 * An empty string filter means "no filter" (match all).
 */
function filterProducts(
  products: Product[],
  garmentTypeFilter: GarmentType | '',
  ageGroupFilter: AgeGroup | '',
): Product[] {
  return products.filter((p) => {
    const matchesGarment = !garmentTypeFilter || p.garmentType === garmentTypeFilter;
    const matchesAge = !ageGroupFilter || p.ageGroup === ageGroupFilter;
    return matchesGarment && matchesAge;
  });
}

// --- Generators ---

const garmentTypes: GarmentType[] = ['jersey', 'shorts', 'tank_top', 'leggings', 'hoodie', 'jacket'];
const ageGroups: AgeGroup[] = ['children', 'adult'];

const garmentTypeArb = fc.constantFrom<GarmentType>(...garmentTypes);
const ageGroupArb = fc.constantFrom<AgeGroup>(...ageGroups);

/** Generates a product with a random garment type and age group. */
const productArb: fc.Arbitrary<Product> = fc.record({
  garmentType: garmentTypeArb,
  ageGroup: ageGroupArb,
});

/** Generates a garment type filter (including '' for no filter). */
const garmentFilterArb: fc.Arbitrary<GarmentType | ''> = fc.constantFrom<GarmentType | ''>(
  '', 'jersey', 'shorts', 'tank_top', 'leggings', 'hoodie', 'jacket',
);

/** Generates an age group filter (including '' for no filter). */
const ageFilterArb: fc.Arbitrary<AgeGroup | ''> = fc.constantFrom<AgeGroup | ''>(
  '', 'children', 'adult',
);

// --- Property Tests ---

describe('Property 4: Client-side product filtering correctness', () => {
  it('with no filters, all products are returned', () => {
    fc.assert(
      fc.property(
        fc.array(productArb, { minLength: 0, maxLength: 50 }),
        (products) => {
          const result = filterProducts(products, '', '');
          expect(result.length).toBe(products.length);
          expect(result).toEqual(products);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('with garment type filter only, result contains only products with that garment type', () => {
    fc.assert(
      fc.property(
        fc.array(productArb, { minLength: 0, maxLength: 50 }),
        garmentTypeArb,
        (products, garmentFilter) => {
          const result = filterProducts(products, garmentFilter, '');

          // Every product in the result matches the garment type filter
          for (const product of result) {
            expect(product.garmentType).toBe(garmentFilter);
          }

          // Every product in the input that matches the filter is in the result
          const expected = products.filter((p) => p.garmentType === garmentFilter);
          expect(result.length).toBe(expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('with age group filter only, result contains only products with that age group', () => {
    fc.assert(
      fc.property(
        fc.array(productArb, { minLength: 0, maxLength: 50 }),
        ageGroupArb,
        (products, ageFilter) => {
          const result = filterProducts(products, '', ageFilter);

          // Every product in the result matches the age group filter
          for (const product of result) {
            expect(product.ageGroup).toBe(ageFilter);
          }

          // Every product in the input that matches the filter is in the result
          const expected = products.filter((p) => p.ageGroup === ageFilter);
          expect(result.length).toBe(expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('combined filters: result = intersection (matches BOTH garment type AND age group)', () => {
    fc.assert(
      fc.property(
        fc.array(productArb, { minLength: 0, maxLength: 50 }),
        garmentTypeArb,
        ageGroupArb,
        (products, garmentFilter, ageFilter) => {
          const result = filterProducts(products, garmentFilter, ageFilter);

          // Every product in the result matches BOTH filters
          for (const product of result) {
            expect(product.garmentType).toBe(garmentFilter);
            expect(product.ageGroup).toBe(ageFilter);
          }

          // Result contains exactly the products matching both criteria
          const expected = products.filter(
            (p) => p.garmentType === garmentFilter && p.ageGroup === ageFilter,
          );
          expect(result.length).toBe(expected.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('count always equals the filtered array length', () => {
    fc.assert(
      fc.property(
        fc.array(productArb, { minLength: 0, maxLength: 50 }),
        garmentFilterArb,
        ageFilterArb,
        (products, garmentFilter, ageFilter) => {
          const result = filterProducts(products, garmentFilter, ageFilter);

          // The count (length) always equals the number of items returned
          const count = result.length;
          expect(count).toBe(result.filter(() => true).length);

          // Additionally, count matches manually computed expected count
          const expectedCount = products.filter((p) => {
            const matchesGarment = !garmentFilter || p.garmentType === garmentFilter;
            const matchesAge = !ageFilter || p.ageGroup === ageFilter;
            return matchesGarment && matchesAge;
          }).length;
          expect(count).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty product set with any filter yields empty result', () => {
    fc.assert(
      fc.property(
        garmentFilterArb,
        ageFilterArb,
        (garmentFilter, ageFilter) => {
          const result = filterProducts([], garmentFilter, ageFilter);
          expect(result).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
