/**
 * Storage module barrel file.
 * Re-exports all S3 service layer functionality.
 */

export {
  s3Client,
  BUCKETS,
  type BucketName,
  ALLOWED_FORMATS,
  FORMAT_EXTENSION_MAP,
  MAX_FILE_SIZE_BYTES,
  type FileValidationResult,
  validateFile,
  getContentType,
  uploadFile,
  downloadFile,
  getPresignedUrl,
  getPresignedUploadUrl,
  deleteFile,
  fileExists,
} from './s3-client.js';
