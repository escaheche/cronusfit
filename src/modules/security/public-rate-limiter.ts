/**
 * IP-based rate limiting for public API endpoints using DynamoDB counters with TTL.
 *
 * Uses the X-Forwarded-For header from CloudFront to identify client IPs.
 * CloudFront appends the actual client IP as the rightmost entry.
 *
 * Default config for quote submissions: 10 requests per IP per hour,
 * configurable via QUOTE_RATE_LIMIT_MAX and QUOTE_RATE_LIMIT_WINDOW_SECONDS env vars.
 */

import type { RateLimitConfig, RateLimitResult } from '../../types/security.js';
import { incrementRateLimit } from '../../db/operations.js';

// ---------------------------------------------------------------------------
// Default configuration for quote submissions (configurable via env vars)
// ---------------------------------------------------------------------------

/** Maximum quote submissions per IP per window (default: 10). */
const QUOTE_RATE_LIMIT_MAX = parseInt(
  process.env.QUOTE_RATE_LIMIT_MAX ?? '10',
  10
);

/** Rate limit window duration in seconds (default: 3600 = 1 hour). */
const QUOTE_RATE_LIMIT_WINDOW_SECONDS = parseInt(
  process.env.QUOTE_RATE_LIMIT_WINDOW_SECONDS ?? '3600',
  10
);

/**
 * Extracts the client IP address from the X-Forwarded-For header.
 *
 * CloudFront appends the real client IP as the rightmost entry in X-Forwarded-For.
 * - Single IP: return it directly (the client IP added by CloudFront).
 * - Multiple IPs: the rightmost is CloudFront-appended (trusted), so take the
 *   second-to-last IP (leftmost untrusted).
 * - Missing/empty header: return null (triggers HTTP 400).
 */
export function extractClientIp(xForwardedFor: string | undefined): string | null {
  if (!xForwardedFor || xForwardedFor.trim() === '') {
    return null;
  }

  const ips = xForwardedFor
    .split(',')
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);

  if (ips.length === 0) {
    return null;
  }

  if (ips.length === 1) {
    return ips[0];
  }

  // Multiple IPs: rightmost is CloudFront-appended (trusted), take second from right
  return ips[ips.length - 2];
}

/**
 * Checks whether a request from the given IP is allowed under the rate limit.
 * Uses DynamoDB atomic counters with TTL-based window expiration.
 *
 * Fixed 15-minute windows aligned to clock boundaries ensure consistent
 * rate limiting regardless of when the first request arrives.
 *
 * @param ip - The client IP address extracted from X-Forwarded-For
 * @param config - Rate limit configuration for the endpoint
 * @returns Rate limit check result with allowed status and remaining requests
 */
export async function checkRateLimit(
  ip: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;

  // Calculate the start of the current fixed window (aligned to clock boundaries)
  const windowStart = Math.floor(now / windowMs) * windowMs;

  // Atomically increment the counter for this IP/endpoint/window
  const currentCount = await incrementRateLimit(
    ip,
    config.endpoint,
    windowStart,
    config.windowSeconds
  );

  const allowed = currentCount <= config.maxRequests;
  const remainingRequests = Math.max(0, config.maxRequests - currentCount);

  // Calculate seconds until the current window expires
  const retryAfterSeconds = Math.ceil((windowStart + windowMs - now) / 1000);

  const result: RateLimitResult = {
    allowed,
    currentCount,
    remainingRequests,
  };

  // Include retryAfterSeconds when the request is denied
  if (!allowed) {
    result.retryAfterSeconds = retryAfterSeconds;
    logRateLimitViolation(ip, config.endpoint, currentCount);
  }

  return result;
}

/**
 * Structured log entry for rate limit violations.
 */
export interface RateLimitViolationLog {
  type: 'RATE_LIMIT_VIOLATION';
  ip: string;
  endpoint: string;
  timestamp: string;
  requestCount: number;
}

/**
 * Logs a rate limit violation with structured JSON output.
 *
 * Records the source IP, endpoint, ISO 8601 timestamp, and request count
 * at the time of violation. Returns the log object for testability.
 *
 * @param ip - The client IP address that exceeded the rate limit
 * @param endpoint - The endpoint being rate-limited
 * @param requestCount - The request count at the time of violation
 * @returns The structured log entry
 */
export function logRateLimitViolation(
  ip: string,
  endpoint: string,
  requestCount: number
): RateLimitViolationLog {
  const logEntry: RateLimitViolationLog = {
    type: 'RATE_LIMIT_VIOLATION',
    ip,
    endpoint,
    timestamp: new Date().toISOString(),
    requestCount,
  };

  console.warn(JSON.stringify(logEntry));

  return logEntry;
}

// ---------------------------------------------------------------------------
// Public endpoint rate limiting (convenience wrapper for quote submissions)
// ---------------------------------------------------------------------------

/**
 * Checks whether a request from the given IP is allowed for a public endpoint.
 *
 * Uses the configurable defaults for quote submissions:
 * - 10 requests per IP per hour (env: QUOTE_RATE_LIMIT_MAX)
 * - 1-hour window (env: QUOTE_RATE_LIMIT_WINDOW_SECONDS)
 *
 * @param ip - The client IP address
 * @param endpoint - The public endpoint identifier (e.g., 'quote-submit')
 * @returns Rate limit check result with allowed status and remaining requests
 */
export async function checkPublicRateLimit(
  ip: string,
  endpoint: string
): Promise<RateLimitResult> {
  const config: RateLimitConfig = {
    endpoint,
    maxRequests: QUOTE_RATE_LIMIT_MAX,
    windowSeconds: QUOTE_RATE_LIMIT_WINDOW_SECONDS,
  };

  return checkRateLimit(ip, config);
}
