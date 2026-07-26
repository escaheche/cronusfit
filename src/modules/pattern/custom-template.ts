/**
 * Custom Template Creation Module for CronusFit.
 *
 * Allows admins to create custom parametric templates with user-defined
 * control points and piece definitions. Validates inputs, applies the
 * age-group-specific ProportionProfile, and stores the template in DynamoDB.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

import { randomBytes } from 'node:crypto';

import type { AgeGroup } from '../../types/garment.js';
import type {
  ParametricTemplate,
  PieceTemplate,
  ControlPoint,
  ProportionProfile,
  PieceDefinition,
  MeasurementConstraint,
} from '../../types/pattern.js';
import type { StructuredValidationResult, ValidationError } from '../../validation/common.js';
import { structuredValid, structuredInvalid, buildCustomError } from '../../validation/common.js';
import { put } from '../../db/operations.js';
import { uploadFile, BUCKETS } from '../../storage/s3-client.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum number of control points required for a custom template. */
const MIN_CONTROL_POINTS = 4;

/** Minimum valid measurement in millimeters (1cm). */
const MEASUREMENT_MIN_MM = 10;

/** Maximum valid measurement in millimeters (200cm). */
const MEASUREMENT_MAX_MM = 2000;

/** Valid age groups. */
const VALID_AGE_GROUPS: readonly string[] = ['children', 'adult'];

// ─── ProportionProfile Definitions ───────────────────────────────────────────

/**
 * Children proportion profile.
 * Children have larger head-to-body ratio, shorter limbs relative to torso,
 * higher waist position, and narrower shoulders relative to hips.
 */
const CHILDREN_PROPORTION_PROFILE: ProportionProfile = {
  ageGroup: 'children',
  headToBodyRatio: 0.2,
  limbToTorsoRatio: 0.9,
  waistPositionRatio: 0.47,
  shoulderToHipRatio: 0.95,
};

/**
 * Adult proportion profile.
 * Adults have smaller head-to-body ratio, longer limbs relative to torso,
 * lower waist position, and wider shoulders relative to hips.
 */
const ADULT_PROPORTION_PROFILE: ProportionProfile = {
  ageGroup: 'adult',
  headToBodyRatio: 0.133,
  limbToTorsoRatio: 1.2,
  waistPositionRatio: 0.42,
  shoulderToHipRatio: 1.1,
};

/**
 * Get the ProportionProfile for a given age group.
 */
function getProportionProfile(ageGroup: AgeGroup): ProportionProfile {
  return ageGroup === 'children'
    ? CHILDREN_PROPORTION_PROFILE
    : ADULT_PROPORTION_PROFILE;
}

// ─── Input Interface ─────────────────────────────────────────────────────────

/**
 * Input shape for creating a custom template.
 */
export interface CreateCustomTemplateInput {
  /** Human-readable template name. */
  name: string;
  /** Target age group ('children' or 'adult'). */
  ageGroup: AgeGroup;
  /** Array of control points (minimum 4 required). */
  controlPoints: ControlPoint[];
  /** Array of piece definitions for the template. */
  pieceDefinitions: PieceDefinition[];
  /** Default measurements (controlPointId → mm value). */
  defaultMeasurements: Record<string, number>;
  /** Measurement constraints for template validation. */
  constraints: MeasurementConstraint[];
  /** ID of the admin who created this template (Cognito sub). */
  createdBy: string;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate the input for creating a custom template.
 *
 * Checks:
 * - name is non-empty
 * - ageGroup is valid ('children' or 'adult')
 * - Minimum 4 control points
 * - No duplicate control point IDs
 * - Control point minValue >= 10mm, maxValue <= 2000mm
 * - minValue < maxValue for each control point
 * - Every piece is referenced by at least one control point
 * - Default measurements exist for each control point
 * - createdBy is non-empty
 *
 * @param input - The create custom template input to validate
 * @returns StructuredValidationResult with errors for each invalid field
 */
export function validateCustomTemplateInput(
  input: CreateCustomTemplateInput,
): StructuredValidationResult {
  const errors: ValidationError[] = [];

  // Validate name
  if (!input.name || input.name.trim().length === 0) {
    errors.push(
      buildCustomError('name', 'REQUIRED', {
        es: 'El nombre de la plantilla es obligatorio.',
        en: 'Template name is required.',
      }),
    );
  }

  // Validate ageGroup
  if (!VALID_AGE_GROUPS.includes(input.ageGroup)) {
    errors.push(
      buildCustomError('ageGroup', 'INVALID_AGE_GROUP', {
        es: `Grupo etario inválido: "${input.ageGroup}". Debe ser "children" o "adult".`,
        en: `Invalid age group: "${input.ageGroup}". Must be "children" or "adult".`,
      }),
    );
  }

  // Validate createdBy
  if (!input.createdBy || input.createdBy.trim().length === 0) {
    errors.push(
      buildCustomError('createdBy', 'REQUIRED', {
        es: 'El campo createdBy es obligatorio.',
        en: 'The createdBy field is required.',
      }),
    );
  }

  // Validate minimum control points
  if (input.controlPoints.length < MIN_CONTROL_POINTS) {
    errors.push(
      buildCustomError('controlPoints', 'MIN_CONTROL_POINTS', {
        es: `Se requieren al menos ${MIN_CONTROL_POINTS} puntos de control. Se proporcionaron ${input.controlPoints.length}.`,
        en: `At least ${MIN_CONTROL_POINTS} control points are required. ${input.controlPoints.length} provided.`,
      }),
    );
  }

  // Validate no duplicate IDs
  const seenIds = new Set<string>();
  for (const cp of input.controlPoints) {
    if (seenIds.has(cp.id)) {
      errors.push(
        buildCustomError(`controlPoints.${cp.id}`, 'DUPLICATE_ID', {
          es: `ID duplicado en puntos de control: "${cp.id}".`,
          en: `Duplicate control point ID: "${cp.id}".`,
        }),
      );
    }
    seenIds.add(cp.id);
  }

  // Validate each control point's range
  for (const cp of input.controlPoints) {
    if (cp.minValue < MEASUREMENT_MIN_MM) {
      errors.push(
        buildCustomError(`controlPoints.${cp.id}.minValue`, 'OUT_OF_RANGE', {
          es: `Punto de control "${cp.id}": valor mínimo (${cp.minValue}mm) es menor que ${MEASUREMENT_MIN_MM}mm.`,
          en: `Control point "${cp.id}": minValue (${cp.minValue}mm) is below ${MEASUREMENT_MIN_MM}mm.`,
        }),
      );
    }
    if (cp.maxValue > MEASUREMENT_MAX_MM) {
      errors.push(
        buildCustomError(`controlPoints.${cp.id}.maxValue`, 'OUT_OF_RANGE', {
          es: `Punto de control "${cp.id}": valor máximo (${cp.maxValue}mm) excede ${MEASUREMENT_MAX_MM}mm.`,
          en: `Control point "${cp.id}": maxValue (${cp.maxValue}mm) exceeds ${MEASUREMENT_MAX_MM}mm.`,
        }),
      );
    }
    if (cp.minValue >= cp.maxValue) {
      errors.push(
        buildCustomError(`controlPoints.${cp.id}`, 'MIN_EXCEEDS_MAX', {
          es: `Punto de control "${cp.id}": minValue (${cp.minValue}mm) debe ser menor que maxValue (${cp.maxValue}mm).`,
          en: `Control point "${cp.id}": minValue (${cp.minValue}mm) must be less than maxValue (${cp.maxValue}mm).`,
        }),
      );
    }
  }

  // Validate every piece is referenced by at least one control point
  const referencedPieces = new Set<string>();
  for (const cp of input.controlPoints) {
    for (const pieceId of cp.affectedPieces) {
      referencedPieces.add(pieceId);
    }
  }
  for (const piece of input.pieceDefinitions) {
    if (!referencedPieces.has(piece.id)) {
      errors.push(
        buildCustomError(`pieceDefinitions.${piece.id}`, 'UNREFERENCED_PIECE', {
          es: `La pieza "${piece.id}" no está referenciada por ningún punto de control.`,
          en: `Piece "${piece.id}" is not referenced by any control point.`,
        }),
      );
    }
  }

  // Validate default measurements exist for each control point
  for (const cp of input.controlPoints) {
    if (input.defaultMeasurements[cp.id] === undefined) {
      errors.push(
        buildCustomError(`defaultMeasurements.${cp.id}`, 'MISSING_DEFAULT', {
          es: `Falta medida por defecto para el punto de control "${cp.id}".`,
          en: `Missing default measurement for control point "${cp.id}".`,
        }),
      );
    }
  }

  if (errors.length > 0) {
    return structuredInvalid(errors);
  }

  return structuredValid();
}

// ─── Custom Template Creation ────────────────────────────────────────────────

/**
 * Create a custom parametric template.
 *
 * Validates the input, generates a unique ID, applies the ProportionProfile
 * for the age group, stores the template as JSON in S3, and registers it
 * in DynamoDB.
 *
 * @param input - The custom template input (name, ageGroup, controlPoints, pieceDefinitions, etc.)
 * @returns The created ParametricTemplate with all fields populated
 * @throws Error with specific message if validation fails
 */
export async function createCustomTemplate(
  input: CreateCustomTemplateInput,
): Promise<ParametricTemplate> {
  // Validate input
  const validationResult = validateCustomTemplateInput(input);
  if (!validationResult.valid) {
    const errorDetails = validationResult.errors
      .map((e) => e.message.en)
      .join('; ');
    throw new Error(`Custom template validation failed: ${errorDetails}`);
  }

  // Generate unique ID: custom-{name-slug}-{8-char-hex}
  const nameSlug = input.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const uniqueSuffix = randomBytes(4).toString('hex');
  const id = `custom-${nameSlug}-${uniqueSuffix}`;

  // Apply ProportionProfile for the selected age group
  const proportionProfile = getProportionProfile(input.ageGroup);

  // Assemble the complete ParametricTemplate
  const template: ParametricTemplate = {
    id,
    garmentType: 'custom',
    ageGroup: input.ageGroup,
    proportionProfile,
    controlPoints: input.controlPoints,
    pieceDefinitions: input.pieceDefinitions,
    defaultMeasurements: input.defaultMeasurements,
    constraints: input.constraints,
  };

  // Store template JSON in S3
  const s3Key = `templates/parametric/custom/${id}.json`;
  await uploadFile(
    BUCKETS.assets,
    s3Key,
    JSON.stringify(template, null, 2),
    'application/json',
  );

  // Store metadata in DynamoDB (TEMPLATE#{garmentType}#{ageGroup} / VERSION#1)
  const now = new Date().toISOString();
  await put({
    PK: `TEMPLATE#custom#${input.ageGroup}`,
    SK: 'VERSION#1',
    GSI1PK: `AGEGROUP#${input.ageGroup}`,
    GSI1SK: 'GARMENT#custom',
    id,
    garmentType: 'custom',
    ageGroup: input.ageGroup,
    version: '1',
    controlPointCount: input.controlPoints.length,
    createdBy: input.createdBy,
    createdAt: now,
    s3Key,
  });

  return template;
}
