/**
 * Quote Process Lambda Handler
 *
 * POST /api/quotes/{id}/price — Admin sets price on a pending quote (JWT required)
 *
 * Thin wrapper over the quote pricing module. Requires JWT authorization.
 * Updates quote status from "pending" to "quoted", then triggers notifications
 * (email + WhatsApp) to the client via the pricing module.
 *
 * @module lambdas/quote-process
 * @requirements 7.7, 7.10, 13.5, 13.6
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { priceQuote } from '../../modules/quote/pricing.js';
import type { QuotePriceInput, AdminContext } from '../../modules/quote/pricing.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;

    if (method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST.');
    }

    // Extract quote ID from path parameters
    const quoteId = event.pathParameters?.id;
    if (!quoteId) {
      return errorResponse(400, 'Quote ID is required in path parameters');
    }

    // Extract admin context from JWT authorizer
    const admin = extractAdminContext(event);

    // Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body) as Record<string, unknown>;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    // Build pricing input
    const input: QuotePriceInput = {
      quoteId,
      unitPrice: body.unitPrice as number,
      totalPrice: body.totalPrice as number,
      currency: (body.currency as string) ?? 'COP',
      validUntil: body.validUntil as string,
      notes: body.notes as string | undefined,
    };

    // Execute pricing logic (validation, status transition, notifications, audit log)
    const result = await priceQuote(input, admin);

    if (!result.success) {
      const statusCode = mapErrorTypeToStatus(result.error.type);

      if (result.error.fieldErrors) {
        return {
          statusCode,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: result.error.message,
            fieldErrors: result.error.fieldErrors,
          }),
        };
      }

      return errorResponse(statusCode, result.error.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteId: result.data.quoteId,
        status: result.data.status,
        quoteLinkToken: result.data.quoteLinkToken,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'QUOTE_PROCESS_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, message);
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts admin context from the JWT authorizer.
 */
function extractAdminContext(event: Parameters<APIGatewayProxyHandler>[0]): AdminContext {
  const authorizer = event.requestContext.authorizer ?? {};
  return {
    adminId: (authorizer.adminId as string) ?? 'unknown',
    adminEmail: (authorizer.adminEmail as string) ?? 'unknown',
  };
}

/**
 * Maps pricing error types to HTTP status codes.
 */
function mapErrorTypeToStatus(type: string): number {
  switch (type) {
    case 'validation':
      return 400;
    case 'not_found':
      return 404;
    case 'invalid_status':
      return 409;
    case 'storage':
      return 500;
    case 'internal':
      return 500;
    default:
      return 500;
  }
}

/**
 * Build a standardized error response.
 */
function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  };
}
