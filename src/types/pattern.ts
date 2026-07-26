/**
 * Pattern generation and grading type definitions for CronusFit.
 * All measurements are internally in millimeters unless noted otherwise.
 */

import type { AgeGroup, GarmentType, MeasurementKey, Size } from './garment.js';

// ─── Core Types ──────────────────────────────────────────────────────────────

/**
 * A configurable parametric pattern template with age-group-aware
 * control points and piece definitions.
 *
 * Supports both the new piece-based format (pieces: PieceTemplate[])
 * and the legacy format (controlPoints + pieceDefinitions).
 */
export interface ParametricTemplate {
  /** Unique template identifier. */
  id: string;
  /** Garment type this template supports. */
  garmentType: GarmentType;
  /** Target age group — determines anatomical proportions used. */
  ageGroup: AgeGroup;
  /** Age-group-specific body proportion profile. */
  proportionProfile: ProportionProfile;

  /** Pattern pieces (new format with embedded control points per piece). */
  pieces?: PieceTemplate[];

  /** Adjustable control points for generating size variations. */
  controlPoints: ControlPoint[];
  /** Definitions of individual pattern pieces (legacy format). */
  pieceDefinitions: PieceDefinition[];
  /** Default measurements (controlPointId → mm value). */
  defaultMeasurements: Record<string, number>;
  /** Validation constraints for measurements. */
  constraints: MeasurementConstraint[];
}

/**
 * Definition of a single pattern piece within a parametric template (new format).
 * Each piece contains its own control points for scaling.
 */
export interface PieceTemplate {
  /** Unique piece identifier (e.g. "panel-frontal", "manga-izquierda"). */
  id: string;
  /** Adjustable control points that scale with body measurements. */
  controlPoints: ControlPoint[];
  /** Seam allowance in millimeters (default: 15mm). */
  seamAllowanceMm: number;
  /** Grain line angle in degrees. */
  grainLineAngle: number;
  /** Relative positions of alignment notches along piece edges (0–1). */
  notchPositions: number[];
}

/**
 * A parametric control point within a template or piece.
 * Its position is adjusted based on a body measurement reference.
 * Values are in millimeters with defined min/max range (10mm–2000mm).
 */
export interface ControlPoint {
  /** Unique control point identifier. */
  id: string;
  /** Human-readable name for this control point. */
  name: string;
  /** X position in mm. */
  x: number;
  /** Y position in mm. */
  y: number;
  /** Minimum allowed value in mm (≥ 10). */
  minValue: number;
  /** Maximum allowed value in mm (≤ 2000). */
  maxValue: number;
  /** IDs of pattern pieces affected by this control point. */
  affectedPieces: string[];
  /** Body measurement that drives this control point. */
  measurementRef?: MeasurementKey;
  /** Scale factor applied relative to the referenced measurement. */
  scaleFactor?: number;
  /** Minimum allowed value in mm — alias for minValue in new format. */
  min?: number;
  /** Maximum allowed value in mm — alias for maxValue in new format. */
  max?: number;
}

/**
 * Age-group-specific body proportion profile.
 * Used by the grading engine to apply anatomically correct scaling.
 */
export interface ProportionProfile {
  /** Target age group for these proportions. */
  ageGroup: AgeGroup;
  /** Head-to-body ratio (children ~1:5, adults ~1:7.5). */
  headToBodyRatio: number;
  /** Limb-to-torso length ratio (children have shorter limbs relative to torso). */
  limbToTorsoRatio: number;
  /** Waist position as ratio of total length (children have higher waist). */
  waistPositionRatio: number;
  /** Shoulder-to-hip width ratio (children have narrower shoulders relative to hips). */
  shoulderToHipRatio: number;
}

/**
 * A fully scaled pattern ready for SVG generation.
 */
export interface ScaledPattern {
  /** Garment type of this pattern. */
  garmentType: GarmentType;
  /** Age group for this pattern. */
  ageGroup: AgeGroup;
  /** Size this pattern was scaled to. */
  size: Size;
  /** Scaled pieces composing this pattern. */
  pieces: ScaledPiece[];
}

/**
 * A scaled pattern piece with resolved geometry data.
 */
export interface ScaledPiece {
  /** Unique piece identifier. */
  id: string;
  /** SVG path data for the cut outline. */
  outline: PathData;
  /** SVG path data for the seam allowance line. */
  seamAllowance: PathData;
  /** Grain line indicator. */
  grainLine: LineData;
  /** Alignment notch marks. */
  notches: LineData[];
  /** Label text (piece name, size, cut quantity). */
  label: string;
}

/**
 * Metadata registered for a generated pattern in the Pattern_Registry.
 */
export interface PatternMetadata {
  /** Unique pattern identifier (UUID). */
  id: string;
  /** Garment type of the generated pattern. */
  garmentType: GarmentType;
  /** Size the pattern was generated for. */
  size: Size;
  /** Creation timestamp in ISO 8601 UTC format. */
  createdAt: string;
  /** Method used to generate this pattern. */
  generationMethod: 'parameters' | 'image';
  /** S3 object key for the stored SVG file. */
  s3Key: string;
  /** Number of pieces in this pattern. */
  pieceCount: number;
  /** Age group of the pattern. */
  ageGroup: AgeGroup;
  /** Seam allowance applied in mm. */
  seamAllowance: number;
  /** ID of the admin who generated this pattern. */
  adminId: string;
}

/**
 * Grading increment table defining measurement differences between
 * consecutive sizes for each control point.
 * Separate tables exist for children and adult age groups.
 */
export interface GradingIncrementTable {
  /** Garment type this table applies to. */
  garmentType: GarmentType;
  /** Age group this table applies to. */
  ageGroup: AgeGroup;
  /**
   * Increment values: sizeTransition → controlPointId → increment in mm.
   * Children transitions: "2T→4T", "4T→6", "6→8", "8→10", "10→12", "12→14", "14→16"
   * Adult transitions: "XS→S", "S→M", "M→L", "L→XL", "XL→XXL", "XXL→3XL", "3XL→4XL", "4XL→5XL", "5XL→6XL"
   */
  increments: Record<string, Record<string, number>>;
}

/**
 * SVG path `d` attribute string representing a geometric path.
 * Example: "M 0 0 L 100 0 L 100 200 L 0 200 Z"
 */
export type PathData = string;

/**
 * A line segment defined by two endpoints in mm coordinates.
 */
export interface LineData {
  /** Start point X coordinate in mm. */
  x1: number;
  /** Start point Y coordinate in mm. */
  y1: number;
  /** End point X coordinate in mm. */
  x2: number;
  /** End point Y coordinate in mm. */
  y2: number;
}

/**
 * Result of SVG generation from a scaled pattern.
 */
export interface SvgGenerationResult {
  /** Complete SVG document string. */
  svg: string;
  /** Whether the generated SVG passes validation. */
  isValid: boolean;
  /** Number of pieces rendered in the SVG. */
  pieceCount: number;
}

// ─── Legacy Types (Backward Compatibility) ───────────────────────────────────

/** Definition of a single pattern piece within a template (legacy format). */
export interface PieceDefinition {
  /** Unique piece identifier. */
  id: string;
  /** Human-readable piece name. */
  name: string;
  /** Number of cuts required for this piece. */
  cutQuantity: number;
  /** Parametric path generation formula identifier. */
  pathFunction: string;
  /** Grain line angle in degrees. */
  grainLineAngle: number;
  /** Notch positions on this piece. */
  notchPositions: NotchPosition[];
}

/** Position of an alignment notch on a pattern piece edge (legacy format). */
export interface NotchPosition {
  /** Edge identifier where the notch is located. */
  edgeId: string;
  /** Position along the edge as a ratio (0.0 to 1.0). */
  position: number;
  /** ID of the matching piece edge this notch aligns with. */
  matchingPieceEdgeId: string;
}

/** Measurement constraint for template validation. */
export interface MeasurementConstraint {
  /** Control point ID this constraint applies to. */
  controlPointId: string;
  /** Minimum allowed value in mm. */
  min: number;
  /** Maximum allowed value in mm. */
  max: number;
  /** Optional relationship constraint with another control point. */
  relatedTo?: string;
  /** Relationship type if relatedTo is specified. */
  relationship?: 'less_than' | 'greater_than' | 'proportional';
}
