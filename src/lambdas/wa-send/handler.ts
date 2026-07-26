/**
 * WhatsApp Send Lambda Handler
 *
 * POST /api/mockups/{id}/share-whatsapp — sends a mockup or quote via WhatsApp (JWT required)
 *
 * Thin wrapper over the WhatsApp send service module. Delegates business logic
 * (retry, queueing, fallback) to src/modules/whatsapp/send-service.ts.
 * Records delivery logs and audit entries for all actions.
 *
 * @module lambdas/wa-send
 * @requirements 12.1, 12.2, 12.3, 12.6, 12.10, 12.11, 12.12, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { sendWhatsAppMessage } from '../../modules/whatsapp/send-service.js';
import { logDelivery } from '../../modules/whatsapp/delivery-log.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';
import type { WhatsAppSendRequest, MockupSharePayload, QuoteSharePayload } from '../../types/whatsapp.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;

    if (method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST.');
    }

    // Extract admin context from JWT authorizer
    const { adminId, adminEmail } = extractAdminContext(event);

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

    // Validate required fields
    const validationError = validateSendRequest(body);
    if (validationError) {
      return errorResponse(400, validationError);
    }

    // Build WhatsApp send request
    const sendRequest: WhatsAppSendRequest = {
      type: body.type as 'mockup' | 'quote',
      recipientPhone: body.recipientPhone as string,
      payload: body.payload as MockupSharePayload | QuoteSharePayload,
    };

    // Send the message via the send service (handles retries + fallback)
    const result = await sendWhatsAppMessage(sendRequest);

    // Log delivery status (Requirement 12.11)
    const entityId = sendRequest.type === 'mockup'
      ? (sendRequest.payload as MockupSharePayload).mockupId
      : (sendRequest.payload as QuoteSharePayload).quoteId;

    try {
      await logDelivery({
        messageType: sendRequest.type,
        recipientPhone: sendRequest.recipientPhone,
        status: result.success ? 'sent' : 'failed',
      });
    } catch (logError) {
      console.error(
        JSON.stringify({
          type: 'DELIVERY_LOG_WRITE_FAILURE',
          error: (logError as Error).message,
          timestamp: new Date().toISOString(),
        })
      );
    }

    // Record audit entry (Requirement 12.12 + 13.5)
    await recordAuditEntry({
      adminId,
      adminEmail,
      actionType: 'whatsapp_send',
      resourceId: entityId,
      resourceType: sendRequest.type,
      metadata: {
        recipientPhone: sendRequest.recipientPhone,
        deliveryStatus: result.status,
        retriesAttempted: result.retriesAttempted,
        fallbackEmail: result.fallbackEmail,
      },
    });

    if (!result.success) {
      return {
        statusCode: 202,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: result.messageId,
          status: result.status,
          retriesAttempted: result.retriesAttempted,
          fallbackEmail: result.fallbackEmail,
          error: result.error,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: result.messageId,
        status: result.status,
        recipientPhone: sendRequest.recipientPhone,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'WA_SEND_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse(500, message);
  }
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates the WhatsApp send request body.
 * Returns an error message if invalid, or null if valid.
 */
function validateSendRequest(body: Record<string, unknown>): string | null {
  if (!body.type || (body.type !== 'mockup' && body.type !== 'quote')) {
    return 'Field "type" is required and must be "mockup" or "quote"';
  }

  if (!body.recipientPhone || typeof body.recipientPhone !== 'string') {
    return 'Field "recipientPhone" is required and must be a string';
  }

  // Basic phone validation (7-15 digits, optional leading +)
  const phonePattern = /^\+?\d{7,15}$/;
  if (!phonePattern.test(body.recipientPhone)) {
    return 'Field "recipientPhone" must be a valid phone number (7-15 digits, optional + prefix)';
  }

  if (!body.payload || typeof body.payload !== 'object') {
    return 'Field "payload" is required and must be an object';
  }

  const payload = body.payload as Record<string, unknown>;

  if (body.type === 'mockup') {
    if (!payload.mockupId || typeof payload.mockupId !== 'string') {
      return 'Mockup payload requires "mockupId" (string)';
    }
    if (!payload.frontImageUrl || typeof payload.frontImageUrl !== 'string') {
      return 'Mockup payload requires "frontImageUrl" (string)';
    }
    if (!payload.backImageUrl || typeof payload.backImageUrl !== 'string') {
      return 'Mockup payload requires "backImageUrl" (string)';
    }
    if (!payload.productName || typeof payload.productName !== 'string') {
      return 'Mockup payload requires "productName" (string)';
    }
    if (typeof payload.includeButtons !== 'boolean') {
      return 'Mockup payload requires "includeButtons" (boolean)';
    }
  } else {
    // quote
    if (!payload.quoteId || typeof payload.quoteId !== 'string') {
      return 'Quote payload requires "quoteId" (string)';
    }
    if (!payload.productName || typeof payload.productName !== 'string') {
      return 'Quote payload requires "productName" (string)';
    }
    if (!payload.price || typeof payload.price !== 'string') {
      return 'Quote payload requires "price" (string)';
    }
    if (typeof payload.quantity !== 'number' || payload.quantity < 1) {
      return 'Quote payload requires "quantity" (positive number)';
    }
    if (!payload.ageGroup || (payload.ageGroup !== 'children' && payload.ageGroup !== 'adult')) {
      return 'Quote payload requires "ageGroup" ("children" or "adult")';
    }
    if (!Array.isArray(payload.sizes) || payload.sizes.length === 0) {
      return 'Quote payload requires "sizes" (non-empty array of strings)';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts admin context from the JWT authorizer.
 */
function extractAdminContext(event: Parameters<APIGatewayProxyHandler>[0]): {
  adminId: string;
  adminEmail: string;
} {
  const authorizer = event.requestContext.authorizer ?? {};
  return {
    adminId: (authorizer.adminId as string) ?? 'unknown',
    adminEmail: (authorizer.adminEmail as string) ?? 'unknown',
  };
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
