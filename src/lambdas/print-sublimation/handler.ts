/**
 * Sublimation Print File Generator Lambda Handler
 *
 * POST /api/print/sublimation (JWT required)
 *
 * Generates production-ready sublimation print files:
 * - PNG at 300 DPI with 3mm bleed on all edges
 * - Horizontal mirroring for transfer
 * - +15% color saturation for ink loss compensation
 *
 * Flow:
 * 1. Parse API Gateway event to extract SublimationGenerateRequest from body
 * 2. Extract admin context from event.requestContext.authorizer
 * 3. Validate required fields and dimensions (1-150cm)
 * 4. Call sublimation generator module
 * 5. Upload print file to S3
 * 6. Generate presigned download URL
 * 7. Record audit log entry (best-effort)
 * 8. Return presigned URL + dimensions
 *
 * @module lambdas/print-sublimation
 * @requirements 9.1–9.7, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { generateSublimation } from '../../modules/print/sublimation-generator.js';
import { uploadFile, getPresignedUrl, BUCKETS } from '../../storage/s3-client.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';
import type {
  SublimationGenerateRequest,
  SublimationGenerateResponse,
} from '../../types/print.js';

// --- Handler ---

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let request: SublimationGenerateRequest;
    try {
      request = JSON.parse(event.body) as SublimationGenerateRequest;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    // 2. Extract admin context from authorizer
    const authorizer = event.requestContext.authorizer ?? {};
    const adminId = (authorizer.adminId as string) ?? 'unknown';
    const adminEmail = (authorizer.adminEmail as string) ?? 'unknown';

    // 3. Validate required fields
    if (!request.designId) {
      return errorResponse(400, 'designId is required');
    }
    if (request.widthCm == null || typeof request.widthCm !== 'number') {
      return errorResponse(400, 'widthCm is required and must be a number');
    }
    if (request.heightCm == null || typeof request.heightCm !== 'number') {
      return errorResponse(400, 'heightCm is required and must be a number');
    }

    // 4. Call sublimation generator module
    let sublimationResult;
    try {
      sublimationResult = await generateSublimation({
        designS3Key: request.designId,
        widthCm: request.widthCm,
        heightCm: request.heightCm,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Sublimation generation failed';
      // Check for known validation/resolution errors
      if (
        message.includes('Invalid sublimation dimensions') ||
        message.includes('resolution insufficient') ||
        message.includes('Unable to read source image')
      ) {
        return errorResponse(400, message);
      }
      if (message.includes('not found')) {
        return errorResponse(404, message);
      }
      return errorResponse(500, `Sublimation generation failed: ${message}`);
    }

    // 5. Upload print file to S3
    const fileId = generateId();
    const fileS3Key = `print/sublimation/${fileId}/output.png`;

    try {
      await uploadFile(BUCKETS.assets, fileS3Key, sublimationResult.buffer, 'image/png');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'S3 upload failed';
      console.error(
        JSON.stringify({
          type: 'SUBLIMATION_S3_UPLOAD_FAILURE',
          fileId,
          adminId,
          error: message,
          timestamp: new Date().toISOString(),
        }),
      );
      return errorResponse(500, 'Failed to store sublimation print file. Please try again.');
    }

    // 6. Generate presigned download URL
    const fileUrl = await getPresignedUrl(BUCKETS.assets, fileS3Key);

    // 7. Record audit log entry (best-effort)
    await recordAuditEntry({
      adminId,
      adminEmail,
      actionType: 'print_sublimation_generate',
      resourceId: fileId,
      resourceType: 'print_file',
      metadata: {
        designId: request.designId,
        widthCm: sublimationResult.widthCm,
        heightCm: sublimationResult.heightCm,
        bleedMm: sublimationResult.bleedMm,
        dpi: sublimationResult.dpi,
      },
    });

    // 8. Return presigned URL + dimensions
    const response: SublimationGenerateResponse = {
      fileUrl,
      dimensions: {
        widthCm: sublimationResult.widthCm,
        heightCm: sublimationResult.heightCm,
        bleedMm: sublimationResult.bleedMm,
        dpi: sublimationResult.dpi,
      },
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'SUBLIMATION_HANDLER_UNHANDLED_ERROR',
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
function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
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
