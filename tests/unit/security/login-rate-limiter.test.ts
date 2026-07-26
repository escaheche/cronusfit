import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkLoginRateLimit,
  recordFailedLogin,
  recordSuccessfulLogin,
  isLockedOut,
  logLockoutEvent,
  getLoginRateLimitConfig,
} from '../../../src/modules/security/rate-limiter.js';

// Mock the db operations
vi.mock('../../../src/db/operations.js', () => ({
  recordLoginAttempt: vi.fn(),
  getRecentLoginAttempts: vi.fn(),
  writeAuditLog: vi.fn(),
}));

import {
  recordLoginAttempt,
  getRecentLoginAttempts,
  writeAuditLog,
} from '../../../src/db/operations.js';

const mockedRecordLoginAttempt = vi.mocked(recordLoginAttempt);
const mockedGetRecentLoginAttempts = vi.mocked(getRecentLoginAttempts);
const mockedWriteAuditLog = vi.mocked(writeAuditLog);

describe('Login Rate Limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getLoginRateLimitConfig', () => {
    it('returns default configuration when env vars are not set', () => {
      const config = getLoginRateLimitConfig();
      expect(config.maxAttempts).toBe(5);
      expect(config.windowMinutes).toBe(15);
      expect(config.lockoutMinutes).toBe(15);
    });

    it('uses environment variables when set', () => {
      process.env.MAX_LOGIN_ATTEMPTS = '3';
      process.env.WINDOW_MINUTES = '10';
      process.env.LOCKOUT_MINUTES = '30';

      const config = getLoginRateLimitConfig();
      expect(config.maxAttempts).toBe(3);
      expect(config.windowMinutes).toBe(10);
      expect(config.lockoutMinutes).toBe(30);

      delete process.env.MAX_LOGIN_ATTEMPTS;
      delete process.env.WINDOW_MINUTES;
      delete process.env.LOCKOUT_MINUTES;
    });
  });

  describe('checkLoginRateLimit', () => {
    it('allows login when no recent failed attempts', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([]);

      const result = await checkLoginRateLimit('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(5);
      expect(result.lockoutEndsAt).toBeUndefined();
    });

    it('allows login with fewer than 5 failed attempts', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T11:54:00.000Z', success: false },
      ]);

      const result = await checkLoginRateLimit('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(2);
      expect(result.lockoutEndsAt).toBeUndefined();
    });

    it('blocks login after 5 failed attempts within window', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T11:54:00.000Z', success: false },
        { timestamp: '2024-06-15T11:56:00.000Z', success: false },
        { timestamp: '2024-06-15T11:58:00.000Z', success: false },
      ]);

      const result = await checkLoginRateLimit('192.168.1.1');

      expect(result.allowed).toBe(false);
      expect(result.attemptsRemaining).toBe(0);
      // Lockout ends 15 minutes after last failure (11:58 + 15 min = 12:13)
      expect(result.lockoutEndsAt).toBe('2024-06-15T12:13:00.000Z');
    });

    it('allows login when lockout period has expired', async () => {
      // Current time: 12:00. Last failure at 11:40.
      // Lockout would end at 11:40 + 15 min = 11:55, which is before 12:00.
      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:30:00.000Z', success: false },
        { timestamp: '2024-06-15T11:32:00.000Z', success: false },
        { timestamp: '2024-06-15T11:34:00.000Z', success: false },
        { timestamp: '2024-06-15T11:36:00.000Z', success: false },
        { timestamp: '2024-06-15T11:40:00.000Z', success: false },
      ]);

      // But the window query is since 11:45, so these would still be returned
      // Wait — window is 15 min from now (12:00) → since 11:45.
      // Only the 11:40 attempt is BEFORE 11:45, so it wouldn't be returned.
      // Let me adjust: the function queries from windowStart which is 11:45.
      // Only failures at or after 11:45 would be returned.
      // So with 5 failures BEFORE the window, we'd get 0 failures returned.
      mockedGetRecentLoginAttempts.mockResolvedValue([]);

      const result = await checkLoginRateLimit('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(5);
    });

    it('ignores successful attempts when counting failures', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:51:00.000Z', success: true, adminEmail: 'admin@test.com' },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T11:53:00.000Z', success: true, adminEmail: 'admin@test.com' },
        { timestamp: '2024-06-15T11:54:00.000Z', success: false },
      ]);

      const result = await checkLoginRateLimit('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.attemptsRemaining).toBe(2); // 5 - 3 failures = 2
    });

    it('queries using the correct window start timestamp', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([]);

      await checkLoginRateLimit('10.0.0.1');

      // Window start: current time (12:00) minus 15 minutes = 11:45
      expect(mockedGetRecentLoginAttempts).toHaveBeenCalledWith(
        '10.0.0.1',
        '2024-06-15T11:45:00.000Z'
      );
    });
  });

  describe('recordFailedLogin', () => {
    it('records a failed attempt in DynamoDB with correct TTL', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([]);
      mockedRecordLoginAttempt.mockResolvedValue();

      await recordFailedLogin('192.168.1.1', 'admin@test.com');

      expect(mockedRecordLoginAttempt).toHaveBeenCalledWith(
        '192.168.1.1',
        '2024-06-15T12:00:00.000Z',
        false,
        'admin@test.com',
        1800 // (15 + 15) * 60 = 1800 seconds
      );
    });

    it('logs lockout event when 5th failure is recorded', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRecordLoginAttempt.mockResolvedValue();
      mockedWriteAuditLog.mockResolvedValue();

      // After recording, the query returns 5 failures
      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T11:54:00.000Z', success: false },
        { timestamp: '2024-06-15T11:56:00.000Z', success: false },
        { timestamp: '2024-06-15T12:00:00.000Z', success: false },
      ]);

      await recordFailedLogin('192.168.1.1', 'admin@test.com');

      expect(consoleSpy).toHaveBeenCalled();
      const logCall = consoleSpy.mock.calls[0][0] as string;
      const logEntry = JSON.parse(logCall);
      expect(logEntry.type).toBe('LOGIN_LOCKOUT');
      expect(logEntry.ip).toBe('192.168.1.1');
      expect(logEntry.failedAttempts).toBe(5);
      expect(logEntry.adminEmail).toBe('admin@test.com');

      consoleSpy.mockRestore();
    });

    it('writes audit log on lockout', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRecordLoginAttempt.mockResolvedValue();
      mockedWriteAuditLog.mockResolvedValue();

      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T11:54:00.000Z', success: false },
        { timestamp: '2024-06-15T11:56:00.000Z', success: false },
        { timestamp: '2024-06-15T12:00:00.000Z', success: false },
      ]);

      await recordFailedLogin('192.168.1.1', 'admin@test.com');

      expect(mockedWriteAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'SYSTEM',
          adminEmail: 'admin@test.com',
          actionType: 'login_lockout',
          resourceId: '192.168.1.1',
          resourceType: 'ip_address',
        })
      );

      vi.restoreAllMocks();
    });

    it('does not fail if audit log write fails (best-effort)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedRecordLoginAttempt.mockResolvedValue();
      mockedWriteAuditLog.mockRejectedValue(new Error('DynamoDB unavailable'));

      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T11:54:00.000Z', success: false },
        { timestamp: '2024-06-15T11:56:00.000Z', success: false },
        { timestamp: '2024-06-15T12:00:00.000Z', success: false },
      ]);

      // Should not throw
      await expect(
        recordFailedLogin('192.168.1.1', 'admin@test.com')
      ).resolves.not.toThrow();

      vi.restoreAllMocks();
    });

    it('does not log lockout when fewer than 5 failures', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockedRecordLoginAttempt.mockResolvedValue();

      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T12:00:00.000Z', success: false },
      ]);

      await recordFailedLogin('192.168.1.1');

      expect(consoleSpy).not.toHaveBeenCalled();
      expect(mockedWriteAuditLog).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('recordSuccessfulLogin', () => {
    it('records a successful attempt in DynamoDB', async () => {
      mockedRecordLoginAttempt.mockResolvedValue();

      await recordSuccessfulLogin('192.168.1.1', 'admin@cronusfit.com');

      expect(mockedRecordLoginAttempt).toHaveBeenCalledWith(
        '192.168.1.1',
        '2024-06-15T12:00:00.000Z',
        true,
        'admin@cronusfit.com',
        900 // 15 * 60 = 900 seconds
      );
    });
  });

  describe('isLockedOut', () => {
    it('returns false when IP is not locked out', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([]);

      const result = await isLockedOut('192.168.1.1');

      expect(result).toBe(false);
    });

    it('returns true when IP is locked out', async () => {
      mockedGetRecentLoginAttempts.mockResolvedValue([
        { timestamp: '2024-06-15T11:50:00.000Z', success: false },
        { timestamp: '2024-06-15T11:52:00.000Z', success: false },
        { timestamp: '2024-06-15T11:54:00.000Z', success: false },
        { timestamp: '2024-06-15T11:56:00.000Z', success: false },
        { timestamp: '2024-06-15T11:58:00.000Z', success: false },
      ]);

      const result = await isLockedOut('192.168.1.1');

      expect(result).toBe(true);
    });
  });

  describe('logLockoutEvent', () => {
    it('returns a structured log entry', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const entry = logLockoutEvent(
        '10.0.0.1',
        5,
        '2024-06-15T12:15:00.000Z',
        'admin@test.com'
      );

      expect(entry.type).toBe('LOGIN_LOCKOUT');
      expect(entry.ip).toBe('10.0.0.1');
      expect(entry.failedAttempts).toBe(5);
      expect(entry.lockoutEndsAt).toBe('2024-06-15T12:15:00.000Z');
      expect(entry.adminEmail).toBe('admin@test.com');
      expect(entry.timestamp).toBe('2024-06-15T12:00:00.000Z');

      vi.restoreAllMocks();
    });

    it('works without adminEmail', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const entry = logLockoutEvent(
        '10.0.0.1',
        5,
        '2024-06-15T12:15:00.000Z'
      );

      expect(entry.adminEmail).toBeUndefined();

      vi.restoreAllMocks();
    });
  });
});
