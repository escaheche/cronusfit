/**
 * Grading engine module for CronusFit pattern generation.
 * Manages grading increment tables: loading, validating, and persisting.
 *
 * Grading tables define measurement increments between consecutive sizes
 * for each control point, enabling size grading from a base pattern.
 *
 * All increment values are in millimeters (1mm–100mm per size step).
 */

import type { AgeGroup, GarmentType, Size, ChildrenSize, AdultSize } from '../../types/garment.js';
import type {
  GradingIncrementTable,
  ScaledPattern,
  ScaledPiece,
  LineData,
  ProportionProfile,
} from '../../types/pattern.js';
import type { StructuredValidationResult, ValidationError } from '../../validation/common.js';
import { structuredValid, structuredInvalid, buildCustomError } from '../../validation/common.js';
import { getGradingTable, putGradingTable } from '../../db/operations.js';
import { generateSvg } from './serialization.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum allowed increment value in mm. */
const MIN_INCREMENT_MM = 1;

/** Maximum allowed increment value in mm. */
const MAX_INCREMENT_MM = 100;

/** Consecutive size transitions for children (2T–16). */
export const CHILDREN_TRANSITIONS: readonly string[] = [
  '2T→4T',
  '4T→6',
  '6→8',
  '8→10',
  '10→12',
  '12→14',
  '14→16',
] as const;

/** Consecutive size transitions for adults (XS–6XL). */
export const ADULT_TRANSITIONS: readonly string[] = [
  'XS→S',
  'S→M',
  'M→L',
  'L→XL',
  'XL→XXL',
  'XXL→3XL',
  '3XL→4XL',
  '4XL→5XL',
  '5XL→6XL',
] as const;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Loads a grading increment table from DynamoDB.
 * Throws if the table is not found.
 *
 * @param ageGroup - Target age group ('children' | 'adult')
 * @param garmentType - Garment type to load the table for
 * @returns The grading increment table
 * @throws Error if no grading table exists for the given combination
 */
export async function loadGradingTable(
  ageGroup: AgeGroup,
  garmentType: GarmentType,
): Promise<GradingIncrementTable> {
  const table = await getGradingTable(ageGroup, garmentType);

  if (!table) {
    throw new Error(
      `Grading table not found for ageGroup="${ageGroup}", garmentType="${garmentType}"`,
    );
  }

  return table;
}

/**
 * Validates a grading increment table ensuring:
 * 1. All increment values are positive between 1mm and 100mm.
 * 2. Table has entries for ALL consecutive size transitions for the age group.
 * 3. Each transition has entries for at least one control point.
 *
 * @param table - The grading increment table to validate
 * @returns Structured validation result with any errors found
 */
export function validateGradingTable(table: GradingIncrementTable): StructuredValidationResult {
  const errors: ValidationError[] = [];

  const expectedTransitions = getExpectedTransitions(table.ageGroup);

  // Check that all expected transitions are present
  for (const transition of expectedTransitions) {
    if (!(transition in table.increments)) {
      errors.push(
        buildCustomError(
          `increments.${transition}`,
          'MISSING_TRANSITION',
          {
            es: `Falta la transición de talla "${transition}" en la tabla de escalado`,
            en: `Missing size transition "${transition}" in the grading table`,
          },
        ),
      );
      continue;
    }

    const controlPoints = table.increments[transition];

    // Each transition must have at least one control point
    if (!controlPoints || Object.keys(controlPoints).length === 0) {
      errors.push(
        buildCustomError(
          `increments.${transition}`,
          'EMPTY_TRANSITION',
          {
            es: `La transición "${transition}" debe tener al menos un punto de control`,
            en: `Transition "${transition}" must have at least one control point`,
          },
        ),
      );
      continue;
    }

    // Validate each increment value is within range
    for (const [controlPointId, increment] of Object.entries(controlPoints)) {
      if (
        typeof increment !== 'number' ||
        !Number.isFinite(increment) ||
        increment < MIN_INCREMENT_MM ||
        increment > MAX_INCREMENT_MM
      ) {
        errors.push(
          buildCustomError(
            `increments.${transition}.${controlPointId}`,
            'INCREMENT_OUT_OF_RANGE',
            {
              es: `El incremento para "${controlPointId}" en "${transition}" debe ser entre ${MIN_INCREMENT_MM}mm y ${MAX_INCREMENT_MM}mm (valor: ${increment})`,
              en: `Increment for "${controlPointId}" in "${transition}" must be between ${MIN_INCREMENT_MM}mm and ${MAX_INCREMENT_MM}mm (value: ${increment})`,
            },
          ),
        );
      }
    }
  }

  if (errors.length > 0) {
    return structuredInvalid(errors);
  }

  return structuredValid();
}

/**
 * Validates and persists a grading increment table to DynamoDB.
 * Throws if validation fails.
 *
 * @param ageGroup - Target age group
 * @param garmentType - Garment type for the table
 * @param table - The grading increment table to save
 * @throws Error if validation fails (includes validation errors in message)
 */
export async function saveGradingTable(
  ageGroup: AgeGroup,
  garmentType: GarmentType,
  table: GradingIncrementTable,
): Promise<void> {
  const validationResult = validateGradingTable(table);

  if (!validationResult.valid) {
    const errorSummary = validationResult.errors
      .map((e) => `${e.field}: ${e.message.en}`)
      .join('; ');
    throw new Error(`Grading table validation failed: ${errorSummary}`);
  }

  await putGradingTable(ageGroup, garmentType, table);
}

// ─── Size Ordering ───────────────────────────────────────────────────────────

/** Ordered children sizes from smallest to largest. */
const CHILDREN_SIZE_ORDER: readonly ChildrenSize[] = [
  '2T', '4T', '6', '8', '10', '12', '14', '16',
] as const;

/** Ordered adult sizes from smallest to largest. */
const ADULT_SIZE_ORDER: readonly AdultSize[] = [
  'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
] as const;

/** ProportionProfile for children age group. */
const CHILDREN_PROPORTION_PROFILE: ProportionProfile = {
  ageGroup: 'children',
  headToBodyRatio: 0.2,
  limbToTorsoRatio: 0.9,
  waistPositionRatio: 0.47,
  shoulderToHipRatio: 0.95,
};

/** ProportionProfile for adults age group. */
const ADULT_PROPORTION_PROFILE: ProportionProfile = {
  ageGroup: 'adult',
  headToBodyRatio: 0.133,
  limbToTorsoRatio: 1.2,
  waistPositionRatio: 0.42,
  shoulderToHipRatio: 1.1,
};

// ─── Grading Public API ──────────────────────────────────────────────────────

/**
 * Grades a base pattern to produce scaled patterns for each target size.
 *
 * For children: applies anatomical proportion adjustments (waist position,
 * limb ratio, shoulder ratio) in addition to increment-based scaling.
 * For adults: scales proportionally maintaining width-to-length relationships.
 *
 * Preserves notch count, grain line, and labels at proportional positions.
 *
 * @param basePattern - The base pattern to scale from
 * @param ageGroup - Target age group ('children' | 'adult')
 * @param targetSizes - Array of sizes to produce
 * @param gradingTable - Increment table with per-transition increments
 * @returns Array of ScaledPattern, one per target size
 */
export function gradePattern(
  basePattern: ScaledPattern,
  ageGroup: AgeGroup,
  targetSizes: Size[],
  gradingTable: GradingIncrementTable,
): ScaledPattern[] {
  const baseSize = basePattern.size;
  const sizeOrder = getSizeOrder(ageGroup);
  const transitions = getExpectedTransitions(ageGroup);

  const baseIndex = sizeOrder.indexOf(baseSize as (typeof sizeOrder)[number]);
  if (baseIndex === -1) {
    throw new Error(`Base size "${baseSize}" is not valid for age group "${ageGroup}"`);
  }

  const results: ScaledPattern[] = [];

  for (const targetSize of targetSizes) {
    const targetIndex = sizeOrder.indexOf(targetSize as (typeof sizeOrder)[number]);
    if (targetIndex === -1) {
      throw new Error(`Target size "${targetSize}" is not valid for age group "${ageGroup}"`);
    }

    // Calculate cumulative increments from base to target
    const cumulativeIncrements = calculateCumulativeIncrements(
      baseIndex,
      targetIndex,
      transitions,
      gradingTable,
    );

    // Grade each piece
    const gradedPieces = basePattern.pieces.map((piece) =>
      gradePiece(piece, cumulativeIncrements, ageGroup, baseIndex, targetIndex, sizeOrder.length),
    );

    results.push({
      garmentType: basePattern.garmentType,
      ageGroup,
      size: targetSize,
      pieces: gradedPieces,
    });
  }

  return results;
}

/**
 * Calculates graded measurements for a target size from base measurements.
 *
 * @param baseMeasurements - Base measurements as controlPointId → mm value
 * @param ageGroup - Target age group
 * @param fromSize - Base size
 * @param toSize - Target size
 * @param gradingTable - Increment table
 * @returns Graded measurements as controlPointId → mm value
 */
export function calculateGradedMeasurements(
  baseMeasurements: Record<string, number>,
  ageGroup: AgeGroup,
  fromSize: Size,
  toSize: Size,
  gradingTable: GradingIncrementTable,
): Record<string, number> {
  const sizeOrder = getSizeOrder(ageGroup);
  const transitions = getExpectedTransitions(ageGroup);

  const fromIndex = sizeOrder.indexOf(fromSize as (typeof sizeOrder)[number]);
  const toIndex = sizeOrder.indexOf(toSize as (typeof sizeOrder)[number]);

  if (fromIndex === -1) {
    throw new Error(`From size "${fromSize}" is not valid for age group "${ageGroup}"`);
  }
  if (toIndex === -1) {
    throw new Error(`To size "${toSize}" is not valid for age group "${ageGroup}"`);
  }

  const cumulativeIncrements = calculateCumulativeIncrements(
    fromIndex,
    toIndex,
    transitions,
    gradingTable,
  );

  const result: Record<string, number> = {};

  for (const [controlPointId, baseValue] of Object.entries(baseMeasurements)) {
    const increment = cumulativeIncrements[controlPointId] ?? 0;
    result[controlPointId] = baseValue + increment;
  }

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the expected size transitions for a given age group.
 */
function getExpectedTransitions(ageGroup: AgeGroup): readonly string[] {
  return ageGroup === 'children' ? CHILDREN_TRANSITIONS : ADULT_TRANSITIONS;
}

/**
 * Returns the ordered list of sizes for a given age group.
 */
function getSizeOrder(ageGroup: AgeGroup): readonly string[] {
  return ageGroup === 'children' ? CHILDREN_SIZE_ORDER : ADULT_SIZE_ORDER;
}

/**
 * Calculates cumulative increments from baseIndex to targetIndex.
 * Supports grading both up (larger sizes) and down (smaller sizes).
 * Returns a map of controlPointId → cumulative increment in mm.
 */
function calculateCumulativeIncrements(
  baseIndex: number,
  targetIndex: number,
  transitions: readonly string[],
  gradingTable: GradingIncrementTable,
): Record<string, number> {
  const cumulative: Record<string, number> = {};

  if (baseIndex === targetIndex) {
    return cumulative;
  }

  const direction = targetIndex > baseIndex ? 1 : -1;
  const start = Math.min(baseIndex, targetIndex);
  const end = Math.max(baseIndex, targetIndex);

  for (let i = start; i < end; i++) {
    const transition = transitions[i];
    const controlPoints = gradingTable.increments[transition];
    if (!controlPoints) {
      continue;
    }

    for (const [cpId, increment] of Object.entries(controlPoints)) {
      if (cumulative[cpId] === undefined) {
        cumulative[cpId] = 0;
      }
      // If grading up (to larger), add increments; if grading down (to smaller), subtract
      cumulative[cpId] += increment * direction;
    }
  }

  return cumulative;
}

/**
 * Grades a single piece by applying cumulative increments.
 * For children, applies anatomical proportion adjustments.
 * For adults, scales proportionally.
 */
function gradePiece(
  piece: ScaledPiece,
  cumulativeIncrements: Record<string, number>,
  ageGroup: AgeGroup,
  baseIndex: number,
  targetIndex: number,
  totalSizes: number,
): ScaledPiece {
  // Calculate width and height scale factors from increments
  const { widthScale, heightScale } = calculateScaleFactors(
    cumulativeIncrements,
    ageGroup,
    baseIndex,
    targetIndex,
    totalSizes,
  );

  // Scale outline path
  const scaledOutline = scalePathData(piece.outline, widthScale, heightScale);

  // Scale seam allowance path
  const scaledSeamAllowance = scalePathData(piece.seamAllowance, widthScale, heightScale);

  // Reposition grain line proportionally
  const scaledGrainLine = scaleLineData(piece.grainLine, widthScale, heightScale);

  // Reposition notches proportionally (preserve count)
  const scaledNotches = piece.notches.map((notch) =>
    scaleLineData(notch, widthScale, heightScale),
  );

  // Update label with new size (replace size in label)
  const updatedLabel = updateLabelSize(piece.label, baseIndex, targetIndex, ageGroup);

  return {
    id: piece.id,
    outline: scaledOutline,
    seamAllowance: scaledSeamAllowance,
    grainLine: scaledGrainLine,
    notches: scaledNotches,
    label: updatedLabel,
  };
}

/**
 * Calculates width and height scale factors from cumulative increments.
 * For children: applies anatomical proportion adjustments.
 * For adults: maintains width-to-length relationships proportionally.
 */
function calculateScaleFactors(
  cumulativeIncrements: Record<string, number>,
  ageGroup: AgeGroup,
  _baseIndex: number,
  _targetIndex: number,
  _totalSizes: number,
): { widthScale: number; heightScale: number } {
  // Calculate average width and height increments from control points
  const widthKeys = ['chest', 'waist', 'hip', 'shoulderWidth'];
  const heightKeys = ['torsoLength', 'legLength'];

  let widthIncrement = 0;
  let widthCount = 0;
  let heightIncrement = 0;
  let heightCount = 0;

  for (const [cpId, increment] of Object.entries(cumulativeIncrements)) {
    if (widthKeys.some((k) => cpId.toLowerCase().includes(k.toLowerCase()))) {
      widthIncrement += increment;
      widthCount++;
    } else if (heightKeys.some((k) => cpId.toLowerCase().includes(k.toLowerCase()))) {
      heightIncrement += increment;
      heightCount++;
    } else {
      // Default: treat as width increment
      widthIncrement += increment;
      widthCount++;
    }
  }

  // Use average increments; if no control points found, default no scaling
  const avgWidthIncrement = widthCount > 0 ? widthIncrement / widthCount : 0;
  const avgHeightIncrement = heightCount > 0 ? heightIncrement / heightCount : 0;

  // Base reference dimension (typical adult M base ~ 500mm width, 700mm height)
  // We use a normalized approach: increment as fraction of a reference
  const refWidth = 500; // mm reference width for scaling
  const refHeight = 700; // mm reference height for scaling

  let widthScale = 1 + avgWidthIncrement / refWidth;
  let heightScale = 1 + avgHeightIncrement / refHeight;

  if (ageGroup === 'children') {
    // Apply anatomical proportion adjustments for children
    const profile = CHILDREN_PROPORTION_PROFILE;

    // Children have higher waist position — adjust vertical scaling
    // Waist position ratio means the upper body is proportionally longer
    const waistAdjustment = profile.waistPositionRatio / ADULT_PROPORTION_PROFILE.waistPositionRatio;
    heightScale *= waistAdjustment;

    // Children have shorter limbs relative to torso
    const limbAdjustment = profile.limbToTorsoRatio / ADULT_PROPORTION_PROFILE.limbToTorsoRatio;
    // Apply limb adjustment to height (shorter overall for same increments)
    heightScale *= limbAdjustment;

    // Children have narrower shoulders relative to hips
    const shoulderAdjustment =
      profile.shoulderToHipRatio / ADULT_PROPORTION_PROFILE.shoulderToHipRatio;
    widthScale *= shoulderAdjustment;
  }
  // For adults: scale proportionally — widthScale and heightScale maintain relationships

  return { widthScale, heightScale };
}

/**
 * Scales SVG path data coordinates by width and height factors.
 * Parses the path `d` attribute, scales numeric values, and reconstructs.
 */
function scalePathData(
  pathData: string,
  widthScale: number,
  heightScale: number,
): string {
  if (!pathData) return pathData;

  // Parse SVG path tokens: commands and numeric values
  const tokens = pathData.match(/[A-Za-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return pathData;

  const result: string[] = [];
  let isXCoord = true; // Alternates between x and y for coordinate commands

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (/^[A-Za-z]$/.test(token)) {
      result.push(token);
      // Reset coordinate tracking based on command type
      isXCoord = true;
    } else {
      // Numeric value — apply appropriate scale
      const value = parseFloat(token);
      const scaledValue = isXCoord ? value * widthScale : value * heightScale;
      result.push(roundTo(scaledValue, 2).toString());
      isXCoord = !isXCoord;
    }
  }

  return result.join(' ');
}

/**
 * Scales a LineData object proportionally.
 */
function scaleLineData(
  line: LineData,
  widthScale: number,
  heightScale: number,
): LineData {
  return {
    x1: roundTo(line.x1 * widthScale, 2),
    y1: roundTo(line.y1 * heightScale, 2),
    x2: roundTo(line.x2 * widthScale, 2),
    y2: roundTo(line.y2 * heightScale, 2),
  };
}

/**
 * Updates the label text by replacing the old size with the new target size.
 */
function updateLabelSize(
  label: string,
  baseIndex: number,
  targetIndex: number,
  ageGroup: AgeGroup,
): string {
  const sizeOrder = getSizeOrder(ageGroup);
  const baseSize = sizeOrder[baseIndex];
  const targetSize = sizeOrder[targetIndex];

  if (baseSize && targetSize) {
    // Replace the base size in the label with the target size
    return label.replace(baseSize, targetSize);
  }

  return label;
}

/**
 * Rounds a number to a specified number of decimal places.
 */
function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// ─── Grading Output Types ────────────────────────────────────────────────────

/**
 * Output mode for grading results.
 * - 'separate': Each size is generated as an individual SVG file.
 * - 'combined': All sizes are rendered as labeled layers within a single SVG.
 */
export type GradingOutputMode = 'separate' | 'combined';

/**
 * Result of grading output generation.
 *
 * Validates: Requirements 3.6, 3.7, 7.2
 */
export interface GradingOutputResult {
  /** Output mode used ('separate' or 'combined'). */
  mode: GradingOutputMode;
  /** SVG strings: one per size in 'separate' mode, single SVG in 'combined' mode. */
  svgs: string[];
  /** Size labels matching the SVGs array. */
  sizeLabels: string[];
  /** Total number of pieces across all sizes. */
  totalPieces: number;
  /** Total processing time in milliseconds. */
  processingTimeMs: number;
}

// ─── Grading Output Constants ────────────────────────────────────────────────

/**
 * Maximum processing time threshold in ms (28s, leaving 2s margin for Lambda's 30s limit).
 */
const GRADING_TIMEOUT_MS = 28_000;

// ─── Grading Output Function ─────────────────────────────────────────────────

/**
 * Generates SVG output from graded patterns, supporting separate or combined modes.
 *
 * - 'separate' mode: Calls generateSvg for each ScaledPattern, returning an array of individual SVGs.
 * - 'combined' mode: Generates a single SVG with all sizes as labeled `<g>` layers
 *   (each layer tagged with a `data-size` attribute).
 *
 * Enforces a 28-second time limit (leaving 2s margin for the Lambda 30s timeout).
 * On timeout, throws an error and produces no partial output.
 *
 * @param gradedPatterns - Array of ScaledPattern objects (one per target size)
 * @param outputMode - 'separate' for individual SVGs, 'combined' for a single layered SVG
 * @returns GradingOutputResult with SVGs, labels, piece count, and processing time
 * @throws Error if processing exceeds 28 seconds (message: "Grading exceeded 30-second time limit")
 *
 * Validates: Requirements 3.6, 3.7, 7.2
 */
export function generateGradingOutput(
  gradedPatterns: ScaledPattern[],
  outputMode: GradingOutputMode,
): GradingOutputResult {
  const startTime = Date.now();

  /**
   * Checks elapsed time and throws if the timeout threshold is exceeded.
   * Ensures no partial output is produced on failure.
   */
  function checkTimeout(): void {
    if (Date.now() - startTime >= GRADING_TIMEOUT_MS) {
      throw new Error('Grading exceeded 30-second time limit');
    }
  }

  if (outputMode === 'separate') {
    return generateSeparateOutput(gradedPatterns, startTime, checkTimeout);
  }

  return generateCombinedOutput(gradedPatterns, startTime, checkTimeout);
}

/**
 * Generates each graded size as a separate SVG file.
 */
function generateSeparateOutput(
  gradedPatterns: ScaledPattern[],
  startTime: number,
  checkTimeout: () => void,
): GradingOutputResult {
  const svgs: string[] = [];
  const sizeLabels: string[] = [];
  let totalPieces = 0;

  for (const pattern of gradedPatterns) {
    checkTimeout();

    const result = generateSvg(pattern);

    if (!result.isValid) {
      throw new Error(
        `SVG generation failed for size "${pattern.size}": invalid SVG produced`,
      );
    }

    svgs.push(result.svg);
    sizeLabels.push(pattern.size);
    totalPieces += result.pieceCount;
  }

  return {
    mode: 'separate',
    svgs,
    sizeLabels,
    totalPieces,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Generates a single SVG with all sizes as labeled layers.
 * Each size is wrapped in a `<g>` element with a `data-size` attribute.
 */
function generateCombinedOutput(
  gradedPatterns: ScaledPattern[],
  startTime: number,
  checkTimeout: () => void,
): GradingOutputResult {
  const sizeLabels: string[] = [];
  let totalPieces = 0;
  const layerSvgs: string[] = [];

  for (const pattern of gradedPatterns) {
    checkTimeout();

    const result = generateSvg(pattern);

    if (!result.isValid) {
      throw new Error(
        `SVG generation failed for size "${pattern.size}": invalid SVG produced`,
      );
    }

    // Extract the inner content from the generated SVG (everything between <svg ...> and </svg>)
    const innerContent = extractSvgInnerContent(result.svg);
    layerSvgs.push(
      `  <g data-size="${pattern.size}" id="size-${pattern.size}">\n    ${innerContent}\n  </g>`,
    );

    sizeLabels.push(pattern.size);
    totalPieces += result.pieceCount;
  }

  checkTimeout();

  // Build a combined SVG document wrapping all size layers
  const combinedSvg = buildCombinedSvg(layerSvgs, gradedPatterns);

  return {
    mode: 'combined',
    svgs: [combinedSvg],
    sizeLabels,
    totalPieces,
    processingTimeMs: Date.now() - startTime,
  };
}

/**
 * Extracts the inner content of an SVG document (between the root <svg> tags).
 * Returns the content without the outer <svg ...> and </svg> wrapper.
 */
function extractSvgInnerContent(svg: string): string {
  // Match from end of opening <svg ...> tag to beginning of closing </svg> tag
  const openTagEnd = svg.indexOf('>');
  const closeTagStart = svg.lastIndexOf('</svg>');

  if (openTagEnd === -1 || closeTagStart === -1) {
    return svg;
  }

  return svg.slice(openTagEnd + 1, closeTagStart).trim();
}

/**
 * Builds a combined SVG document wrapping multiple size layers.
 * Uses mm units and a viewBox large enough to contain all layers.
 */
function buildCombinedSvg(layers: string[], patterns: ScaledPattern[]): string {
  // Use a generous viewBox that accommodates all sizes
  // Each size will be a layer at the same position (overlaid)
  const viewBoxWidth = 2000;
  const viewBoxHeight = 2000;

  const layerContent = layers.join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" width="${viewBoxWidth}mm" height="${viewBoxHeight}mm" data-units="mm" data-output-mode="combined" data-size-count="${patterns.length}">
${layerContent}
</svg>`;
}
