/**
 * DTF Print File Generator Lambda Handler
 *
 * POST /api/print/dtf (JWT required)
 *
 * Generates production-ready DTF (Direct-to-Film) print files:
 * - Main CMYK PNG at 300+ DPI with transparent background
 * - Separate white ink underbase PNG at same DPI/dimensions
 *
 * Flow:
 * 1. Parse API Gateway event to extract DTFGenerateRequest from body
 * 2. Extract admin context from event.requestContext.authorizer
 * 3. Validate required fields and dimensions (10-500mm)
 * 4. Call DTF generator module
 * 5. Upload main + underbase files to S3
 * 6. Generate presigned download URLs
 * 7. Record audit log entry (best-effort)
 * 8. Return presigned URLs + dimensions
 *
 * @module lambdas/print-dtf
 * @requirements 8.1–8.7, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { generateDTF, DTFGeneratorError } from '../../modules/print/dtf-generator.js';
import { uploadFile, getPresignedUrl, BUCKETS } from '../../storage/s3-client.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';
import type { DTFGenerateRequest, DTFGenerateResponse } from '../../types/print.js';

// --- Handler ---

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let request: DTFGenerateRequest;
    try {
      request = JSON.parse(event.body) as DTFGenerateRequest;
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
    if (request.widthMm == null || typeof request.widthMm !== 'number') {
      return errorResponse(400, 'widthMm is required and must be a number');
    }
    if (request.heightMm == null || typeof request.heightMm !== 'number') {
      return errorResponse(400, 'heightMm is required and must be a number');
    }

    // 4. Call DTF generator module
    let dtfResult;
    try {
      dtfResult = await generateDTF({
        designS3Key: request.designId,
        widthMm: request.widthMm,
        heightMm: request.heightMm,
      });
    } catch (error: unknown) {
      if (error instanceof DTFGeneratorError) {
        // Map DTF-specific errors to appropriate HTTP status codes
        if (
          error.code === 'INVALID_DIMENSIONS' ||
          error.code === 'INSUFFICIENT_RESOLUTION' ||
          error.code === 'INVALID_SOURCE'
        ) {
          return errorResponse(400, error.message);
        }
        if (error.code === 'DESIGN_NOT_FOUND') {
          return errorResponse(404, error.message);
        }
      }
      const message = error instanceof Error ? error.message : 'DTF generation failed';
      return errorResponse(500, `DTF generation failed: ${message}`);
    }

    // 5. Upload main + underbase files to S3
    const fileId = generateId();
    const mainS3Key = `print/dtf/${fileId}/main.png`;
    const underbaseS3Key = `print/dtf/${fileId}/underbase.png`;

    try {
      await Promise.all([
        uploadFile(BUCKETS.assets, mainS3Key, dtfResult.mainBuffer, 'image/png'),
        uploadFile(BUCKETS.assets, underbaseS3Key, dtfResult.underbaseBuffer, 'image/png'),
      ]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'S3 upload failed';
      console.error(
        JSON.stringify({
          type: 'DTF_S3_UPLOAD_FAILURE',
          fileId,
          adminId,
          error: message,
          timestamp: new Date().toISOString(),
        }),
      );
      return errorResponse(500, 'Failed to store DTF print files. Please try again.');
    }

    // 6. Generate presigned download URLs
    const [mainFileUrl, underbaseFileUrl] = await Promise.all([
      getPresignedUrl(BUCKETS.assets, mainS3Key),
      getPresignedUrl(BUCKETS.assets, underbaseS3Key),
    ]);

    // 7. Record audit log entry (best-effort)
    await recordAuditEntry({
      adminId,
      adminEmail,
      actionType: 'print_dtf_generate',
      resourceId: fileId,
      resourceType: 'print_file',
      metadata: {
        designId: request.designId,
        widthMm: dtfResult.widthMm,
        heightMm: dtfResult.heightMm,
        dpi: dtfResult.dpi,
      },
    });

    // 8. Return presigned URLs + dimensions
    const response: DTFGenerateResponse = {
      mainFileUrl,
      underbaseFileUrl,
      dimensions: {
        widthMm: dtfResult.widthMm,
        heightMm: dtfResult.heightMm,
        dpi: dtfResult.dpi,
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
        type: 'DTF_HANDLER_UNHANDLED_ERROR',
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
