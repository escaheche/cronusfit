/**
 * Unit tests for the print-sublimation Lambda handler.
 *
 * Tests:
 * - POST /api/print/sublimation — success path with presigned URL
 * - Validation: missing body, invalid JSON, missing fields
 * - Error mapping: invalid dimensions, insufficient resolution, design not found
 * - S3 upload failure handling
 * - Audit log recording
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock dependencies
vi.mock('../../../src/modules/print/sublimation-generator.js', () => ({
  generateSublimation: vi.fn(),
}));

vi.mock('../../../src/storage/s3-client.js', () => ({
  uploadFile: vi.fn(),
  getPresignedUrl: vi.fn(),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

vi.mock('../../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: vi.fn(),
}));

import { handler } from '../../../src/lambdas/print-sublimation/handler.js';
import { generateSublimation } from '../../../src/modules/print/sublimation-generator.js';
import { uploadFile, getPresignedUrl } from '../../../src/storage/s3-client.js';
import { recordAuditEntry } from '../../../src/modules/security/audit-log.js';

const mockGenerateSublimation = vi.mocked(generateSublimation);
const mockUploadFile = vi.mocked(uploadFile);
const mockGetPresignedUrl = vi.mocked(getPresignedUrl);
const mockRecordAuditEntry = vi.mocked(recordAuditEntry);

describe('print-sublimation handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEntry.mockResolvedValue(undefined);
  });

  function createEvent(
    overrides: Partial<APIGatewayProxyEvent> = {},
  ): APIGatewayProxyEvent {
    return {
      body: JSON.stringify({
        designId: 'designs/sublimation-design.png',
        widthCm: 30,
        heightCm: 40,
      }),
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/api/print/sublimation',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '',
      requestContext: {
        accountId: '123456789',
        apiId: 'api-id',
        authorizer: {
          adminId: 'admin-sub-002',
          adminEmail: 'admin@cronusfit.com',
        },
        protocol: 'HTTP/1.1',
        httpMethod: 'POST',
        identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
        path: '/api/print/sublimation',
        stage: 'prod',
        requestId: 'req-002',
        requestTimeEpoch: Date.now(),
        resourceId: '',
        resourcePath: '',
      },
      ...overrides,
    } as APIGatewayProxyEvent;
  }

  describe('success path', () => {
    it('should generate sublimation file and return presigned URL', async () => {
      mockGenerateSublimation.mockResolvedValue({
        buffer: Buffer.from('sublimation-png-data'),
        dpi: 300,
        widthCm: 30,
        heightCm: 40,
        bleedMm: 3,
      });
      mockUploadFile.mockResolvedValue(undefined);
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/sublimation.png?signed');

      const result = await handler(createEvent(), {} as any, () => {});

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.fileUrl).toBe('https://s3.example.com/sublimation.png?signed');
      expect(body.dimensions).toEqual({
        widthCm: 30,
        heightCm: 40,
        bleedMm: 3,
        dpi: 300,
      });
    });

    it('should call generateSublimation with correct parameters', async () => {
      mockGenerateSublimation.mockResolvedValue({
        buffer: Buffer.from('output'),
        dpi: 300,
        widthCm: 30,
        heightCm: 40,
        bleedMm: 3,
      });
      mockUploadFile.mockResolvedValue(undefined);
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/file');

      await handler(createEvent(), {} as any, () => {});

      expect(mockGenerateSublimation).toHaveBeenCalledWith({
        designS3Key: 'designs/sublimation-design.png',
        widthCm: 30,
        heightCm: 40,
      });
    });

    it('should record an audit log entry on success', async () => {
      mockGenerateSublimation.mockResolvedValue({
        buffer: Buffer.from('output'),
        dpi: 300,
        widthCm: 30,
        heightCm: 40,
        bleedMm: 3,
      });
      mockUploadFile.mockResolvedValue(undefined);
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/file');

      await handler(createEvent(), {} as any, () => {});

      expect(mockRecordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-sub-002',
          adminEmail: 'admin@cronusfit.com',
          actionType: 'print_sublimation_generate',
          resourceType: 'print_file',
          metadata: expect.objectContaining({
            designId: 'designs/sublimation-design.png',
            widthCm: 30,
            heightCm: 40,
            bleedMm: 3,
            dpi: 300,
          }),
        }),
      );
    });
  });

  describe('validation errors', () => {
    it('should return 400 when body is missing', async () => {
      const event = createEvent({ body: null });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Request body is required');
    });

    it('should return 400 when body is invalid JSON', async () => {
      const event = createEvent({ body: '{broken' });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Invalid JSON in request body');
    });

    it('should return 400 when designId is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ widthCm: 30, heightCm: 40 }),
      });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('designId is required');
    });

    it('should return 400 when widthCm is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ designId: 'test', heightCm: 40 }),
      });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('widthCm');
    });

    it('should return 400 when heightCm is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ designId: 'test', widthCm: 30 }),
      });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('heightCm');
    });
  });

  describe('sublimation generator errors', () => {
    it('should return 400 for invalid dimensions', async () => {
      mockGenerateSublimation.mockRejectedValue(
        new Error('Invalid sublimation dimensions: width out of range'),
      );

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('Invalid sublimation dimensions');
    });

    it('should return 400 for insufficient resolution', async () => {
      mockGenerateSublimation.mockRejectedValue(
        new Error('Source resolution insufficient: source is 100x100px'),
      );

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('resolution insufficient');
    });

    it('should return 404 for design not found', async () => {
      mockGenerateSublimation.mockRejectedValue(
        new Error('Source design not found: designs/missing.png'),
      );

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toContain('not found');
    });

    it('should return 500 for unexpected generator errors', async () => {
      mockGenerateSublimation.mockRejectedValue(new Error('Sharp crashed'));

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toContain('Sharp crashed');
    });
  });

  describe('S3 upload failure', () => {
    it('should return 500 when S3 upload fails', async () => {
      mockGenerateSublimation.mockResolvedValue({
        buffer: Buffer.from('output'),
        dpi: 300,
        widthCm: 30,
        heightCm: 40,
        bleedMm: 3,
      });
      mockUploadFile.mockRejectedValue(new Error('S3 timeout'));

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toContain('Failed to store sublimation print file');
    });
  });
});
