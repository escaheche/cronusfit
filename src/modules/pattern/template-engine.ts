/**
 * Parametric Template Engine for CronusFit pattern generation.
 *
 * Provides:
 * 1. loadTemplate(garmentType, ageGroup) — Loads JSON template definitions from
 *    the local `templates/parametric/{ageGroup}/` directory.
 * 2. applyMeasurements(template, measurements) — Scales control points based on
 *    provided measurements and the template's ProportionProfile, producing a ScaledPattern.
 * 3. generatePattern(template, measurements, options) — Full SVG generation (legacy API).
 *
 * SVG output uses millimeters as coordinate units for real-scale production output.
 * Each pattern piece is a grouped <g> element with a unique ID.
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgeGroup, GarmentType, MeasurementKey } from '../../types/garment.js';
import type {
  ParametricTemplate,
  PieceTemplate,
  ControlPoint,
  ScaledPattern,
  ScaledPiece,
  ProportionProfile,
  PathData,
  LineData,
  PieceDefinition,
  NotchPosition,
} from '../../types/pattern.js';
import { validateMeasurements } from '../../validation/measurements.js';

// --- Public Interfaces ---

/** Options for pattern generation. */
export interface PatternOptions {
  /** Seam allowance in centimeters (0.5–3.0, default 1.5). */
  seamAllowanceCm?: number;
  /** Size label to display on pieces. */
  size?: string;
}

/** Result of SVG path generation for a single piece. */
export interface PiecePathResult {
  /** The piece definition used. */
  piece: PieceDefinition;
  /** SVG path data string (d attribute). */
  pathData: string;
  /** Bounding box of the piece path in mm. */
  bounds: { x: number; y: number; width: number; height: number };
  /** Interpolated control points used for this piece. */
  resolvedPoints: Array<{ x: number; y: number }>;
}

// --- Constants ---

/** Default seam allowance in cm. */
const DEFAULT_SEAM_ALLOWANCE_CM = 1.5;
/** Minimum seam allowance in cm. */
const MIN_SEAM_ALLOWANCE_CM = 0.5;
/** Maximum seam allowance in cm. */
const MAX_SEAM_ALLOWANCE_CM = 3.0;
/** Default seam allowance in mm (15mm = 1.5cm). */
const DEFAULT_SEAM_ALLOWANCE_MM = 15;

/**
 * Resolve path to the project root templates directory.
 * Uses TEMPLATES_PATH env var if available (for Lambda deployment),
 * otherwise resolves relative to source using import.meta.url.
 */
function getTemplatesBasePath(): string {
  if (process.env.TEMPLATES_PATH) {
    return process.env.TEMPLATES_PATH;
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, '..', '..', '..', 'templates', 'parametric');
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEW API: loadTemplate (filesystem) + applyMeasurements
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Load a parametric template from the local filesystem.
 *
 * Reads JSON template definitions from `templates/parametric/{ageGroup}/{garmentType}.json`.
 * Handles the legacy 'tank_top' filename for the 'tank-top' garment type.
 *
 * @param garmentType - The garment type to load (e.g. 'camiseta', 'short', 'tank-top')
 * @param ageGroup - The age group ('children' or 'adult')
 * @returns The parsed ParametricTemplate
 * @throws Error if the template file cannot be found or parsed
 */
export function loadTemplate(
  garmentType: GarmentType,
  ageGroup: AgeGroup,
): ParametricTemplate {
  const basePath = getTemplatesBasePath();

  // Normalize garment type for filename: 'tank-top' -> 'tank_top' (file convention)
  const filename = garmentType === 'tank-top' ? 'tank_top' : garmentType;
  const filePath = resolve(basePath, ageGroup, `${filename}.json`);

  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        `Template not found: ${ageGroup}/${garmentType}. Expected at: ${filePath}`,
      );
    }
    throw new Error(
      `Failed to read template file for ${ageGroup}/${garmentType}: ${(err as Error).message}`,
    );
  }

  let template: ParametricTemplate;
  try {
    template = JSON.parse(fileContent) as ParametricTemplate;
  } catch {
    throw new Error(
      `Failed to parse template JSON for ${ageGroup}/${garmentType}`,
    );
  }

  validateTemplate(template);
  return template;
}

/**
 * Apply body measurements to a parametric template, producing a ScaledPattern.
 *
 * For each piece in the template (supports both new PieceTemplate[] format and
 * legacy pieceDefinitions format):
 *   - Scales control point x/y using the referenced measurement and scaleFactor
 *   - Applies ProportionProfile adjustments (children use different body proportions)
 *   - Generates outline PathData from scaled control points
 *   - Generates seamAllowance PathData offset by seamAllowanceMm
 *   - Generates grainLine LineData at the configured angle
 *   - Generates notches at notchPositions along the outline
 *   - Generates label with piece id and size info
 *
 * @param template - The parametric template to apply measurements to
 * @param measurements - Record of MeasurementKey → value in mm (e.g. { chest: 1000 })
 * @returns A fully scaled pattern ready for SVG generation
 */
export function applyMeasurements(
  template: ParametricTemplate,
  measurements: Record<string, number>,
): ScaledPattern {
  const { proportionProfile, ageGroup, garmentType } = template;
  const sizeLabel = `${garmentType}-${ageGroup}`;

  // Use pieces (new format) or construct from legacy format
  const pieceTemplates = template.pieces ?? buildPieceTemplatesFromLegacy(template);

  const scaledPieces: ScaledPiece[] = pieceTemplates.map((piece) =>
    scalePieceFromTemplate(piece, measurements, proportionProfile),
  );

  return {
    garmentType,
    ageGroup,
    size: sizeLabel as any,
    pieces: scaledPieces,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEGACY API: generatePattern (full SVG generation)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generate an SVG pattern from a parametric template and measurements.
 *
 * @param template - The parametric template to use
 * @param measurements - Record of control point ID → measurement value in mm
 * @param options - Pattern generation options (seam allowance, size label)
 * @returns SVG string with all pattern pieces
 * @throws Error if measurements are invalid or seam allowance is out of range
 */
export async function generatePattern(
  template: ParametricTemplate,
  measurements: Record<string, number>,
  options: PatternOptions = {},
): Promise<string> {
  // Validate measurements
  const validationResult = validateMeasurements(measurements);
  if (!validationResult.valid) {
    const errorDetails = validationResult.errors
      .map((e) => `${e.field}: ${e.message.en}`)
      .join('; ');
    throw new Error(`Invalid measurements: ${errorDetails}`);
  }

  // Validate seam allowance
  const seamAllowanceCm = options.seamAllowanceCm ?? DEFAULT_SEAM_ALLOWANCE_CM;
  if (seamAllowanceCm < MIN_SEAM_ALLOWANCE_CM || seamAllowanceCm > MAX_SEAM_ALLOWANCE_CM) {
    throw new Error(
      `Seam allowance must be between ${MIN_SEAM_ALLOWANCE_CM}cm and ${MAX_SEAM_ALLOWANCE_CM}cm, got ${seamAllowanceCm}cm`,
    );
  }

  const seamAllowanceMm = seamAllowanceCm * 10;
  const sizeLabel = options.size ?? '';

  // Interpolate control points with provided measurements
  const resolvedControlPoints = interpolateControlPoints(
    template.controlPoints,
    measurements,
  );

  // Generate paths for each piece
  const piecePaths = template.pieceDefinitions.map((piece) =>
    generatePiecePath(piece, resolvedControlPoints, template.controlPoints),
  );

  // Calculate total SVG dimensions
  const layout = calculateLayout(piecePaths, seamAllowanceMm);

  // Build SVG string
  return buildSvg(piecePaths, layout, seamAllowanceMm, sizeLabel, template.id);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Exported Helpers (used by tests and other modules)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Interpolate control points by applying measurement values.
 * Each control point's position is scaled based on the provided measurement
 * relative to its default range.
 */
export function interpolateControlPoints(
  controlPoints: ControlPoint[],
  measurements: Record<string, number>,
): Map<string, { x: number; y: number }> {
  const resolved = new Map<string, { x: number; y: number }>();

  for (const cp of controlPoints) {
    const measurement = measurements[cp.id];
    if (measurement === undefined) {
      const defaultValue = (cp.minValue + cp.maxValue) / 2;
      const ratio = defaultValue / cp.maxValue;
      resolved.set(cp.id, { x: cp.x * ratio, y: cp.y * ratio });
    } else {
      const range = cp.maxValue - cp.minValue;
      const ratio = range > 0 ? (measurement - cp.minValue) / range : 1;
      const scaledX = cp.x * (0.5 + ratio * 0.5);
      const scaledY = cp.y * (0.5 + ratio * 0.5);
      resolved.set(cp.id, { x: scaledX, y: scaledY });
    }
  }

  return resolved;
}

/**
 * Generate an SVG path for a single piece definition.
 */
export function generatePiecePath(
  piece: PieceDefinition,
  resolvedPoints: Map<string, { x: number; y: number }>,
  controlPoints: ControlPoint[],
): PiecePathResult {
  const affectingPoints = controlPoints.filter((cp) =>
    cp.affectedPieces.includes(piece.id),
  );

  const points: Array<{ x: number; y: number }> = affectingPoints.map((cp) => {
    const resolved = resolvedPoints.get(cp.id);
    return resolved ?? { x: cp.x, y: cp.y };
  });

  if (points.length < 3) {
    const width = points.length > 0 ? Math.abs(points[0].x) * 2 || 200 : 200;
    const height = points.length > 1 ? Math.abs(points[1].y) * 2 || 300 : 300;
    const pathData = `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`;
    return {
      piece,
      pathData,
      bounds: { x: 0, y: 0, width, height },
      resolvedPoints: points,
    };
  }

  const pathData = generateSmoothPath(points);
  const bounds = calculateBounds(points);

  return {
    piece,
    pathData,
    bounds,
    resolvedPoints: points,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// applyMeasurements Internal Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Scale a single PieceTemplate using measurements and proportion profile.
 */
function scalePieceFromTemplate(
  piece: PieceTemplate,
  measurements: Record<string, number>,
  proportionProfile: ProportionProfile,
): ScaledPiece {
  const scaledPoints = scaleControlPoints(piece.controlPoints, measurements, proportionProfile);

  const outline = generateOutlinePath(scaledPoints);
  const seamAllowanceMm = piece.seamAllowanceMm ?? DEFAULT_SEAM_ALLOWANCE_MM;
  const seamAllowance = generateOffsetPath(scaledPoints, seamAllowanceMm);
  const bounds = calculateBounds(scaledPoints);
  const grainLine = computeGrainLine(bounds, piece.grainLineAngle);
  const notches = computeNotches(scaledPoints, piece.notchPositions);
  const label = piece.id;

  return { id: piece.id, outline, seamAllowance, grainLine, notches, label };
}

/**
 * Scale control points using the referenced measurement and scaleFactor,
 * applying ProportionProfile adjustments for the age group.
 */
function scaleControlPoints(
  controlPoints: ControlPoint[],
  measurements: Record<string, number>,
  proportionProfile: ProportionProfile,
): Array<{ x: number; y: number }> {
  return controlPoints.map((cp) => {
    let baseX = cp.x;
    let baseY = cp.y;

    if (cp.measurementRef && cp.scaleFactor !== undefined) {
      const measurementValue = measurements[cp.measurementRef];
      if (measurementValue !== undefined) {
        baseX = cp.x * measurementValue * cp.scaleFactor;
        baseY = cp.y * measurementValue * cp.scaleFactor;
      }
    } else {
      const midValue = (cp.minValue + cp.maxValue) / 2;
      const matchedMeasurement = findMatchingMeasurement(cp.id, measurements);
      if (matchedMeasurement !== undefined) {
        baseX = cp.x * matchedMeasurement;
        baseY = cp.y * matchedMeasurement;
      } else {
        baseX = cp.x * midValue;
        baseY = cp.y * midValue;
      }
    }

    // Apply ProportionProfile adjustments
    baseX = applyProportionX(baseX, cp, proportionProfile);
    baseY = applyProportionY(baseY, cp, proportionProfile);

    return { x: baseX, y: baseY };
  });
}

/**
 * Apply horizontal proportion adjustment based on ProportionProfile.
 */
function applyProportionX(x: number, cp: ControlPoint, profile: ProportionProfile): number {
  const isShoulderRelated =
    cp.id.includes('shoulder') || (cp.name?.toLowerCase().includes('hombro') ?? false);
  if (isShoulderRelated) return x * profile.shoulderToHipRatio;
  return x;
}

/**
 * Apply vertical proportion adjustment based on ProportionProfile.
 */
function applyProportionY(y: number, cp: ControlPoint, profile: ProportionProfile): number {
  const isWaistRelated =
    cp.id.includes('waist') || (cp.name?.toLowerCase().includes('cintura') ?? false);
  if (isWaistRelated) return y * (profile.waistPositionRatio / 0.45);

  const isLimbRelated =
    cp.id.includes('sleeve') ||
    cp.id.includes('leg') ||
    (cp.name?.toLowerCase().includes('manga') ?? false) ||
    (cp.name?.toLowerCase().includes('pierna') ?? false);
  if (isLimbRelated) return y * profile.limbToTorsoRatio;

  return y;
}

/**
 * Find a matching measurement for a legacy control point ID.
 */
function findMatchingMeasurement(
  controlPointId: string,
  measurements: Record<string, number>,
): number | undefined {
  if (measurements[controlPointId] !== undefined) {
    return measurements[controlPointId];
  }

  const stripped = controlPointId.replace(/^cp-/, '');
  const mappings: Record<string, MeasurementKey> = {
    'chest': 'chest',
    'waist': 'waist',
    'hip': 'hip',
    'shoulder-width': 'shoulderWidth',
    'body-length': 'torsoLength',
    'sleeve-length': 'legLength',
    'armhole-depth': 'chest',
    'neck-width': 'shoulderWidth',
    'leg-length': 'legLength',
    'torso-length': 'torsoLength',
  };

  const mappedKey = mappings[stripped];
  if (mappedKey && measurements[mappedKey] !== undefined) {
    return measurements[mappedKey];
  }

  return undefined;
}

/**
 * Build PieceTemplate[] from legacy pieceDefinitions + controlPoints.
 */
function buildPieceTemplatesFromLegacy(template: ParametricTemplate): PieceTemplate[] {
  return template.pieceDefinitions.map((pd: PieceDefinition) => {
    const affectingControlPoints = template.controlPoints.filter((cp) =>
      cp.affectedPieces.includes(pd.id),
    );
    return {
      id: pd.id,
      controlPoints: affectingControlPoints,
      seamAllowanceMm: DEFAULT_SEAM_ALLOWANCE_MM,
      grainLineAngle: pd.grainLineAngle,
      notchPositions: pd.notchPositions.map((np: NotchPosition) => np.position),
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Path Generation Helpers (shared between legacy and new API)
// ═══════════════════════════════════════════════════════════════════════════════

/** Generate a smooth closed SVG path using cubic Bezier curves. */
function generateSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} Z`;
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y} Z`;
  }

  const parts: string[] = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const nextNext = points[(i + 2) % points.length];

    const cp1x = current.x + (next.x - current.x) / 3;
    const cp1y = current.y + (next.y - current.y) / 3;
    const cp2x = next.x - (nextNext.x - current.x) / 6;
    const cp2y = next.y - (nextNext.y - current.y) / 6;

    parts.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`,
    );
  }

  parts.push('Z');
  return parts.join(' ');
}

/** Generate outline path for applyMeasurements using fixed-precision output. */
function generateOutlinePath(points: Array<{ x: number; y: number }>): PathData {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)} Z`;
  if (points.length === 2) {
    return `M ${fmt(points[0].x)} ${fmt(points[0].y)} L ${fmt(points[1].x)} ${fmt(points[1].y)} Z`;
  }

  const parts: string[] = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const nextNext = points[(i + 2) % points.length];

    const cp1x = current.x + (next.x - current.x) / 3;
    const cp1y = current.y + (next.y - current.y) / 3;
    const cp2x = next.x - (nextNext.x - current.x) / 6;
    const cp2y = next.y - (nextNext.y - current.y) / 6;

    parts.push(
      `C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(next.x)} ${fmt(next.y)}`,
    );
  }

  parts.push('Z');
  return parts.join(' ');
}

/** Generate a seam allowance path by offsetting each point outward from centroid. */
function generateOffsetPath(
  points: Array<{ x: number; y: number }>,
  offsetMm: number,
): PathData {
  if (points.length < 2) return '';
  const centroid = computeCentroid(points);
  const offsetPoints = points.map((p) => {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return { x: p.x, y: p.y };
    const scale = (dist + offsetMm) / dist;
    return { x: centroid.x + dx * scale, y: centroid.y + dy * scale };
  });
  return generateOutlinePath(offsetPoints);
}

/** Compute grain line for applyMeasurements. */
function computeGrainLine(
  bounds: { x: number; y: number; width: number; height: number },
  angleDegrees: number,
): LineData {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const length = Math.min(bounds.width, bounds.height) * 0.6;
  const angleRad = (angleDegrees * Math.PI) / 180;
  return {
    x1: cx - (length / 2) * Math.cos(angleRad),
    y1: cy - (length / 2) * Math.sin(angleRad),
    x2: cx + (length / 2) * Math.cos(angleRad),
    y2: cy + (length / 2) * Math.sin(angleRad),
  };
}

/** Generate notch marks for applyMeasurements. */
function computeNotches(
  points: Array<{ x: number; y: number }>,
  notchPositions: number[],
): LineData[] {
  if (points.length < 2 || notchPositions.length === 0) return [];
  const notches: LineData[] = [];
  const totalSegments = points.length;

  for (const position of notchPositions) {
    const clampedPos = Math.max(0, Math.min(position, 0.999));
    const segmentIndex = Math.floor(clampedPos * totalSegments);
    const t = clampedPos * totalSegments - segmentIndex;

    const p1 = points[segmentIndex % totalSegments];
    const p2 = points[(segmentIndex + 1) % totalSegments];

    const nx = p1.x + (p2.x - p1.x) * t;
    const ny = p1.y + (p2.y - p1.y) * t;

    const edgeDx = p2.x - p1.x;
    const edgeDy = p2.y - p1.y;
    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
    if (edgeLen === 0) continue;

    const normalX = -edgeDy / edgeLen;
    const normalY = edgeDx / edgeLen;
    const notchSize = 3;

    notches.push({
      x1: nx,
      y1: ny,
      x2: nx + normalX * notchSize,
      y2: ny + normalY * notchSize,
    });
  }

  return notches;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Legacy SVG Generation Helpers (for generatePattern)
// ═══════════════════════════════════════════════════════════════════════════════

/** Calculate bounding box of a set of points. */
function calculateBounds(
  points: Array<{ x: number; y: number }>,
): { x: number; y: number; width: number; height: number } {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Compute centroid of a set of points. */
function computeCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  let sumX = 0, sumY = 0;
  for (const p of points) { sumX += p.x; sumY += p.y; }
  return { x: sumX / points.length, y: sumY / points.length };
}

/** Format a number to 2 decimal places. */
function fmt(value: number): string {
  return value.toFixed(2);
}

/** Calculate layout for placing all pieces in the SVG canvas. */
function calculateLayout(
  piecePaths: PiecePathResult[],
  seamAllowanceMm: number,
): { totalWidth: number; totalHeight: number; offsets: Array<{ x: number; y: number }> } {
  const padding = seamAllowanceMm * 2 + 20;
  let currentX = padding;
  let maxHeight = 0;
  const offsets: Array<{ x: number; y: number }> = [];

  for (const pp of piecePaths) {
    offsets.push({ x: currentX - pp.bounds.x, y: padding - pp.bounds.y });
    currentX += pp.bounds.width + padding;
    if (pp.bounds.height > maxHeight) maxHeight = pp.bounds.height;
  }

  return { totalWidth: currentX, totalHeight: maxHeight + padding * 2, offsets };
}

/** Build the complete SVG string from pieces and layout. */
function buildSvg(
  piecePaths: PiecePathResult[],
  layout: { totalWidth: number; totalHeight: number; offsets: Array<{ x: number; y: number }> },
  seamAllowanceMm: number,
  sizeLabel: string,
  templateId: string,
): string {
  const { totalWidth, totalHeight, offsets } = layout;
  const groups: string[] = [];

  for (let i = 0; i < piecePaths.length; i++) {
    groups.push(buildPieceGroup(piecePaths[i], offsets[i], seamAllowanceMm, sizeLabel));
  }

  const svgContent = groups.join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${totalWidth.toFixed(2)} ${totalHeight.toFixed(2)}"
     width="${totalWidth.toFixed(2)}mm"
     height="${totalHeight.toFixed(2)}mm"
     data-template-id="${escapeXml(templateId)}"
     data-units="mm">
  <defs>
    <style>
      .pattern-piece { fill: none; stroke: #000; stroke-width: 0.5; }
      .seam-allowance { fill: none; stroke: #666; stroke-width: 0.3; stroke-dasharray: 2,1; }
      .grain-line { stroke: #333; stroke-width: 0.4; stroke-dasharray: 4,2; }
      .grain-arrow { fill: #333; stroke: none; }
      .notch { fill: #000; stroke: none; }
      .label { font-family: Arial, sans-serif; font-size: 8px; fill: #000; }
      .label-size { font-family: Arial, sans-serif; font-size: 6px; fill: #333; }
    </style>
  </defs>
    ${svgContent}
</svg>`;
}

/** Build the SVG group for a single pattern piece (legacy). */
function buildPieceGroup(
  pp: PiecePathResult,
  offset: { x: number; y: number },
  seamAllowanceMm: number,
  sizeLabel: string,
): string {
  const elements: string[] = [];
  const pieceId = `piece-${pp.piece.id}`;

  // Piece outline path
  elements.push(`    <path class="pattern-piece" d="${pp.pathData}" />`);

  // Seam allowance (offset path)
  const seamPath = generateLegacySeamAllowancePath(pp, seamAllowanceMm);
  elements.push(`    <path class="seam-allowance" d="${seamPath}" />`);

  // Grain line
  const grainLine = generateLegacyGrainLine(pp.bounds, pp.piece.grainLineAngle);
  elements.push(grainLine);

  // Notches
  for (const notch of pp.piece.notchPositions) {
    const notchSvg = generateLegacyNotch(pp, notch);
    elements.push(notchSvg);
  }

  // Labels
  const labelY = pp.bounds.y + pp.bounds.height / 2;
  const labelX = pp.bounds.x + pp.bounds.width / 2;
  elements.push(
    `    <text class="label" x="${labelX.toFixed(2)}" y="${(labelY - 5).toFixed(2)}" text-anchor="middle">${escapeXml(pp.piece.name)}</text>`,
  );
  if (sizeLabel) {
    elements.push(
      `    <text class="label-size" x="${labelX.toFixed(2)}" y="${(labelY + 5).toFixed(2)}" text-anchor="middle">Size: ${escapeXml(sizeLabel)}</text>`,
    );
  }
  elements.push(
    `    <text class="label-size" x="${labelX.toFixed(2)}" y="${(labelY + 13).toFixed(2)}" text-anchor="middle">Cut: ${pp.piece.cutQuantity}x</text>`,
  );

  const content = elements.join('\n');
  return `<g id="${escapeXml(pieceId)}" transform="translate(${offset.x.toFixed(2)}, ${offset.y.toFixed(2)})" data-piece-name="${escapeXml(pp.piece.name)}" data-cut-qty="${pp.piece.cutQuantity}">
${content}
  </g>`;
}

/** Generate seam allowance path for legacy SVG generation. */
function generateLegacySeamAllowancePath(pp: PiecePathResult, seamAllowanceMm: number): string {
  const points = pp.resolvedPoints;

  if (points.length < 3) {
    const b = pp.bounds;
    const s = seamAllowanceMm;
    return `M ${(b.x - s).toFixed(2)} ${(b.y - s).toFixed(2)} L ${(b.x + b.width + s).toFixed(2)} ${(b.y - s).toFixed(2)} L ${(b.x + b.width + s).toFixed(2)} ${(b.y + b.height + s).toFixed(2)} L ${(b.x - s).toFixed(2)} ${(b.y + b.height + s).toFixed(2)} Z`;
  }

  const centroid = computeCentroid(points);
  const offsetPoints = points.map((p) => {
    const dx = p.x - centroid.x;
    const dy = p.y - centroid.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return { x: p.x, y: p.y };
    const scale = (dist + seamAllowanceMm) / dist;
    return { x: centroid.x + dx * scale, y: centroid.y + dy * scale };
  });

  return generateSmoothPath(offsetPoints);
}

/** Generate grain line SVG for legacy output. */
function generateLegacyGrainLine(
  bounds: { x: number; y: number; width: number; height: number },
  angleDegrees: number,
): string {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const length = Math.min(bounds.width, bounds.height) * 0.6;
  const angleRad = (angleDegrees * Math.PI) / 180;

  const x1 = cx - (length / 2) * Math.cos(angleRad);
  const y1 = cy - (length / 2) * Math.sin(angleRad);
  const x2 = cx + (length / 2) * Math.cos(angleRad);
  const y2 = cy + (length / 2) * Math.sin(angleRad);

  const arrowSize = 3;
  const arrowAngle1 = angleRad + Math.PI * 0.85;
  const arrowAngle2 = angleRad - Math.PI * 0.85;
  const ax1 = x2 + arrowSize * Math.cos(arrowAngle1);
  const ay1 = y2 + arrowSize * Math.sin(arrowAngle1);
  const ax2 = x2 + arrowSize * Math.cos(arrowAngle2);
  const ay2 = y2 + arrowSize * Math.sin(arrowAngle2);

  return `    <line class="grain-line" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" />
    <polygon class="grain-arrow" points="${x2.toFixed(2)},${y2.toFixed(2)} ${ax1.toFixed(2)},${ay1.toFixed(2)} ${ax2.toFixed(2)},${ay2.toFixed(2)}" />`;
}

/** Generate notch SVG element for legacy output. */
function generateLegacyNotch(pp: PiecePathResult, notch: NotchPosition): string {
  const points = pp.resolvedPoints;
  if (points.length < 2) {
    return `    <!-- notch ${notch.edgeId} skipped: insufficient points -->`;
  }

  const totalPoints = points.length;
  const index = Math.floor(notch.position * totalPoints);
  const nextIndex = (index + 1) % totalPoints;
  const t = notch.position * totalPoints - index;

  const p1 = points[index % totalPoints];
  const p2 = points[nextIndex];

  const nx = p1.x + (p2.x - p1.x) * t;
  const ny = p1.y + (p2.y - p1.y) * t;

  const edgeDx = p2.x - p1.x;
  const edgeDy = p2.y - p1.y;
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
  const normalX = edgeLen > 0 ? -edgeDy / edgeLen : 0;
  const normalY = edgeLen > 0 ? edgeDx / edgeLen : 1;

  const notchSize = 3;
  const tipX = nx + normalX * notchSize;
  const tipY = ny + normalY * notchSize;
  const base1X = nx + (edgeDx / edgeLen) * 1.5;
  const base1Y = ny + (edgeDy / edgeLen) * 1.5;
  const base2X = nx - (edgeDx / edgeLen) * 1.5;
  const base2Y = ny - (edgeDy / edgeLen) * 1.5;

  return `    <polygon class="notch" points="${tipX.toFixed(2)},${tipY.toFixed(2)} ${base1X.toFixed(2)},${base1Y.toFixed(2)} ${base2X.toFixed(2)},${base2Y.toFixed(2)}" data-edge="${escapeXml(notch.edgeId)}" data-matches="${escapeXml(notch.matchingPieceEdgeId)}" />`;
}

/** Escape XML special characters. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Validate a parsed template has required fields. */
function validateTemplate(template: ParametricTemplate): void {
  if (!template.id) throw new Error('Template missing required field: id');
  if (!template.garmentType) throw new Error('Template missing required field: garmentType');
  if (!template.ageGroup) throw new Error('Template missing required field: ageGroup');
  if (!template.proportionProfile) throw new Error('Template missing required field: proportionProfile');

  const hasPieces = Array.isArray(template.pieces) && template.pieces.length > 0;
  const hasLegacy =
    Array.isArray(template.controlPoints) &&
    template.controlPoints.length > 0 &&
    Array.isArray(template.pieceDefinitions) &&
    template.pieceDefinitions.length > 0;

  if (!hasPieces && !hasLegacy) {
    throw new Error(
      'Template must have either pieces[] (new format) or controlPoints[] + pieceDefinitions[] (legacy format)',
    );
  }
}
