/**
 * Property-based tests for hCaptcha token one-time use enforcement.
 *
 * **Validates: Requirements 8.6**
 *
 * Property 17: hCaptcha token one-time use enforcement
 * For any valid hCaptcha token that has been successfully verified once,
 * a subsequent verification attempt with the same token SHALL fail,
 * regardless of whether it is submitted to the same or a different endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { createHash } from 'node:crypto';

// Mock db/operations (isTokenUsed, storeUsedToken)
vi.mock('../../src/db/operations.js', () => ({
  isTokenUsed: vi.fn(),
  storeUsedToken: vi.fn(),
}));

// Mock global fetch for the hCaptcha siteverify API
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { isTokenUsed, storeUsedToken } from '../../src/db/operations.js';
import { verifyCaptcha } from '../../src/modules/security/captcha.js';

describe('Property 17: hCaptcha token one-time use enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HCAPTCHA_SECRET = 'test-hcaptcha-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HCAPTCHA_SECRET;
  });

  it('any valid token verified once SHALL fail on subsequent attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate non-empty tokens that won't be treated as "missing" after trim
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        // Generate IPv4 addresses
        fc.ipV4(),
        async (token, ip) => {
          vi.clearAllMocks();

          // --- First call: token not used yet, hCaptcha API returns success ---
          vi.mocked(isTokenUsed).mockResolvedValueOnce(false);
          vi.mocked(storeUsedToken).mockResolvedValueOnce(undefined);

          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);

          const firstResult = await verifyCaptcha(token, ip);

          // First verification should succeed
          expect(firstResult.valid).toBe(true);
          expect(firstResult.error).toBeUndefined();

          // storeUsedToken should have been called with the token's SHA-256 hash
          expect(storeUsedToken).toHaveBeenCalledTimes(1);
          const expectedHash = createHash('sha256').update(token).digest('hex');
          expect(vi.mocked(storeUsedToken).mock.calls[0][0]).toBe(expectedHash);

          // --- Second call: same token is now marked as used ---
          vi.mocked(isTokenUsed).mockResolvedValueOnce(true);

          const secondResult = await verifyCaptcha(token, ip);

          // Second verification should fail with reused_token error
          expect(secondResult.valid).toBe(false);
          expect(secondResult.error).toBe('reused_token');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('storeUsedToken is called with the SHA-256 hash of the token on first successful verification', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        fc.ipV4(),
        async (token, ip) => {
          vi.clearAllMocks();

          vi.mocked(isTokenUsed).mockResolvedValueOnce(false);
          vi.mocked(storeUsedToken).mockResolvedValueOnce(undefined);

          mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true }),
          } as Response);

          const result = await verifyCaptcha(token, ip);

          expect(result.valid).toBe(true);

          // storeUsedToken must be called exactly once with a valid SHA-256 hash
          expect(storeUsedToken).toHaveBeenCalledTimes(1);
          const hash = vi.mocked(storeUsedToken).mock.calls[0][0];
          expect(hash).toHaveLength(64);
          expect(hash).toMatch(/^[a-f0-9]{64}$/);

          // Same token should always produce the same deterministic hash
          const expectedHash = createHash('sha256').update(token).digest('hex');
          expect(hash).toBe(expectedHash);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('a reused token is rejected immediately without calling hCaptcha API', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        fc.ipV4(),
        async (token, ip) => {
          vi.clearAllMocks();

          // Token is already used
          vi.mocked(isTokenUsed).mockResolvedValueOnce(true);

          const result = await verifyCaptcha(token, ip);

          expect(result.valid).toBe(false);
          expect(result.error).toBe('reused_token');

          // hCaptcha API should NOT be called for reused tokens
          expect(mockFetch).not.toHaveBeenCalled();

          // storeUsedToken should NOT be called again
          expect(storeUsedToken).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });
});
