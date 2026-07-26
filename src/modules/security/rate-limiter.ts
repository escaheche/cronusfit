/**
 * Login rate limiting for admin authentication.
 *
 * Tracks failed login attempts per IP address in DynamoDB with TTL-based
 * automatic cleanup. Blocks further login attempts after 5 failures within
 * a 15-minute window for an additional 15 minutes.
 *
 * Satisfies Requirement 13.4:
 * "IF 5 failed login attempts occur from the same IP address within a
 * 15-minute window, THEN THE Platform SHALL temporarily block further
 * login attempts from that IP for 15 minutes and log the lockout event."
 */

import type { LoginRateLimitConfig } from '../../types/security.js';
import {
  recordLoginAttempt,
  getRecentLoginAttempts,
  writeAuditLog,
} from '../../db/operations.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default rate limit configuration (overridable via environment variables). */
export function getLoginRateLimitConfig(): LoginRateLimitConfig {
  return {
    maxAttempts: parseInt(process.env.MAX_LOGIN_ATTEMPTS ?? '5', 10),
    windowMinutes: parseInt(process.env.WINDOW_MINUTES ?? '15', 10),
    lockoutMinutes: parseInt(process.env.LOCKOUT_MINUTES ?? '15', 10),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of checking whether a login attempt is allowed. */
export interface RateLimitCheckResult {
  /** Whether the login attempt is allowed. */
  allowed: boolean;
  /** Number of remaining attempts before lockout (0 if locked out). */
  attemptsRemaining: number;
  /** ISO 8601 timestamp when the lockout ends (present only when locked out). */
  lockoutEndsAt?: string;
}

/** Structured log entry for lockout events. */
export interface LockoutLogEntry {
  type: 'LOGIN_LOCKOUT';
  ip: string;
  failedAttempts: number;
  lockoutEndsAt: string;
  timestamp: string;
  adminEmail?: string;
}

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Checks whether a login attempt from the given IP is currently allowed.
 *
 * Logic:
 * 1. Query recent failed attempts within the configured window (default 15 min).
 * 2. If count >= maxAttempts (5), calculate lockout end time from last failure.
 * 3. If lockout period has not passed, return { allowed: false }.
 * 4. If not locked out, return { allowed: true, attemptsRemaining }.
 *
 * @param ip - The client IP address to check
 * @returns Rate limit check result
 */
export async function checkLoginRateLimit(
  ip: string
): Promise<RateLimitCheckResult> {
  const config = getLoginRateLimitConfig();
  const now = new Date();
  const windowStart = new Date(
    now.getTime() - config.windowMinutes * 60 * 1000
  );

  const attempts = await getRecentLoginAttempts(
    ip,
    windowStart.toISOString()
  );

  // Count only failed attempts within the window
  const failedAttempts = attempts.filter((a) => !a.success);

  if (failedAttempts.length >= config.maxAttempts) {
    // Find the most recent failed attempt to calculate lockout end
    const lastFailure = failedAttempts.reduce((latest, attempt) => {
      return attempt.timestamp > latest.timestamp ? attempt : latest;
    });

    const lockoutEnd = new Date(
      new Date(lastFailure.timestamp).getTime() +
        config.lockoutMinutes * 60 * 1000
    );

    if (now < lockoutEnd) {
      // Still locked out
      return {
        allowed: false,
        attemptsRemaining: 0,
        lockoutEndsAt: lockoutEnd.toISOString(),
      };
    }
  }

  // Not locked out
  const attemptsRemaining = Math.max(
    0,
    config.maxAttempts - failedAttempts.length
  );

  return {
    allowed: true,
    attemptsRemaining,
  };
}

/**
 * Records a failed login attempt for the given IP address.
 *
 * Stores the attempt in DynamoDB with a TTL for automatic cleanup.
 * If the failure count reaches the threshold, logs a lockout event.
 *
 * @param ip - The client IP address
 * @param adminEmail - Optional email of the admin attempting to log in
 */
export async function recordFailedLogin(
  ip: string,
  adminEmail?: string
): Promise<void> {
  const config = getLoginRateLimitConfig();
  const now = new Date();
  const timestamp = now.toISOString();

  // TTL should cover both the window and the lockout period
  const ttlSeconds = (config.windowMinutes + config.lockoutMinutes) * 60;

  await recordLoginAttempt(ip, timestamp, false, adminEmail, ttlSeconds);

  // Check if this failure triggers a lockout
  const windowStart = new Date(
    now.getTime() - config.windowMinutes * 60 * 1000
  );

  const attempts = await getRecentLoginAttempts(
    ip,
    windowStart.toISOString()
  );

  const failedAttempts = attempts.filter((a) => !a.success);

  if (failedAttempts.length >= config.maxAttempts) {
    const lockoutEnd = new Date(
      now.getTime() + config.lockoutMinutes * 60 * 1000
    );

    // Log the lockout event
    logLockoutEvent(ip, failedAttempts.length, lockoutEnd.toISOString(), adminEmail);

    // Write audit log entry for the lockout (best-effort)
    try {
      await writeAuditLog({
        adminId: 'SYSTEM',
        adminEmail: adminEmail ?? 'unknown',
        timestamp,
        actionType: 'login_lockout',
        resourceId: ip,
        resourceType: 'ip_address',
        metadata: {
          failedAttempts: failedAttempts.length,
          lockoutEndsAt: lockoutEnd.toISOString(),
          windowMinutes: config.windowMinutes,
        },
      });
    } catch {
      // Best-effort audit logging — don't fail the primary operation
      console.error(
        JSON.stringify({
          type: 'AUDIT_LOG_FAILURE',
          context: 'login_lockout',
          ip,
          timestamp,
        })
      );
    }
  }
}

/**
 * Records a successful login attempt for the given IP address.
 *
 * A successful login is recorded to mark the end of failed attempt sequences.
 * Note: This does NOT clear previous failed attempts — the window-based
 * approach means old failures naturally expire via TTL.
 *
 * @param ip - The client IP address
 * @param adminEmail - Email of the admin who logged in successfully
 */
export async function recordSuccessfulLogin(
  ip: string,
  adminEmail: string
): Promise<void> {
  const config = getLoginRateLimitConfig();
  const timestamp = new Date().toISOString();

  // TTL for successful login records (shorter, mainly for tracking)
  const ttlSeconds = config.windowMinutes * 60;

  await recordLoginAttempt(ip, timestamp, true, adminEmail, ttlSeconds);
}

/**
 * Convenience function to check if an IP is currently locked out.
 *
 * @param ip - The client IP address to check
 * @returns true if the IP is currently locked out
 */
export async function isLockedOut(ip: string): Promise<boolean> {
  const result = await checkLoginRateLimit(ip);
  return !result.allowed;
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Logs a lockout event as a structured JSON entry to CloudWatch.
 *
 * @param ip - The locked out IP address
 * @param failedAttempts - Number of failed attempts that triggered the lockout
 * @param lockoutEndsAt - ISO 8601 timestamp when the lockout expires
 * @param adminEmail - Optional admin email associated with the attempts
 * @returns The structured log entry (for testability)
 */
export function logLockoutEvent(
  ip: string,
  failedAttempts: number,
  lockoutEndsAt: string,
  adminEmail?: string
): LockoutLogEntry {
  const logEntry: LockoutLogEntry = {
    type: 'LOGIN_LOCKOUT',
    ip,
    failedAttempts,
    lockoutEndsAt,
    timestamp: new Date().toISOString(),
    adminEmail,
  };

  console.warn(JSON.stringify(logEntry));

  return logEntry;
}
