/**
 * Shared Lambda response utilities.
 *
 * Provides a consistent error response format, CORS headers, and timeout
 * detection across all pattern-related Lambda handlers.
 *
 * Standard error response shape:
 *   { error: string, message?: string, details?: unknown, measurements?: Record<string, number> }
 *
 * HTTP status code conventions:
 *   400 — Validation errors (invalid input, missing fields)
 *   401 — Missing or invalid authentication (Cognito JWT)
 *   404 — Resource not found
 *   500 — Internal processing errors
 *   504 — Timeout exceeded
 *
 * @module lambdas/shared/response
 */

import type { APIGatewayProxyResult } from 'aws-lambda';

// --- Standard Headers ---

/** Standard response headers with CORS support. */
const STANDARD_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// --- Error Response Interface ---

export interface LambdaErrorBody {
  error: string;
  message?: string;
  details?: unknown;
  /** Preserved admin-entered measurements on generation failure (Req 1.12). */
  measurements?: Record<string, number>;
}

// --- Builder Functions ---

/**
 * Builds a standardized success response with CORS headers.
 */
export function successResponse(
  statusCode: number,
  body: Record<string, unknown>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: STANDARD_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Builds a standardized error response with consistent shape and CORS headers.
 *
 * @param statusCode HTTP status code
 * @param error Short error category (e.g. "Validation Error", "Timeout")
 * @param options Additional error details
 */
export function errorResponse(
  statusCode: number,
  error: string,
  options?: {
    message?: string;
    details?: unknown;
    measurements?: Record<string, number>;
  },
): APIGatewayProxyResult {
  const body: LambdaErrorBody = { error };
  if (options?.message) body.message = options.message;
  if (options?.details !== undefined) body.details = options.details;
  if (options?.measurements) body.measurements = options.measurements;

  return {
    statusCode,
    headers: STANDARD_HEADERS,
    body: JSON.stringify(body),
  };
}

// --- Timeout Utilities ---

/**
 * Checks whether the elapsed time exceeds the given budget.
 * Throws a TimeoutError if exceeded.
 *
 * @param startTime Timestamp (ms) when execution started
 * @param budgetMs Maximum allowed execution time in ms
 * @param label Human-readable label for the timeout message
 */
export function checkTimeout(startTime: number, budgetMs: number, label: string): void {
  if (Date.now() - startTime >= budgetMs) {
    throw new TimeoutError(`${label} exceeded the allowed execution time.`);
  }
}

/**
 * Custom error class for timeout conditions.
 * Handlers can check `instanceof TimeoutError` to return 504 vs 500.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Determines the appropriate HTTP status code for an error.
 * Returns 504 for timeouts, 500 for everything else.
 */
export function statusCodeForError(error: unknown): number {
  if (error instanceof TimeoutError) return 504;
  return 500;
}

/**
 * Extracts a human-readable message from an unknown error.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Internal server error';
}

// --- Auth Utility ---

/**
 * Extracts the admin user ID (sub claim) from the API Gateway event.
 * Returns undefined if not authenticated.
 */
export function extractAdminId(
  requestContext: { authorizer?: Record<string, unknown> | null },
): string | undefined {
  if (!requestContext.authorizer) return undefined;
  const claims = requestContext.authorizer.claims as Record<string, unknown> | undefined;
  return claims?.sub as string | undefined;
}
