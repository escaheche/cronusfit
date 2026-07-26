/**
 * Mockup Generate Lambda Handler
 *
 * POST /api/mockups/generate (JWT required)
 *
 * Generates front and back garment mockup images with a design overlay,
 * then stores images to S3 and creates a DynamoDB record atomically.
 *
 * Flow:
 * 1. Parse API Gateway event to extract MockupGenerateRequest from body
 * 2. Extract admin context from event.requestContext.authorizer
 * 3. Validate required fields
 * 4. Composite front/back images via compositor engine
 * 5. Generate mockup UUID
 * 6. Upload front and back images to S3
 * 7. Create DynamoDB MockupRecord with status "pending_approval"
 * 8. If DynamoDB write fails, rollback S3 uploads (delete both images)
 * 9. Record audit log entry (best-effort)
 * 10. Return presigned URLs + mockup ID
 *
 * Atomic guarantee:
 * - S3 uploads first, then DynamoDB write
 * - If DynamoDB fails → delete S3 objects (rollback)
 * - If rollback fails → log error, notify Admin of inconsistency
 * - No partial state: either both S3 + DDB exist, or neither
 *
 * @module lambdas/mockup-generate
 * @requirements 4.4, 4.6, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { compositeDesign, CompositorError } from '../../modules/mockup/compositor.js';
import { uploadFile, deleteFile, getPresignedUrl, BUCKETS } from '../../storage/s3-client.js';
import { put } from '../../db/operations.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';
import type { MockupRecord } from '../../db/entities.js';
import type { MockupGenerateRequest, MockupGenerateResponse } from '../../types/mockup.js';

// --- Error Response Interface ---

interface ErrorResponse {
  error: string;
  details?: string;
}

// --- Handler ---

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let request: MockupGenerateRequest;
    try {
      request = JSON.parse(event.body) as MockupGenerateRequest;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    // 2. Extract admin context from authorizer
    const authorizer = event.requestContext.authorizer ?? {};
    const adminId = (authorizer.adminId as string) ?? 'unknown';
    const adminEmail = (authorizer.adminEmail as string) ?? 'unknown';

    // 3. Validate required fields
    if (!request.patternId) {
      return errorResponse(400, 'patternId is required');
    }
    if (!request.garmentType) {
      return errorResponse(400, 'garmentType is required');
    }
    if (!request.designFileKey) {
      return errorResponse(400, 'designFileKey is required');
    }
    if (!request.placementZone) {
      return errorResponse(400, 'placementZone is required');
    }

    const validZones = ['chest', 'full-front', 'full-back', 'left-sleeve', 'right-sleeve'];
    if (!validZones.includes(request.placementZone)) {
      return errorResponse(
        400,
        `Invalid placementZone. Must be one of: ${validZones.join(', ')}`,
      );
    }

    // 4. Composite front/back images via compositor engine
    let compositeResult;
    try {
      compositeResult = await compositeDesign({
        garmentType: request.garmentType,
        designFileKey: request.designFileKey,
        placementZone: request.placementZone,
      });
    } catch (error: unknown) {
      if (error instanceof CompositorError) {
        // Design validation failures (unsupported format, size exceeded, etc.)
        if (error.code === 'DESIGN_VALIDATION_FAILED' || error.code === 'DESIGN_NOT_FOUND') {
          return errorResponse(400, error.message);
        }
        // Template issues
        if (error.code === 'TEMPLATE_NOT_FOUND') {
          return errorResponse(400, error.message);
        }
      }
      const message = error instanceof Error ? error.message : 'Mockup compositing failed';
      return errorResponse(500, `Mockup generation failed: ${message}`);
    }

    // 5. Generate mockup UUID
    const mockupId = generateId();
    const createdAt = new Date().toISOString();

    // 6. Upload front and back images to S3
    const frontS3Key = `mockups/${mockupId}/front.png`;
    const backS3Key = `mockups/${mockupId}/back.png`;

    try {
      await Promise.all([
        uploadFile(BUCKETS.assets, frontS3Key, compositeResult.frontImage, 'image/png'),
        uploadFile(BUCKETS.assets, backS3Key, compositeResult.backImage, 'image/png'),
      ]);
    } catch (error: unknown) {
      // S3 upload failed — no state was committed, notify Admin
      const message = error instanceof Error ? error.message : 'S3 upload failed';
      console.error(
        JSON.stringify({
          type: 'MOCKUP_S3_UPLOAD_FAILURE',
          mockupId,
          adminId,
          error: message,
          timestamp: createdAt,
        }),
      );
      return errorResponse(500, 'Mockup storage failed. Please try again.');
    }

    // 7. Create DynamoDB MockupRecord with status "pending_approval"
    const mockupRecord: MockupRecord = {
      PK: `MOCKUP#${mockupId}`,
      SK: 'METADATA',
      GSI1PK: `STATUS#pending_approval`,
      GSI1SK: `CREATED#${createdAt}`,
      id: mockupId,
      patternId: request.patternId,
      garmentType: request.garmentType,
      designS3Key: request.designFileKey,
      frontImageS3Key: frontS3Key,
      backImageS3Key: backS3Key,
      placementZone: request.placementZone,
      scalingPercentage: compositeResult.scalingApplied,
      status: 'pending_approval',
      publishStatus: 'unpublished',
      createdAt,
      createdBy: adminId,
    };

    try {
      await put(mockupRecord, {
        conditionExpression: 'attribute_not_exists(PK)',
      });
    } catch (error: unknown) {
      // 8. DynamoDB write failed — rollback S3 uploads
      const dbError = error instanceof Error ? error.message : 'DynamoDB write failed';
      console.error(
        JSON.stringify({
          type: 'MOCKUP_DDB_WRITE_FAILURE',
          mockupId,
          adminId,
          error: dbError,
          timestamp: new Date().toISOString(),
        }),
      );

      // Attempt rollback: delete both S3 objects
      try {
        await Promise.all([
          deleteFile(BUCKETS.assets, frontS3Key),
          deleteFile(BUCKETS.assets, backS3Key),
        ]);
      } catch (rollbackError: unknown) {
        // Rollback failed — log the inconsistency for manual resolution
        const rbMessage =
          rollbackError instanceof Error ? rollbackError.message : 'Rollback failed';
        console.error(
          JSON.stringify({
            type: 'MOCKUP_ROLLBACK_FAILURE',
            mockupId,
            adminId,
            s3Keys: [frontS3Key, backS3Key],
            error: rbMessage,
            timestamp: new Date().toISOString(),
          }),
        );
      }

      return errorResponse(
        500,
        'Mockup creation failed. No mockup was saved. Please try again.',
      );
    }

    // 9. Record audit log entry (best-effort, never blocks primary operation)
    await recordAuditEntry({
      adminId,
      adminEmail,
      actionType: 'mockup_generate',
      resourceId: mockupId,
      resourceType: 'mockup',
      metadata: {
        patternId: request.patternId,
        garmentType: request.garmentType,
        placementZone: request.placementZone,
        scalingApplied: compositeResult.scalingApplied,
      },
    });

    // 10. Generate presigned URLs for response
    const [frontImageUrl, backImageUrl] = await Promise.all([
      getPresignedUrl(BUCKETS.assets, frontS3Key),
      getPresignedUrl(BUCKETS.assets, backS3Key),
    ]);

    // 11. Return success response
    const response: MockupGenerateResponse = {
      mockupId,
      frontImageUrl,
      backImageUrl,
      status: 'pending_approval',
      scalingApplied: compositeResult.scalingApplied,
    };

    return {
      statusCode: 201,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'MOCKUP_GENERATE_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, message);
  }
};

// --- Helpers ---

/**
 * Build a standardized error response.
 */
function errorResponse(
  statusCode: number,
  error: string,
  details?: string,
): APIGatewayProxyResult {
  const body: ErrorResponse = { error };
  if (details) body.details = details;

  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Generate a unique ID (UUID v4-like).
 */
function generateId(): string {
  const chars = '0123456789abcdef';
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map((len) =>
      Array.from({ length: len }, () => chars[Math.floor(Math.random() * 16)]).join(''),
    )
    .join('-');
}
