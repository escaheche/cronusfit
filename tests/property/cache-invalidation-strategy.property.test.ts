/**
 * Property-based tests for cache invalidation strategy selection.
 *
 * **Validates: Requirements 2.4**
 *
 * Property 6: Cache invalidation strategy selection
 * For any list of changed paths after a rebuild, the invalidation module SHALL
 * select the "wildcard" strategy (/*) when the number of paths exceeds 15,
 * and the "individual" strategy when the number is 15 or fewer.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { selectStrategy } from '../../src/modules/exhibition/cache-invalidation.js';

describe('Property 6: Cache invalidation strategy selection', () => {
  it('for any array with length 1-15, strategy is "individual"', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => '/' + s),
          { minLength: 1, maxLength: 15 },
        ),
        (paths) => {
          const strategy = selectStrategy(paths);
          expect(strategy).toBe('individual');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any array with length > 15, strategy is "wildcard"', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.string({ minLength: 1, maxLength: 50 }).map((s) => '/' + s),
          { minLength: 16, maxLength: 100 },
        ),
        (paths) => {
          const strategy = selectStrategy(paths);
          expect(strategy).toBe('wildcard');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for empty array, strategy is "individual" (no paths to invalidate)', () => {
    fc.assert(
      fc.property(fc.constant([]), (paths: string[]) => {
        const strategy = selectStrategy(paths);
        expect(strategy).toBe('individual');
      }),
      { numRuns: 1 },
    );
  });
});
