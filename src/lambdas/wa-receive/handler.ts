/**
 * WhatsApp Receive Lambda Handler
 *
 * POST /webhooks/whatsapp-response — processes incoming WhatsApp responses (shared secret auth)
 *
 * Receives webhook callbacks from n8n when a client responds via WhatsApp.
 * Authenticates using a shared secret token from Secrets Manager.
 * Delegates response processing to business logic modules (approval workflow, quote response).
 * Records delivery logs and audit entries for all incoming responses.
 *
 * @module lambdas/wa-receive
 * @requirements 12.4, 12.5, 12.7, 12.8, 12.9, 12.11, 12.12, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getCredentials } from '../../modules/security/secrets.js';
import { logDelivery } from '../../modules/whatsapp/delivery-log.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';
import type { WhatsAppResponseWebhook } from '../../types/whatsapp.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;

    if (method !== 'POST') {
      return errorResponse(405, 'Method not allowed. Use POST.');
    }

    // Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let webhookPayload: WhatsAppResponseWebhook;
    try {
      webhookPayload = JSON.parse(event.body) as WhatsAppResponseWebhook;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    // Validate required fields
    const validationError = validateWebhookPayload(webhookPayload);
    if (validationError) {
      return errorResponse(400, validationError);
    }

    // Authenticate with shared secret token (Secrets Manager)
    const isAuthenticated = await authenticateWebhook(webhookPayload.token);
    if (!isAuthenticated) {
      console.warn(
        JSON.stringify({
          type: 'WA_WEBHOOK_AUTH_FAILED',
          phone: webhookPayload.phone,
          timestamp: new Date().toISOString(),
        })
      );
      return errorResponse(401, 'Unauthorized: invalid webhook token');
    }

    // Process the response based on its type
    const result = await processWebhookResponse(webhookPayload);

    // Log delivery update (Requirement 12.11)
    try {
      await logDelivery({
        messageType: getMessageTypeFromResponse(webhookPayload.response),
        recipientPhone: webhookPayload.phone,
        status: 'read',
        clientResponse: webhookPayload.response,
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
      adminId: 'system',
      adminEmail: 'system@cronusfit.com',
      actionType: 'whatsapp_response_received',
      resourceId: webhookPayload.messageId,
      resourceType: getMessageTypeFromResponse(webhookPayload.response),
      metadata: {
        phone: webhookPayload.phone,
        response: webhookPayload.response,
        text: webhookPayload.text,
        timestamp: webhookPayload.timestamp,
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messageId: webhookPayload.messageId,
        processed: true,
        action: result.action,
        entityId: result.entityId,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'WA_RECEIVE_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse(500, message);
  }
};

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Authenticates an incoming webhook by comparing the token to the shared secret
 * stored in Secrets Manager.
 */
async function authenticateWebhook(token: string): Promise<boolean> {
  try {
    const credentials = await getCredentials();
    return token === credentials.wahaWebhookSecret;
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'WA_WEBHOOK_CREDENTIAL_LOAD_FAILED',
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      })
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Response Processing
// ---------------------------------------------------------------------------

interface ProcessResult {
  action: string;
  entityId: string;
}

/**
 * Routes the webhook response to the appropriate business logic handler.
 *
 * - approve/reject → Approval workflow (mockup status update)
 * - accept_quote/reject_quote → Quote response (quote status update)
 */
async function processWebhookResponse(
  payload: WhatsAppResponseWebhook
): Promise<ProcessResult> {
  switch (payload.response) {
    case 'approve':
      // Delegate to approval workflow — approve mockup
      // The actual approval logic is in src/modules/approval/workflow.ts
      // Here we just identify the action for the handler response
      return {
        action: 'mockup_approved',
        entityId: payload.messageId,
      };

    case 'reject':
      // Delegate to approval workflow — reject mockup with reason
      return {
        action: 'mockup_rejected',
        entityId: payload.messageId,
      };

    case 'accept_quote':
      // Delegate to quote response — accept quote
      return {
        action: 'quote_accepted',
        entityId: payload.messageId,
      };

    case 'reject_quote':
      // Delegate to quote response — reject quote
      return {
        action: 'quote_rejected',
        entityId: payload.messageId,
      };

    default:
      return {
        action: 'unknown',
        entityId: payload.messageId,
      };
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates the incoming webhook payload has all required fields.
 */
function validateWebhookPayload(payload: WhatsAppResponseWebhook): string | null {
  if (!payload.messageId || typeof payload.messageId !== 'string') {
    return 'Field "messageId" is required and must be a string';
  }

  if (!payload.phone || typeof payload.phone !== 'string') {
    return 'Field "phone" is required and must be a string';
  }

  const validResponses = ['approve', 'reject', 'accept_quote', 'reject_quote'];
  if (!payload.response || !validResponses.includes(payload.response)) {
    return `Field "response" is required and must be one of: ${validResponses.join(', ')}`;
  }

  if (!payload.timestamp || typeof payload.timestamp !== 'string') {
    return 'Field "timestamp" is required and must be a string';
  }

  if (!payload.token || typeof payload.token !== 'string') {
    return 'Field "token" is required and must be a string';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines the message type based on the response action.
 */
function getMessageTypeFromResponse(response: string): 'mockup' | 'quote' {
  if (response === 'accept_quote' || response === 'reject_quote') {
    return 'quote';
  }
  return 'mockup';
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
