/**
 * Mockup Compositing Engine for CronusFit.
 *
 * Composites design graphics onto garment base templates using Sharp:
 * 1. Loads garment base template (front/back views) from S3
 * 2. Loads and validates design graphic (format + size)
 * 3. Calculates placement area boundaries for selected zone
 * 4. Scales design proportionally if it exceeds zone boundaries
 * 5. Composites design onto garment template
 * 6. Outputs 1200×1600 PNG with transparent background
 *
 * This module is pure business logic — decoupled from Lambda event structure.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.7
 */

import sharp from 'sharp';
import type { PlacementZone } from '../../types/mockup.js';
import type { GarmentType } from '../../types/garment.js';
import { downloadFile, BUCKETS, validateFile } from '../../storage/s3-client.js';

// --- Constants ---

/** Output image width in pixels. */
export const OUTPUT_WIDTH = 1200;

/** Output image height in pixels. */
export const OUTPUT_HEIGHT = 1600;

/** S3 key prefix for garment base templates. */
const GARMENT_TEMPLATE_PREFIX = 'templates/garment-bases';

// --- Public Interfaces ---

/** Placement zone boundary definition (pixel coordinates on the 1200×1600 canvas). */
export interface ZoneBounds {
  /** Left edge X coordinate. */
  x: number;
  /** Top edge Y coordinate. */
  y: number;
  /** Zone width in pixels. */
  width: number;
  /** Zone height in pixels. */
  height: number;
}

/** Result of the compositing operation. */
export interface CompositeResult {
  /** Composited front-view PNG buffer. */
  frontImage: Buffer;
  /** Composited back-view PNG buffer. */
  backImage: Buffer;
  /** Scaling percentage applied (undefined if no scaling was needed). */
  scalingApplied?: number;
}

/** Options for the compositing operation. */
export interface CompositeOptions {
  /** Garment type to load base template for. */
  garmentType: GarmentType;
  /** S3 key of the design file. */
  designFileKey: string;
  /** Placement zone for the design overlay. */
  placementZone: PlacementZone;
}

// --- Placement Zone Definitions ---

/**
 * Predefined placement zone boundaries for each zone on the 1200×1600 canvas.
 * These define the bounding box where designs can be placed on the garment template.
 */
export const ZONE_BOUNDS: Record<PlacementZone, ZoneBounds> = {
  'chest': {
    x: 400,
    y: 250,
    width: 400,
    height: 300,
  },
  'full-front': {
    x: 250,
    y: 200,
    width: 700,
    height: 900,
  },
  'full-back': {
    x: 250,
    y: 200,
    width: 700,
    height: 900,
  },
  'left-sleeve': {
    x: 50,
    y: 300,
    width: 250,
    height: 400,
  },
  'right-sleeve': {
    x: 900,
    y: 300,
    width: 250,
    height: 400,
  },
};

// --- Main Exported Functions ---

/**
 * Composite a design graphic onto garment base templates.
 *
 * Loads the garment front/back base images from S3, loads and validates
 * the design graphic, calculates placement, scales if needed, and
 * composites the design onto both views.
 *
 * @param options - Compositing options (garment type, design key, zone)
 * @returns CompositeResult with front/back PNG buffers and optional scaling info
 * @throws Error if design validation fails, templates not found, or processing errors
 */
export async function compositeDesign(options: CompositeOptions): Promise<CompositeResult> {
  const { garmentType, designFileKey, placementZone } = options;

  // 1. Load design graphic from S3 and validate
  const designBuffer = await loadAndValidateDesign(designFileKey);

  // 2. Load garment base templates (front and back views)
  const [frontTemplate, backTemplate] = await Promise.all([
    loadGarmentTemplate(garmentType, 'front'),
    loadGarmentTemplate(garmentType, 'back'),
  ]);

  // 3. Get zone boundaries
  const zone = ZONE_BOUNDS[placementZone];

  // 4. Prepare design (resize if exceeds zone, get scaling info)
  const { resizedDesign, scalingApplied } = await prepareDesign(designBuffer, zone);

  // 5. Composite design onto front and back templates
  const [frontImage, backImage] = await Promise.all([
    compositeOntoTemplate(frontTemplate, resizedDesign, zone, placementZone),
    compositeOntoTemplate(backTemplate, resizedDesign, zone, placementZone),
  ]);

  return {
    frontImage,
    backImage,
    scalingApplied,
  };
}

// --- Internal Functions ---

/**
 * Load and validate a design file from S3.
 *
 * Validates:
 * - File exists in S3
 * - File format (PNG, JPEG, SVG) via extension
 * - File size (≤ 10MB)
 *
 * @param designFileKey - S3 key of the design file
 * @returns Design file buffer
 * @throws Error if file not found, invalid format, or size exceeded
 */
async function loadAndValidateDesign(designFileKey: string): Promise<Buffer> {
  // Extract filename from S3 key for validation
  const filename = designFileKey.split('/').pop() ?? designFileKey;

  // Download from S3
  const buffer = await downloadFile(BUCKETS.assets, designFileKey);

  if (!buffer) {
    throw new CompositorError(
      'DESIGN_NOT_FOUND',
      `Design file not found at key: ${designFileKey}`
    );
  }

  // Validate using the shared file validation utility
  const validationResult = validateFile(buffer, filename);

  if (!validationResult.valid) {
    throw new CompositorError(
      'DESIGN_VALIDATION_FAILED',
      `Design file validation failed: ${validationResult.errors.join('; ')}`
    );
  }

  return buffer;
}

/**
 * Load a garment base template image from S3.
 *
 * Templates are stored at: templates/garment-bases/{garmentType}/{view}.png
 *
 * @param garmentType - The garment type
 * @param view - 'front' or 'back'
 * @returns Template image buffer
 * @throws Error if template not found
 */
async function loadGarmentTemplate(
  garmentType: GarmentType,
  view: 'front' | 'back'
): Promise<Buffer> {
  const key = `${GARMENT_TEMPLATE_PREFIX}/${garmentType}/${view}.png`;
  const buffer = await downloadFile(BUCKETS.assets, key);

  if (!buffer) {
    throw new CompositorError(
      'TEMPLATE_NOT_FOUND',
      `Garment template not found: ${garmentType} (${view} view) at ${key}`
    );
  }

  return buffer;
}

/**
 * Prepare the design for compositing by resizing if it exceeds zone boundaries.
 *
 * If the design dimensions exceed the zone boundaries, it is scaled down
 * proportionally (maintaining aspect ratio) to fit within the zone.
 * The scaling percentage is recorded.
 *
 * @param designBuffer - Raw design image buffer
 * @param zone - Target zone boundaries
 * @returns Resized design buffer and optional scaling percentage
 */
async function prepareDesign(
  designBuffer: Buffer,
  zone: ZoneBounds
): Promise<{ resizedDesign: Buffer; scalingApplied?: number }> {
  // Get design metadata (dimensions)
  const metadata = await sharp(designBuffer).metadata();
  const designWidth = metadata.width ?? 0;
  const designHeight = metadata.height ?? 0;

  if (designWidth === 0 || designHeight === 0) {
    throw new CompositorError(
      'DESIGN_INVALID_DIMENSIONS',
      'Design image has invalid dimensions (width or height is 0)'
    );
  }

  // Check if design exceeds zone boundaries
  const widthRatio = zone.width / designWidth;
  const heightRatio = zone.height / designHeight;
  const scaleFactor = Math.min(widthRatio, heightRatio);

  // Only scale down, never scale up
  if (scaleFactor >= 1) {
    // Design fits within zone — no scaling needed
    return { resizedDesign: designBuffer };
  }

  // Scale proportionally to fit within zone
  const newWidth = Math.round(designWidth * scaleFactor);
  const newHeight = Math.round(designHeight * scaleFactor);
  const scalingPercentage = Math.round(scaleFactor * 100);

  const resizedDesign = await sharp(designBuffer)
    .resize(newWidth, newHeight, { fit: 'inside', withoutEnlargement: true })
    .toBuffer();

  return {
    resizedDesign,
    scalingApplied: scalingPercentage,
  };
}

/**
 * Composite a prepared design onto a garment template.
 *
 * Centers the design within the placement zone and composites it
 * onto the template, then outputs a 1200×1600 PNG with transparent background.
 *
 * @param templateBuffer - Garment base template buffer
 * @param designBuffer - Prepared (possibly resized) design buffer
 * @param zone - Placement zone boundaries
 * @param placementZone - The zone identifier (used for view-specific logic)
 * @returns Composited PNG buffer at 1200×1600
 */
async function compositeOntoTemplate(
  templateBuffer: Buffer,
  designBuffer: Buffer,
  zone: ZoneBounds,
  _placementZone: PlacementZone
): Promise<Buffer> {
  // Get design dimensions after resizing
  const designMeta = await sharp(designBuffer).metadata();
  const designWidth = designMeta.width ?? 0;
  const designHeight = designMeta.height ?? 0;

  // Center design within the zone
  const left = Math.round(zone.x + (zone.width - designWidth) / 2);
  const top = Math.round(zone.y + (zone.height - designHeight) / 2);

  // Ensure the design has an alpha channel for compositing
  const designWithAlpha = await sharp(designBuffer)
    .ensureAlpha()
    .toBuffer();

  // Composite: resize template to output size, then overlay design
  const result = await sharp(templateBuffer)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'fill' })
    .ensureAlpha()
    .composite([
      {
        input: designWithAlpha,
        left,
        top,
        blend: 'over',
      },
    ])
    .png()
    .toBuffer();

  return result;
}

// --- Error Classes ---

/** Custom error class for compositor-specific errors. */
export class CompositorError extends Error {
  /** Machine-readable error code. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CompositorError';
    this.code = code;
  }
}
