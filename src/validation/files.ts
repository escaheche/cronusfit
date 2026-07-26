/**
 * File format and size validation utilities.
 *
 * Accepted formats: JPEG (image/jpeg, .jpg/.jpeg), PNG (image/png, .png), SVG (image/svg+xml, .svg)
 * Maximum file size: 10MB (10 * 1024 * 1024 bytes)
 *
 * Validates: Requirements 1.2, 4.6
 */

import {
  type ValidationError,
  type StructuredValidationResult,
  buildError,
  structuredValid,
  structuredInvalid,
} from './common.js';

/** Maximum file size in bytes (10MB). */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Accepted MIME types for file uploads. */
export const ACCEPTED_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/svg+xml',
]);

/** Accepted file extensions (lowercase, including dot). */
export const ACCEPTED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.svg',
]);

/** File metadata for validation. */
export interface FileInfo {
  /** File name with extension. */
  name: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** MIME type of the file (e.g., 'image/png'). */
  mimeType: string;
}

/**
 * Extract the file extension from a filename (lowercase, with dot).
 */
function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Check if a MIME type is accepted.
 */
export function isValidMimeType(mimeType: string): boolean {
  return ACCEPTED_MIME_TYPES.has(mimeType.toLowerCase());
}

/**
 * Check if a file extension is accepted.
 */
export function isValidExtension(filename: string): boolean {
  return ACCEPTED_EXTENSIONS.has(getExtension(filename));
}

/**
 * Check if a file size is within the maximum limit.
 */
export function isValidFileSize(sizeBytes: number): boolean {
  return Number.isFinite(sizeBytes) && sizeBytes >= 0 && sizeBytes <= MAX_FILE_SIZE_BYTES;
}

/**
 * Validate a file's format and size.
 *
 * Checks:
 * 1. MIME type must be image/jpeg, image/png, or image/svg+xml
 * 2. File extension must be .jpg, .jpeg, .png, or .svg
 * 3. File size must not exceed 10MB
 *
 * @param file - File metadata to validate
 * @returns StructuredValidationResult with per-field errors
 */
export function validateFile(file: FileInfo): StructuredValidationResult {
  const errors: ValidationError[] = [];

  // Validate MIME type
  if (!isValidMimeType(file.mimeType)) {
    errors.push(buildError('mimeType', 'INVALID_FORMAT', 'file_format_invalid'));
  }

  // Validate extension
  if (!isValidExtension(file.name)) {
    errors.push(buildError('name', 'INVALID_FORMAT', 'file_format_invalid'));
  }

  // Validate file size
  if (!isValidFileSize(file.sizeBytes)) {
    errors.push(buildError('sizeBytes', 'SIZE_EXCEEDED', 'file_size_exceeded'));
  }

  if (errors.length > 0) {
    return structuredInvalid(errors);
  }

  return structuredValid();
}
