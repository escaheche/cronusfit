/**
 * Design Upload Lambda Handler
 *
 * POST /api/designs/upload (JWT required)
 *
 * Accepts design files (PNG, JPEG, SVG) as base64-encoded strings,
 * validates format and size, generates a unique S3 key, and uploads to S3.
 *
 * Flow:
 * 1. Parse API Gateway event to extract upload request from body
 * 2. Extract admin context from event.requestContext.authorizer
 * 3. Validate required fields (fileName, fileType, fileContent)
 * 4. Validate file format (PNG, JPEG, SVG only)
 * 5. Decode base64 content to Buffer
 * 6. Validate file size (≤ 10 MB)
 * 7. Generate unique S3 key: designs/{uuid}-{fileName}
 * 8. Upload to S3 bucket
 * 9. Record audit log entry (best-effort)
 * 10. Return designFileKey
 *
 * @module lambdas/design-upload
 * @requirements File validation, S3 storage, JWT auth
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { uploadFile, BUCKETS, MAX_FILE_SIZE_BYTES } from '../../storage/s3-client.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';

// --- Request/Response Interfaces ---

interface DesignUploadRequest {
  fileName: string;
  fileType: string;
  fileContent: string; // base64-encoded
}

interface DesignUploadResponse {
  designFileKey: string;
  message: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

// --- Constants ---

const VALID_FILE_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'];

// --- Handler ---

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let request: DesignUploadRequest;
    try {
      request = JSON.parse(event.body) as DesignUploadRequest;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    // 2. Extract admin context from authorizer
    const authorizer = event.requestContext.authorizer ?? {};
    const adminId = (authorizer.adminId as string) ?? 'unknown';
    const adminEmail = (authorizer.adminEmail as string) ?? 'unknown';

    // 3. Validate required fields
    if (!request.fileName) {
      return errorResponse(400, 'fileName is required');
    }
    if (!request.fileType) {
      return errorResponse(400, 'fileType is required');
    }
    if (!request.fileContent) {
      return errorResponse(400, 'fileContent is required');
    }

    // 4. Validate file format
    if (!VALID_FILE_TYPES.includes(request.fileType)) {
      return errorResponse(
        400,
        `Invalid file type. Must be one of: ${VALID_FILE_TYPES.join(', ')}`
      );
    }

    // 5. Decode base64 content to Buffer
    let fileBuffer: Buffer;
    try {
      // Remove data URL prefix if present (e.g., "data:image/png;base64,...")
      const base64Data = request.fileContent.includes(',')
        ? request.fileContent.split(',')[1]
        : request.fileContent;
      
      fileBuffer = Buffer.from(base64Data, 'base64');
    } catch (error: unknown) {
      return errorResponse(
        400,
        'Invalid base64 encoding in fileContent',
        error instanceof Error ? error.message : undefined
      );
    }

    // 6. Validate file size (≤ 10 MB)
    if (fileBuffer.byteLength > MAX_FILE_SIZE_BYTES) {
      const sizeMB = (fileBuffer.byteLength / (1024 * 1024)).toFixed(2);
      return errorResponse(
        400,
        `File size ${sizeMB} MB exceeds maximum allowed size of 10 MB`
      );
    }

    // 7. Generate unique S3 key: designs/{uuid}-{fileName}
    const fileId = generateId();
    const sanitizedFileName = sanitizeFileName(request.fileName);
    const designFileKey = `designs/${fileId}-${sanitizedFileName}`;

    // 8. Upload to S3 bucket
    try {
      await uploadFile(BUCKETS.assets, designFileKey, fileBuffer, request.fileType);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'S3 upload failed';
      console.error(
        JSON.stringify({
          type: 'DESIGN_S3_UPLOAD_FAILURE',
          fileId,
          adminId,
          error: message,
          timestamp: new Date().toISOString(),
        })
      );
      return errorResponse(500, 'File upload failed. Please try again.');
    }

    // 9. Record audit log entry (best-effort, never blocks primary operation)
    await recordAuditEntry({
      adminId,
      adminEmail,
      actionType: 'design_upload',
      resourceId: fileId,
      resourceType: 'design',
      metadata: {
        fileName: request.fileName,
        fileType: request.fileType,
        fileSizeBytes: fileBuffer.byteLength,
        s3Key: designFileKey,
      },
    });

    // 10. Return success response
    const response: DesignUploadResponse = {
      designFileKey,
      message: 'Design file uploaded successfully',
    };

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://d29tumvobv6mdj.cloudfront.net',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      },
      body: JSON.stringify(response),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'DESIGN_UPLOAD_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      })
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
  details?: string
): APIGatewayProxyResult {
  const body: ErrorResponse = { error };
  if (details) body.details = details;

  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://d29tumvobv6mdj.cloudfront.net',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
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

/**
 * Sanitize filename to prevent path traversal and ensure S3 compatibility.
 * - Removes or replaces special characters
 * - Limits length to 100 characters
 * - Preserves extension
 */
function sanitizeFileName(fileName: string): string {
  // Remove directory separators and other dangerous characters
  let sanitized = fileName.replace(/[/\\:*?"<>|]/g, '_');
  
  // Replace spaces with underscores
  sanitized = sanitized.replace(/\s+/g, '_');
  
  // Limit length while preserving extension
  if (sanitized.length > 100) {
    const lastDot = sanitized.lastIndexOf('.');
    if (lastDot > 0) {
      const ext = sanitized.slice(lastDot);
      const name = sanitized.slice(0, 100 - ext.length);
      sanitized = name + ext;
    } else {
      sanitized = sanitized.slice(0, 100);
    }
  }
  
  return sanitized;
}
