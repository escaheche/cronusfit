/**
 * Unit tests for the design-upload Lambda handler.
 *
 * Tests file upload flow:
 * - Base64 decode + validation → S3 upload → returns designFileKey
 * - Format validation → rejects invalid MIME types
 * - Size validation → rejects files > 10MB
 * - Input validation → returns 400 for missing/invalid fields
 * - Audit log is recorded on success
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock dependencies
vi.mock('../../../src/storage/s3-client.js', () => ({
  uploadFile: vi.fn(),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

vi.mock('../../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: vi.fn(),
}));

import { handler } from '../../../src/lambdas/design-upload/handler.js';
import { uploadFile } from '../../../src/storage/s3-client.js';
import { recordAuditEntry } from '../../../src/modules/security/audit-log.js';

const mockUploadFile = vi.mocked(uploadFile);
const mockRecordAuditEntry = vi.mocked(recordAuditEntry);

describe('design-upload handler', () => {
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
      path: '/api/designs/upload',
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
        path: '/api/designs/upload',
        stage: 'prod',
        requestId: 'req-123',
        requestTimeEpoch: Date.now(),
        resourceId: '',
        resourcePath: '',
      },
    } as APIGatewayProxyEvent;
  }

  // Create a small PNG (1x1 pixel, ~68 bytes) in base64
  const smallPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const validRequest = {
    fileName: 'logo.png',
    fileType: 'image/png',
    fileContent: smallPngBase64,
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

  it('should return 400 when fileName is missing', async () => {
    const event = createEvent({ ...validRequest, fileName: '' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('fileName is required');
  });

  it('should return 400 when fileType is missing', async () => {
    const event = createEvent({ ...validRequest, fileType: '' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('fileType is required');
  });

  it('should return 400 when fileContent is missing', async () => {
    const event = createEvent({ ...validRequest, fileContent: '' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('fileContent is required');
  });

  it('should return 400 when fileType is invalid', async () => {
    const event = createEvent({ ...validRequest, fileType: 'application/pdf' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('Invalid file format');
    expect(JSON.parse(response.body).error).toContain('image/png');
    expect(JSON.parse(response.body).error).toContain('image/jpeg');
    expect(JSON.parse(response.body).error).toContain('image/svg+xml');
  });

  it('should accept image/png format', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent({ ...validRequest, fileType: 'image/png' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(201);
  });

  it('should accept image/jpeg format', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent({ ...validRequest, fileType: 'image/jpeg' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(201);
  });

  it('should accept image/svg+xml format', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent({ ...validRequest, fileType: 'image/svg+xml' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(201);
  });

  it('should handle edge case base64 strings gracefully', async () => {
    // Note: Buffer.from() with 'base64' is permissive and ignores invalid chars
    // This test verifies the handler doesn't crash on unusual input
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent({ ...validRequest, fileContent: 'not-valid-base64!@#$' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number };
    // Should succeed (Buffer.from base64 is lenient) or fail validation
    expect([201, 400]).toContain(response.statusCode);
  });

  it('should return 400 when file size exceeds 10MB', async () => {
    // Create a base64 string that decodes to >10MB
    // 10MB = 10 * 1024 * 1024 = 10,485,760 bytes
    // Base64 is ~4/3 original size, so we need >13,981,013 base64 chars
    // Create a buffer of 10MB + 1 byte, then encode
    const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 1, 'A');
    const largeBase64 = largeBuffer.toString('base64');

    const event = createEvent({ ...validRequest, fileContent: largeBase64 });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toContain('exceeds maximum allowed size of 10MB');
  });

  // --- Success Path ---

  it('should return 201 with designFileKey on success', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(201);

    const body = JSON.parse(response.body);
    expect(body.designFileKey).toBeDefined();
    expect(body.designFileKey).toMatch(/^designs\/[a-f0-9-]+-logo\.png$/);
    expect(body.message).toBe('Design file uploaded successfully');
  });

  it('should include CORS headers in response', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; headers: Record<string, string> };
    expect(response.headers['Access-Control-Allow-Origin']).toBe(
      'https://d29tumvobv6mdj.cloudfront.net',
    );
    expect(response.headers['Access-Control-Allow-Methods']).toBe('POST,OPTIONS');
    expect(response.headers['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
  });

  it('should upload file to S3 with correct key pattern', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    await handler(event, {} as Context, () => {});

    expect(mockUploadFile).toHaveBeenCalledTimes(1);

    const [bucket, key, buffer, contentType] = mockUploadFile.mock.calls[0];
    expect(bucket).toBe('cronusfit-assets');
    expect(key).toMatch(/^designs\/[a-f0-9-]+-logo\.png$/);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(contentType).toBe('image/png');
  });

  it('should decode base64 correctly before upload', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    await handler(event, {} as Context, () => {});

    const [, , buffer] = mockUploadFile.mock.calls[0];
    const expectedBuffer = Buffer.from(smallPngBase64, 'base64');
    expect(buffer).toEqual(expectedBuffer);
  });

  it('should record an audit log entry on success', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest);
    await handler(event, {} as Context, () => {});

    expect(mockRecordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-sub-123',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'design_upload',
        resourceType: 'design',
        metadata: expect.objectContaining({
          fileName: 'logo.png',
          fileType: 'image/png',
          fileSizeBytes: expect.any(Number),
          s3Key: expect.stringMatching(/^designs\/[a-f0-9-]+-logo\.png$/),
        }),
      }),
    );
  });

  it('should generate unique UUIDs for different uploads', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event1 = createEvent(validRequest);
    const result1 = await handler(event1, {} as Context, () => {});
    const key1 = JSON.parse((result1 as { body: string }).body).designFileKey;

    const event2 = createEvent(validRequest);
    const result2 = await handler(event2, {} as Context, () => {});
    const key2 = JSON.parse((result2 as { body: string }).body).designFileKey;

    expect(key1).not.toBe(key2);
  });

  it('should preserve original fileName in S3 key', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const customRequest = { ...validRequest, fileName: 'my-design-v2.png' };
    const event = createEvent(customRequest);
    const result = await handler(event, {} as Context, () => {});

    const body = JSON.parse((result as { body: string }).body);
    expect(body.designFileKey).toMatch(/^designs\/[a-f0-9-]+-my-design-v2\.png$/);
  });

  // --- Error Handling ---

  it('should return 500 when S3 upload fails', async () => {
    mockUploadFile.mockRejectedValue(new Error('S3 PutObject failed'));

    const event = createEvent(validRequest);
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toContain('Design file upload failed');
  });

  it('should include CORS headers in error responses', async () => {
    const event = createEvent({ ...validRequest, fileName: '' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; headers: Record<string, string> };
    expect(response.headers['Access-Control-Allow-Origin']).toBe(
      'https://d29tumvobv6mdj.cloudfront.net',
    );
  });

  it('should extract admin context from authorizer', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const customAuthorizer = {
      adminId: 'custom-admin-456',
      adminEmail: 'custom@cronusfit.com',
    };
    const event = createEvent(validRequest, customAuthorizer);
    await handler(event, {} as Context, () => {});

    expect(mockRecordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'custom-admin-456',
        adminEmail: 'custom@cronusfit.com',
      }),
    );
  });

  it('should handle missing authorizer gracefully', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    const event = createEvent(validRequest, {});
    await handler(event, {} as Context, () => {});

    expect(mockRecordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'unknown',
        adminEmail: 'unknown',
      }),
    );
  });

  it('should accept file exactly at 10MB limit', async () => {
    mockUploadFile.mockResolvedValue(undefined);
    mockRecordAuditEntry.mockResolvedValue(undefined);

    // Create exactly 10MB
    const exactBuffer = Buffer.alloc(10 * 1024 * 1024, 'A');
    const exactBase64 = exactBuffer.toString('base64');

    const event = createEvent({ ...validRequest, fileContent: exactBase64 });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number };
    expect(response.statusCode).toBe(201);
  });
});
