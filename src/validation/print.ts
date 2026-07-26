/**
 * Print dimension validation utilities.
 *
 * DTF: width and height must be between 10mm and 500mm.
 * Sublimation: width and height must be between 10mm and 1500mm (1cm–150cm).
 *
 * All dimensions are validated in millimeters internally.
 *
 * Validates: Requirements 8.5, 9.5
 */

import {
  type ValidationError,
  type StructuredValidationResult,
  buildError,
  structuredValid,
  structuredInvalid,
} from './common.js';

/** Minimum DTF dimension in millimeters. */
export const DTF_MIN_MM = 10;

/** Maximum DTF dimension in millimeters. */
export const DTF_MAX_MM = 500;

/** Minimum sublimation dimension in millimeters (1cm). */
export const SUBLIMATION_MIN_MM = 10;

/** Maximum sublimation dimension in millimeters (150cm). */
export const SUBLIMATION_MAX_MM = 1500;

/** DTF print dimensions input (in millimeters). */
export interface DTFDimensions {
  /** Width in millimeters (10–500). */
  widthMm: number;
  /** Height in millimeters (10–500). */
  heightMm: number;
}

/** Sublimation print dimensions input (in millimeters). */
export interface SublimationDimensions {
  /** Width in millimeters (10–1500). */
  widthMm: number;
  /** Height in millimeters (10–1500). */
  heightMm: number;
}

/**
 * Validate a single DTF dimension value.
 */
function isValidDTFDimension(valueMm: number): boolean {
  return Number.isFinite(valueMm) && valueMm >= DTF_MIN_MM && valueMm <= DTF_MAX_MM;
}

/**
 * Validate a single sublimation dimension value.
 */
function isValidSublimationDimension(valueMm: number): boolean {
  return (
    Number.isFinite(valueMm) &&
    valueMm >= SUBLIMATION_MIN_MM &&
    valueMm <= SUBLIMATION_MAX_MM
  );
}

/**
 * Validate DTF print dimensions.
 *
 * Both width and height must be between 10mm and 500mm.
 *
 * @param dimensions - DTF print dimensions in millimeters
 * @returns StructuredValidationResult with per-field errors
 */
export function validateDTFDimensions(
  dimensions: DTFDimensions,
): StructuredValidationResult {
  const errors: ValidationError[] = [];

  if (!isValidDTFDimension(dimensions.widthMm)) {
    errors.push(buildError('widthMm', 'OUT_OF_RANGE', 'dtf_dimension_invalid'));
  }

  if (!isValidDTFDimension(dimensions.heightMm)) {
    errors.push(buildError('heightMm', 'OUT_OF_RANGE', 'dtf_dimension_invalid'));
  }

  if (errors.length > 0) {
    return structuredInvalid(errors);
  }

  return structuredValid();
}

/**
 * Validate sublimation print dimensions.
 *
 * Both width and height must be between 10mm (1cm) and 1500mm (150cm).
 *
 * @param dimensions - Sublimation print dimensions in millimeters
 * @returns StructuredValidationResult with per-field errors
 */
export function validateSublimationDimensions(
  dimensions: SublimationDimensions,
): StructuredValidationResult {
  const errors: ValidationError[] = [];

  if (!isValidSublimationDimension(dimensions.widthMm)) {
    errors.push(
      buildError('widthMm', 'OUT_OF_RANGE', 'sublimation_dimension_invalid'),
    );
  }

  if (!isValidSublimationDimension(dimensions.heightMm)) {
    errors.push(
      buildError('heightMm', 'OUT_OF_RANGE', 'sublimation_dimension_invalid'),
    );
  }

  if (errors.length > 0) {
    return structuredInvalid(errors);
  }

  return structuredValid();
}
