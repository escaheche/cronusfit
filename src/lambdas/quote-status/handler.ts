/**
 * Quote Status Lambda Handler
 *
 * GET /api/quotes/{trackingNumber}/status — public endpoint (CAPTCHA + rate limit, no JWT)
 *
 * Allows clients to look up the status of their quote submission using
 * the tracking number provided at submission time.
 *
 * Security:
 * - Rate limited (10 queries/IP/hour)
 * - Requires CAPTCHA token (via query parameter)
 * - No JWT required (public endpoint per Req 13.6)
 *
 * @module lambdas/quote-status
 * @requirements 7.11, 13.6, 13.7
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { extractClientIp, checkRateLimit } from '../../modules/security/public-rate-limiter.js';
import { verifyCaptcha } from '../../modules/security/captcha.js';
import { getQuoteByTrackingNumber } from '../../db/operations.js';
import type { QuoteRecord } from '../../db/entities.js';
import type { RateLimitConfig } from '../../types/security.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RATE_LIMIT_CONFIG: RateLimitConfig = {
  endpoint: 'quote-status',
  maxRequests: parseInt(process.env.QUOTE_STATUS_RATE_LIMIT_MAX ?? '10', 10),
  windowSeconds: parseInt(process.env.QUOTE_STATUS_RATE_LIMIT_WINDOW_SECONDS ?? '3600', 10),
};

/** Regex to validate tracking number format (alphanumeric + dash, max 36 chars). */
const TRACKING_NUMBER_REGEX = /^[A-Za-z0-9-]+$/;
const TRACKING_NUMBER_MAX_LENGTH = 36;

// ---------------------------------------------------------------------------
// CORS Headers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // Step 1: Extract client IP
    const clientIp = extractClientIp(event.headers['X-Forwarded-For'] ?? event.headers['x-forwarded-for']);
    if (!clientIp) {
      return errorResponse(400, 'Missing X-Forwarded-For header');
    }

    // Step 2: Check rate limit
    let rateLimitResult;
    try {
      rateLimitResult = await checkRateLimit(clientIp, RATE_LIMIT_CONFIG);
    } catch {
      return errorResponse(503, 'Service temporarily unavailable');
    }

    if (!rateLimitResult.allowed) {
      const retryAfter = rateLimitResult.retryAfterSeconds ?? 3600;
      return {
        statusCode: 429,
        headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfter) },
        body: JSON.stringify({
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        }),
      };
    }

    // Step 3: Validate and verify CAPTCHA token (from query parameter)
    const captchaToken = event.queryStringParameters?.captchaToken;
    if (!captchaToken || captchaToken.trim() === '') {
      return errorResponse(403, 'A valid captcha token is required');
    }

    let captchaResult;
    try {
      captchaResult = await verifyCaptcha(captchaToken, clientIp);
    } catch {
      return errorResponse(503, 'CAPTCHA service temporarily unavailable');
    }

    if (!captchaResult.valid) {
      if (captchaResult.error === 'service_unavailable') {
        return errorResponse(503, 'CAPTCHA service temporarily unavailable');
      }
      return errorResponse(403, `CAPTCHA verification failed: ${captchaResult.error ?? 'unknown'}`);
    }

    // Step 4: Extract and validate tracking number from path
    const trackingNumber = event.pathParameters?.trackingNumber;
    if (!trackingNumber) {
      return errorResponse(400, 'Tracking number is required');
    }

    if (trackingNumber.length > TRACKING_NUMBER_MAX_LENGTH) {
      return errorResponse(400, 'Invalid tracking number format');
    }

    if (!TRACKING_NUMBER_REGEX.test(trackingNumber)) {
      return errorResponse(400, 'Invalid tracking number format');
    }

    // Step 5: Look up quote by tracking number
    let quote: QuoteRecord | null;
    try {
      quote = await getQuoteByTrackingNumber<QuoteRecord>(trackingNumber);
    } catch {
      return errorResponse(503, 'Service temporarily unavailable');
    }

    if (!quote) {
      return errorResponse(404, 'Quote not found for the provided tracking number');
    }

    // Step 6: Return status response (only public-safe fields)
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        trackingNumber: quote.trackingNumber,
        status: quote.status,
        productName: quote.productName,
        submittedAt: quote.createdAt,
      }),
    };
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        type: 'QUOTE_STATUS_UNHANDLED_ERROR',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, 'Internal server error');
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a standardized error response with CORS headers.
 */
function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  };
}
