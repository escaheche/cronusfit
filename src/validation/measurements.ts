/**
 * Measurement and input validation utilities for pattern generation.
 *
 * All internal measurements are in millimeters.
 * Valid range: 10mm (1cm) to 2000mm (200cm) per individual measurement.
 *
 * Validates: Requirements 1.10, 1.11, 2.3, 2.6, 3.8
 */

import type {
  GarmentType,
  AgeGroup,
  Size,
  ChildrenSize,
  AdultSize,
} from '../types/garment.js';
import type { ControlPoint } from '../types/pattern.js';
import {
  type ValidationError,
  type StructuredValidationResult,
  buildError,
  buildCustomError,
  structuredValid,
  structuredInvalid,
} from './common.js';

/** Minimum valid measurement in millimeters (1cm). */
export const MEASUREMENT_MIN_MM = 10;

/** Maximum valid measurement in millimeters (200cm). */
export const MEASUREMENT_MAX_MM = 2000;

/** Minimum number of control points required for a custom template. */
export const MIN_CONTROL_POINTS = 4;

/** Valid standard garment types. */
const VALID_GARMENT_TYPES: readonly GarmentType[] = [
  'camiseta',
  'short',
  'legging',
  'sudadera',
  'tank-top',
  'custom',
] as const;

/** Valid children sizes. */
const VALID_CHILDREN_SIZES: readonly ChildrenSize[] = [
  '2T', '4T', '6', '8', '10', '12', '14', '16',
] as const;

/** Valid adult sizes. */
const VALID_ADULT_SIZES: readonly AdultSize[] = [
  'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
] as const;

/** All valid sizes (children + adult). */
const VALID_SIZES: readonly Size[] = [
  ...VALID_CHILDREN_SIZES,
  ...VALID_ADULT_SIZES,
] as const;

/** Valid age groups. */
const VALID_AGE_GROUPS: readonly AgeGroup[] = ['children', 'adult'] as const;

/**
 * Validate a single measurement value (in millimeters).
 *
 * Returns true if the measurement is a finite number within [10mm, 2000mm].
 */
export function isValidMeasurement(valueMm: number): boolean {
  return (
    Number.isFinite(valueMm) &&
    valueMm >= MEASUREMENT_MIN_MM &&
    valueMm <= MEASUREMENT_MAX_MM
  );
}

/**
 * Validate a record of named measurements (all in millimeters).
 *
 * Each measurement must be a finite number between 10mm and 2000mm.
 * Returns a structured result with per-field errors for any invalid values.
 *
 * @param measurements - Record mapping measurement names to values in mm
 * @returns StructuredValidationResult with errors for each invalid measurement
 */
export function validateMeasurements(
  measurements: Record<string, number>,
): StructuredValidationResult {
  const errors: ValidationError[] = [];

  for (const [name, value] of Object.entries(measurements)) {
    if (!Number.isFinite(value)) {
      errors.push(
        buildError(name, 'INVALID_NUMBER', 'measurement_out_of_range'),
      );
    } else if (value < MEASUREMENT_MIN_MM || value > MEASUREMENT_MAX_MM) {
      errors.push(
        buildError(name, 'OUT_OF_RANGE', 'measurement_out_of_range'),
      );
    }
  }

  if (errors.length > 0) {
    return structuredInvalid(errors);
  }

  return structuredValid();
}

/**
 * Validate that a string is a valid GarmentType.
 *
 * Valid values: 'camiseta' | 'short' | 'legging' | 'sudadera' | 'tank-top' | 'custom'
 * Also accepts legacy 'tank_top' for backward compatibility.
 *
 * @param type - The garment type string to validate
 * @returns StructuredValidationResult with error if invalid
 */
export function validateGarmentType(type: string): StructuredValidationResult {
  // Accept legacy 'tank_top' as valid (backward compatibility per garment.ts type definition)
  if (
    (VALID_GARMENT_TYPES as readonly string[]).includes(type) ||
    type === 'tank_top'
  ) {
    return structuredValid();
  }

  const validList = VALID_GARMENT_TYPES.join(', ');
  return structuredInvalid([
    buildCustomError('garmentType', 'INVALID_GARMENT_TYPE', {
      es: `Tipo de prenda inválido: "${type}". Tipos válidos: ${validList}`,
      en: `Invalid garment type: "${type}". Valid types: ${validList}`,
    }),
  ]);
}

/**
 * Validate that a string is a valid Size (ChildrenSize or AdultSize).
 *
 * Children sizes: 2T, 4T, 6, 8, 10, 12, 14, 16
 * Adult sizes: XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL
 *
 * @param size - The size string to validate
 * @returns StructuredValidationResult with error if invalid
 */
export function validateSize(size: string): StructuredValidationResult {
  if ((VALID_SIZES as readonly string[]).includes(size)) {
    return structuredValid();
  }

  const childrenList = VALID_CHILDREN_SIZES.join(', ');
  const adultList = VALID_ADULT_SIZES.join(', ');
  return structuredInvalid([
    buildCustomError('size', 'INVALID_SIZE', {
      es: `Talla inválida: "${size}". Tallas válidas — Niños: ${childrenList}; Adultos: ${adultList}`,
      en: `Invalid size: "${size}". Valid sizes — Children: ${childrenList}; Adults: ${adultList}`,
    }),
  ]);
}

/**
 * Validate that a string is a valid AgeGroup.
 *
 * Valid values: 'children' | 'adult'
 *
 * @param ageGroup - The age group string to validate
 * @returns StructuredValidationResult with error if invalid
 */
export function validateAgeGroup(ageGroup: string): StructuredValidationResult {
  if ((VALID_AGE_GROUPS as readonly string[]).includes(ageGroup)) {
    return structuredValid();
  }

  return structuredInvalid([
    buildError('ageGroup', 'INVALID_AGE_GROUP', 'age_group_invalid'),
  ]);
}

/**
 * Validate an array of control points for custom template creation.
 *
 * Requirements:
 * - Minimum 4 control points required
 * - Each control point's minValue (or min) must be >= 10mm
 * - Each control point's maxValue (or max) must be <= 2000mm
 * - minValue must be <= maxValue
 *
 * @param controlPoints - Array of ControlPoint objects to validate
 * @returns StructuredValidationResult with specific errors for each invalid control point
 */
export function validateControlPoints(
  controlPoints: ControlPoint[],
): StructuredValidationResult {
  const errors: ValidationError[] = [];

  if (controlPoints.length < MIN_CONTROL_POINTS) {
    errors.push(
      buildCustomError('controlPoints', 'INSUFFICIENT_CONTROL_POINTS', {
        es: `Se requieren al menos ${MIN_CONTROL_POINTS} puntos de control. Se proporcionaron ${controlPoints.length}.`,
        en: `At least ${MIN_CONTROL_POINTS} control points are required. ${controlPoints.length} provided.`,
      }),
    );
  }

  for (let i = 0; i < controlPoints.length; i++) {
    const cp = controlPoints[i];
    const fieldPrefix = `controlPoints[${i}]`;
    const cpName = cp.name || cp.id || `#${i}`;

    // Resolve min/max values (support both minValue/maxValue and min/max aliases)
    const minVal = cp.minValue ?? cp.min;
    const maxVal = cp.maxValue ?? cp.max;

    if (minVal === undefined || maxVal === undefined) {
      errors.push(
        buildCustomError(`${fieldPrefix}`, 'MISSING_RANGE', {
          es: `Punto de control "${cpName}": debe tener valores mínimo y máximo definidos.`,
          en: `Control point "${cpName}": must have min and max values defined.`,
        }),
      );
      continue;
    }

    if (!Number.isFinite(minVal)) {
      errors.push(
        buildCustomError(`${fieldPrefix}.min`, 'INVALID_NUMBER', {
          es: `Punto de control "${cpName}": el valor mínimo debe ser un número válido.`,
          en: `Control point "${cpName}": min value must be a valid number.`,
        }),
      );
    } else if (minVal < MEASUREMENT_MIN_MM) {
      errors.push(
        buildCustomError(`${fieldPrefix}.min`, 'OUT_OF_RANGE', {
          es: `Punto de control "${cpName}": valor mínimo (${minVal}mm) es menor que el mínimo permitido (${MEASUREMENT_MIN_MM}mm).`,
          en: `Control point "${cpName}": min value (${minVal}mm) is below the allowed minimum (${MEASUREMENT_MIN_MM}mm).`,
        }),
      );
    } else if (minVal > MEASUREMENT_MAX_MM) {
      errors.push(
        buildCustomError(`${fieldPrefix}.min`, 'OUT_OF_RANGE', {
          es: `Punto de control "${cpName}": valor mínimo (${minVal}mm) excede el máximo permitido (${MEASUREMENT_MAX_MM}mm).`,
          en: `Control point "${cpName}": min value (${minVal}mm) exceeds the allowed maximum (${MEASUREMENT_MAX_MM}mm).`,
        }),
      );
    }

    if (!Number.isFinite(maxVal)) {
      errors.push(
        buildCustomError(`${fieldPrefix}.max`, 'INVALID_NUMBER', {
          es: `Punto de control "${cpName}": el valor máximo debe ser un número válido.`,
          en: `Control point "${cpName}": max value must be a valid number.`,
        }),
      );
    } else if (maxVal > MEASUREMENT_MAX_MM) {
      errors.push(
        buildCustomError(`${fieldPrefix}.max`, 'OUT_OF_RANGE', {
          es: `Punto de control "${cpName}": valor máximo (${maxVal}mm) excede el máximo permitido (${MEASUREMENT_MAX_MM}mm).`,
          en: `Control point "${cpName}": max value (${maxVal}mm) exceeds the allowed maximum (${MEASUREMENT_MAX_MM}mm).`,
        }),
      );
    } else if (maxVal < MEASUREMENT_MIN_MM) {
      errors.push(
        buildCustomError(`${fieldPrefix}.max`, 'OUT_OF_RANGE', {
          es: `Punto de control "${cpName}": valor máximo (${maxVal}mm) es menor que el mínimo permitido (${MEASUREMENT_MIN_MM}mm).`,
          en: `Control point "${cpName}": max value (${maxVal}mm) is below the allowed minimum (${MEASUREMENT_MIN_MM}mm).`,
        }),
      );
    }

    // Validate min <= max (only if both are valid finite numbers in range)
    if (
      Number.isFinite(minVal) &&
      Number.isFinite(maxVal) &&
      minVal >= MEASUREMENT_MIN_MM &&
      maxVal <= MEASUREMENT_MAX_MM &&
      minVal > maxVal
    ) {
      errors.push(
        buildCustomError(`${fieldPrefix}`, 'INVALID_RANGE_ORDER', {
          es: `Punto de control "${cpName}": el valor mínimo (${minVal}mm) no puede ser mayor que el máximo (${maxVal}mm).`,
          en: `Control point "${cpName}": min value (${minVal}mm) cannot be greater than max value (${maxVal}mm).`,
        }),
      );
    }
  }

  if (errors.length > 0) {
    return structuredInvalid(errors);
  }

  return structuredValid();
}
