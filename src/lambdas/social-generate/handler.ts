/**
 * Social Generate Lambda Handler
 *
 * POST /api/social/generate (JWT required)
 *
 * Generates social media content (Instagram/Facebook posts) for approved products.
 * Composites product images with brand templates to create ready-to-post content.
 *
 * @module lambdas/social-generate
 * @requirements 10.1, 10.2, 10.3, 10.4, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  generateSocialContent,
  type SocialContentGenerateRequest,
} from '../../modules/social/content-generator.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';

// --- Handler ---

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let request: SocialContentGenerateRequest;
    try {
      request = JSON.parse(event.body) as SocialContentGenerateRequest;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    // 2. Extract admin context from authorizer
    const authorizer = event.requestContext.authorizer ?? {};
    const adminId = (authorizer.adminId as string) ?? 'unknown';
    const adminEmail = (authorizer.adminEmail as string) ?? 'unknown';

    // 3. Validate required fields
    if (!request.productId) {
      return errorResponse(400, 'productId is required');
    }
    if (!request.mockupFrontUrl) {
      return errorResponse(400, 'mockupFrontUrl is required');
    }
    if (!request.mockupBackUrl) {
      return errorResponse(400, 'mockupBackUrl is required');
    }
    if (!request.productName) {
      return errorResponse(400, 'productName is required');
    }

    // 4. Generate social content
    const result = await generateSocialContent(request);

    // 5. Check for failure
    if ('success' in result && result.success === false) {
      return errorResponse(500, result.error);
    }

    // 6. Record audit log entry (best-effort)
    if ('contentId' in result) {
      await recordAuditEntry({
        adminId,
        adminEmail,
        actionType: 'social_generate',
        resourceId: result.contentId,
        resourceType: 'social_content',
        metadata: {
          productId: request.productId,
          productName: request.productName,
        },
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      };
    }

    return errorResponse(500, 'Unexpected result from social content generation');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'SOCIAL_GENERATE_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, message);
  }
};

// --- Helpers ---

function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  };
}
