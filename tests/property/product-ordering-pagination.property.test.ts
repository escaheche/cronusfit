/**
 * Property-based tests for product ordering and pagination.
 *
 * **Validates: Requirements 1.4, 4.2**
 *
 * Property 2: Product ordering and pagination
 * For any set of published products with distinct publication dates,
 * the product listing functions SHALL return products ordered by publication
 * date descending, with at most N products per page (12 for home page,
 * 50 for listing page), and the union of all pages SHALL equal the full
 * set of published products.
 *
 * Tests pure ordering and pagination logic:
 *   1. Sort products by publishedAt descending
 *   2. Slice into pages of max N items (12 for home, 50 for listing)
 *   3. Union of all pages equals the full sorted set
 *   4. No duplicates across pages
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { PublishedProductRecord } from '../../src/db/entities.js';
import type { GarmentType, AgeGroup } from '../../src/types/garment.js';

// --- Pure functions under test (extracted from Eleventy template + client-side logic) ---

/**
 * Sorts products by publishedAt date descending (newest first).
 * Mirrors the Eleventy template: `products | sort(true, false, 'publishedAt')`
 */
function sortProductsByDateDescending(products: PublishedProductRecord[]): PublishedProductRecord[] {
  return [...products].sort((a, b) => {
    const dateA = new Date(a.publishedAt).getTime();
    const dateB = new Date(b.publishedAt).getTime();
    return dateB - dateA;
  });
}

/**
 * Paginates a sorted product list into pages of max N items.
 * - Home page: N = 12 (only first page shown)
 * - Listing page: N = 50
 */
function paginateProducts(products: PublishedProductRecord[], pageSize: number): PublishedProductRecord[][] {
  if (products.length === 0) return [[]];
  const pages: PublishedProductRecord[][] = [];
  for (let i = 0; i < products.length; i += pageSize) {
    pages.push(products.slice(i, i + pageSize));
  }
  return pages;
}

// --- Generators ---

const garmentTypes: GarmentType[] = ['jersey', 'shorts', 'tank_top', 'leggings', 'hoodie', 'jacket'];
const ageGroups: AgeGroup[] = ['children', 'adult'];

/**
 * Generates an array of published products with distinct publishedAt dates.
 * Uses fc.uniqueArray + fc.date to ensure no two products share the same date.
 */
function productsWithDistinctDatesArb(minLength = 1, maxLength = 80): fc.Arbitrary<PublishedProductRecord[]> {
  return fc.uniqueArray(
    fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
    { minLength, maxLength, comparator: (a, b) => a.getTime() === b.getTime() }
  ).chain((dates) =>
    fc.tuple(
      ...dates.map((date) =>
        fc.record({
          PK: fc.string({ minLength: 1, maxLength: 10 }).map((id) => `PRODUCT#${id}`),
          SK: fc.constant('METADATA' as const),
          GSI1PK: fc.constant('PUBLISHED#true' as const),
          GSI1SK: fc.constant(`CREATED#${date.toISOString()}`),
          id: fc.uuid(),
          mockupId: fc.string({ minLength: 1, maxLength: 20 }),
          productName: fc.record({
            es: fc.string({ minLength: 1, maxLength: 50 }),
            en: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          garmentType: fc.constantFrom(...garmentTypes),
          ageGroup: fc.constantFrom(...ageGroups),
          availableSizes: fc.array(fc.string({ minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
          frontImageS3Key: fc.string({ minLength: 1, maxLength: 30 }).map((s) => `images/${s}.png`),
          backImageS3Key: fc.string({ minLength: 1, maxLength: 30 }).map((s) => `images/${s}.png`),
          publishedAt: fc.constant(date.toISOString()),
          publishedBy: fc.string({ minLength: 1, maxLength: 20 }),
        })
      )
    ) as fc.Arbitrary<PublishedProductRecord[]>
  );
}

describe('Property 2: Product ordering and pagination', () => {
  it('products are always sorted in descending date order', () => {
    fc.assert(
      fc.property(
        productsWithDistinctDatesArb(2, 60),
        (products) => {
          const sorted = sortProductsByDateDescending(products);

          // Each product's date should be >= the next product's date
          for (let i = 0; i < sorted.length - 1; i++) {
            const currentDate = new Date(sorted[i].publishedAt).getTime();
            const nextDate = new Date(sorted[i + 1].publishedAt).getTime();
            expect(currentDate).toBeGreaterThan(nextDate);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each page has at most N products (12 for home page)', () => {
    const HOME_PAGE_SIZE = 12;

    fc.assert(
      fc.property(
        productsWithDistinctDatesArb(1, 60),
        (products) => {
          const sorted = sortProductsByDateDescending(products);
          const pages = paginateProducts(sorted, HOME_PAGE_SIZE);

          for (const page of pages) {
            expect(page.length).toBeLessThanOrEqual(HOME_PAGE_SIZE);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('each page has at most N products (50 for listing page)', () => {
    const LISTING_PAGE_SIZE = 50;

    fc.assert(
      fc.property(
        productsWithDistinctDatesArb(1, 80),
        (products) => {
          const sorted = sortProductsByDateDescending(products);
          const pages = paginateProducts(sorted, LISTING_PAGE_SIZE);

          for (const page of pages) {
            expect(page.length).toBeLessThanOrEqual(LISTING_PAGE_SIZE);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('union of all pages equals the full sorted set', () => {
    fc.assert(
      fc.property(
        productsWithDistinctDatesArb(1, 60),
        fc.constantFrom(12, 50),
        (products, pageSize) => {
          const sorted = sortProductsByDateDescending(products);
          const pages = paginateProducts(sorted, pageSize);

          // Flatten all pages
          const union = pages.flat();

          // Union must equal the full sorted set
          expect(union.length).toBe(sorted.length);

          for (let i = 0; i < sorted.length; i++) {
            expect(union[i].id).toBe(sorted[i].id);
            expect(union[i].publishedAt).toBe(sorted[i].publishedAt);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no duplicates across pages', () => {
    fc.assert(
      fc.property(
        productsWithDistinctDatesArb(1, 60),
        fc.constantFrom(12, 50),
        (products, pageSize) => {
          const sorted = sortProductsByDateDescending(products);
          const pages = paginateProducts(sorted, pageSize);

          // Collect all product IDs across all pages
          const allIds: string[] = [];
          for (const page of pages) {
            for (const product of page) {
              allIds.push(product.id);
            }
          }

          // No duplicate IDs
          const uniqueIds = new Set(allIds);
          expect(uniqueIds.size).toBe(allIds.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('home page shows at most 12 most recent products', () => {
    const HOME_PAGE_SIZE = 12;

    fc.assert(
      fc.property(
        productsWithDistinctDatesArb(1, 60),
        (products) => {
          const sorted = sortProductsByDateDescending(products);
          const homePageProducts = sorted.slice(0, HOME_PAGE_SIZE);

          // Home page shows at most 12 products
          expect(homePageProducts.length).toBeLessThanOrEqual(HOME_PAGE_SIZE);

          // They are the N most recent (highest dates)
          if (sorted.length > HOME_PAGE_SIZE) {
            const lastHomeDate = new Date(homePageProducts[homePageProducts.length - 1].publishedAt).getTime();
            const firstRemainingDate = new Date(sorted[HOME_PAGE_SIZE].publishedAt).getTime();
            expect(lastHomeDate).toBeGreaterThan(firstRemainingDate);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('pagination preserves order within each page', () => {
    fc.assert(
      fc.property(
        productsWithDistinctDatesArb(2, 60),
        fc.constantFrom(12, 50),
        (products, pageSize) => {
          const sorted = sortProductsByDateDescending(products);
          const pages = paginateProducts(sorted, pageSize);

          // Within each page, products must maintain descending date order
          for (const page of pages) {
            for (let i = 0; i < page.length - 1; i++) {
              const currentDate = new Date(page[i].publishedAt).getTime();
              const nextDate = new Date(page[i + 1].publishedAt).getTime();
              expect(currentDate).toBeGreaterThan(nextDate);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
