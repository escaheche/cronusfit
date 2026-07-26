/**
 * Unit tests for the mockup-generate Lambda handler.
 *
 * Tests atomic storage semantics:
 * - S3 upload + DynamoDB write succeed → returns 201 with mockup data
 * - DynamoDB write fails → S3 objects are rolled back (deleted)
 * - S3 upload fails → returns 500 with no partial state
 * - Input validation → returns 400 for missing/invalid fields
 * - Audit log is recorded on success
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock dependencies
vi.mock('../../../src/modules/mockup/compositor.js', () => ({
  compositeDesign: vi.fn(),
  CompositorError: class CompositorError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'CompositorError';
      this.code = code;
    }
  },
}));

vi.mock('../../../src/storage/s3-client.js', () => ({
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  getPresignedUrl: vi.fn(),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

vi.mock('../../../src/db/operations.js', () => ({
  put: vi.fn(),
}));

vi.mock('../../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: vi.fn(),
}));

import { handler } from '../../../src/lambdas/mockup-generate/handler.js';
import { compositeDesign, CompositorError } from '../../../src/modules/mockup/compositor.js';
import { uploadFile, deleteFile, getPresignedUrl } from '../../../src/storage/s3-client.js';
import { put } from '../../../src/db/operations.js';
import { recordAuditEntry } from '../../../src/modules/security/audit-log.js';

const mockCompositeDesign = vi.mocked(compositeDesign);
const mockUploadFile = vi.mocked(uploadFile);
const mockDeleteFile = vi.mocked(deleteFile);
const mockGetPresignedUrl = vi.mocked(getPresignedUrl);
const mockPut = vi.mocked(put);
const mockRecordAuditEntry = vi.mocked(recordAuditEntry);

describe('mockup-generate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createEvent(body?: unknown, authorizer?: Record<string, string>): APIGatewayProxyEvent {
    return {
      body: body ? JSON.stringify(body) : null,
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/api/mockups/generate',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '',
      requestContext: {
        accountId: '123456789',
        apiId: 'api-id',
        authorizer: authorizer ?? {
          adminId: 'admin-sub-123',
          adminEmail: 'admin@cronusfit.com',
        },
        protocol: 'HTTP/1.1',
        httpMethod: 'POST',
        identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
        path: '/api/mockups/generate',
        stage: 'prod',
        requestId: 'req-123',
        requestTimeEpoch: Date.now(),
        resourceId: '',
        resourcePath: '',
      },
    } as APIGatewayProxyEvent;
  }

  const validRequest = {
    patternId: 'pattern-abc-123',
    garmentType: 'camiseta',
    designFileKey: 'designs/design-001/logo.png',
    placementZone: 'chest',
  };

  const compositeResult = {
    frontImage: Buffer.from('front-image-data'),
    backImage: Buffer.from('back-image-data'),
    scalingApplied: 85,
  };

  // --- Validation Tests ---

  it('should return 400 when body is missing', async () => {
    const event = createEvent(undefined);
    const result = await handler(event, {} as Context, () => {});

    expect(result).toBeDefined();
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Request body is required');
  });

  it('should return 400 when body is invalid JSON', async () => {
    const event = createEvent(undefined);
    event.body = 'not-json{';
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Invalid JSON in request body');
  });

  it('should return 400 when patternId is missing', async () => {
    const event = createEvent({ ...validRequest, patternId: '' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('patternId is required');
  });

  it('should return 400 when garmentType is missing', async () => {
    const event = createEvent({ ...validRequest, garmentType: '' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('garmentType is required');
  });

  it('should return 400 when placementZone is invalid', async () => {
    const event = createEvent({ ...validRequest, placementZone: 'invalid-zone' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('Invalid placementZone');
  });

  // --- Success Path ---

  it('should return 201 with mockup data on success', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockResolvedValue(undefined);
    mockPut.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValueOnce('https://s3.presigned/front.png');
    mockGetPresignedUrl.mockResolvedValueOnce('https://s3.presigned/back.png');
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.mockupId).toBeDefined();
    expect(body.frontImageUrl).toBe('https://s3.presigned/front.png');
    expect(body.backImageUrl).toBe('https://s3.presigned/back.png');
    expect(body.status).toBe('pending_approval');
    expect(body.scalingApplied).toBe(85);
  });

  it('should call compositeDesign with correct options', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockResolvedValue(undefined);
    mockPut.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValue('https://presigned.url');
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    await handler(event, {} as Context, () => {});

    expect(mockCompositeDesign).toHaveBeenCalledWith({
      garmentType: 'camiseta',
      designFileKey: 'designs/design-001/logo.png',
      placementZone: 'chest',
    });
  });

  it('should store front and back images to S3 at correct keys', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockResolvedValue(undefined);
    mockPut.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValue('https://presigned.url');
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    await handler(event, {} as Context, () => {});

    expect(mockUploadFile).toHaveBeenCalledTimes(2);

    const frontCall = mockUploadFile.mock.calls.find(
      (call) => (call[1] as string).includes('front.png'),
    );
    const backCall = mockUploadFile.mock.calls.find(
      (call) => (call[1] as string).includes('back.png'),
    );

    expect(frontCall).toBeDefined();
    expect(frontCall![0]).toBe('cronusfit-assets');
    expect(frontCall![1]).toMatch(/^mockups\/[a-f0-9-]+\/front\.png$/);
    expect(frontCall![2]).toEqual(compositeResult.frontImage);
    expect(frontCall![3]).toBe('image/png');

    expect(backCall).toBeDefined();
    expect(backCall![0]).toBe('cronusfit-assets');
    expect(backCall![1]).toMatch(/^mockups\/[a-f0-9-]+\/back\.png$/);
    expect(backCall![2]).toEqual(compositeResult.backImage);
    expect(backCall![3]).toBe('image/png');
  });

  it('should create DynamoDB record with pending_approval status', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockResolvedValue(undefined);
    mockPut.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValue('https://presigned.url');
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    await handler(event, {} as Context, () => {});

    expect(mockPut).toHaveBeenCalledTimes(1);
    const record = mockPut.mock.calls[0][0];

    expect(record.PK).toMatch(/^MOCKUP#[a-f0-9-]+$/);
    expect(record.SK).toBe('METADATA');
    expect(record.GSI1PK).toBe('STATUS#pending_approval');
    expect((record as Record<string, unknown>).status).toBe('pending_approval');
    expect((record as Record<string, unknown>).publishStatus).toBe('unpublished');
    expect((record as Record<string, unknown>).patternId).toBe('pattern-abc-123');
    expect((record as Record<string, unknown>).garmentType).toBe('camiseta');
    expect((record as Record<string, unknown>).placementZone).toBe('chest');
    expect((record as Record<string, unknown>).createdBy).toBe('admin-sub-123');
    expect((record as Record<string, unknown>).scalingPercentage).toBe(85);
  });

  it('should record an audit log entry on success', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockResolvedValue(undefined);
    mockPut.mockResolvedValue(undefined);
    mockGetPresignedUrl.mockResolvedValue('https://presigned.url');
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    await handler(event, {} as Context, () => {});

    expect(mockRecordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-sub-123',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'mockup_generate',
        resourceType: 'mockup',
        metadata: expect.objectContaining({
          patternId: 'pattern-abc-123',
          garmentType: 'camiseta',
          placementZone: 'chest',
          scalingApplied: 85,
        }),
      }),
    );
  });

  // --- Atomic Rollback Tests ---

  it('should rollback S3 objects when DynamoDB write fails', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockResolvedValue(undefined);
    mockPut.mockRejectedValue(new Error('ConditionalCheckFailedException'));
    mockDeleteFile.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toContain('Mockup creation failed');

    // Verify rollback happened
    expect(mockDeleteFile).toHaveBeenCalledTimes(2);
    const deleteKeys = mockDeleteFile.mock.calls.map((call) => call[1]);
    expect(deleteKeys.some((key) => (key as string).includes('front.png'))).toBe(true);
    expect(deleteKeys.some((key) => (key as string).includes('back.png'))).toBe(true);
  });

  it('should return 500 when S3 upload fails (no partial state)', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockRejectedValue(new Error('S3 PutObject failed'));

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toContain('Mockup storage failed');

    // DynamoDB should NOT have been called
    expect(mockPut).not.toHaveBeenCalled();
  });

  it('should still return error even if rollback fails', async () => {
    mockCompositeDesign.mockResolvedValue(compositeResult);
    mockUploadFile.mockResolvedValue(undefined);
    mockPut.mockRejectedValue(new Error('DynamoDB error'));
    mockDeleteFile.mockRejectedValue(new Error('S3 delete failed'));

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toContain('Mockup creation failed');
  });

  // --- Compositor Error Handling ---

  it('should return 400 when design validation fails', async () => {
    const error = new CompositorError(
      'DESIGN_VALIDATION_FAILED',
      'Design file validation failed: Invalid file format',
    );
    mockCompositeDesign.mockRejectedValue(error);

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('Design file validation failed');
  });

  it('should return 400 when design is not found', async () => {
    const error = new CompositorError(
      'DESIGN_NOT_FOUND',
      'Design file not found at key: designs/missing.png',
    );
    mockCompositeDesign.mockRejectedValue(error);

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('Design file not found');
  });

  it('should return 500 for unexpected compositor errors', async () => {
    mockCompositeDesign.mockRejectedValue(new Error('Sharp processing failed'));

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toContain('Mockup generation failed');
  });
});
