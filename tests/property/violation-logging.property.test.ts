import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { logRateLimitViolation } from '../../src/modules/security/public-rate-limiter.js';

/**
 * Property 15: Rate limit violation logging completeness
 *
 * For any rate limit violation event, the log entry SHALL contain:
 * source IP address, endpoint name, timestamp (ISO 8601), and request
 * count at time of violation.
 *
 * **Validates: Requirements 7.7**
 */
describe('Property 15: Rate limit violation logging completeness', () => {
  it('for any IP, endpoint, and request count: the returned log object contains all four fields', () => {
    fc.assert(
      fc.property(
        fc.ipV4(),
        fc.constantFrom('quote-submit', 'quote-status'),
        fc.integer({ min: 1, max: 1000 }),
        (ip, endpoint, requestCount) => {
          const logEntry = logRateLimitViolation(ip, endpoint, requestCount);

          expect(logEntry).toHaveProperty('type');
          expect(logEntry).toHaveProperty('ip');
          expect(logEntry).toHaveProperty('endpoint');
          expect(logEntry).toHaveProperty('timestamp');
          expect(logEntry).toHaveProperty('requestCount');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the type field is always RATE_LIMIT_VIOLATION', () => {
    fc.assert(
      fc.property(
        fc.ipV4(),
        fc.constantFrom('quote-submit', 'quote-status'),
        fc.integer({ min: 1, max: 1000 }),
        (ip, endpoint, requestCount) => {
          const logEntry = logRateLimitViolation(ip, endpoint, requestCount);

          expect(logEntry.type).toBe('RATE_LIMIT_VIOLATION');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the timestamp field is a valid ISO 8601 string (parseable by new Date())', () => {
    fc.assert(
      fc.property(
        fc.ipV4(),
        fc.constantFrom('quote-submit', 'quote-status'),
        fc.integer({ min: 1, max: 1000 }),
        (ip, endpoint, requestCount) => {
          const logEntry = logRateLimitViolation(ip, endpoint, requestCount);

          const parsed = new Date(logEntry.timestamp);
          expect(parsed.getTime()).not.toBeNaN();
          // ISO 8601 format check: must match YYYY-MM-DDTHH:mm:ss.sssZ pattern
          expect(logEntry.timestamp).toMatch(
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the ip and endpoint fields match the inputs exactly', () => {
    fc.assert(
      fc.property(
        fc.ipV4(),
        fc.constantFrom('quote-submit', 'quote-status'),
        fc.integer({ min: 1, max: 1000 }),
        (ip, endpoint, requestCount) => {
          const logEntry = logRateLimitViolation(ip, endpoint, requestCount);

          expect(logEntry.ip).toBe(ip);
          expect(logEntry.endpoint).toBe(endpoint);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the requestCount field matches the input', () => {
    fc.assert(
      fc.property(
        fc.ipV4(),
        fc.constantFrom('quote-submit', 'quote-status'),
        fc.integer({ min: 1, max: 1000 }),
        (ip, endpoint, requestCount) => {
          const logEntry = logRateLimitViolation(ip, endpoint, requestCount);

          expect(logEntry.requestCount).toBe(requestCount);
        },
      ),
      { numRuns: 200 },
    );
  });
});
