/**
 * Approval Audit Lambda Handler
 *
 * GET /api/mockups/{id}/audit — retrieves the audit trail for a specific mockup (JWT required)
 *
 * Thin wrapper over the approval audit module.
 * Returns the full chronological audit trail for a mockup's approval workflow.
 *
 * @module lambdas/approval-audit
 * @requirements 5.6, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { getAuditTrailForMockup } from '../../modules/approval/audit.js';

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    const method = event.httpMethod;

    if (method !== 'GET') {
      return errorResponse(400, 'Only GET method is supported');
    }

    const mockupId = event.pathParameters?.id ?? undefined;

    if (!mockupId) {
      return errorResponse(400, 'Mockup ID is required in path parameters');
    }

    const auditTrail = await getAuditTrailForMockup(mockupId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mockupId,
        auditTrail,
        count: auditTrail.length,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'APPROVAL_AUDIT_UNHANDLED_ERROR',
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
 * Build a standardized error response.
 */
function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  };
}
