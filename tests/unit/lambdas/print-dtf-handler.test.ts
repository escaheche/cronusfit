/**
 * Unit tests for the print-dtf Lambda handler.
 *
 * Tests:
 * - POST /api/print/dtf — success path with presigned URLs
 * - Validation: missing body, invalid JSON, missing fields
 * - Error mapping: invalid dimensions, insufficient resolution, design not found
 * - S3 upload failure handling
 * - Audit log recording
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// Mock dependencies
vi.mock('../../../src/modules/print/dtf-generator.js', () => ({
  generateDTF: vi.fn(),
  DTFGeneratorError: class DTFGeneratorError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'DTFGeneratorError';
      this.code = code;
    }
  },
}));

vi.mock('../../../src/storage/s3-client.js', () => ({
  uploadFile: vi.fn(),
  getPresignedUrl: vi.fn(),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

vi.mock('../../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: vi.fn(),
}));

import { handler } from '../../../src/lambdas/print-dtf/handler.js';
import { generateDTF, DTFGeneratorError } from '../../../src/modules/print/dtf-generator.js';
import { uploadFile, getPresignedUrl } from '../../../src/storage/s3-client.js';
import { recordAuditEntry } from '../../../src/modules/security/audit-log.js';

const mockGenerateDTF = vi.mocked(generateDTF);
const mockUploadFile = vi.mocked(uploadFile);
const mockGetPresignedUrl = vi.mocked(getPresignedUrl);
const mockRecordAuditEntry = vi.mocked(recordAuditEntry);

describe('print-dtf handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordAuditEntry.mockResolvedValue(undefined);
  });

  function createEvent(
    overrides: Partial<APIGatewayProxyEvent> = {},
  ): APIGatewayProxyEvent {
    return {
      body: JSON.stringify({
        designId: 'designs/test-design.png',
        widthMm: 200,
        heightMm: 300,
      }),
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/api/print/dtf',
      pathParameters: null,
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '',
      requestContext: {
        accountId: '123456789',
        apiId: 'api-id',
        authorizer: {
          adminId: 'admin-sub-001',
          adminEmail: 'admin@cronusfit.com',
        },
        protocol: 'HTTP/1.1',
        httpMethod: 'POST',
        identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
        path: '/api/print/dtf',
        stage: 'prod',
        requestId: 'req-001',
        requestTimeEpoch: Date.now(),
        resourceId: '',
        resourcePath: '',
      },
      ...overrides,
    } as APIGatewayProxyEvent;
  }

  describe('success path', () => {
    it('should generate DTF files and return presigned URLs', async () => {
      mockGenerateDTF.mockResolvedValue({
        mainBuffer: Buffer.from('main-png-data'),
        underbaseBuffer: Buffer.from('underbase-png-data'),
        dpi: 300,
        widthMm: 200,
        heightMm: 300,
      });
      mockUploadFile.mockResolvedValue(undefined);
      mockGetPresignedUrl.mockResolvedValueOnce('https://s3.example.com/main.png?signed');
      mockGetPresignedUrl.mockResolvedValueOnce('https://s3.example.com/underbase.png?signed');

      const result = await handler(createEvent(), {} as any, () => {});

      expect(result).toBeDefined();
      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.mainFileUrl).toBe('https://s3.example.com/main.png?signed');
      expect(body.underbaseFileUrl).toBe('https://s3.example.com/underbase.png?signed');
      expect(body.dimensions).toEqual({ widthMm: 200, heightMm: 300, dpi: 300 });
    });

    it('should call generateDTF with correct parameters', async () => {
      mockGenerateDTF.mockResolvedValue({
        mainBuffer: Buffer.from('main'),
        underbaseBuffer: Buffer.from('underbase'),
        dpi: 300,
        widthMm: 200,
        heightMm: 300,
      });
      mockUploadFile.mockResolvedValue(undefined);
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/file');

      await handler(createEvent(), {} as any, () => {});

      expect(mockGenerateDTF).toHaveBeenCalledWith({
        designS3Key: 'designs/test-design.png',
        widthMm: 200,
        heightMm: 300,
      });
    });

    it('should record an audit log entry on success', async () => {
      mockGenerateDTF.mockResolvedValue({
        mainBuffer: Buffer.from('main'),
        underbaseBuffer: Buffer.from('underbase'),
        dpi: 300,
        widthMm: 200,
        heightMm: 300,
      });
      mockUploadFile.mockResolvedValue(undefined);
      mockGetPresignedUrl.mockResolvedValue('https://s3.example.com/file');

      await handler(createEvent(), {} as any, () => {});

      expect(mockRecordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-sub-001',
          adminEmail: 'admin@cronusfit.com',
          actionType: 'print_dtf_generate',
          resourceType: 'print_file',
          metadata: expect.objectContaining({
            designId: 'designs/test-design.png',
            widthMm: 200,
            heightMm: 300,
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
      const event = createEvent({ body: 'not-json' });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Invalid JSON in request body');
    });

    it('should return 400 when designId is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ widthMm: 200, heightMm: 300 }),
      });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('designId is required');
    });

    it('should return 400 when widthMm is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ designId: 'test', heightMm: 300 }),
      });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('widthMm');
    });

    it('should return 400 when heightMm is missing', async () => {
      const event = createEvent({
        body: JSON.stringify({ designId: 'test', widthMm: 200 }),
      });
      const result = await handler(event, {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('heightMm');
    });
  });

  describe('DTF generator errors', () => {
    it('should return 400 for invalid dimensions', async () => {
      mockGenerateDTF.mockRejectedValue(
        new DTFGeneratorError('INVALID_DIMENSIONS', 'Width out of range'),
      );

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('Width out of range');
    });

    it('should return 400 for insufficient resolution', async () => {
      mockGenerateDTF.mockRejectedValue(
        new DTFGeneratorError('INSUFFICIENT_RESOLUTION', 'Source DPI too low'),
      );

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('Source DPI too low');
    });

    it('should return 404 for design not found', async () => {
      mockGenerateDTF.mockRejectedValue(
        new DTFGeneratorError('DESIGN_NOT_FOUND', 'Design file not found'),
      );

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toContain('Design file not found');
    });

    it('should return 500 for unexpected generator errors', async () => {
      mockGenerateDTF.mockRejectedValue(new Error('Sharp crashed'));

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toContain('Sharp crashed');
    });
  });

  describe('S3 upload failure', () => {
    it('should return 500 when S3 upload fails', async () => {
      mockGenerateDTF.mockResolvedValue({
        mainBuffer: Buffer.from('main'),
        underbaseBuffer: Buffer.from('underbase'),
        dpi: 300,
        widthMm: 200,
        heightMm: 300,
      });
      mockUploadFile.mockRejectedValue(new Error('S3 timeout'));

      const result = await handler(createEvent(), {} as any, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toContain('Failed to store DTF print files');
    });
  });
});
