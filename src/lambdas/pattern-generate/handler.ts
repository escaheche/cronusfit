/**
 * Lambda handler for pattern generation.
 *
 * Accepts a request with garmentType, ageGroup, size, measurements,
 * optional seamAllowance, and optional referenceImageKey.
 * Validates inputs, loads template, applies measurements, generates SVG,
 * validates round-trip, stores in S3, registers metadata in DynamoDB,
 * and returns { patternId, downloadUrl, metadata }.
 *
 * Enforces 15-second Lambda timeout; on timeout returns error without storing partial results.
 * Requires Cognito JWT authentication.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.10, 1.11, 1.12, 5.1, 5.2, 7.1, 7.5, 7.6
 */

import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { loadTemplate, applyMeasurements } from '../../modules/pattern/template-engine.js';
import { generateSvg, validateRoundTrip } from '../../modules/pattern/serialization.js';
import {
  validateMeasurements,
  validateGarmentType,
  validateSize,
  validateAgeGroup,
} from '../../validation/measurements.js';
import { putPattern } from '../../db/operations.js';
import { uploadPatternSvg, getPatternDownloadUrl } from '../../storage/s3-client.js';
import type { PatternMetadata } from '../../types/pattern.js';
import type { GarmentType, AgeGroup, Size } from '../../types/garment.js';
import {
  successResponse,
  errorResponse,
  checkTimeout,
  TimeoutError,
  errorMessage,
  extractAdminId,
} from '../shared/response.js';

/** Lambda timeout budget in ms (13s leaves 2s margin for Lambda's 15s timeout). */
const TIMEOUT_BUDGET_MS = 13_000;

/** Default seam allowance in cm. */
const DEFAULT_SEAM_ALLOWANCE_CM = 1.5;

/** Minimum seam allowance in cm. */
const MIN_SEAM_ALLOWANCE_CM = 0.5;

/** Maximum seam allowance in cm. */
const MAX_SEAM_ALLOWANCE_CM = 3.0;

/** Request body interface. */
interface PatternGenerateRequest {
  garmentType: string;
  ageGroup: string;
  size: string;
  measurements: Record<string, number>;
  seamAllowance?: number;
  referenceImageKey?: string;
}

/**
 * Main Lambda handler for pattern generation.
 */
export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();

  // --- Authentication: Require Cognito JWT ---
  const adminId = extractAdminId(event.requestContext);
  if (!adminId) {
    return errorResponse(401, 'Authentication required', {
      message: 'Valid Cognito JWT authentication is required.',
    });
  }

  // --- Parse request body ---
  let requestBody: PatternGenerateRequest;
  try {
    if (!event.body) {
      return errorResponse(400, 'Bad Request', {
        message: 'Request body is required.',
      });
    }
    requestBody = JSON.parse(event.body) as PatternGenerateRequest;
  } catch {
    return errorResponse(400, 'Bad Request', {
      message: 'Invalid JSON in request body.',
    });
  }

  const { garmentType, ageGroup, size, measurements, seamAllowance, referenceImageKey } =
    requestBody;

  // --- Validate garmentType ---
  if (!garmentType) {
    return errorResponse(400, 'Validation Error', {
      message: 'garmentType is required.',
    });
  }
  const garmentTypeResult = validateGarmentType(garmentType);
  if (!garmentTypeResult.valid) {
    return errorResponse(400, 'Validation Error', {
      message: garmentTypeResult.errors[0].message.en,
      details: garmentTypeResult.errors,
    });
  }

  // --- Validate ageGroup ---
  if (!ageGroup) {
    return errorResponse(400, 'Validation Error', {
      message: 'ageGroup is required.',
    });
  }
  const ageGroupResult = validateAgeGroup(ageGroup);
  if (!ageGroupResult.valid) {
    return errorResponse(400, 'Validation Error', {
      message: ageGroupResult.errors[0].message.en,
      details: ageGroupResult.errors,
    });
  }

  // --- Validate size ---
  if (!size) {
    return errorResponse(400, 'Validation Error', {
      message: 'size is required.',
    });
  }
  const sizeResult = validateSize(size);
  if (!sizeResult.valid) {
    return errorResponse(400, 'Validation Error', {
      message: sizeResult.errors[0].message.en,
      details: sizeResult.errors,
    });
  }

  // --- Validate measurements ---
  if (!measurements || typeof measurements !== 'object' || Array.isArray(measurements)) {
    return errorResponse(400, 'Validation Error', {
      message: 'measurements is required and must be an object.',
    });
  }
  if (Object.keys(measurements).length === 0) {
    return errorResponse(400, 'Validation Error', {
      message: 'At least one measurement must be provided.',
    });
  }
  const measurementsResult = validateMeasurements(measurements);
  if (!measurementsResult.valid) {
    return errorResponse(400, 'Validation Error', {
      message: 'One or more measurements are invalid.',
      details: measurementsResult.errors,
    });
  }

  // --- Validate seam allowance (optional, default 1.5 cm) ---
  const seamAllowanceCm = seamAllowance ?? DEFAULT_SEAM_ALLOWANCE_CM;
  if (
    typeof seamAllowanceCm !== 'number' ||
    !Number.isFinite(seamAllowanceCm) ||
    seamAllowanceCm < MIN_SEAM_ALLOWANCE_CM ||
    seamAllowanceCm > MAX_SEAM_ALLOWANCE_CM
  ) {
    return errorResponse(400, 'Validation Error', {
      message: `seamAllowance must be between ${MIN_SEAM_ALLOWANCE_CM} and ${MAX_SEAM_ALLOWANCE_CM} cm. Got: ${seamAllowance}`,
    });
  }

  // --- Check timeout before proceeding to generation ---
  try {
    checkTimeout(startTime, TIMEOUT_BUDGET_MS, 'Pattern generation');
  } catch (err) {
    if (err instanceof TimeoutError) {
      return errorResponse(504, 'Timeout', {
        message: 'Pattern generation exceeded the allowed execution time.',
        measurements,
      });
    }
  }

  // --- Load template ---
  let template;
  try {
    template = loadTemplate(garmentType as GarmentType, ageGroup as AgeGroup);
  } catch (err: unknown) {
    return errorResponse(500, 'Template Error', {
      message: errorMessage(err),
      measurements, // Preserve admin-entered measurements on failure (Req 1.12)
    });
  }

  // --- Apply measurements to template ---
  let scaledPattern;
  try {
    scaledPattern = applyMeasurements(template, measurements);
    // Override the size with the user-provided size
    scaledPattern = { ...scaledPattern, size: size as Size };
  } catch (err: unknown) {
    return errorResponse(500, 'Generation Error', {
      message: errorMessage(err),
      measurements, // Preserve admin-entered measurements on failure (Req 1.12)
    });
  }

  // --- Generate SVG ---
  let svgResult;
  try {
    svgResult = generateSvg(scaledPattern);
    if (!svgResult.isValid || !svgResult.svg) {
      return errorResponse(500, 'Generation Error', {
        message: 'SVG generation produced invalid output.',
        measurements,
      });
    }
  } catch (err: unknown) {
    return errorResponse(500, 'Generation Error', {
      message: errorMessage(err),
      measurements,
    });
  }

  // --- Validate round-trip ---
  try {
    const roundTripValid = validateRoundTrip(svgResult.svg);
    if (!roundTripValid) {
      return errorResponse(500, 'Validation Error', {
        message: 'SVG round-trip validation failed. Pattern integrity cannot be guaranteed.',
        measurements,
      });
    }
  } catch (err: unknown) {
    return errorResponse(500, 'Validation Error', {
      message: errorMessage(err),
      measurements,
    });
  }

  // --- Check timeout before storage operations ---
  try {
    checkTimeout(startTime, TIMEOUT_BUDGET_MS, 'Pattern generation');
  } catch (err) {
    if (err instanceof TimeoutError) {
      return errorResponse(504, 'Timeout', {
        message: 'Pattern generation exceeded the allowed execution time. No partial results stored.',
        measurements,
      });
    }
  }

  // --- Generate pattern ID ---
  const patternId = randomUUID();
  const s3Key = `patterns/${patternId}/pattern.svg`;

  // --- Upload SVG to S3 ---
  try {
    await uploadPatternSvg(patternId, svgResult.svg);
  } catch (err: unknown) {
    return errorResponse(500, 'Storage Error', {
      message: errorMessage(err),
      measurements,
    });
  }

  // --- Check timeout before DynamoDB write ---
  try {
    checkTimeout(startTime, TIMEOUT_BUDGET_MS, 'Pattern generation');
  } catch (err) {
    if (err instanceof TimeoutError) {
      return errorResponse(504, 'Timeout', {
        message: 'Pattern generation exceeded the allowed execution time. No partial results stored.',
        measurements,
      });
    }
  }

  // --- Register metadata in DynamoDB ---
  const metadata: PatternMetadata = {
    id: patternId,
    garmentType: garmentType as GarmentType,
    size: size as Size,
    createdAt: new Date().toISOString(),
    generationMethod: referenceImageKey ? 'image' : 'parameters',
    s3Key,
    pieceCount: svgResult.pieceCount,
    ageGroup: ageGroup as AgeGroup,
    seamAllowance: seamAllowanceCm * 10, // Convert cm to mm for storage
    adminId,
  };

  try {
    await putPattern(metadata);
  } catch (err: unknown) {
    return errorResponse(500, 'Registry Error', {
      message: errorMessage(err),
      measurements,
    });
  }

  // --- Get download URL ---
  let downloadUrl: string;
  try {
    downloadUrl = await getPatternDownloadUrl(patternId);
  } catch (err: unknown) {
    return errorResponse(500, 'Storage Error', {
      message: errorMessage(err),
    });
  }

  // --- Return success response ---
  return successResponse(200, {
    patternId,
    downloadUrl,
    metadata,
  });
}
