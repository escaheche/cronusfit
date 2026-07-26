/**
 * Cache invalidation utilities for the Exhibition Website.
 *
 * Provides strategy selection logic for CloudFront cache invalidation
 * after a successful site rebuild.
 */

/**
 * Selects the cache invalidation strategy based on the number of changed paths.
 *
 * - If the number of paths is 15 or fewer, use "individual" path invalidation.
 * - If the number of paths exceeds 15, use "wildcard" invalidation (/*).
 *
 * @param paths - Array of file paths that changed during the rebuild
 * @returns 'individual' | 'wildcard'
 */
export function selectStrategy(paths: string[]): 'individual' | 'wildcard' {
  return paths.length > 15 ? 'wildcard' : 'individual';
}
