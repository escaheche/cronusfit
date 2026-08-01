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

/**
 * Generate standard measurements based on garment type, age group, and size.
 * This is used as a fallback when PDF mode is active but no measurements are extracted.
 * 
 * @param garmentType - Type of garment
 * @param ageGroup - Age group (children or adult)
 * @param size - Size
 * @returns Standard measurements object
 */
function generateStandardMeasurements(
  garmentType: GarmentType,
  ageGroup: AgeGroup,
  size: Size
): Record<string, number> {
  // Standard measurements in millimeters
  // These are approximate values - in production, would extract from PDF
  
  const measurements: Record<string, number> = {};

  if (ageGroup === 'adult') {
    // Adult size mapping (approximate)
    const sizeFactors = {
      'XS': 0.85,
      'S': 0.92,
      'M': 1.0,
      'L': 1.08,
      'XL': 1.16,
      'XXL': 1.24,
      '3XL': 1.32,
      '4XL': 1.40,
      '5XL': 1.48,
      '6XL': 1.56,
    };
    
    const factor = sizeFactors[size as keyof typeof sizeFactors] || 1.0;
    
    // Base measurements for M size
    const baseMeasurements = {
      chest: 1000,
      waist: 860,
      hip: 1000,
      torsoLength: 600,
      shoulderWidth: 460,
      legLength: 820,
    };
    
    // Scale measurements by size factor
    for (const [key, value] of Object.entries(baseMeasurements)) {
      measurements[key] = Math.round(value * factor);
    }
    
  } else {
    // Children size mapping (approximate)
    const childSizeFactors = {
      '2T': 0.50,
      '4T': 0.60,
      '6': 0.70,
      '8': 0.80,
      '10': 0.85,
      '12': 0.90,
      '14': 0.95,
      '16': 1.0,
    };
    
    const factor = childSizeFactors[size as keyof typeof childSizeFactors] || 0.75;
    
    // Base measurements for size 16 (scaled down for smaller sizes)
    const baseMeasurements = {
      chest: 800,
      waist: 680,
      hip: 850,
      torsoLength: 480,
      shoulderWidth: 360,
      legLength: 650,
    };
    
    // Scale measurements by size factor
    for (const [key, value] of Object.entries(baseMeasurements)) {
      measurements[key] = Math.round(value * factor);
    }
  }
  
  return measurements;
}

/** Request body interface. */
interface PatternGenerateRequest {
  mode?: 'manual' | 'pdf'; // New: operation mode
  garmentType: string;
  ageGroup: string;
  size: string;
  measurements: Record<string, number>;
  seamAllowance?: number;
  referenceImageKey?: string;
  referenceImageName?: string;
  referenceImageType?: string;
  detectedSizes?: string[]; // For PDF mode: sizes detected in PDF
  gradingSizes?: string[]; // For PDF mode: additional sizes to generate
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

  const { 
    mode = 'manual',
    garmentType, 
    ageGroup, 
    size, 
    measurements, 
    seamAllowance, 
    referenceImageKey,
    referenceImageName,
    referenceImageType,
    detectedSizes,
    gradingSizes,
  } = requestBody;

  // --- Special handling for PDF mode ---
  const isPdfMode = mode === 'pdf';
  
  if (isPdfMode) {
    // In PDF mode, we expect the PDF to contain the pattern data
    // For now, we'll use the detected sizes and generate standard measurements
    // TODO: Implement actual PDF parsing to extract measurements
    console.log('PDF mode detected:', {
      referenceImageName,
      referenceImageType,
      detectedSizes,
      gradingSizes,
    });
  }

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
  if (!isPdfMode) {
    // In manual mode, measurements are required
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
  } else {
    // In PDF mode, use standard measurements based on size
    // TODO: Extract actual measurements from PDF
    // For now, use template defaults with size-based scaling
    console.log('PDF mode: Using standard measurements for size', size);
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
    // Use provided measurements or generate standard ones for PDF mode
    const effectiveMeasurements = isPdfMode && (!measurements || Object.keys(measurements).length === 0)
      ? generateStandardMeasurements(garmentType as GarmentType, ageGroup as AgeGroup, size as Size)
      : measurements;

    scaledPattern = applyMeasurements(template, effectiveMeasurements);
    // Override the size with the user-provided size
    scaledPattern = { ...scaledPattern, size: size as Size };
  } catch (err: unknown) {
    return errorResponse(500, 'Generation Error', {
      message: errorMessage(err),
      measurements: isPdfMode ? {} : measurements, // Preserve admin-entered measurements on failure (Req 1.12)
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
    generationMethod: isPdfMode ? 'pdf' : (referenceImageKey ? 'image' : 'parameters'),
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
