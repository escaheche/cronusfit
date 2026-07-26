/**
 * Server-side hCaptcha token verification with one-time use enforcement.
 *
 * Verifies tokens with the hCaptcha siteverify API, checks DynamoDB for reuse,
 * and stores verified token hashes with a 5-minute TTL.
 *
 * The hCaptcha secret key is read from the HCAPTCHA_SECRET environment variable
 * (will migrate to Secrets Manager in a later task).
 */

import { createHash } from 'node:crypto';
import type { CaptchaVerifyResult } from '../../types/security.js';
import { isTokenUsed, storeUsedToken } from '../../db/operations.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HCAPTCHA_VERIFY_URL = 'https://hcaptcha.com/siteverify';

const VERIFY_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Secret retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieves the hCaptcha secret key from the HCAPTCHA_SECRET env var.
 * Throws if not configured.
 */
export function getHCaptchaSecret(): string {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) {
    throw new Error('HCAPTCHA_SECRET environment variable is not set');
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes the SHA-256 hash of a token string (hex-encoded).
 */
function sha256(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Main verification function
// ---------------------------------------------------------------------------

/**
 * Verifies an hCaptcha token server-side.
 *
 * Flow:
 * 1. Reject missing/empty tokens immediately.
 * 2. Check if the token has already been consumed (DynamoDB lookup by hash).
 * 3. Call the hCaptcha siteverify API with a 5-second timeout.
 * 4. Map API error codes to distinct error reasons.
 * 5. On success, store the token hash in DynamoDB (5-min TTL) to prevent reuse.
 *
 * @param token - The hCaptcha response token from the client
 * @param remoteIp - The client's remote IP address
 * @returns Verification result with valid flag and optional error reason
 */
export async function verifyCaptcha(
  token: string,
  remoteIp: string
): Promise<CaptchaVerifyResult> {
  // 1. Missing token check
  if (!token || token.trim() === '') {
    return { valid: false, error: 'missing_token' };
  }

  const tokenHash = sha256(token);

  // 2. One-time use check (reused token)
  const alreadyUsed = await isTokenUsed(tokenHash);
  if (alreadyUsed) {
    return { valid: false, error: 'reused_token' };
  }

  // 3. Call hCaptcha siteverify API
  let secret: string;
  try {
    secret = getHCaptchaSecret();
  } catch {
    return { valid: false, error: 'service_unavailable' };
  }

  const body = new URLSearchParams({
    response: token,
    secret,
    remoteip: remoteIp,
  });

  let apiResponse: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

    apiResponse = await fetch(HCAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // Network error or timeout (AbortError)
    return { valid: false, error: 'service_unavailable' };
  }

  // 4. Parse hCaptcha response
  if (!apiResponse.ok) {
    return { valid: false, error: 'service_unavailable' };
  }

  let result: { success: boolean; 'error-codes'?: string[] };
  try {
    result = (await apiResponse.json()) as { success: boolean; 'error-codes'?: string[] };
  } catch {
    return { valid: false, error: 'service_unavailable' };
  }

  if (!result.success) {
    const errorCodes = result['error-codes'] ?? [];

    // Map hCaptcha error codes to our error reasons
    if (errorCodes.includes('expired-or-already-seen-response')) {
      return { valid: false, error: 'expired_token' };
    }

    return { valid: false, error: 'invalid_token' };
  }

  // 5. Store token hash to prevent reuse, then return success
  await storeUsedToken(tokenHash);

  return { valid: true };
}
