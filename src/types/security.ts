/**
 * Security-related type definitions for CronusFit.
 * Covers audit logging, login rate limiting, session management,
 * CAPTCHA verification, and credential configuration.
 */

/** Immutable audit log entry stored in DynamoDB. */
export interface AuditLogEntry {
  /** Partition key: AUDIT#{adminId} */
  PK: string;
  /** Sort key: ACTION#{timestamp} */
  SK: string;
  /** GSI1 partition key: AUDITTYPE#{actionType} */
  GSI1PK: string;
  /** GSI1 sort key: TIME#{timestamp} */
  GSI1SK: string;
  /** Admin's Cognito sub identifier. */
  adminId: string;
  /** Admin's email address. */
  adminEmail: string;
  /** Timestamp of the action (UTC ISO 8601). */
  timestamp: string;
  /** Type of action performed (e.g., pattern_generate, mockup_approve, publish). */
  actionType: string;
  /** Identifier of the affected resource. */
  resourceId: string;
  /** Type of the affected resource (e.g., pattern, mockup, quote). */
  resourceType: string;
  /** Additional metadata about the action. */
  metadata?: Record<string, unknown>;
}

/** Record of a login attempt stored in DynamoDB for rate limiting. */
export interface LoginAttemptRecord {
  /** Partition key: LOGINATTEMPT#{ipAddress} */
  PK: string;
  /** Sort key: ATTEMPT#{timestamp} */
  SK: string;
  /** IP address that made the login attempt. */
  ipAddress: string;
  /** Timestamp of the attempt (UTC ISO 8601). */
  timestamp: string;
  /** Whether the login attempt was successful. */
  success: boolean;
  /** Email of the admin attempting to log in (if provided). */
  adminEmail?: string;
}

/** Request payload for server-side hCaptcha token verification. */
export interface CaptchaVerifyRequest {
  /** The hCaptcha response token from the client. */
  token: string;
  /** The client's remote IP address. */
  remoteIp: string;
}

/** Response from hCaptcha verification service. */
export interface CaptchaVerifyResponse {
  /** Whether the CAPTCHA token is valid. */
  success: boolean;
  /** Timestamp of the challenge (UTC ISO 8601). */
  challengeTs?: string;
  /** Hostname where the CAPTCHA was solved. */
  hostname?: string;
  /** Error codes if verification failed. */
  errorCodes?: string[];
}

/** Session management configuration. */
export interface SessionConfig {
  /** Inactivity timeout in minutes (default 30, configurable 5-120). */
  inactivityTimeoutMinutes: number;
  /** Maximum concurrent sessions per Admin. */
  maxConcurrentSessions: number;
}

/** Configuration for login rate limiting. */
export interface LoginRateLimitConfig {
  /** Maximum failed attempts before lockout. */
  maxAttempts: number;
  /** Window duration in minutes for counting attempts. */
  windowMinutes: number;
  /** Lockout duration in minutes after exceeding max attempts. */
  lockoutMinutes: number;
}

/** Configuration for IP-based rate limiting on public endpoints. */
export interface RateLimitConfig {
  /** The endpoint being rate-limited. */
  endpoint: string;
  /** Maximum number of requests allowed per window. */
  maxRequests: number;
  /** Duration of the rate limit window in seconds. */
  windowSeconds: number;
}

/** Result of a rate limit check for a given IP and endpoint. */
export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Current number of requests in the active window. */
  currentCount: number;
  /** Number of requests remaining before the limit is reached. */
  remainingRequests: number;
  /** Seconds until the current window expires (present when rate-limited). */
  retryAfterSeconds?: number;
}

/** Result of hCaptcha token verification (alias for backward compat). */
export interface CaptchaVerifyResult {
  /** Whether the token is valid. */
  valid: boolean;
  /** Error reason when the token is invalid. */
  error?:
    | 'missing_token'
    | 'invalid_token'
    | 'expired_token'
    | 'reused_token'
    | 'service_unavailable';
}
