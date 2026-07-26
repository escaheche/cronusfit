/**
 * Garment-related type definitions for CronusFit.
 * All measurements are internally in millimeters.
 */

/**
 * Standard garment types supported by the pattern generator.
 * Canonical form uses hyphenated 'tank-top'.
 */
export type StandardGarmentType =
  | 'camiseta'
  | 'short'
  | 'legging'
  | 'sudadera'
  | 'tank-top';

/**
 * Supported garment type classifications.
 * Includes standard types and a custom type for admin-defined garments.
 * Note: 'tank_top' is kept for backward compatibility; prefer 'tank-top'.
 */
export type GarmentType = StandardGarmentType | 'tank_top' | 'custom';

/** Age group classification for sportswear products. */
export type AgeGroup = 'children' | 'adult';

/** Size ranges for children (2T–16). */
export type ChildrenSize = '2T' | '4T' | '6' | '8' | '10' | '12' | '14' | '16';

/** Size ranges for adults (XS–6XL). */
export type AdultSize =
  | 'XS'
  | 'S'
  | 'M'
  | 'L'
  | 'XL'
  | 'XXL'
  | '3XL'
  | '4XL'
  | '5XL'
  | '6XL';

/** Union type encompassing all valid sizes across age groups. */
export type Size = ChildrenSize | AdultSize;

/**
 * Body measurement keys used by parametric templates and control points.
 * All values are in millimeters internally.
 */
export type MeasurementKey =
  | 'chest'
  | 'waist'
  | 'hip'
  | 'torsoLength'
  | 'legLength'
  | 'shoulderWidth';
