/**
 * Property-based tests for hCaptcha token rejection reasons.
 *
 * **Validates: Requirements 8.3, 8.6**
 *
 * Property 16: hCaptcha token rejection with correct error reason
 * - For any empty/whitespace-only token → error is 'missing_token'
 * - For any token where isTokenUsed returns true → error is 'reused_token'
 * - For any token where hCaptcha API returns { success: false, "error-codes": ["expired-or-already-seen-response"] } → error is 'expired_token'
 * - For any token where hCaptcha API returns { success: false } (without the expired code) → error is 'invalid_token'
 * - For any token where fetch throws/times out → error is 'service_unavailable'
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// Mock db/operations
vi.mock('../../src/db/operations.js', () => ({
  isTokenUsed: vi.fn(),
  storeUsedToken: vi.fn(),
}));

import { isTokenUsed, storeUsedToken } from '../../src/db/operations.js';
import { verifyCaptcha } from '../../src/modules/security/captcha.js';

describe('Property 16: hCaptcha token rejection with correct error reason', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.mocked(isTokenUsed).mockResolvedValue(false);
    vi.mocked(storeUsedToken).mockResolvedValue(undefined);
    process.env.HCAPTCHA_SECRET = 'test-secret-key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    delete process.env.HCAPTCHA_SECRET;
  });

  it('empty or whitespace-only tokens produce missing_token error', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate empty or whitespace-only strings
        fc.stringOf(fc.constantFrom(' ', '\t', '\n', '\r')),
        fc.ipV4(),
        async (token, remoteIp) => {
          const result = await verifyCaptcha(token, remoteIp);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('missing_token');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('previously used tokens produce reused_token error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.ipV4(),
        async (token, remoteIp) => {
          // Mock isTokenUsed to return true (token already consumed)
          vi.mocked(isTokenUsed).mockResolvedValue(true);

          const result = await verifyCaptcha(token, remoteIp);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('reused_token');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('expired tokens from hCaptcha API produce expired_token error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.ipV4(),
        async (token, remoteIp) => {
          vi.mocked(isTokenUsed).mockResolvedValue(false);

          // Mock fetch to return expired response from hCaptcha
          globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                success: false,
                'error-codes': ['expired-or-already-seen-response'],
              }),
              { status: 200 },
            ),
          );

          const result = await verifyCaptcha(token, remoteIp);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('expired_token');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid tokens from hCaptcha API (without expired code) produce invalid_token error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.ipV4(),
        async (token, remoteIp) => {
          vi.mocked(isTokenUsed).mockResolvedValue(false);

          // Mock fetch to return generic failure (no expired error code)
          globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({ success: false }),
              { status: 200 },
            ),
          );

          const result = await verifyCaptcha(token, remoteIp);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('invalid_token');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('fetch errors or timeouts produce service_unavailable error', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.ipV4(),
        async (token, remoteIp) => {
          vi.mocked(isTokenUsed).mockResolvedValue(false);

          // Mock fetch to throw (simulating network error or timeout)
          globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

          const result = await verifyCaptcha(token, remoteIp);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('service_unavailable');
        },
      ),
      { numRuns: 100 },
    );
  });
});
