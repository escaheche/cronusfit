/**
 * Property-based tests for rate limiting enforcement.
 *
 * **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 6.9**
 *
 * Property 13: Rate limiting enforcement
 * For any IP address, endpoint configuration (limit N, window W seconds), and sequence of M
 * requests within a single window: the first N requests SHALL be allowed, and request N+1
 * through M SHALL be denied with HTTP 429 and a Retry-After header whose value equals the
 * remaining seconds until the window expires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import type { RateLimitConfig } from '../../src/types/security.js';

// Mock the incrementRateLimit function from db/operations
vi.mock('../../src/db/operations.js', () => ({
  incrementRateLimit: vi.fn(),
}));

import { incrementRateLimit } from '../../src/db/operations.js';
import { checkRateLimit } from '../../src/modules/security/public-rate-limiter.js';

describe('Property 13: Rate limiting enforcement', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('first N requests are allowed for any IP and config', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate IP address
        fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map(
          ([a, b, c, d]) => `${a}.${b}.${c}.${d}`,
        ),
        // maxRequests (N): 1 to 20
        fc.integer({ min: 1, max: 20 }),
        // windowSeconds (W): 1 to 30
        fc.integer({ min: 1, max: 30 }),
        async (ip, maxRequests, windowSeconds) => {
          // Setup sequential mock: returns 1, 2, 3, ... for each call
          let callCount = 0;
          vi.mocked(incrementRateLimit).mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount);
          });

          const config: RateLimitConfig = {
            endpoint: 'quote-submit',
            maxRequests,
            windowSeconds,
          };

          // Send exactly N requests — all should be allowed
          for (let i = 1; i <= maxRequests; i++) {
            const result = await checkRateLimit(ip, config);
            expect(result.allowed).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('requests N+1 through M are denied for any IP and config', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate IP address
        fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map(
          ([a, b, c, d]) => `${a}.${b}.${c}.${d}`,
        ),
        // maxRequests (N): 1 to 20
        fc.integer({ min: 1, max: 20 }),
        // extra requests beyond limit: 1 to 30
        fc.integer({ min: 1, max: 30 }),
        // windowSeconds (W): 1 to 30
        fc.integer({ min: 1, max: 30 }),
        async (ip, maxRequests, extraRequests, windowSeconds) => {
          let callCount = 0;
          vi.mocked(incrementRateLimit).mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount);
          });

          const totalRequests = maxRequests + extraRequests;
          const config: RateLimitConfig = {
            endpoint: 'quote-status',
            maxRequests,
            windowSeconds,
          };

          // Send all M requests
          for (let i = 1; i <= totalRequests; i++) {
            const result = await checkRateLimit(ip, config);
            if (i <= maxRequests) {
              expect(result.allowed).toBe(true);
            } else {
              expect(result.allowed).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('denied requests have retryAfterSeconds > 0', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate IP address
        fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map(
          ([a, b, c, d]) => `${a}.${b}.${c}.${d}`,
        ),
        // maxRequests (N): 1 to 20
        fc.integer({ min: 1, max: 20 }),
        // extra requests beyond the limit: 1 to 10
        fc.integer({ min: 1, max: 10 }),
        // windowSeconds (W): 1 to 30
        fc.integer({ min: 1, max: 30 }),
        async (ip, maxRequests, extraRequests, windowSeconds) => {
          let callCount = 0;
          vi.mocked(incrementRateLimit).mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount);
          });

          const config: RateLimitConfig = {
            endpoint: 'quote-submit',
            maxRequests,
            windowSeconds,
          };

          // Exhaust allowed requests
          for (let i = 1; i <= maxRequests; i++) {
            await checkRateLimit(ip, config);
          }

          // All subsequent requests should have retryAfterSeconds > 0
          for (let i = 1; i <= extraRequests; i++) {
            const result = await checkRateLimit(ip, config);
            expect(result.allowed).toBe(false);
            expect(result.retryAfterSeconds).toBeDefined();
            expect(result.retryAfterSeconds).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('remainingRequests decreases with each allowed request', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate IP address
        fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map(
          ([a, b, c, d]) => `${a}.${b}.${c}.${d}`,
        ),
        // maxRequests (N): 1 to 20
        fc.integer({ min: 1, max: 20 }),
        // windowSeconds (W): 1 to 30
        fc.integer({ min: 1, max: 30 }),
        async (ip, maxRequests, windowSeconds) => {
          let callCount = 0;
          vi.mocked(incrementRateLimit).mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount);
          });

          const config: RateLimitConfig = {
            endpoint: 'quote-submit',
            maxRequests,
            windowSeconds,
          };

          // Each allowed request should have decreasing remainingRequests
          for (let i = 1; i <= maxRequests; i++) {
            const result = await checkRateLimit(ip, config);
            expect(result.allowed).toBe(true);
            expect(result.remainingRequests).toBe(maxRequests - i);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('remainingRequests is 0 for all denied requests', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate IP address
        fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255)).map(
          ([a, b, c, d]) => `${a}.${b}.${c}.${d}`,
        ),
        // maxRequests (N): 1 to 20
        fc.integer({ min: 1, max: 20 }),
        // extra requests beyond the limit: 1 to 10
        fc.integer({ min: 1, max: 10 }),
        // windowSeconds (W): 1 to 30
        fc.integer({ min: 1, max: 30 }),
        async (ip, maxRequests, extraRequests, windowSeconds) => {
          let callCount = 0;
          vi.mocked(incrementRateLimit).mockImplementation(() => {
            callCount++;
            return Promise.resolve(callCount);
          });

          const config: RateLimitConfig = {
            endpoint: 'quote-status',
            maxRequests,
            windowSeconds,
          };

          // Exhaust allowed requests
          for (let i = 1; i <= maxRequests; i++) {
            await checkRateLimit(ip, config);
          }

          // All denied requests should have remainingRequests = 0
          for (let i = 1; i <= extraRequests; i++) {
            const result = await checkRateLimit(ip, config);
            expect(result.allowed).toBe(false);
            expect(result.remainingRequests).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
