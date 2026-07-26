/**
 * Site Publish Lambda Handler
 *
 * POST /api/products/{mockupId}/publish (JWT required)
 * POST /api/products/{id}/unpublish (JWT required)
 *
 * Processes JWT-protected publish/unpublish requests from the Admin via API Gateway.
 * JWT verification is handled by API Gateway's Cognito authorizer — this Lambda
 * receives pre-authenticated requests.
 *
 * Flow (publish):
 * 1. Extract admin context from JWT authorizer
 * 2. Parse request body (mockupId, productName, targetAgeGroups, availableSizes, descriptions)
 * 3. Validate required fields
 * 4. Delegate to publish module
 * 5. Record audit log entry (best-effort, per Requirement 13.5)
 * 6. Return PublishResult
 *
 * Flow (unpublish):
 * 1. Extract admin context from JWT authorizer
 * 2. Delegate to unpublish module
 * 3. Record audit log entry (best-effort)
 * 4. Return PublishResult
 *
 * @module lambdas/site-publish
 * @requirements 6.1–6.5, 13.5
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { publishProductFromAction, unpublishProduct } from '../../modules/exhibition/publish.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';
import type { PublishAction } from '../../types/exhibition.js';
import type { AgeGroup } from '../../types/garment.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Request body for publishing a product (matches design interface). */
interface PublishRequestBody {
  mockupId?: string;
  productName?: string;
  targetAgeGroups?: AgeGroup[];
  availableSizes?: Array<{ ageGroup: AgeGroup; size: string }>;
  descriptions?: { es?: string; en?: string };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** CORS headers included in all responses. */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Lambda handler for product publish/unpublish actions.
 *
 * Receives a JWT-authenticated API Gateway event (Cognito authorizer)
 * and delegates to the publish module.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    // Extract admin context from JWT authorizer
    const { adminId, adminEmail } = extractAdminContext(event);
    if (!adminId) {
      return jsonResponse(403, { message: 'Unauthorized: missing admin identity' });
    }

    // Extract product ID from path parameters
    const productId = event.pathParameters?.id ?? event.pathParameters?.mockupId ?? '';
    if (!productId || productId.trim().length === 0) {
      return jsonResponse(400, { message: 'Product ID is required in path parameters' });
    }

    // Determine action from request path
    const action = extractAction(event.path);
    if (!action) {
      return jsonResponse(400, { message: 'Invalid action. Use /publish or /unpublish' });
    }

    if (action === 'publish') {
      return await handlePublish(event, productId, adminId, adminEmail);
    } else {
      return await handleUnpublish(productId, adminId, adminEmail);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'SITE_PUBLISH_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      }),
    );
    return jsonResponse(500, { message: 'Internal server error' });
  }
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/**
 * Handles POST /api/products/{mockupId}/publish
 * Parses the full PublishRequest body and delegates to the publish module.
 */
async function handlePublish(
  event: APIGatewayProxyEvent,
  productId: string,
  adminId: string,
  adminEmail: string,
): Promise<APIGatewayProxyResult> {
  // Parse request body
  let body: PublishRequestBody = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body) as PublishRequestBody;
    } catch {
      return jsonResponse(400, { message: 'Invalid JSON in request body' });
    }
  }

  // mockupId can come from body or from path parameter (design uses {mockupId} in path)
  const mockupId = body.mockupId ?? productId;
  if (!mockupId || mockupId.trim().length === 0) {
    return jsonResponse(400, { message: 'mockupId is required for publish action' });
  }

  // Validate productName if provided
  if (body.productName !== undefined && typeof body.productName !== 'string') {
    return jsonResponse(400, { message: 'productName must be a string' });
  }

  const publishAction: PublishAction = {
    productId,
    mockupId,
    action: 'publish',
    adminId,
  };

  const result = await publishProductFromAction(publishAction);

  if (!result.success) {
    const statusCode = getErrorStatusCode(result.error);
    return jsonResponse(statusCode, {
      success: false,
      rebuildQueued: false,
      error: result.error,
    });
  }

  // Record audit log entry (best-effort — does not block response)
  await recordAuditEntry({
    adminId,
    adminEmail,
    actionType: 'product_publish',
    resourceId: productId,
    resourceType: 'product',
    metadata: {
      mockupId,
      productName: body.productName,
      targetAgeGroups: body.targetAgeGroups,
      queuePosition: result.queuePosition,
    },
  });

  return jsonResponse(200, {
    success: true,
    rebuildQueued: result.rebuildQueued,
    queuePosition: result.queuePosition,
  });
}

/**
 * Handles POST /api/products/{id}/unpublish
 * Removes a product from the public exhibition catalog.
 */
async function handleUnpublish(
  productId: string,
  adminId: string,
  adminEmail: string,
): Promise<APIGatewayProxyResult> {
  const result = await unpublishProduct(productId, adminId);

  if (!result.success) {
    const statusCode = getErrorStatusCode(result.error);
    return jsonResponse(statusCode, {
      success: false,
      rebuildQueued: false,
      error: result.error,
    });
  }

  // Record audit log entry (best-effort — does not block response)
  await recordAuditEntry({
    adminId,
    adminEmail,
    actionType: 'product_unpublish',
    resourceId: productId,
    resourceType: 'product',
    metadata: {
      queuePosition: result.queuePosition,
    },
  });

  return jsonResponse(200, {
    success: true,
    rebuildQueued: result.rebuildQueued,
    queuePosition: result.queuePosition,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a JSON response with CORS headers.
 */
function jsonResponse(statusCode: number, body: Record<string, unknown>): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Extracts the action type (publish or unpublish) from the request path.
 * Expects paths like /products/{id}/publish or /products/{id}/unpublish.
 */
function extractAction(path: string): 'publish' | 'unpublish' | null {
  const normalizedPath = path.replace(/\/+$/, '');
  if (normalizedPath.endsWith('/publish')) return 'publish';
  if (normalizedPath.endsWith('/unpublish')) return 'unpublish';
  return null;
}

/**
 * Extracts admin context from the JWT authorizer.
 * Supports both Cognito authorizer formats (claims-based and Lambda authorizer context).
 */
function extractAdminContext(event: APIGatewayProxyEvent): {
  adminId: string;
  adminEmail: string;
} {
  const authorizer = event.requestContext.authorizer ?? {};
  // Support Lambda authorizer context format (used by other handlers)
  const adminId = (authorizer.adminId as string) ?? authorizer.claims?.sub ?? '';
  const adminEmail = (authorizer.adminEmail as string) ?? authorizer.claims?.email ?? '';
  return { adminId, adminEmail };
}

/**
 * Maps publish module error messages to HTTP status codes.
 *
 * - 404: product not found
 * - 409: mockup not approved, product not published, or queue full (conflict state)
 * - 500: unknown error
 */
function getErrorStatusCode(error?: string): number {
  if (!error) return 500;
  if (error.includes('not found')) return 404;
  if (error.includes('mockup status')) return 409;
  if (error.includes('not currently published')) return 409;
  if (error.includes('queue is full')) return 409;
  return 500;
}
