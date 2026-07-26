/**
 * Mockup generation type definitions for CronusFit.
 */

import type { GarmentType } from './garment.js';

/** Predefined placement zones for design overlays on garments. */
export type PlacementZone =
  | 'chest'
  | 'full-front'
  | 'full-back'
  | 'left-sleeve'
  | 'right-sleeve';

/** Request payload for generating a garment mockup with design overlay. */
export interface MockupGenerateRequest {
  /** Pattern ID to base the mockup on. */
  patternId: string;
  /** Garment type for the mockup. */
  garmentType: GarmentType;
  /** S3 key of the design file to overlay. */
  designFileKey: string;
  /** Zone where the design should be placed on the garment. */
  placementZone: PlacementZone;
}

/** Response returned after successful mockup generation. */
export interface MockupGenerateResponse {
  /** Unique mockup identifier. */
  mockupId: string;
  /** S3 presigned URL for the front-view image. */
  frontImageUrl: string;
  /** S3 presigned URL for the back-view image. */
  backImageUrl: string;
  /** Initial status is always 'pending_approval'. */
  status: 'pending_approval';
  /** Scaling percentage applied if design exceeded zone boundaries. */
  scalingApplied?: number;
}
