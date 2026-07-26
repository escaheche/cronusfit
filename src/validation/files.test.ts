import { describe, it, expect } from 'vitest';
import {
  isValidMimeType,
  isValidExtension,
  isValidFileSize,
  validateFile,
  MAX_FILE_SIZE_BYTES,
  ACCEPTED_MIME_TYPES,
  ACCEPTED_EXTENSIONS,
  type FileInfo,
} from './files.js';

describe('isValidMimeType', () => {
  it('accepts image/jpeg', () => {
    expect(isValidMimeType('image/jpeg')).toBe(true);
  });

  it('accepts image/png', () => {
    expect(isValidMimeType('image/png')).toBe(true);
  });

  it('accepts image/svg+xml', () => {
    expect(isValidMimeType('image/svg+xml')).toBe(true);
  });

  it('rejects image/gif', () => {
    expect(isValidMimeType('image/gif')).toBe(false);
  });

  it('rejects application/pdf', () => {
    expect(isValidMimeType('application/pdf')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidMimeType('')).toBe(false);
  });
});

describe('isValidExtension', () => {
  it('accepts .jpg', () => {
    expect(isValidExtension('photo.jpg')).toBe(true);
  });

  it('accepts .jpeg', () => {
    expect(isValidExtension('photo.jpeg')).toBe(true);
  });

  it('accepts .png', () => {
    expect(isValidExtension('image.png')).toBe(true);
  });

  it('accepts .svg', () => {
    expect(isValidExtension('icon.svg')).toBe(true);
  });

  it('accepts uppercase extensions', () => {
    expect(isValidExtension('PHOTO.JPG')).toBe(true);
  });

  it('rejects .gif', () => {
    expect(isValidExtension('animation.gif')).toBe(false);
  });

  it('rejects .pdf', () => {
    expect(isValidExtension('document.pdf')).toBe(false);
  });

  it('rejects file without extension', () => {
    expect(isValidExtension('noextension')).toBe(false);
  });
});

describe('isValidFileSize', () => {
  it('accepts 0 bytes', () => {
    expect(isValidFileSize(0)).toBe(true);
  });

  it('accepts exactly 10MB', () => {
    expect(isValidFileSize(10 * 1024 * 1024)).toBe(true);
  });

  it('accepts 1 byte', () => {
    expect(isValidFileSize(1)).toBe(true);
  });

  it('rejects size over 10MB', () => {
    expect(isValidFileSize(10 * 1024 * 1024 + 1)).toBe(false);
  });

  it('rejects negative size', () => {
    expect(isValidFileSize(-1)).toBe(false);
  });

  it('rejects NaN', () => {
    expect(isValidFileSize(NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isValidFileSize(Infinity)).toBe(false);
  });
});

describe('validateFile', () => {
  const validFile: FileInfo = {
    name: 'design.png',
    sizeBytes: 5 * 1024 * 1024,
    mimeType: 'image/png',
  };

  it('returns valid for a correct PNG file', () => {
    const result = validateFile(validFile);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for a correct JPEG file', () => {
    const result = validateFile({
      name: 'photo.jpg',
      sizeBytes: 2 * 1024 * 1024,
      mimeType: 'image/jpeg',
    });
    expect(result.valid).toBe(true);
  });

  it('returns valid for a correct SVG file', () => {
    const result = validateFile({
      name: 'icon.svg',
      sizeBytes: 1024,
      mimeType: 'image/svg+xml',
    });
    expect(result.valid).toBe(true);
  });

  it('returns error for invalid MIME type', () => {
    const result = validateFile({
      ...validFile,
      mimeType: 'image/gif',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'mimeType')).toBe(true);
  });

  it('returns error for invalid extension', () => {
    const result = validateFile({
      ...validFile,
      name: 'design.bmp',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('returns error for file exceeding 10MB', () => {
    const result = validateFile({
      ...validFile,
      sizeBytes: 11 * 1024 * 1024,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'sizeBytes')).toBe(true);
    expect(result.errors.some((e) => e.code === 'SIZE_EXCEEDED')).toBe(true);
  });

  it('returns multiple errors for multiple issues', () => {
    const result = validateFile({
      name: 'design.bmp',
      sizeBytes: 20 * 1024 * 1024,
      mimeType: 'image/bmp',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('errors include bilingual messages', () => {
    const result = validateFile({
      ...validFile,
      mimeType: 'text/plain',
    });
    const error = result.errors[0];
    expect(error.message.es).toBeTruthy();
    expect(error.message.en).toBeTruthy();
  });

  it('exports correct constants', () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(10 * 1024 * 1024);
    expect(ACCEPTED_MIME_TYPES.has('image/jpeg')).toBe(true);
    expect(ACCEPTED_MIME_TYPES.has('image/png')).toBe(true);
    expect(ACCEPTED_MIME_TYPES.has('image/svg+xml')).toBe(true);
    expect(ACCEPTED_EXTENSIONS.has('.jpg')).toBe(true);
    expect(ACCEPTED_EXTENSIONS.has('.jpeg')).toBe(true);
    expect(ACCEPTED_EXTENSIONS.has('.png')).toBe(true);
    expect(ACCEPTED_EXTENSIONS.has('.svg')).toBe(true);
  });
});
