/**
 * Approval Process Lambda Handler
 *
 * POST /api/mockups/{id}/approve — approves a mockup (JWT required)
 * POST /api/mockups/{id}/reject  — rejects a mockup (JWT required, body: { rejectionReason })
 * GET  /api/mockups?status=pending_approval — lists pending mockups (JWT required)
 *
 * Thin wrapper over the approval workflow and queue modules.
 * All business logic (state machine, conditional writes, audit) is delegated
 * to src/modules/approval/workflow.ts and src/modules/approval/queue.ts.
 *
 * @module lambdas/approval-process
 * @requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { approveMockup, rejectMockup } from '../../modules/approval/workflow.js';
import { getPendingMockups } from '../../modules/approval/queue.js';
import { recordApprovalAction } from '../../modules/approval/audit.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;
    const path = event.path ?? '';

    // GET /api/mockups?status=pending_approval — list pending queue
    if (method === 'GET' && !path.includes('/approve') && !path.includes('/reject') && !path.includes('/audit')) {
      return await handleGetPendingMockups(event);
    }

    // POST /api/mockups/{id}/approve
    if (method === 'POST' && path.endsWith('/approve')) {
      return await handleApprove(event);
    }

    // POST /api/mockups/{id}/reject
    if (method === 'POST' && path.endsWith('/reject')) {
      return await handleReject(event);
    }

    return errorResponse(400, 'Unsupported action. Use POST /approve, POST /reject, or GET with status=pending_approval');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'APPROVAL_PROCESS_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, message);
  }
};

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/**
 * Handles GET /api/mockups?status=pending_approval
 */
async function handleGetPendingMockups(
  event: Parameters<APIGatewayProxyHandler>[0],
): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters ?? {};
  const status = queryParams.status;

  if (status !== 'pending_approval') {
    return errorResponse(400, 'Query parameter "status" must be "pending_approval"');
  }

  const limit = queryParams.limit ? parseInt(queryParams.limit, 10) : undefined;
  const startKey = queryParams.startKey ?? undefined;

  const result = await getPendingMockups({ limit, startKey });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
}

/**
 * Handles POST /api/mockups/{id}/approve
 */
async function handleApprove(
  event: Parameters<APIGatewayProxyHandler>[0],
): Promise<APIGatewayProxyResult> {
  const mockupId = extractMockupId(event);
  if (!mockupId) {
    return errorResponse(400, 'Mockup ID is required in path parameters');
  }

  const { adminId, adminEmail } = extractAdminContext(event);

  const result = await approveMockup(mockupId, adminId, adminEmail);

  if (!result.success) {
    // Record the action attempt in the approval-specific audit trail
    await recordApprovalAction({
      mockupId,
      action: 'invalid_attempt',
      adminId,
      adminEmail,
      timestamp: new Date().toISOString(),
    });

    return errorResponse(mapErrorCodeToStatus(result.code), result.error);
  }

  // Record successful approval in the approval-specific audit trail
  await recordApprovalAction({
    mockupId,
    action: 'approved',
    adminId,
    adminEmail,
    timestamp: result.approvalTimestamp,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mockupId: result.mockupId,
      status: result.newStatus,
      approvalTimestamp: result.approvalTimestamp,
    }),
  };
}

/**
 * Handles POST /api/mockups/{id}/reject
 */
async function handleReject(
  event: Parameters<APIGatewayProxyHandler>[0],
): Promise<APIGatewayProxyResult> {
  const mockupId = extractMockupId(event);
  if (!mockupId) {
    return errorResponse(400, 'Mockup ID is required in path parameters');
  }

  const { adminId, adminEmail } = extractAdminContext(event);

  // Parse body to extract rejectionReason
  if (!event.body) {
    return errorResponse(400, 'Request body is required with rejectionReason');
  }

  let body: { rejectionReason?: string };
  try {
    body = JSON.parse(event.body) as { rejectionReason?: string };
  } catch {
    return errorResponse(400, 'Invalid JSON in request body');
  }

  if (!body.rejectionReason || typeof body.rejectionReason !== 'string') {
    return errorResponse(400, 'rejectionReason is required and must be a string');
  }

  const result = await rejectMockup(mockupId, adminId, adminEmail, body.rejectionReason);

  if (!result.success) {
    // Record the failed attempt in the approval-specific audit trail
    await recordApprovalAction({
      mockupId,
      action: 'invalid_attempt',
      adminId,
      adminEmail,
      timestamp: new Date().toISOString(),
      rejectionReason: body.rejectionReason,
    });

    return errorResponse(mapErrorCodeToStatus(result.code), result.error);
  }

  // Record successful rejection in the approval-specific audit trail
  await recordApprovalAction({
    mockupId,
    action: 'rejected',
    adminId,
    adminEmail,
    timestamp: new Date().toISOString(),
    rejectionReason: result.rejectionReason,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mockupId: result.mockupId,
      status: result.newStatus,
      rejectionReason: result.rejectionReason,
    }),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the mockup ID from path parameters.
 */
function extractMockupId(event: Parameters<APIGatewayProxyHandler>[0]): string | undefined {
  return event.pathParameters?.id ?? undefined;
}

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
 * Maps workflow error codes to HTTP status codes.
 */
function mapErrorCodeToStatus(code: string): number {
  switch (code) {
    case 'MOCKUP_NOT_FOUND':
      return 404;
    case 'INVALID_STATE_TRANSITION':
      return 409;
    case 'INVALID_REJECTION_REASON':
      return 400;
    case 'CONDITION_CHECK_FAILED':
      return 409;
    case 'AUDIT_WRITE_FAILED':
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
