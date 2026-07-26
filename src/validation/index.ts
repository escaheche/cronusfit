/**
 * Validation module barrel export.
 *
 * Re-exports all validation utilities from:
 * - common: Error types, error builder, bilingual messages
 * - measurements: Measurement range validation (10mm–2000mm)
 * - files: File format (JPEG, PNG, SVG) and size (≤10MB) validation
 * - quote: Quote form field validation
 * - print: DTF and sublimation dimension validation
 * - sanitize: Input sanitization (XSS prevention)
 */

export {
  type Locale,
  type ValidationResult,
  type ValidationError,
  type StructuredValidationResult,
  type ErrorKey,
  getErrorMessage,
  getBilingualMessage,
  valid,
  invalid,
  structuredValid,
  structuredInvalid,
  buildError,
  buildCustomError,
} from './common.js';

export {
  MEASUREMENT_MIN_MM,
  MEASUREMENT_MAX_MM,
  isValidMeasurement,
  validateMeasurements,
} from './measurements.js';

export {
  MAX_FILE_SIZE_BYTES,
  ACCEPTED_MIME_TYPES,
  ACCEPTED_EXTENSIONS,
  type FileInfo,
  isValidMimeType,
  isValidExtension,
  isValidFileSize,
  validateFile,
} from './files.js';

export {
  validateClientName,
  validateEmail,
  validatePhone,
  validateQuantity,
  validateAgeGroup,
  validateSizes,
  validateCustomizationNotes,
  validateTrackingNumber,
} from './quote.js';

export {
  DTF_MIN_MM,
  DTF_MAX_MM,
  SUBLIMATION_MIN_MM,
  SUBLIMATION_MAX_MM,
  type DTFDimensions,
  type SublimationDimensions,
  validateDTFDimensions,
  validateSublimationDimensions,
} from './print.js';

export { sanitizeInput, sanitizeQuoteFields } from './sanitize.js';
