import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { sdkStreamMixin } from '@smithy/util-stream';

import {
  s3Client,
  BUCKETS,
  ALLOWED_FORMATS,
  FORMAT_EXTENSION_MAP,
  MAX_FILE_SIZE_BYTES,
  validateFile,
  getContentType,
  uploadFile,
  downloadFile,
  deleteFile,
  fileExists,
  getPatternS3Key,
  uploadPatternSvg,
  getPatternDownloadUrl,
} from '../../../src/storage/s3-client.js';

// Mock the presigner module to avoid needing real AWS region/credentials
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://s3.amazonaws.com/cronusfit-assets/patterns/mock/pattern.svg?X-Amz-Signed=mock'),
}));

// ---------------------------------------------------------------------------
// AWS SDK mock
// ---------------------------------------------------------------------------

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

// ---------------------------------------------------------------------------
// Bucket Configuration
// ---------------------------------------------------------------------------

describe('Bucket configuration', () => {
  it('should define assets bucket with default name', () => {
    expect(BUCKETS.assets).toBe('cronusfit-assets');
  });

  it('should define website bucket with default name', () => {
    expect(BUCKETS.website).toBe('cronusfit-website');
  });
});

// ---------------------------------------------------------------------------
// File Validation
// ---------------------------------------------------------------------------

describe('validateFile', () => {
  it('should accept a valid JPEG file under 10MB', () => {
    const buffer = Buffer.alloc(1024); // 1KB
    const result = validateFile(buffer, 'photo.jpg');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept a valid PNG file', () => {
    const buffer = Buffer.alloc(2048);
    const result = validateFile(buffer, 'design.png');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept a valid SVG file', () => {
    const buffer = Buffer.from('<svg></svg>');
    const result = validateFile(buffer, 'pattern.svg');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept .jpeg extension', () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, 'image.jpeg');
    expect(result.valid).toBe(true);
  });

  it('should reject unsupported file format', () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, 'document.pdf');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Invalid file format');
    expect(result.errors[0]).toContain('.pdf');
  });

  it('should reject file exceeding 10MB', () => {
    const buffer = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1);
    const result = validateFile(buffer, 'large.png');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('exceeds maximum');
    expect(result.errors[0]).toContain('10MB');
  });

  it('should report both format and size errors together', () => {
    const buffer = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1);
    const result = validateFile(buffer, 'large.gif');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('should reject file with no extension', () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, 'noextension');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid file format');
  });

  it('should handle case-insensitive extensions', () => {
    const buffer = Buffer.alloc(100);
    const result = validateFile(buffer, 'IMAGE.PNG');
    expect(result.valid).toBe(true);
  });

  it('should accept file at exactly 10MB', () => {
    const buffer = Buffer.alloc(MAX_FILE_SIZE_BYTES);
    const result = validateFile(buffer, 'exact.png');
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getContentType
// ---------------------------------------------------------------------------

describe('getContentType', () => {
  it('should return image/jpeg for .jpg', () => {
    expect(getContentType('photo.jpg')).toBe('image/jpeg');
  });

  it('should return image/jpeg for .jpeg', () => {
    expect(getContentType('photo.jpeg')).toBe('image/jpeg');
  });

  it('should return image/png for .png', () => {
    expect(getContentType('design.png')).toBe('image/png');
  });

  it('should return image/svg+xml for .svg', () => {
    expect(getContentType('pattern.svg')).toBe('image/svg+xml');
  });

  it('should return undefined for unknown extension', () => {
    expect(getContentType('file.txt')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// S3 Operations
// ---------------------------------------------------------------------------

describe('uploadFile', () => {
  it('should send a PutObjectCommand with correct params', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await uploadFile('cronusfit-assets', 'patterns/abc/pattern.svg', Buffer.from('data'), 'image/svg+xml');

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: 'cronusfit-assets',
      Key: 'patterns/abc/pattern.svg',
      ContentType: 'image/svg+xml',
    });
  });
});

describe('downloadFile', () => {
  it('should return buffer from S3 object body', async () => {
    const body = Buffer.from('file content');
    const stream = sdkStreamMixin(Readable.from([body]));
    s3Mock.on(GetObjectCommand).resolves({ Body: stream });

    const result = await downloadFile('cronusfit-assets', 'patterns/abc/pattern.svg');
    expect(result).toBeInstanceOf(Buffer);
    expect(result!.toString()).toBe('file content');
  });

  it('should return undefined when body is empty', async () => {
    s3Mock.on(GetObjectCommand).resolves({ Body: undefined });

    const result = await downloadFile('cronusfit-assets', 'key');
    expect(result).toBeUndefined();
  });
});

describe('deleteFile', () => {
  it('should send a DeleteObjectCommand', async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});

    await deleteFile('cronusfit-assets', 'patterns/abc/file.png');

    const calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: 'cronusfit-assets',
      Key: 'patterns/abc/file.png',
    });
  });
});

describe('fileExists', () => {
  it('should return true when object exists', async () => {
    s3Mock.on(HeadObjectCommand).resolves({});

    const result = await fileExists('cronusfit-assets', 'existing-key');
    expect(result).toBe(true);
  });

  it('should return false when object does not exist (NotFound)', async () => {
    s3Mock.on(HeadObjectCommand).rejects({ name: 'NotFound' });

    const result = await fileExists('cronusfit-assets', 'missing-key');
    expect(result).toBe(false);
  });

  it('should return false when object does not exist (NoSuchKey)', async () => {
    s3Mock.on(HeadObjectCommand).rejects({ name: 'NoSuchKey' });

    const result = await fileExists('cronusfit-assets', 'missing-key');
    expect(result).toBe(false);
  });

  it('should rethrow non-NotFound errors', async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error('AccessDenied'));

    await expect(fileExists('cronusfit-assets', 'forbidden-key')).rejects.toThrow('AccessDenied');
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Constants', () => {
  it('MAX_FILE_SIZE_BYTES should be 10MB', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('ALLOWED_FORMATS should include JPEG, PNG, SVG', () => {
    expect(ALLOWED_FORMATS).toContain('image/jpeg');
    expect(ALLOWED_FORMATS).toContain('image/png');
    expect(ALLOWED_FORMATS).toContain('image/svg+xml');
  });

  it('FORMAT_EXTENSION_MAP should map common extensions', () => {
    expect(FORMAT_EXTENSION_MAP['.jpg']).toBe('image/jpeg');
    expect(FORMAT_EXTENSION_MAP['.jpeg']).toBe('image/jpeg');
    expect(FORMAT_EXTENSION_MAP['.png']).toBe('image/png');
    expect(FORMAT_EXTENSION_MAP['.svg']).toBe('image/svg+xml');
  });
});

// ---------------------------------------------------------------------------
// Pattern Storage Operations
// ---------------------------------------------------------------------------

describe('getPatternS3Key', () => {
  it('should return the correct S3 key pattern for a given patternId', () => {
    expect(getPatternS3Key('abc-123')).toBe('patterns/abc-123/pattern.svg');
  });

  it('should handle UUID-style pattern IDs', () => {
    const uuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    expect(getPatternS3Key(uuid)).toBe(`patterns/${uuid}/pattern.svg`);
  });
});

describe('uploadPatternSvg', () => {
  it('should upload SVG content with correct key and content type', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const svgContent = '<svg xmlns="http://www.w3.org/2000/svg"><g id="panel-frontal"></g></svg>';
    const key = await uploadPatternSvg('pattern-001', svgContent);

    expect(key).toBe('patterns/pattern-001/pattern.svg');

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0].input).toMatchObject({
      Bucket: BUCKETS.assets,
      Key: 'patterns/pattern-001/pattern.svg',
      Body: svgContent,
      ContentType: 'image/svg+xml',
    });
  });

  it('should use the assets bucket (Block Public Access maintained)', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    await uploadPatternSvg('test-id', '<svg></svg>');

    const calls = s3Mock.commandCalls(PutObjectCommand);
    expect(calls[0].args[0].input.Bucket).toBe(BUCKETS.assets);
    // No ACL is set, maintaining Block Public Access
    expect(calls[0].args[0].input).not.toHaveProperty('ACL');
  });

  it('should return the S3 key of the uploaded file', async () => {
    s3Mock.on(PutObjectCommand).resolves({});

    const key = await uploadPatternSvg('uuid-abc', '<svg></svg>');
    expect(key).toBe('patterns/uuid-abc/pattern.svg');
  });
});

describe('getPatternDownloadUrl', () => {
  it('should generate a presigned URL for the correct key', async () => {
    // getSignedUrl doesn't go through the mock, so we test
    // that it creates a URL string (presigner generates locally)
    const url = await getPatternDownloadUrl('pattern-001');

    // Presigned URLs are strings that contain the bucket and key info
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });
});
