import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { extractClientIp } from '../../src/modules/security/public-rate-limiter.js';

/**
 * Property 14: IP extraction from X-Forwarded-For
 *
 * For any X-Forwarded-For header value containing one or more comma-separated
 * IP addresses, the extraction function SHALL return the rightmost IP when only
 * one IP is present, or the leftmost untrusted IP (second from right) when
 * multiple IPs are present. For any empty or missing header value, the function
 * SHALL return null.
 *
 * **Validates: Requirements 7.5, 7.8**
 */
describe('Property 14: IP extraction from X-Forwarded-For', () => {
  // Generator for valid IPv4 addresses
  const ipArb = fc
    .tuple(fc.nat(255), fc.nat(255), fc.nat(255), fc.nat(255))
    .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

  it('single IP → returns that IP exactly', () => {
    fc.assert(
      fc.property(ipArb, (ip) => {
        const result = extractClientIp(ip);
        expect(result).toBe(ip);
      }),
      { numRuns: 200 },
    );
  });

  it('two IPs (a, b) → returns a (second from right)', () => {
    fc.assert(
      fc.property(ipArb, ipArb, (clientIp, cloudFrontIp) => {
        const header = `${clientIp}, ${cloudFrontIp}`;
        const result = extractClientIp(header);
        expect(result).toBe(clientIp);
      }),
      { numRuns: 200 },
    );
  });

  it('three or more IPs → returns second from right', () => {
    fc.assert(
      fc.property(
        fc.array(ipArb, { minLength: 1, maxLength: 5 }),
        ipArb,
        ipArb,
        (prefixIps, expectedIp, cloudFrontIp) => {
          // Build header: ...prefixIps, expectedIp, cloudFrontIp
          // The second from right should be expectedIp
          const allIps = [...prefixIps, expectedIp, cloudFrontIp];
          const header = allIps.join(', ');
          const result = extractClientIp(header);
          expect(result).toBe(expectedIp);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('undefined header → returns null', () => {
    const result = extractClientIp(undefined);
    expect(result).toBeNull();
  });

  it('empty string → returns null', () => {
    const result = extractClientIp('');
    expect(result).toBeNull();
  });

  it('whitespace-only strings → returns null', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 20 }),
        (whitespace) => {
          const result = extractClientIp(whitespace);
          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
