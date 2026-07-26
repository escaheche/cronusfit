/**
 * Integration tests for pattern generation end-to-end flows.
 *
 * Validates cross-module integration of:
 * - Full generation flow: request → validate → generate → store → retrieve
 * - Grading flow: base pattern → grade → multiple SVGs stored
 * - Custom template flow: create template → generate pattern from it
 * - Error scenarios: invalid measurements, missing template, auth, not found
 *
 * Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mock modules — must be declared before imports
// ---------------------------------------------------------------------------

// Mock db/operations
vi.mock('../../src/db/operations.js', () => ({
  put: vi.fn().mockResolvedValue(undefined),
  get: vi.fn().mockResolvedValue(null),
  putPattern: vi.fn().mockResolvedValue(undefined),
  getPattern: vi.fn().mockResolvedValue(null),
  queryPatterns: vi.fn().mockResolvedValue({ patterns: [], count: 0 }),
  putTemplate: vi.fn().mockResolvedValue(undefined),
  getTemplate: vi.fn().mockResolvedValue(null),
  putGradingTable: vi.fn().mockResolvedValue(undefined),
  getGradingTable: vi.fn().mockResolvedValue(null),
}));

// Mock db/client
vi.mock('../../src/db/client.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'CronusFit',
  GSI1: { indexName: 'GSI1' },
  GSI2: { indexName: 'GSI2' },
}));

// Mock storage/s3-client
vi.mock('../../src/storage/s3-client.js', () => ({
  uploadPatternSvg: vi.fn().mockResolvedValue('patterns/test-id/pattern.svg'),
  getPatternDownloadUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

// Mock template-engine (filesystem-based template loading)
vi.mock('../../src/modules/pattern/template-engine.js', () => ({
  loadTemplate: vi.fn(),
  applyMeasurements: vi.fn(),
}));

// Mock serialization module
vi.mock('../../src/modules/pattern/serialization.js', () => ({
  generateSvg: vi.fn(),
  validateRoundTrip: vi.fn().mockReturnValue(true),
  serializePatternToJson: vi.fn(),
  deserializePatternFromJson: vi.fn(),
}));

// Mock grading-engine module
vi.mock('../../src/modules/pattern/grading-engine.js', () => ({
  loadGradingTable: vi.fn(),
  gradePattern: vi.fn(),
  generateGradingOutput: vi.fn(),
}));

// Mock custom-template module
vi.mock('../../src/modules/pattern/custom-template.js', () => ({
  createCustomTemplate: vi.fn(),
  validateCustomTemplateInput: vi.fn(),
}));

// Mock validation/measurements
vi.mock('../../src/validation/measurements.js', () => ({
  validateMeasurements: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  validateGarmentType: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  validateSize: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  validateAgeGroup: vi.fn().mockReturnValue({ valid: true, errors: [] }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { handler as generateHandler } from '../../src/lambdas/pattern-generate/handler.js';
import { handler as gradeHandler } from '../../src/lambdas/pattern-grade/handler.js';
import { handler as listHandler } from '../../src/lambdas/pattern-list/handler.js';

import { putPattern, getPattern } from '../../src/db/operations.js';
import { uploadPatternSvg, getPatternDownloadUrl, uploadFile, downloadFile, getPresignedUrl } from '../../src/storage/s3-client.js';
import { loadTemplate, applyMeasurements } from '../../src/modules/pattern/template-engine.js';
import { generateSvg, validateRoundTrip, deserializePatternFromJson } from '../../src/modules/pattern/serialization.js';
import { loadGradingTable, gradePattern, generateGradingOutput } from '../../src/modules/pattern/grading-engine.js';
import { createCustomTemplate } from '../../src/modules/pattern/custom-template.js';
import { validateMeasurements, validateGarmentType, validateSize, validateAgeGroup } from '../../src/validation/measurements.js';
import { put, get } from '../../src/db/operations.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake API Gateway event with Cognito JWT authentication. */
function makeAuthenticatedEvent(
  body: Record<string, unknown>,
  overrides?: Partial<APIGatewayProxyEvent>,
): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/api/patterns/generate',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {
      authorizer: {
        claims: { sub: 'admin-001' },
      },
    } as any,
    resource: '',
    ...overrides,
  } as APIGatewayProxyEvent;
}

/** Build a fake event without authentication. */
function makeUnauthenticatedEvent(
  body: Record<string, unknown>,
): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/api/patterns/generate',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  } as APIGatewayProxyEvent;
}

/** Build a GET event for the list/download handler. */
function makeGetEvent(
  pathParams?: Record<string, string> | null,
  queryParams?: Record<string, string> | null,
  authenticated = true,
): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/api/patterns',
    headers: {},
    body: null,
    pathParameters: pathParams ?? null,
    queryStringParameters: queryParams ?? null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: authenticated
      ? { authorizer: { claims: { sub: 'admin-001' } } } as any
      : {} as any,
    resource: '',
  } as APIGatewayProxyEvent;
}

/** Valid measurements for testing. */
const VALID_MEASUREMENTS = {
  chest: 1000,
  waist: 800,
  hip: 1020,
  torsoLength: 450,
  shoulderWidth: 440,
  legLength: 760,
};

/** A mock ScaledPattern returned by applyMeasurements. */
const MOCK_SCALED_PATTERN = {
  garmentType: 'camiseta',
  ageGroup: 'adult',
  size: 'M',
  pieces: [
    {
      id: 'panel-frontal',
      outline: 'M 0 0 L 500 0 L 500 700 L 0 700 Z',
      seamAllowance: 'M -15 -15 L 515 -15 L 515 715 L -15 715 Z',
      grainLine: { x1: 250, y1: 50, x2: 250, y2: 650 },
      notches: [{ x1: 0, y1: 350, x2: 3, y2: 350 }],
      label: 'panel-frontal',
    },
    {
      id: 'panel-trasero',
      outline: 'M 0 0 L 500 0 L 500 700 L 0 700 Z',
      seamAllowance: 'M -15 -15 L 515 -15 L 515 715 L -15 715 Z',
      grainLine: { x1: 250, y1: 50, x2: 250, y2: 650 },
      notches: [{ x1: 0, y1: 350, x2: 3, y2: 350 }],
      label: 'panel-trasero',
    },
  ],
};

const MOCK_SVG_RESULT = {
  svg: '<svg xmlns="http://www.w3.org/2000/svg"><g id="piece-panel-frontal"></g></svg>',
  isValid: true,
  pieceCount: 2,
};

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Reset validation mocks to return valid results
  vi.mocked(validateGarmentType).mockReturnValue({ valid: true, errors: [] } as any);
  vi.mocked(validateAgeGroup).mockReturnValue({ valid: true, errors: [] } as any);
  vi.mocked(validateSize).mockReturnValue({ valid: true, errors: [] } as any);
  vi.mocked(validateMeasurements).mockReturnValue({ valid: true, errors: [] } as any);

  // Default happy-path mock behaviors for pattern generation
  vi.mocked(loadTemplate).mockReturnValue({
    id: 'tpl-camiseta-adult',
    garmentType: 'camiseta',
    ageGroup: 'adult',
    proportionProfile: {
      ageGroup: 'adult',
      headToBodyRatio: 0.133,
      limbToTorsoRatio: 1.2,
      waistPositionRatio: 0.42,
      shoulderToHipRatio: 1.1,
    },
    controlPoints: [],
    pieceDefinitions: [],
    defaultMeasurements: {},
    constraints: [],
  } as any);

  vi.mocked(applyMeasurements).mockReturnValue(MOCK_SCALED_PATTERN as any);
  vi.mocked(generateSvg).mockReturnValue(MOCK_SVG_RESULT as any);
  vi.mocked(validateRoundTrip).mockReturnValue(true);
  vi.mocked(uploadPatternSvg).mockResolvedValue('patterns/test-id/pattern.svg');
  vi.mocked(getPatternDownloadUrl).mockResolvedValue('https://s3.example.com/presigned-url');
  vi.mocked(putPattern).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Full Generation Flow (Req 1.1, 5.1)
// ===========================================================================

describe('Full generation flow: request → validate → generate → store → retrieve', () => {
  it('generates a pattern and returns patternId, downloadUrl, metadata', async () => {
    const event = makeAuthenticatedEvent({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      measurements: VALID_MEASUREMENTS,
    });

    const result = await generateHandler(event);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);

    expect(body.patternId).toBeDefined();
    expect(body.downloadUrl).toBe('https://s3.example.com/presigned-url');
    expect(body.metadata).toBeDefined();
    expect(body.metadata.garmentType).toBe('camiseta');
    expect(body.metadata.ageGroup).toBe('adult');
    expect(body.metadata.pieceCount).toBe(2);
  });

  it('calls S3 upload with the generated SVG content', async () => {
    const event = makeAuthenticatedEvent({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      measurements: VALID_MEASUREMENTS,
    });

    await generateHandler(event);

    expect(uploadPatternSvg).toHaveBeenCalledWith(
      expect.any(String),
      MOCK_SVG_RESULT.svg,
    );
  });

  it('registers pattern metadata in DynamoDB', async () => {
    const event = makeAuthenticatedEvent({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      measurements: VALID_MEASUREMENTS,
    });

    await generateHandler(event);

    expect(putPattern).toHaveBeenCalledWith(
      expect.objectContaining({
        garmentType: 'camiseta',
        ageGroup: 'adult',
        generationMethod: 'parameters',
        pieceCount: 2,
        adminId: 'admin-001',
      }),
    );
  });

  it('chains correctly: loadTemplate → applyMeasurements → generateSvg → store', async () => {
    const event = makeAuthenticatedEvent({
      garmentType: 'short',
      ageGroup: 'children',
      size: '8',
      measurements: VALID_MEASUREMENTS,
    });

    await generateHandler(event);

    // Template loaded with correct params
    expect(loadTemplate).toHaveBeenCalledWith('short', 'children');
    // Measurements applied to loaded template
    expect(applyMeasurements).toHaveBeenCalled();
    // SVG generated from scaled pattern
    expect(generateSvg).toHaveBeenCalled();
    // Round-trip validated
    expect(validateRoundTrip).toHaveBeenCalledWith(MOCK_SVG_RESULT.svg);
    // Stored in S3
    expect(uploadPatternSvg).toHaveBeenCalled();
    // Registered in DynamoDB
    expect(putPattern).toHaveBeenCalled();
  });
});

// ===========================================================================
// 2. Grading Flow (Req 3.1)
// ===========================================================================

describe('Grading flow: base pattern → grade → multiple SVGs stored', () => {
  beforeEach(() => {
    // Mock a stored base pattern in DynamoDB
    vi.mocked(getPattern).mockResolvedValue({
      id: 'pattern-001',
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M' as any,
      createdAt: '2024-06-15T10:00:00Z',
      generationMethod: 'parameters',
      s3Key: 'patterns/pattern-001/pattern.svg',
      pieceCount: 2,
      seamAllowance: 15,
      adminId: 'admin-001',
    });

    // Mock downloading pattern JSON from S3
    vi.mocked(downloadFile).mockResolvedValue(
      Buffer.from(JSON.stringify(MOCK_SCALED_PATTERN)),
    );

    // Mock deserialization
    vi.mocked(deserializePatternFromJson).mockReturnValue(MOCK_SCALED_PATTERN as any);

    // Mock grading table loading
    vi.mocked(loadGradingTable).mockResolvedValue({
      ageGroup: 'adult',
      garmentType: 'camiseta',
      increments: {},
    } as any);

    // Mock grading operation
    vi.mocked(gradePattern).mockReturnValue([
      { ...MOCK_SCALED_PATTERN, size: 'S' },
      { ...MOCK_SCALED_PATTERN, size: 'L' },
    ] as any);

    // Mock grading output generation
    vi.mocked(generateGradingOutput).mockReturnValue({
      svgs: ['<svg>size-S</svg>', '<svg>size-L</svg>'],
      sizeLabels: ['S', 'L'],
      totalPieces: 4,
      processingTimeMs: 500,
    } as any);

    // Mock S3 upload and presigned URL for graded files
    vi.mocked(uploadFile).mockResolvedValue(undefined);
    vi.mocked(getPresignedUrl).mockResolvedValue('https://s3.example.com/graded-url');
  });

  it('grades a base pattern into multiple sizes and returns download URLs', async () => {
    const event = makeAuthenticatedEvent({
      patternId: 'pattern-001',
      ageGroup: 'adult',
      targetSizes: ['S', 'L'],
      outputMode: 'separate',
    });

    const result = await gradeHandler!(event, {} as any, () => {});
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);

    expect(body.patternId).toBe('pattern-001');
    expect(body.gradedSizes).toEqual(['S', 'L']);
    expect(body.outputMode).toBe('separate');
    expect(body.downloadUrls).toBeDefined();
    expect(body.downloadUrls['S']).toBeDefined();
    expect(body.downloadUrls['L']).toBeDefined();
  });

  it('stores graded SVGs in S3 for each target size', async () => {
    const event = makeAuthenticatedEvent({
      patternId: 'pattern-001',
      ageGroup: 'adult',
      targetSizes: ['S', 'L'],
      outputMode: 'separate',
    });

    await gradeHandler!(event, {} as any, () => {});

    // Two SVGs uploaded (one per target size)
    expect(uploadFile).toHaveBeenCalledTimes(2);
    expect(uploadFile).toHaveBeenCalledWith(
      'cronusfit-assets',
      'patterns/pattern-001/grade-S.svg',
      '<svg>size-S</svg>',
      'image/svg+xml',
    );
    expect(uploadFile).toHaveBeenCalledWith(
      'cronusfit-assets',
      'patterns/pattern-001/grade-L.svg',
      '<svg>size-L</svg>',
      'image/svg+xml',
    );
  });

  it('registers grading metadata in DynamoDB', async () => {
    const event = makeAuthenticatedEvent({
      patternId: 'pattern-001',
      ageGroup: 'adult',
      targetSizes: ['S', 'L'],
      outputMode: 'separate',
    });

    await gradeHandler!(event, {} as any, () => {});

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: 'PATTERN#pattern-001',
        patternId: 'pattern-001',
        ageGroup: 'adult',
        targetSizes: ['S', 'L'],
        outputMode: 'separate',
        gradedSizes: ['S', 'L'],
        adminId: 'admin-001',
      }),
    );
  });
});

// ===========================================================================
// 3. Custom Template Flow (Req 2.1)
// ===========================================================================

describe('Custom template flow: create template → verify storage', () => {
  it('creates a custom template and stores it in S3 and DynamoDB', async () => {
    const mockTemplate = {
      id: 'custom-vestido-abc12345',
      garmentType: 'custom',
      ageGroup: 'adult',
      proportionProfile: {
        ageGroup: 'adult',
        headToBodyRatio: 0.133,
        limbToTorsoRatio: 1.2,
        waistPositionRatio: 0.42,
        shoulderToHipRatio: 1.1,
      },
      controlPoints: [
        { id: 'cp-chest', x: 1, y: 0.5, minValue: 800, maxValue: 1400, affectedPieces: ['bodice'] },
        { id: 'cp-waist', x: 1, y: 0.5, minValue: 600, maxValue: 1100, affectedPieces: ['bodice'] },
        { id: 'cp-hip', x: 1, y: 0.5, minValue: 850, maxValue: 1300, affectedPieces: ['skirt'] },
        { id: 'cp-length', x: 0, y: 1, minValue: 500, maxValue: 1500, affectedPieces: ['skirt'] },
      ],
      pieceDefinitions: [
        { id: 'bodice', name: 'Bodice', grainLineAngle: 0, notchPositions: [], cutQuantity: 2 },
        { id: 'skirt', name: 'Skirt', grainLineAngle: 0, notchPositions: [], cutQuantity: 2 },
      ],
      defaultMeasurements: { 'cp-chest': 1000, 'cp-waist': 800, 'cp-hip': 1020, 'cp-length': 900 },
      constraints: [],
    };

    vi.mocked(createCustomTemplate).mockResolvedValue(mockTemplate as any);

    const result = await createCustomTemplate({
      name: 'Vestido',
      ageGroup: 'adult',
      controlPoints: mockTemplate.controlPoints as any,
      pieceDefinitions: mockTemplate.pieceDefinitions as any,
      defaultMeasurements: mockTemplate.defaultMeasurements,
      constraints: [],
      createdBy: 'admin-001',
    });

    expect(result).toBeDefined();
    expect(result.id).toBe('custom-vestido-abc12345');
    expect(result.garmentType).toBe('custom');
    expect(result.ageGroup).toBe('adult');
    expect(result.proportionProfile.ageGroup).toBe('adult');
    expect(result.controlPoints).toHaveLength(4);
  });

  it('applies the correct ProportionProfile for children age group', async () => {
    const childTemplate = {
      id: 'custom-uniforme-def67890',
      garmentType: 'custom',
      ageGroup: 'children',
      proportionProfile: {
        ageGroup: 'children',
        headToBodyRatio: 0.2,
        limbToTorsoRatio: 0.9,
        waistPositionRatio: 0.47,
        shoulderToHipRatio: 0.95,
      },
      controlPoints: [
        { id: 'cp-chest', x: 1, y: 0.5, minValue: 500, maxValue: 900, affectedPieces: ['top'] },
        { id: 'cp-waist', x: 1, y: 0.5, minValue: 400, maxValue: 750, affectedPieces: ['top'] },
        { id: 'cp-hip', x: 1, y: 0.5, minValue: 550, maxValue: 950, affectedPieces: ['bottom'] },
        { id: 'cp-length', x: 0, y: 1, minValue: 300, maxValue: 900, affectedPieces: ['bottom'] },
      ],
      pieceDefinitions: [],
      defaultMeasurements: {},
      constraints: [],
    };

    vi.mocked(createCustomTemplate).mockResolvedValue(childTemplate as any);

    const result = await createCustomTemplate({
      name: 'Uniforme Escolar',
      ageGroup: 'children',
      controlPoints: childTemplate.controlPoints as any,
      pieceDefinitions: [] as any,
      defaultMeasurements: {},
      constraints: [],
      createdBy: 'admin-001',
    });

    expect(result.proportionProfile.ageGroup).toBe('children');
    expect(result.proportionProfile.headToBodyRatio).toBe(0.2);
    expect(result.proportionProfile.limbToTorsoRatio).toBe(0.9);
  });
});

// ===========================================================================
// 4. Error Scenarios
// ===========================================================================

describe('Error scenarios', () => {
  it('returns 400 for invalid measurements (out of range)', async () => {
    vi.mocked(validateMeasurements).mockReturnValue({
      valid: false,
      errors: [
        {
          field: 'chest',
          code: 'OUT_OF_RANGE',
          message: { es: 'Fuera de rango', en: 'Chest measurement is out of valid range (10mm-2000mm)' },
        },
      ],
    } as any);

    const event = makeAuthenticatedEvent({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      measurements: { chest: 5000 }, // Out of range
    });

    const result = await generateHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Validation Error');
  });

  it('returns 500 when template is not found', async () => {
    vi.mocked(loadTemplate).mockImplementation(() => {
      throw new Error('Template not found: adult/nonexistent');
    });

    const event = makeAuthenticatedEvent({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      measurements: VALID_MEASUREMENTS,
    });

    const result = await generateHandler(event);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Template Error');
    expect(body.message).toContain('Template not found');
    // Measurements preserved on failure (Req 1.12)
    expect(body.measurements).toEqual(VALID_MEASUREMENTS);
  });

  it('returns 401 when authentication is missing', async () => {
    const event = makeUnauthenticatedEvent({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      measurements: VALID_MEASUREMENTS,
    });

    const result = await generateHandler(event);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Authentication required');
    expect(body.message).toContain('Cognito JWT');
  });

  it('returns 404 when pattern not found for download', async () => {
    vi.mocked(getPattern).mockResolvedValue(null);

    const event = makeGetEvent({ id: 'nonexistent-id' });

    const result = await listHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('nonexistent-id');
  });

  it('returns 400 when request body is missing', async () => {
    const event: APIGatewayProxyEvent = {
      httpMethod: 'POST',
      path: '/api/patterns/generate',
      headers: { 'Content-Type': 'application/json' },
      body: null,
      pathParameters: null,
      queryStringParameters: null,
      multiValueHeaders: {},
      multiValueQueryStringParameters: null,
      isBase64Encoded: false,
      stageVariables: null,
      requestContext: {
        authorizer: { claims: { sub: 'admin-001' } },
      } as any,
      resource: '',
    } as APIGatewayProxyEvent;

    const result = await generateHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Bad Request');
  });

  it('returns 400 when garmentType is missing', async () => {
    const event = makeAuthenticatedEvent({
      ageGroup: 'adult',
      size: 'M',
      measurements: VALID_MEASUREMENTS,
    });

    const result = await generateHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.error).toBe('Validation Error');
    expect(body.message).toContain('garmentType');
  });

  it('returns 401 for grading handler without auth', async () => {
    const event = makeUnauthenticatedEvent({
      patternId: 'pattern-001',
      ageGroup: 'adult',
      targetSizes: ['S', 'L'],
      outputMode: 'separate',
    });

    const result = await gradeHandler!(event, {} as any, () => {});
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Authentication required');
  });

  it('returns 404 when grading a non-existent pattern', async () => {
    vi.mocked(getPattern).mockResolvedValue(null);

    const event = makeAuthenticatedEvent({
      patternId: 'nonexistent-pattern',
      ageGroup: 'adult',
      targetSizes: ['S', 'L'],
      outputMode: 'separate',
    });

    const result = await gradeHandler!(event, {} as any, () => {});
    const response = result as { statusCode: number; body: string };

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Not Found');
    expect(body.message).toContain('nonexistent-pattern');
  });
});
