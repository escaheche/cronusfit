/**
 * Pattern Serialize Lambda Handler
 *
 * Supports two operations determined by POST body `action` field:
 * - POST /patterns/serialize: Takes a ScaledPattern, serializes to JSON,
 *   stores in DynamoDB (or S3 overflow if >400KB), returns storage reference.
 * - POST /patterns/deserialize: Takes a stored pattern reference (patternId),
 *   retrieves JSON, deserializes back to ScaledPattern, generates SVG.
 *
 * DynamoDB 400KB limit handling:
 * - If serialized JSON ≤ 400KB → store directly in DynamoDB item
 * - If serialized JSON > 400KB → store chunks in S3, keep reference in DynamoDB
 *
 * Requires Cognito JWT authentication.
 *
 * @module lambdas/pattern-serialize
 * @requirements 4.1, 4.2, 4.5, 4.6
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import {
  serializePatternToJson,
  deserializePatternFromJson,
  generateSvg,
  type SerializedPatternResult,
} from '../../modules/pattern/serialization.js';
import { uploadFile, downloadFile, BUCKETS } from '../../storage/s3-client.js';
import { put, get } from '../../db/operations.js';
import type { ScaledPattern } from '../../types/pattern.js';
import type { BaseRecord } from '../../db/entities.js';
import {
  successResponse,
  errorResponse,
  errorMessage,
  extractAdminId,
} from '../shared/response.js';

// --- DynamoDB Record Interfaces ---

/** DynamoDB record for serialized pattern data (fits within 400KB). */
interface SerializedPatternRecord extends BaseRecord {
  PK: `PATTERN_JSON#${string}`;
  SK: 'DATA';
  patternId: string;
  json: string;
  sizeBytes: number;
  storageType: 'inline';
  createdAt: string;
  adminId: string;
}

/** DynamoDB record for pattern data stored in S3 (exceeds 400KB). */
interface SerializedPatternRefRecord extends BaseRecord {
  PK: `PATTERN_JSON#${string}`;
  SK: 'DATA';
  patternId: string;
  sizeBytes: number;
  storageType: 'overflow';
  s3Bucket: string;
  s3Key: string;
  chunkCount: number;
  createdAt: string;
  adminId: string;
}

type PatternJsonRecord = SerializedPatternRecord | SerializedPatternRefRecord;

// --- Request/Response Interfaces ---

interface SerializeRequest {
  action: 'serialize';
  pattern: ScaledPattern;
}

interface DeserializeRequest {
  action: 'deserialize';
  patternId: string;
  /** If true, generates SVG from the stored JSON and returns it. */
  generateSvgOutput?: boolean;
}

type PatternSerializeBody = SerializeRequest | DeserializeRequest;

interface SerializeResponse {
  action: 'serialize';
  patternId: string;
  sizeBytes: number;
  storageType: 'inline' | 'overflow';
  createdAt: string;
}

interface DeserializeResponse {
  action: 'deserialize';
  patternId: string;
  pattern: ScaledPattern;
  svg?: string;
}

// --- Handler ---

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // 1. Validate request body
    if (!event.body) {
      return errorResponse(400, 'Bad Request', { message: 'Request body is required' });
    }

    let body: PatternSerializeBody;
    try {
      body = JSON.parse(event.body) as PatternSerializeBody;
    } catch {
      return errorResponse(400, 'Bad Request', { message: 'Invalid JSON in request body' });
    }

    // 2. Extract admin ID from Cognito JWT claims
    const adminId = extractAdminId(event.requestContext);
    if (!adminId) {
      return errorResponse(401, 'Authentication required', {
        message: 'Valid Cognito JWT authentication is required.',
      });
    }

    // 3. Route by action
    if (!body.action || !['serialize', 'deserialize'].includes(body.action)) {
      return errorResponse(400, 'Validation Error', {
        message: 'action must be "serialize" or "deserialize"',
      });
    }

    if (body.action === 'serialize') {
      return handleSerialize(body as SerializeRequest, adminId);
    } else {
      return handleDeserialize(body as DeserializeRequest, adminId);
    }
  } catch (error: unknown) {
    return errorResponse(500, 'Processing Error', { message: errorMessage(error) });
  }
};

// --- Serialize Operation ---

async function handleSerialize(
  request: SerializeRequest,
  adminId: string,
): Promise<APIGatewayProxyResult> {
  // Validate pattern input
  if (!request.pattern) {
    return errorResponse(400, 'Validation Error', { message: 'pattern is required for serialize action' });
  }

  if (!request.pattern.garmentType) {
    return errorResponse(400, 'Validation Error', { message: 'pattern.garmentType is required' });
  }

  if (!request.pattern.ageGroup) {
    return errorResponse(400, 'Validation Error', { message: 'pattern.ageGroup is required' });
  }

  if (!request.pattern.size) {
    return errorResponse(400, 'Validation Error', { message: 'pattern.size is required' });
  }

  if (!request.pattern.pieces || !Array.isArray(request.pattern.pieces) || request.pattern.pieces.length === 0) {
    return errorResponse(400, 'Validation Error', { message: 'pattern.pieces must be a non-empty array' });
  }

  // Serialize pattern to JSON
  let serializationResult: SerializedPatternResult;
  try {
    serializationResult = serializePatternToJson(request.pattern);
  } catch (error: unknown) {
    return errorResponse(500, 'Processing Error', {
      message: `Serialization failed: ${errorMessage(error)}`,
    });
  }

  const patternId = generateId();
  const createdAt = new Date().toISOString();

  if (!serializationResult.exceedsLimit) {
    // Store directly in DynamoDB (inline)
    const record: SerializedPatternRecord = {
      PK: `PATTERN_JSON#${patternId}`,
      SK: 'DATA',
      patternId,
      json: serializationResult.json,
      sizeBytes: serializationResult.sizeBytes,
      storageType: 'inline',
      createdAt,
      adminId,
    };

    await put(record);

    const response: SerializeResponse = {
      action: 'serialize',
      patternId,
      sizeBytes: serializationResult.sizeBytes,
      storageType: 'inline',
      createdAt,
    };

    return successResponse(200, response as unknown as Record<string, unknown>);
  } else {
    // Exceeds 400KB — store chunks in S3, keep reference in DynamoDB
    const s3Key = `patterns/${patternId}/serialized.json`;

    try {
      await uploadFile(
        BUCKETS.assets,
        s3Key,
        serializationResult.json,
        'application/json',
      );
    } catch (error: unknown) {
      return errorResponse(500, 'Storage Error', {
        message: `Failed to store overflow data: ${errorMessage(error)}`,
      });
    }

    const record: SerializedPatternRefRecord = {
      PK: `PATTERN_JSON#${patternId}`,
      SK: 'DATA',
      patternId,
      sizeBytes: serializationResult.sizeBytes,
      storageType: 'overflow',
      s3Bucket: BUCKETS.assets,
      s3Key,
      chunkCount: serializationResult.chunks?.length ?? 1,
      createdAt,
      adminId,
    };

    await put(record);

    const response: SerializeResponse = {
      action: 'serialize',
      patternId,
      sizeBytes: serializationResult.sizeBytes,
      storageType: 'overflow',
      createdAt,
    };

    return successResponse(200, response as unknown as Record<string, unknown>);
  }
}

// --- Deserialize Operation ---

async function handleDeserialize(
  request: DeserializeRequest,
  _adminId: string,
): Promise<APIGatewayProxyResult> {
  // Validate request
  if (!request.patternId) {
    return errorResponse(400, 'Validation Error', {
      message: 'patternId is required for deserialize action',
    });
  }

  // Load pattern record from DynamoDB
  const record = await get<PatternJsonRecord>(
    `PATTERN_JSON#${request.patternId}`,
    'DATA',
  );

  if (!record) {
    return errorResponse(404, 'Not Found', {
      message: `Serialized pattern not found: ${request.patternId}`,
    });
  }

  // Retrieve JSON data based on storage type
  let jsonString: string;

  if (record.storageType === 'inline') {
    // JSON is stored directly in DynamoDB
    jsonString = (record as SerializedPatternRecord).json;
  } else {
    // JSON is stored in S3 (overflow)
    const refRecord = record as SerializedPatternRefRecord;
    try {
      const buffer = await downloadFile(refRecord.s3Bucket, refRecord.s3Key);
      if (!buffer) {
        return errorResponse(500, 'Storage Error', {
          message: 'Overflow data is empty or missing from S3',
        });
      }
      jsonString = buffer.toString('utf-8');
    } catch (error: unknown) {
      return errorResponse(500, 'Storage Error', {
        message: `Failed to retrieve overflow data: ${errorMessage(error)}`,
      });
    }
  }

  // Deserialize JSON back to ScaledPattern
  let pattern: ScaledPattern;
  try {
    pattern = deserializePatternFromJson(jsonString);
  } catch (error: unknown) {
    return errorResponse(500, 'Processing Error', {
      message: `Deserialization failed: ${errorMessage(error)}`,
    });
  }

  // Optionally generate SVG from the deserialized pattern
  const response: DeserializeResponse = {
    action: 'deserialize',
    patternId: request.patternId,
    pattern,
  };

  if (request.generateSvgOutput) {
    const svgResult = generateSvg(pattern);
    if (svgResult.isValid) {
      response.svg = svgResult.svg;
    }
  }

  return successResponse(200, response as unknown as Record<string, unknown>);
}

// --- Helpers ---

function generateId(): string {
  const chars = '0123456789abcdef';
  const segments = [8, 4, 4, 4, 12];
  return segments
    .map((len) =>
      Array.from({ length: len }, () => chars[Math.floor(Math.random() * 16)]).join(''),
    )
    .join('-');
}
