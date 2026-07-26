/**
 * Pattern List & Download Lambda Handler
 *
 * GET /patterns — List patterns from Pattern_Registry ordered by date desc
 * GET /patterns/:id/download — Get presigned download URL for a pattern
 *
 * Both endpoints require Cognito JWT authentication.
 *
 * List endpoint:
 * - Queries GSI1 (GSI1PK='PATTERNS') sorted by GSI1SK (createdAt) descending
 * - Supports optional query string filters: garmentType, ageGroup
 * - Returns paginated list of pattern metadata
 *
 * Download endpoint:
 * - Looks up pattern by PK=PATTERN#{id}, SK=METADATA
 * - Returns 404 if pattern ID not found
 * - Returns presigned S3 URL with 1-hour expiry plus pattern metadata
 *
 * @module lambdas/pattern-list
 * @requirements 5.3, 5.4, 5.5
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { queryPatterns, getPattern } from '../../db/operations.js';
import { getPatternDownloadUrl } from '../../storage/s3-client.js';
import type { AgeGroup, GarmentType } from '../../types/garment.js';
import {
  successResponse,
  errorResponse,
  errorMessage,
  extractAdminId,
} from '../shared/response.js';

// --- Response Interfaces ---

interface PatternListResponse {
  patterns: Array<{
    id: string;
    garmentType: GarmentType;
    ageGroup: AgeGroup;
    size: string;
    createdAt: string;
    generationMethod: 'parameters' | 'image';
    pieceCount: number;
    seamAllowance: number;
  }>;
  count: number;
  lastEvaluatedKey?: string;
}

interface PatternDownloadResponse {
  downloadUrl: string;
  metadata: {
    id: string;
    garmentType: GarmentType;
    ageGroup: AgeGroup;
    size: string;
    createdAt: string;
    generationMethod: 'parameters' | 'image';
    s3Key: string;
    pieceCount: number;
    seamAllowance: number;
    adminId: string;
  };
}

// --- Valid filter values ---

const VALID_GARMENT_TYPES: GarmentType[] = [
  'camiseta',
  'short',
  'legging',
  'sudadera',
  'tank-top',
  'tank_top',
  'custom',
];

const VALID_AGE_GROUPS: AgeGroup[] = ['children', 'adult'];

// --- Handler ---

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Validate Cognito JWT authentication
    const sub = extractAdminId(event.requestContext);

    if (!sub) {
      return errorResponse(401, 'Authentication required', {
        message: 'Valid Cognito JWT authentication is required.',
      });
    }

    // 2. Route based on path
    const pathId = event.pathParameters?.id;

    if (pathId) {
      // GET /patterns/:id/download
      return handleDownload(pathId);
    }

    // GET /patterns
    return handleList(event);
  } catch (error: unknown) {
    return errorResponse(500, 'Processing Error', { message: errorMessage(error) });
  }
};

// --- List Patterns ---

async function handleList(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const queryParams = event.queryStringParameters ?? {};

  // Parse optional filters
  const garmentType = queryParams.garmentType as GarmentType | undefined;
  const ageGroup = queryParams.ageGroup as AgeGroup | undefined;
  const limitParam = queryParams.limit;
  const cursor = queryParams.cursor;

  // Validate garmentType filter if provided
  if (garmentType && !VALID_GARMENT_TYPES.includes(garmentType)) {
    return errorResponse(400, 'Validation Error', {
      message: `Invalid garmentType filter: "${garmentType}". Valid values: ${VALID_GARMENT_TYPES.join(', ')}`,
    });
  }

  // Validate ageGroup filter if provided
  if (ageGroup && !VALID_AGE_GROUPS.includes(ageGroup)) {
    return errorResponse(400, 'Validation Error', {
      message: `Invalid ageGroup filter: "${ageGroup}". Valid values: ${VALID_AGE_GROUPS.join(', ')}`,
    });
  }

  // Parse limit (default 20, max 100)
  let limit = 20;
  if (limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, 100);
    }
  }

  // Parse pagination cursor
  let exclusiveStartKey: Record<string, unknown> | undefined;
  if (cursor) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
    } catch {
      return errorResponse(400, 'Validation Error', { message: 'Invalid pagination cursor' });
    }
  }

  // Query patterns
  const result = await queryPatterns({
    limit,
    garmentType,
    ageGroup,
    exclusiveStartKey,
  });

  // Build response
  const response: PatternListResponse = {
    patterns: result.patterns.map((p) => ({
      id: p.id,
      garmentType: p.garmentType,
      ageGroup: p.ageGroup,
      size: p.size as string,
      createdAt: p.createdAt,
      generationMethod: p.generationMethod,
      pieceCount: p.pieceCount,
      seamAllowance: p.seamAllowance,
    })),
    count: result.patterns.length,
  };

  // Encode lastEvaluatedKey as base64url cursor for pagination
  if (result.lastEvaluatedKey) {
    response.lastEvaluatedKey = Buffer.from(
      JSON.stringify(result.lastEvaluatedKey),
    ).toString('base64url');
  }

  return successResponse(200, response as unknown as Record<string, unknown>);
}

// --- Download Pattern ---

async function handleDownload(patternId: string): Promise<APIGatewayProxyResult> {
  // Look up pattern metadata
  const pattern = await getPattern(patternId);

  if (!pattern) {
    return errorResponse(404, 'Not Found', { message: `Pattern not found: ${patternId}` });
  }

  // Generate presigned download URL (1-hour expiry)
  const downloadUrl = await getPatternDownloadUrl(patternId);

  const response: PatternDownloadResponse = {
    downloadUrl,
    metadata: {
      id: pattern.id,
      garmentType: pattern.garmentType,
      ageGroup: pattern.ageGroup,
      size: pattern.size as string,
      createdAt: pattern.createdAt,
      generationMethod: pattern.generationMethod,
      s3Key: pattern.s3Key,
      pieceCount: pattern.pieceCount,
      seamAllowance: pattern.seamAllowance,
      adminId: pattern.adminId,
    },
  };

  return successResponse(200, response as unknown as Record<string, unknown>);
}

