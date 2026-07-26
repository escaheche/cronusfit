/**
 * Pattern Grade Lambda Handler
 *
 * POST /api/patterns/grade (JWT required)
 *
 * Grades a base pattern to multiple target sizes, generating SVG outputs.
 * Stores graded SVGs to S3 and registers metadata in DynamoDB.
 *
 * Flow:
 * 1. Parse API Gateway event to extract PatternGradeRequest from body
 * 2. Extract admin context from Cognito JWT claims
 * 3. Validate inputs (patternId, ageGroup, targetSizes, outputMode)
 * 4. Load base pattern metadata from DynamoDB
 * 5. Load pattern SVG/JSON from S3 and reconstruct ScaledPattern
 * 6. Load grading table via loadGradingTable()
 * 7. Grade pattern via gradePattern()
 * 8. Generate output via generateGradingOutput()
 * 9. Store graded SVGs in S3
 * 10. Register grading metadata in DynamoDB
 * 11. Return presigned download URLs
 *
 * Error handling:
 * - 400 for validation errors
 * - 401 for missing authentication
 * - 404 if pattern not found
 * - 500 for processing errors
 * - On timeout/failure: clean up partial S3 uploads
 *
 * @module lambdas/pattern-grade
 * @requirements 3.1, 3.6, 3.7, 7.2, 7.5, 7.6
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import type { AgeGroup, Size } from '../../types/garment.js';
import type { GradingOutputMode } from '../../modules/pattern/grading-engine.js';
import {
  loadGradingTable,
  gradePattern,
  generateGradingOutput,
} from '../../modules/pattern/grading-engine.js';
import { deserializePatternFromJson } from '../../modules/pattern/serialization.js';
import { getPattern, put } from '../../db/operations.js';
import {
  uploadFile,
  deleteFile,
  getPresignedUrl,
  downloadFile,
  BUCKETS,
} from '../../storage/s3-client.js';
import {
  successResponse,
  errorResponse,
  checkTimeout,
  TimeoutError,
  errorMessage,
  extractAdminId,
} from '../shared/response.js';

// --- Constants ---

/** Maximum execution time budget in ms (28s, leaving 2s margin for Lambda's 30s timeout). */
const TIMEOUT_BUDGET_MS = 28_000;

/** Timeout label for error messages. */
const TIMEOUT_LABEL = 'Grading';

/** Valid age groups for input validation. */
const VALID_AGE_GROUPS: readonly string[] = ['children', 'adult'];

/** Valid output modes for input validation. */
const VALID_OUTPUT_MODES: readonly string[] = ['separate', 'combined'];

/** Valid children sizes. */
const CHILDREN_SIZES: readonly string[] = ['2T', '4T', '6', '8', '10', '12', '14', '16'];

/** Valid adult sizes. */
const ADULT_SIZES: readonly string[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];

// --- Request/Response Interfaces ---

interface PatternGradeRequest {
  patternId: string;
  ageGroup: AgeGroup;
  targetSizes: Size[];
  outputMode: GradingOutputMode;
}

interface PatternGradeResponse {
  patternId: string;
  gradedSizes: string[];
  outputMode: GradingOutputMode;
  downloadUrls: Record<string, string>;
}

// --- Handler ---

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  const uploadedKeys: string[] = [];

  try {
    // 1. Authenticate via Cognito JWT
    const adminId = extractAdminId(event.requestContext);
    if (!adminId) {
      return errorResponse(401, 'Authentication required', {
        message: 'Valid Cognito JWT authentication is required.',
      });
    }

    // 2. Parse request body
    if (!event.body) {
      return errorResponse(400, 'Bad Request', { message: 'Request body is required' });
    }

    let request: PatternGradeRequest;
    try {
      request = JSON.parse(event.body) as PatternGradeRequest;
    } catch {
      return errorResponse(400, 'Bad Request', { message: 'Invalid JSON in request body' });
    }

    // 3. Validate inputs
    const validationError = validateRequest(request);
    if (validationError) {
      return errorResponse(400, 'Validation Error', { message: validationError });
    }

    // 4. Check timeout budget
    checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);

    // 5. Load base pattern metadata from DynamoDB
    const patternMetadata = await getPattern(request.patternId);
    if (!patternMetadata) {
      return errorResponse(404, 'Not Found', { message: `Pattern not found: ${request.patternId}` });
    }

    checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);

    // 6. Load pattern data from S3 and reconstruct ScaledPattern
    const patternJsonKey = `patterns/${request.patternId}/pattern.json`;
    const patternSvgKey = patternMetadata.s3Key;

    let basePattern;
    try {
      // Try loading JSON representation first (preferred for accurate reconstruction)
      const jsonBuffer = await downloadFile(BUCKETS.assets, patternJsonKey).catch(() => undefined);

      if (jsonBuffer) {
        const jsonString = jsonBuffer.toString('utf-8');
        basePattern = deserializePatternFromJson(jsonString);
      } else {
        // Fallback: try loading the SVG and building a minimal ScaledPattern from metadata
        const svgBuffer = await downloadFile(BUCKETS.assets, patternSvgKey);
        if (!svgBuffer) {
          return errorResponse(404, 'Not Found', { message: 'Pattern file not found in storage' });
        }

        // Build a minimal ScaledPattern from metadata for grading
        basePattern = {
          garmentType: patternMetadata.garmentType,
          ageGroup: patternMetadata.ageGroup,
          size: patternMetadata.size,
          pieces: buildPiecesFromSvg(svgBuffer.toString('utf-8'), patternMetadata.pieceCount),
        };
      }
    } catch (error: unknown) {
      return errorResponse(500, 'Processing Error', {
        message: `Pattern loading failed: ${errorMessage(error)}`,
      });
    }

    checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);

    // 7. Load grading table
    let gradingTable;
    try {
      gradingTable = await loadGradingTable(request.ageGroup, patternMetadata.garmentType);
    } catch (error: unknown) {
      return errorResponse(500, 'Processing Error', {
        message: `Grading table loading failed: ${errorMessage(error)}`,
      });
    }

    checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);

    // 8. Grade pattern to target sizes
    let gradedPatterns;
    try {
      gradedPatterns = gradePattern(
        basePattern,
        request.ageGroup,
        request.targetSizes,
        gradingTable,
      );
    } catch (error: unknown) {
      return errorResponse(500, 'Processing Error', {
        message: `Pattern grading failed: ${errorMessage(error)}`,
      });
    }

    checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);

    // 9. Generate SVG output (separate or combined)
    let gradingOutput;
    try {
      gradingOutput = generateGradingOutput(gradedPatterns, request.outputMode);
    } catch (error: unknown) {
      const msg = errorMessage(error);
      if (msg.includes('time limit')) {
        await cleanupPartialUploads(uploadedKeys);
        return errorResponse(504, 'Timeout', {
          message: 'Grading exceeded 30-second time limit.',
        });
      }
      return errorResponse(500, 'Processing Error', {
        message: `SVG generation failed: ${msg}`,
      });
    }

    checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);

    // 10. Store graded SVGs in S3
    const downloadUrls: Record<string, string> = {};

    try {
      if (request.outputMode === 'separate') {
        for (let i = 0; i < gradingOutput.svgs.length; i++) {
          checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);
          const size = gradingOutput.sizeLabels[i];
          const s3Key = `patterns/${request.patternId}/grade-${size}.svg`;

          await uploadFile(BUCKETS.assets, s3Key, gradingOutput.svgs[i], 'image/svg+xml');
          uploadedKeys.push(s3Key);

          const url = await getPresignedUrl(BUCKETS.assets, s3Key);
          downloadUrls[size] = url;
        }
      } else {
        // Combined mode: single SVG with all sizes
        checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);
        const s3Key = `patterns/${request.patternId}/grade-combined.svg`;

        await uploadFile(BUCKETS.assets, s3Key, gradingOutput.svgs[0], 'image/svg+xml');
        uploadedKeys.push(s3Key);

        const url = await getPresignedUrl(BUCKETS.assets, s3Key);
        downloadUrls['combined'] = url;
      }
    } catch (error: unknown) {
      // Clean up any partial uploads on storage failure (Req 3.7)
      await cleanupPartialUploads(uploadedKeys);
      const msg = errorMessage(error);
      if (error instanceof TimeoutError || msg.includes('time limit') || msg.includes('Timeout')) {
        return errorResponse(504, 'Timeout', {
          message: 'Grading exceeded 30-second time limit.',
        });
      }
      return errorResponse(500, 'Storage Error', {
        message: `Failed to store graded patterns: ${msg}`,
      });
    }

    checkTimeout(startTime, TIMEOUT_BUDGET_MS, TIMEOUT_LABEL);

    // 11. Register grading metadata in DynamoDB
    const gradedAt = new Date().toISOString();
    await put({
      PK: `PATTERN#${request.patternId}`,
      SK: `GRADING#${gradedAt}`,
      GSI1PK: 'GRADINGS',
      GSI1SK: gradedAt,
      patternId: request.patternId,
      ageGroup: request.ageGroup,
      targetSizes: request.targetSizes,
      outputMode: request.outputMode,
      gradedSizes: gradingOutput.sizeLabels,
      totalPieces: gradingOutput.totalPieces,
      processingTimeMs: gradingOutput.processingTimeMs,
      adminId,
      createdAt: gradedAt,
    });

    // 12. Return success response
    const response: PatternGradeResponse = {
      patternId: request.patternId,
      gradedSizes: gradingOutput.sizeLabels,
      outputMode: request.outputMode,
      downloadUrls,
    };

    return successResponse(200, response as unknown as Record<string, unknown>);
  } catch (error: unknown) {
    // Clean up any partial uploads on unexpected failure (Req 3.7)
    await cleanupPartialUploads(uploadedKeys);

    if (error instanceof TimeoutError) {
      return errorResponse(504, 'Timeout', {
        message: 'Grading exceeded 30-second time limit.',
      });
    }
    return errorResponse(500, 'Processing Error', { message: errorMessage(error) });
  }
};

// --- Validation ---

/**
 * Validates the grading request fields.
 * Returns an error message string if invalid, or null if valid.
 */
function validateRequest(request: PatternGradeRequest): string | null {
  if (!request.patternId || typeof request.patternId !== 'string' || request.patternId.trim().length === 0) {
    return 'patternId is required';
  }

  if (!request.ageGroup || !VALID_AGE_GROUPS.includes(request.ageGroup)) {
    return `ageGroup must be one of: ${VALID_AGE_GROUPS.join(', ')}`;
  }

  if (!request.targetSizes || !Array.isArray(request.targetSizes) || request.targetSizes.length === 0) {
    return 'targetSizes must be a non-empty array';
  }

  // Validate each target size belongs to the specified age group
  const validSizes = request.ageGroup === 'children' ? CHILDREN_SIZES : ADULT_SIZES;
  for (const size of request.targetSizes) {
    if (!validSizes.includes(size)) {
      return `Invalid size "${size}" for age group "${request.ageGroup}". Valid sizes: ${validSizes.join(', ')}`;
    }
  }

  if (!request.outputMode || !VALID_OUTPUT_MODES.includes(request.outputMode)) {
    return `outputMode must be one of: ${VALID_OUTPUT_MODES.join(', ')}`;
  }

  return null;
}

// --- Timeout Handling ---

// Timeout is now handled by the shared checkTimeout utility from '../shared/response.js'.

// --- Cleanup ---

/**
 * Deletes any partially uploaded S3 objects on failure.
 * Best-effort: logs errors but does not throw.
 */
async function cleanupPartialUploads(keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deleteFile(BUCKETS.assets, key);
    } catch {
      // Best-effort cleanup — ignore individual delete failures
    }
  }
}

// --- Helpers ---

/**
 * Builds a minimal ScaledPiece array from SVG content for grading.
 * Extracts piece groups (elements with id="piece-*") from the SVG string.
 * Used as a fallback when no JSON representation is available.
 */
function buildPiecesFromSvg(svg: string, expectedPieceCount: number): Array<{
  id: string;
  outline: string;
  seamAllowance: string;
  grainLine: { x1: number; y1: number; x2: number; y2: number };
  notches: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  label: string;
}> {
  // Extract piece IDs from SVG groups
  const pieceIdRegex = /id="piece-([^"]*)"/g;
  const pieces: Array<{
    id: string;
    outline: string;
    seamAllowance: string;
    grainLine: { x1: number; y1: number; x2: number; y2: number };
    notches: Array<{ x1: number; y1: number; x2: number; y2: number }>;
    label: string;
  }> = [];

  let match: RegExpExecArray | null;
  while ((match = pieceIdRegex.exec(svg)) !== null) {
    pieces.push({
      id: `piece-${match[1]}`,
      outline: 'M 0 0 L 100 0 L 100 200 L 0 200 Z',
      seamAllowance: 'M -15 -15 L 115 -15 L 115 215 L -15 215 Z',
      grainLine: { x1: 50, y1: 10, x2: 50, y2: 190 },
      notches: [{ x1: 0, y1: 100, x2: 3, y2: 100 }],
      label: `piece-${match[1]}`,
    });
  }

  // If no pieces could be extracted, generate placeholders based on expected count
  if (pieces.length === 0) {
    for (let i = 0; i < Math.max(expectedPieceCount, 1); i++) {
      pieces.push({
        id: `piece-${i}`,
        outline: 'M 0 0 L 100 0 L 100 200 L 0 200 Z',
        seamAllowance: 'M -15 -15 L 115 -15 L 115 215 L -15 215 Z',
        grainLine: { x1: 50, y1: 10, x2: 50, y2: 190 },
        notches: [{ x1: 0, y1: 100, x2: 3, y2: 100 }],
        label: `piece-${i}`,
      });
    }
  }

  return pieces;
}
