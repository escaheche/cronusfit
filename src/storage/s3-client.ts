/**
 * S3 service layer for CronusFit platform.
 * Handles uploads, downloads, presigned URLs, and file validation.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// --- S3 Client ---

const s3Client = new S3Client({});

export { s3Client };

// --- Bucket Configuration ---

export const BUCKETS = {
  /** Private bucket for patterns, designs, mockups, print files, social content (Block Public Access). */
  assets: process.env.S3_ASSETS_BUCKET ?? 'cronusfit-assets',
  /** Private bucket for static site (CloudFront OAI access only). */
  website: process.env.S3_WEBSITE_BUCKET ?? 'cronusfit-website',
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

// --- Presigned URL Configuration ---

/** Default presigned URL expiry in seconds (1 hour). */
const DEFAULT_PRESIGNED_EXPIRY_SECONDS = 3600;

const PRESIGNED_EXPIRY_SECONDS = process.env.PRESIGNED_URL_EXPIRY
  ? parseInt(process.env.PRESIGNED_URL_EXPIRY, 10)
  : DEFAULT_PRESIGNED_EXPIRY_SECONDS;

// --- File Validation ---

/** Allowed file formats for upload validation. */
export const ALLOWED_FORMATS = ['image/jpeg', 'image/png', 'image/svg+xml'] as const;

/** Allowed file extensions mapped to MIME types. */
export const FORMAT_EXTENSION_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** Maximum file size in bytes (10MB). */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a file buffer and filename for allowed format and size constraints.
 * Checks:
 * - File extension matches allowed formats (JPEG, PNG, SVG)
 * - File size does not exceed 10MB
 *
 * @param buffer - The file content as a Buffer or Uint8Array
 * @param filename - The original filename (used for extension check)
 * @returns Validation result with error messages if invalid
 */
export function validateFile(
  buffer: Buffer | Uint8Array,
  filename: string
): FileValidationResult {
  const errors: string[] = [];

  // Check file extension
  const ext = getFileExtension(filename).toLowerCase();
  const allowedExtensions = Object.keys(FORMAT_EXTENSION_MAP);

  if (!allowedExtensions.includes(ext)) {
    errors.push(
      `Invalid file format "${ext}". Allowed formats: ${allowedExtensions.join(', ')} (JPEG, PNG, SVG)`
    );
  }

  // Check file size
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
    errors.push(
      `File size ${sizeMB}MB exceeds maximum allowed size of 10MB`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Gets the content type for a given filename based on its extension.
 * Returns undefined if the extension is not recognized.
 */
export function getContentType(filename: string): string | undefined {
  const ext = getFileExtension(filename).toLowerCase();
  return FORMAT_EXTENSION_MAP[ext];
}

// --- S3 Operations ---

/**
 * Uploads a file to an S3 bucket.
 *
 * @param bucket - Target bucket name
 * @param key - S3 object key (e.g., "patterns/uuid/pattern.svg")
 * @param body - File content
 * @param contentType - MIME type of the file
 */
export async function uploadFile(
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType: string
): Promise<void> {
  const params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  };

  await s3Client.send(new PutObjectCommand(params));
}

/**
 * Downloads a file from an S3 bucket.
 *
 * @param bucket - Source bucket name
 * @param key - S3 object key
 * @returns The file content as a Buffer, or undefined if the object body is empty
 */
export async function downloadFile(
  bucket: string,
  key: string
): Promise<Buffer | undefined> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  if (!response.Body) {
    return undefined;
  }

  const byteArray = await response.Body.transformToByteArray();
  return Buffer.from(byteArray);
}

/**
 * Generates a presigned GET URL for downloading a file.
 *
 * @param bucket - Source bucket name
 * @param key - S3 object key
 * @param expiresIn - URL expiry time in seconds (default: configured value or 1 hour)
 * @returns Presigned URL string
 */
export async function getPresignedUrl(
  bucket: string,
  key: string,
  expiresIn?: number
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: expiresIn ?? PRESIGNED_EXPIRY_SECONDS,
  });
}

/**
 * Generates a presigned PUT URL for uploading a file.
 *
 * @param bucket - Target bucket name
 * @param key - S3 object key
 * @param contentType - Expected MIME type for the upload
 * @param expiresIn - URL expiry time in seconds (default: configured value or 1 hour)
 * @returns Presigned URL string
 */
export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresIn?: number
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: expiresIn ?? PRESIGNED_EXPIRY_SECONDS,
  });
}

/**
 * Deletes a file from an S3 bucket.
 *
 * @param bucket - Source bucket name
 * @param key - S3 object key
 */
export async function deleteFile(bucket: string, key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

/**
 * Checks whether an object exists in an S3 bucket using HEAD request.
 *
 * @param bucket - Source bucket name
 * @param key - S3 object key
 * @returns true if the object exists, false otherwise
 */
export async function fileExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return true;
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

// --- Pattern Storage Operations ---

/**
 * S3 key pattern for pattern SVG files.
 * Format: patterns/{patternId}/pattern.svg
 */
export function getPatternS3Key(patternId: string): string {
  return `patterns/${patternId}/pattern.svg`;
}

/**
 * Uploads a pattern SVG to S3 using the standard key pattern.
 * Stores to `patterns/{patternId}/pattern.svg` with ContentType 'image/svg+xml'.
 * Block Public Access is maintained — no public ACLs are set.
 *
 * @param patternId - Unique pattern identifier (UUID)
 * @param svgContent - The SVG document string
 * @returns The S3 key where the file was stored
 *
 * @see Requirements 5.1
 */
export async function uploadPatternSvg(
  patternId: string,
  svgContent: string
): Promise<string> {
  const key = getPatternS3Key(patternId);

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKETS.assets,
      Key: key,
      Body: svgContent,
      ContentType: 'image/svg+xml',
    })
  );

  return key;
}

/**
 * Generates a presigned download URL for a pattern SVG file.
 * URL expires after 1 hour (3600 seconds) as required by Requirement 5.4.
 * Block Public Access is maintained — access is only via presigned URL.
 *
 * @param patternId - Unique pattern identifier (UUID)
 * @returns Presigned URL string with 1-hour expiry
 *
 * @see Requirements 5.4, 7.3
 */
export async function getPatternDownloadUrl(patternId: string): Promise<string> {
  const key = getPatternS3Key(patternId);

  const command = new GetObjectCommand({
    Bucket: BUCKETS.assets,
    Key: key,
  });

  return getSignedUrl(s3Client, command, {
    expiresIn: 3600, // 1 hour
  });
}

// --- Utility Helpers ---

/**
 * Extracts the file extension from a filename (including the dot).
 */
function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  return filename.slice(lastDot);
}

/**
 * Checks if an error is an S3 NotFound/NoSuchKey error.
 */
function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name: string }).name;
    return name === 'NotFound' || name === 'NoSuchKey' || name === '404';
  }
  return false;
}
