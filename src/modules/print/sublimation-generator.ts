/**
 * Sublimation print file generator for CronusFit.
 *
 * Generates production-ready PNG files for sublimation printing with:
 * - 300 DPI resolution
 * - 3mm bleed on all edges
 * - Horizontal mirroring (for transfer)
 * - +15% color saturation (ink loss compensation)
 * - Dimension validation (1–150cm per side)
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import sharp from 'sharp';
import { downloadFile, BUCKETS } from '../../storage/s3-client.js';
import { validateSublimationDimensions } from '../../validation/print.js';

/** Sublimation print target DPI. */
export const SUBLIMATION_DPI = 300;

/** Bleed in millimeters added on each edge. */
export const BLEED_MM = 3;

/** Saturation multiplier for sublimation ink loss compensation. */
export const SATURATION_MULTIPLIER = 1.15;

/** Request to generate a sublimation print file. */
export interface SublimationRequest {
  /** S3 key for the source design file. */
  designS3Key: string;
  /** Target print width in centimeters (1–150). */
  widthCm: number;
  /** Target print height in centimeters (1–150). */
  heightCm: number;
}

/** Result of sublimation print file generation. */
export interface SublimationResult {
  /** PNG buffer of the generated print file. */
  buffer: Buffer;
  /** Output DPI (always 300). */
  dpi: number;
  /** Print width in centimeters (excluding bleed). */
  widthCm: number;
  /** Print height in centimeters (excluding bleed). */
  heightCm: number;
  /** Bleed added on each edge in millimeters. */
  bleedMm: number;
}

/**
 * Convert centimeters to pixels at 300 DPI.
 * Formula: pixels = (cm * 10 / 25.4) * 300
 */
export function cmToPixels(cm: number): number {
  return Math.round((cm * 10 / 25.4) * SUBLIMATION_DPI);
}

/**
 * Convert millimeters to pixels at 300 DPI.
 * Formula: pixels = (mm / 25.4) * 300
 */
export function mmToPixels(mm: number): number {
  return Math.round((mm / 25.4) * SUBLIMATION_DPI);
}

/**
 * Generate a sublimation print file from a source design.
 *
 * Steps:
 * 1. Validate dimensions (1–150cm per side)
 * 2. Download source design from S3
 * 3. Validate source has sufficient resolution (≥300 DPI at target size)
 * 4. Resize to target dimensions + bleed
 * 5. Increase saturation by 15%
 * 6. Apply horizontal mirror (flop)
 * 7. Export as PNG at 300 DPI
 *
 * @param request - Sublimation generation request
 * @returns Sublimation result with buffer and metadata
 * @throws Error if dimensions invalid, source not found, or resolution insufficient
 */
export async function generateSublimation(
  request: SublimationRequest,
): Promise<SublimationResult> {
  const { designS3Key, widthCm, heightCm } = request;

  // 1. Validate dimensions (convert cm to mm for validator)
  const widthMm = widthCm * 10;
  const heightMm = heightCm * 10;
  const validation = validateSublimationDimensions({ widthMm, heightMm });

  if (!validation.valid) {
    const messages = validation.errors.map((e) => e.message.en).join('; ');
    throw new Error(`Invalid sublimation dimensions: ${messages}`);
  }

  // 2. Download source design from S3
  const sourceBuffer = await downloadFile(BUCKETS.assets, designS3Key);

  if (!sourceBuffer) {
    throw new Error(`Source design not found: ${designS3Key}`);
  }

  // 3. Check source resolution
  const sourceMetadata = await sharp(sourceBuffer).metadata();
  const sourceWidth = sourceMetadata.width;
  const sourceHeight = sourceMetadata.height;

  if (!sourceWidth || !sourceHeight) {
    throw new Error('Unable to read source image dimensions');
  }

  // Calculate required pixels for target at 300 DPI (excluding bleed)
  const targetWidthPx = cmToPixels(widthCm);
  const targetHeightPx = cmToPixels(heightCm);

  // Source must have enough pixels to achieve 300 DPI at target size
  if (sourceWidth < targetWidthPx || sourceHeight < targetHeightPx) {
    throw new Error(
      `Source resolution insufficient: source is ${sourceWidth}x${sourceHeight}px, ` +
        `but ${targetWidthPx}x${targetHeightPx}px required for ${widthCm}x${heightCm}cm at 300 DPI`,
    );
  }

  // 4. Calculate total dimensions with bleed (3mm on each edge = 6mm added total)
  const bleedPx = mmToPixels(BLEED_MM);
  const totalWidthPx = targetWidthPx + bleedPx * 2;
  const totalHeightPx = targetHeightPx + bleedPx * 2;

  // 5. Resize, saturate, mirror, and export as PNG at 300 DPI
  const outputBuffer = await sharp(sourceBuffer)
    .resize(totalWidthPx, totalHeightPx, { fit: 'fill' })
    .modulate({ saturation: SATURATION_MULTIPLIER })
    .flop() // Horizontal mirror for sublimation transfer
    .png({ compressionLevel: 6 })
    .withMetadata({ density: SUBLIMATION_DPI })
    .toBuffer();

  return {
    buffer: outputBuffer,
    dpi: SUBLIMATION_DPI,
    widthCm,
    heightCm,
    bleedMm: BLEED_MM,
  };
}
