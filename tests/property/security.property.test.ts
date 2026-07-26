/**
 * Property-based tests for Security module (Properties 28–32).
 *
 * **Validates: Requirements 13.1–13.7**
 *
 * Property 28: JWT Authentication Enforcement
 * - For any missing, expired, or invalid JWT token, validateToken SHALL throw AuthenticationError.
 *
 * Property 29: Session Inactivity Timeout
 * - For any inactivity period > configured timeout, checkSessionTimeout returns true (expired).
 * - For any inactivity period < configured timeout, checkSessionTimeout returns false (active).
 *
 * Property 30: Login Rate Limiting
 * - For any IP with ≥5 failures in 15min window → always returns locked.
 * - For any IP with <5 failures in 15min window → always returns unlocked.
 *
 * Property 31: Audit Log Completeness
 * - For any admin action, recordAuditEntry always calls writeAuditLog with required fields:
 *   adminId, timestamp, actionType, resourceId.
 *
 * Property 32: Quote Submission CAPTCHA and Rate Limiting
 * - CAPTCHA is required (invalid token → rejected).
 * - Rate limit enforced at 10/IP/hour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock jose (for JWT validation tests)
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
  decodeJwt: vi.fn(),
}));

// Mock db/operations
vi.mock('../../src/db/operations.js', () => ({
  writeAuditLog: vi.fn(),
  queryByPK: vi.fn(),
  queryByGSI1: vi.fn(),
  queryByGSI2: vi.fn(),
  recordLoginAttempt: vi.fn(),
  getRecentLoginAttempts: vi.fn(),
  incrementRateLimit: vi.fn(),
  isTokenUsed: vi.fn(),
  storeUsedToken: vi.fn(),
}));

import { jwtVerify } from 'jose';
import { writeAuditLog, getRecentLoginAttempts, incrementRateLimit, isTokenUsed } from '../../src/db/operations.js';
import { validateToken, checkSessionTimeout, SESSION_TIMEOUT_MIN, SESSION_TIMEOUT_MAX } from '../../src/modules/security/cognito-auth.js';
import { checkLoginRateLimit } from '../../src/modules/security/rate-limiter.js';
import { recordAuditEntry } from '../../src/modules/security/audit-log.js';
import { verifyCaptcha } from '../../src/modules/security/captcha.js';
import { checkPublicRateLimit } from '../../src/modules/security/public-rate-limiter.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Property 28: JWT Authentication Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property 28: JWT Authentication Enforcement', () => {
  /**
   * **Validates: Requirements 13.1, 13.2**
   */

  beforeEach(() => {
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testPool123';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.COGNITO_USER_POOL_ID;
    delete process.env.COGNITO_CLIENT_ID;
  });

  it('rejects any empty or whitespace-only token with AuthenticationError', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.stringOf(fc.constantFrom('', ' ', '\t', '\n', '\r')),
        async (token) => {
          await expect(validateToken(token)).rejects.toThrow();
          try {
            await validateToken(token);
          } catch (error: unknown) {
            const err = error as { name: string; code: string };
            expect(err.name).toBe('AuthenticationError');
            expect(err.code).toBe('MISSING_TOKEN');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects any token that fails JWKS signature verification', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary non-empty strings as invalid tokens
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (token) => {
          // Simulate jose throwing a signature verification error
          vi.mocked(jwtVerify).mockRejectedValue(new Error('JWS signature verification failed'));

          await expect(validateToken(token)).rejects.toThrow();
          try {
            await validateToken(token);
          } catch (error: unknown) {
            const err = error as { name: string; code: string };
            expect(err.name).toBe('AuthenticationError');
            expect(err.code).toBe('INVALID_SIGNATURE');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects any expired token with EXPIRED_TOKEN error code', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (token) => {
          // Simulate jose throwing an expiration error
          vi.mocked(jwtVerify).mockRejectedValue(new Error('"exp" claim timestamp check failed'));

          await expect(validateToken(token)).rejects.toThrow();
          try {
            await validateToken(token);
          } catch (error: unknown) {
            const err = error as { name: string; code: string };
            expect(err.name).toBe('AuthenticationError');
            expect(err.code).toBe('EXPIRED_TOKEN');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects any token with invalid issuer', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
        async (token) => {
          vi.mocked(jwtVerify).mockRejectedValue(new Error('"iss" claim check failed'));

          await expect(validateToken(token)).rejects.toThrow();
          try {
            await validateToken(token);
          } catch (error: unknown) {
            const err = error as { name: string; code: string };
            expect(err.name).toBe('AuthenticationError');
            expect(err.code).toBe('INVALID_ISSUER');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 29: Session Inactivity Timeout
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property 29: Session Inactivity Timeout', () => {
  /**
   * **Validates: Requirements 13.3**
   */

  it('session is expired when inactivity exceeds configured timeout', () => {
    fc.assert(
      fc.property(
        // Timeout between 5 and 120 minutes
        fc.integer({ min: SESSION_TIMEOUT_MIN, max: SESSION_TIMEOUT_MAX }),
        // Extra minutes beyond the timeout (at least 1 minute past)
        fc.integer({ min: 1, max: 500 }),
        (timeoutMinutes, extraMinutes) => {
          const totalInactivityMs = (timeoutMinutes + extraMinutes) * 60 * 1000;
          const lastActivity = new Date(Date.now() - totalInactivityMs).toISOString();

          const isExpired = checkSessionTimeout(lastActivity, timeoutMinutes);
          expect(isExpired).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('session is NOT expired when inactivity is below configured timeout', () => {
    fc.assert(
      fc.property(
        // Timeout between 5 and 120 minutes
        fc.integer({ min: SESSION_TIMEOUT_MIN, max: SESSION_TIMEOUT_MAX }),
        // Fraction of timeout elapsed (0% to 99%)
        fc.integer({ min: 0, max: 99 }),
        (timeoutMinutes, percentElapsed) => {
          // Calculate ms elapsed as a percentage of the timeout (never reaching 100%)
          const elapsedMs = Math.floor((timeoutMinutes * 60 * 1000 * percentElapsed) / 100);
          // Ensure we subtract at least 1ms less than the timeout
          const safeElapsedMs = Math.min(elapsedMs, timeoutMinutes * 60 * 1000 - 1000);
          const lastActivity = new Date(Date.now() - safeElapsedMs).toISOString();

          const isExpired = checkSessionTimeout(lastActivity, timeoutMinutes);
          expect(isExpired).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('invalid lastActivity date is treated as expired for safety', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary strings that aren't valid ISO dates
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => isNaN(new Date(s).getTime())),
        fc.integer({ min: SESSION_TIMEOUT_MIN, max: SESSION_TIMEOUT_MAX }),
        (invalidDate, timeoutMinutes) => {
          const isExpired = checkSessionTimeout(invalidDate, timeoutMinutes);
          expect(isExpired).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 30: Login Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property 30: Login Rate Limiting', () => {
  /**
   * **Validates: Requirements 13.4**
   */

  beforeEach(() => {
    process.env.MAX_LOGIN_ATTEMPTS = '5';
    process.env.WINDOW_MINUTES = '15';
    process.env.LOCKOUT_MINUTES = '15';
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MAX_LOGIN_ATTEMPTS;
    delete process.env.WINDOW_MINUTES;
    delete process.env.LOCKOUT_MINUTES;
  });

  it('locks out any IP with 5 or more failures within the 15-minute window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),
        // Number of failures: 5 to 20
        fc.integer({ min: 5, max: 20 }),
        async (ip, failureCount) => {
          // Generate timestamps within the last 15 minutes
          const now = new Date();
          const attempts = Array.from({ length: failureCount }, (_, i) => ({
            timestamp: new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString(), // each 1 min ago
            success: false,
            adminEmail: 'test@example.com',
          }));

          vi.mocked(getRecentLoginAttempts).mockResolvedValue(attempts);

          const result = await checkLoginRateLimit(ip);
          expect(result.allowed).toBe(false);
          expect(result.attemptsRemaining).toBe(0);
          expect(result.lockoutEndsAt).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('does NOT lock out any IP with fewer than 5 failures within the window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),
        // Number of failures: 0 to 4
        fc.integer({ min: 0, max: 4 }),
        async (ip, failureCount) => {
          const now = new Date();
          const attempts = Array.from({ length: failureCount }, (_, i) => ({
            timestamp: new Date(now.getTime() - (i + 1) * 60 * 1000).toISOString(),
            success: false,
            adminEmail: 'test@example.com',
          }));

          vi.mocked(getRecentLoginAttempts).mockResolvedValue(attempts);

          const result = await checkLoginRateLimit(ip);
          expect(result.allowed).toBe(true);
          expect(result.attemptsRemaining).toBe(5 - failureCount);
          expect(result.lockoutEndsAt).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 31: Audit Log Completeness
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property 31: Audit Log Completeness', () => {
  /**
   * **Validates: Requirements 13.5**
   */

  beforeEach(() => {
    vi.mocked(writeAuditLog).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('recordAuditEntry always writes with adminId, timestamp, actionType, and resourceId', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          adminId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          adminEmail: fc.emailAddress(),
          actionType: fc.constantFrom(
            'pattern_generate',
            'mockup_approve',
            'mockup_reject',
            'publish',
            'quote_price',
            'print_generate',
          ),
          resourceId: fc.uuid(),
          resourceType: fc.constantFrom('pattern', 'mockup', 'quote', 'product'),
        }),
        async (entry) => {
          await recordAuditEntry(entry);

          expect(writeAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
              adminId: entry.adminId,
              actionType: entry.actionType,
              resourceId: entry.resourceId,
              timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
            }),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('recordAuditEntry includes all provided fields in the write call', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          adminId: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
          adminEmail: fc.emailAddress(),
          actionType: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
          resourceId: fc.uuid(),
          resourceType: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        }),
        async (entry) => {
          vi.mocked(writeAuditLog).mockClear();

          await recordAuditEntry(entry);

          expect(writeAuditLog).toHaveBeenCalledTimes(1);
          const call = vi.mocked(writeAuditLog).mock.calls[0][0];
          expect(call.adminId).toBe(entry.adminId);
          expect(call.adminEmail).toBe(entry.adminEmail);
          expect(call.actionType).toBe(entry.actionType);
          expect(call.resourceId).toBe(entry.resourceId);
          expect(call.resourceType).toBe(entry.resourceType);
          expect(typeof call.timestamp).toBe('string');
          // Verify timestamp is ISO 8601 format
          expect(new Date(call.timestamp).toISOString()).toBe(call.timestamp);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property 32: Quote Submission CAPTCHA and Rate Limiting
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property 32: Quote Submission CAPTCHA and Rate Limiting', () => {
  /**
   * **Validates: Requirements 13.7**
   */

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.HCAPTCHA_SECRET = 'test-secret-key';
    vi.mocked(isTokenUsed).mockResolvedValue(false);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    delete process.env.HCAPTCHA_SECRET;
  });

  it('rejects quote submissions with invalid CAPTCHA token', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
        fc.ipV4(),
        async (token, remoteIp) => {
          vi.mocked(isTokenUsed).mockResolvedValue(false);

          // hCaptcha API returns failure
          globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({ success: false }),
              { status: 200 },
            ),
          );

          const result = await verifyCaptcha(token, remoteIp);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects quote submissions when CAPTCHA token is missing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', ' ', '\t', '\n'),
        fc.ipV4(),
        async (emptyToken, remoteIp) => {
          const result = await verifyCaptcha(emptyToken, remoteIp);
          expect(result.valid).toBe(false);
          expect(result.error).toBe('missing_token');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('enforces rate limit of 10/IP/hour — rejects when count exceeds limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),
        // Current count already at or above limit
        fc.integer({ min: 11, max: 100 }),
        async (ip, currentCount) => {
          vi.mocked(incrementRateLimit).mockResolvedValue(currentCount);

          const result = await checkPublicRateLimit(ip, 'quote-submit');
          expect(result.allowed).toBe(false);
          expect(result.remainingRequests).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('allows requests when count is within the 10/IP/hour limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.ipV4(),
        // Current count within limit (1 to 10)
        fc.integer({ min: 1, max: 10 }),
        async (ip, currentCount) => {
          vi.mocked(incrementRateLimit).mockResolvedValue(currentCount);

          const result = await checkPublicRateLimit(ip, 'quote-submit');
          expect(result.allowed).toBe(true);
          expect(result.remainingRequests).toBe(10 - currentCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});
