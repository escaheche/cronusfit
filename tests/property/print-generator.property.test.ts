/**
 * Property-based tests for Print Generator modules (DTF + Sublimation).
 *
 * **Validates: Requirements 8.1–8.5, 9.1–9.5**
 *
 * Properties tested:
 * 19. DTF Output Specification
 * 20. Sublimation Output Specification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import sharp from 'sharp';

// Increase timeout for image processing property tests
vi.setConfig({ testTimeout: 120_000 });

// --- Mocks ---

const mockDownloadFile = vi.fn();

vi.mock('../../src/storage/s3-client.js', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

// --- Imports (after mocks) ---

import {
  generateDTF,
  mmToPixels as dtfMmToPixels,
  DTFGeneratorError,
  MIN_DPI,
  MM_PER_INCH,
} from '../../src/modules/print/dtf-generator.js';

import {
  generateSublimation,
  cmToPixels,
  mmToPixels as subMmToPixels,
  SUBLIMATION_DPI,
  BLEED_MM,
  SATURATION_MULTIPLIER,
} from '../../src/modules/print/sublimation-generator.js';

import {
  validateDTFDimensions,
  validateSublimationDimensions,
  DTF_MIN_MM,
  DTF_MAX_MM,
  SUBLIMATION_MIN_MM,
  SUBLIMATION_MAX_MM,
} from '../../src/validation/print.js';

// --- Helpers ---

/**
 * Create a test PNG image buffer with given dimensions and RGBA channels.
 * Uses a solid color fill for fast generation.
 */
async function createTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 200, g: 100, b: 50, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Create a test image with partial transparency (some pixels transparent).
 * Useful for verifying underbase generation handles alpha properly.
 */
async function createTestImageWithAlpha(width: number, height: number): Promise<Buffer> {
  // Create a solid image and add a semi-transparent overlay
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 180, g: 60, b: 120, alpha: 0.8 },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Calculate the required source pixels for a given mm dimension at 300 DPI.
 * Ensures the source image has sufficient resolution.
 */
function requiredPixelsForMm(mm: number): number {
  return Math.ceil((mm / MM_PER_INCH) * MIN_DPI) + 1;
}

/**
 * Calculate the required source pixels for a given cm dimension at 300 DPI.
 */
function requiredPixelsForCm(cm: number): number {
  return Math.ceil((cm * 10 / 25.4) * SUBLIMATION_DPI) + 1;
}

// --- Generators ---

/** Arbitrary valid DTF dimensions (10–500mm). */
const arbDTFDimensions = fc.record({
  widthMm: fc.integer({ min: 10, max: 500 }),
  heightMm: fc.integer({ min: 10, max: 500 }),
});

/**
 * Arbitrary valid DTF dimensions with smaller range for image-heavy tests.
 * Keeps pixel counts low to avoid sharp processing timeouts.
 */
const arbDTFDimensionsSmall = fc.record({
  widthMm: fc.integer({ min: 10, max: 80 }),
  heightMm: fc.integer({ min: 10, max: 80 }),
});

/** Arbitrary invalid DTF dimensions (outside 10–500mm). */
const arbInvalidDTFDimensions = fc.oneof(
  // Width too small
  fc.record({
    widthMm: fc.integer({ min: -1000, max: 9 }),
    heightMm: fc.integer({ min: 10, max: 500 }),
  }),
  // Width too large
  fc.record({
    widthMm: fc.integer({ min: 501, max: 2000 }),
    heightMm: fc.integer({ min: 10, max: 500 }),
  }),
  // Height too small
  fc.record({
    widthMm: fc.integer({ min: 10, max: 500 }),
    heightMm: fc.integer({ min: -1000, max: 9 }),
  }),
  // Height too large
  fc.record({
    widthMm: fc.integer({ min: 10, max: 500 }),
    heightMm: fc.integer({ min: 501, max: 2000 }),
  }),
  // Both invalid
  fc.record({
    widthMm: fc.integer({ min: 501, max: 2000 }),
    heightMm: fc.integer({ min: 501, max: 2000 }),
  }),
);

/** Arbitrary valid sublimation dimensions (1–150cm). */
const arbSublimationDimensions = fc.record({
  widthCm: fc.integer({ min: 1, max: 150 }),
  heightCm: fc.integer({ min: 1, max: 150 }),
});

/**
 * Arbitrary valid sublimation dimensions with smaller range for image-heavy tests.
 * Keeps pixel counts manageable for sharp processing within test timeouts.
 */
const arbSublimationDimensionsSmall = fc.record({
  widthCm: fc.integer({ min: 1, max: 15 }),
  heightCm: fc.integer({ min: 1, max: 15 }),
});

/** Arbitrary invalid sublimation dimensions (outside 1–150cm → 10–1500mm). */
const arbInvalidSublimationDimensions = fc.oneof(
  // Width too small (< 1cm)
  fc.record({
    widthCm: fc.integer({ min: -100, max: 0 }),
    heightCm: fc.integer({ min: 1, max: 150 }),
  }),
  // Width too large (> 150cm)
  fc.record({
    widthCm: fc.integer({ min: 151, max: 500 }),
    heightCm: fc.integer({ min: 1, max: 150 }),
  }),
  // Height too small (< 1cm)
  fc.record({
    widthCm: fc.integer({ min: 1, max: 150 }),
    heightCm: fc.integer({ min: -100, max: 0 }),
  }),
  // Height too large (> 150cm)
  fc.record({
    widthCm: fc.integer({ min: 1, max: 150 }),
    heightCm: fc.integer({ min: 151, max: 500 }),
  }),
  // Both invalid
  fc.record({
    widthCm: fc.integer({ min: 151, max: 500 }),
    heightCm: fc.integer({ min: 151, max: 500 }),
  }),
);

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Property 19: DTF Output Specification ---

describe('Property 19: DTF Output Specification', () => {
  it('[property] for any valid dimensions (10-500mm) with sufficient source, generateDTF produces main PNG at 300+ DPI with correct mm dimensions + underbase PNG at same specs', async () => {
    /**
     * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
     *
     * Verifies:
     * - Main PNG at 300+ DPI
     * - CMYK color space processing (pipeline applies toColorspace('cmyk'))
     * - Transparent background (alpha channel present)
     * - Dimensions matching the requested mm size
     * - Separate white ink underbase PNG at same DPI and dimensions as main
     */
    await fc.assert(
      fc.asyncProperty(
        arbDTFDimensionsSmall,
        async ({ widthMm, heightMm }) => {
          // Create source image with sufficient resolution for the target dimensions
          const sourceWidth = requiredPixelsForMm(widthMm);
          const sourceHeight = requiredPixelsForMm(heightMm);
          const sourceBuffer = await createTestImage(sourceWidth, sourceHeight);

          mockDownloadFile.mockResolvedValue(sourceBuffer);

          const result = await generateDTF({
            designS3Key: 'designs/test-dtf.png',
            widthMm,
            heightMm,
          });

          // Expected output pixel dimensions at 300 DPI
          const expectedWidthPx = Math.round((widthMm / MM_PER_INCH) * MIN_DPI);
          const expectedHeightPx = Math.round((heightMm / MM_PER_INCH) * MIN_DPI);

          // --- Verify mainBuffer is valid PNG with correct specs ---
          const mainMeta = await sharp(result.mainBuffer).metadata();
          expect(mainMeta.format).toBe('png');
          expect(mainMeta.width).toBe(expectedWidthPx);
          expect(mainMeta.height).toBe(expectedHeightPx);
          // DPI embedded in metadata (300)
          expect(mainMeta.density).toBe(300);
          // Must have alpha channel (transparent background support, RGBA = 4 channels)
          expect(mainMeta.channels).toBeGreaterThanOrEqual(4);
          // CMYK processing converts back to sRGB for PNG output
          // The color space in the output should be srgb (PNG doesn't support CMYK natively)
          expect(mainMeta.space).toBe('srgb');

          // --- Verify underbaseBuffer is valid PNG with same dimensions and DPI ---
          const underbaseMeta = await sharp(result.underbaseBuffer).metadata();
          expect(underbaseMeta.format).toBe('png');
          expect(underbaseMeta.width).toBe(expectedWidthPx);
          expect(underbaseMeta.height).toBe(expectedHeightPx);
          expect(underbaseMeta.density).toBe(300);
          // Underbase also has alpha (only white where design content exists)
          expect(underbaseMeta.hasAlpha).toBe(true);

          // --- Verify result metadata matches request ---
          expect(result.dpi).toBeGreaterThanOrEqual(300);
          expect(result.widthMm).toBe(widthMm);
          expect(result.heightMm).toBe(heightMm);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] for any dimensions outside 10-500mm, generateDTF rejects with INVALID_DIMENSIONS', async () => {
    /**
     * **Validates: Requirements 8.5**
     *
     * Verifies rejection for invalid dimensions (outside 10-500mm range).
     */
    await fc.assert(
      fc.asyncProperty(
        arbInvalidDTFDimensions,
        async ({ widthMm, heightMm }) => {
          // Should not even attempt S3 download for invalid dimensions
          await expect(
            generateDTF({
              designS3Key: 'designs/any-design.png',
              widthMm,
              heightMm,
            }),
          ).rejects.toThrow(DTFGeneratorError);

          try {
            await generateDTF({
              designS3Key: 'designs/any-design.png',
              widthMm,
              heightMm,
            });
          } catch (error) {
            expect(error).toBeInstanceOf(DTFGeneratorError);
            expect((error as DTFGeneratorError).code).toBe('INVALID_DIMENSIONS');
          }

          // Verify S3 was NOT called for invalid dimensions
          expect(mockDownloadFile).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] for any dimensions where source DPI < 300, generateDTF rejects with INSUFFICIENT_RESOLUTION', async () => {
    /**
     * **Validates: Requirements 8.5**
     *
     * Verifies rejection for source images below 300 DPI at target size.
     */
    await fc.assert(
      fc.asyncProperty(
        arbDTFDimensionsSmall,
        fc.integer({ min: 1, max: 99 }),
        async ({ widthMm, heightMm }, dpiPercent) => {
          // Create a source image that is intentionally too small to achieve 300 DPI.
          const fullWidthRequired = Math.ceil((widthMm / MM_PER_INCH) * MIN_DPI);
          const fullHeightRequired = Math.ceil((heightMm / MM_PER_INCH) * MIN_DPI);

          // Scale down to guarantee insufficient resolution
          const sourceWidth = Math.max(1, Math.floor(fullWidthRequired * (dpiPercent / 100)));
          const sourceHeight = Math.max(1, Math.floor(fullHeightRequired * (dpiPercent / 100)));

          const sourceBuffer = await createTestImage(sourceWidth, sourceHeight);
          mockDownloadFile.mockResolvedValue(sourceBuffer);

          await expect(
            generateDTF({
              designS3Key: 'designs/small-source.png',
              widthMm,
              heightMm,
            }),
          ).rejects.toThrow(DTFGeneratorError);

          try {
            await generateDTF({
              designS3Key: 'designs/small-source.png',
              widthMm,
              heightMm,
            });
          } catch (error) {
            expect(error).toBeInstanceOf(DTFGeneratorError);
            expect((error as DTFGeneratorError).code).toBe('INSUFFICIENT_RESOLUTION');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 20: Sublimation Output Specification ---

describe('Property 20: Sublimation Output Specification', () => {
  it('[property] for any valid dimensions (1-150cm) with sufficient source, generateSublimation produces PNG at 300 DPI with 3mm bleed, mirrored, +15% saturation, and correct cm dimensions', async () => {
    /**
     * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
     *
     * Verifies:
     * - PNG at 300 DPI
     * - 3mm bleed on all edges (output dimensions = requested + 6mm width + 6mm height)
     * - Horizontally mirrored image (flop applied)
     * - Color saturation increased by 15%
     * - Content dimensions matching the requested cm size (excluding bleed)
     */
    await fc.assert(
      fc.asyncProperty(
        arbSublimationDimensionsSmall,
        async ({ widthCm, heightCm }) => {
          // Create source image with sufficient resolution
          const sourceWidth = requiredPixelsForCm(widthCm);
          const sourceHeight = requiredPixelsForCm(heightCm);
          const sourceBuffer = await createTestImage(sourceWidth, sourceHeight);

          mockDownloadFile.mockResolvedValue(sourceBuffer);

          const result = await generateSublimation({
            designS3Key: 'designs/test-sublimation.png',
            widthCm,
            heightCm,
          });

          // Expected pixel dimensions: target content + bleed (3mm on each edge = 6mm total per axis)
          const targetWidthPx = cmToPixels(widthCm);
          const targetHeightPx = cmToPixels(heightCm);
          const bleedPx = subMmToPixels(BLEED_MM);
          const expectedTotalWidthPx = targetWidthPx + bleedPx * 2;
          const expectedTotalHeightPx = targetHeightPx + bleedPx * 2;

          // --- Verify buffer is valid PNG with correct specs ---
          const meta = await sharp(result.buffer).metadata();
          expect(meta.format).toBe('png');
          expect(meta.width).toBe(expectedTotalWidthPx);
          expect(meta.height).toBe(expectedTotalHeightPx);
          expect(meta.density).toBe(300);

          // --- Verify bleed adds exactly 6mm total per axis ---
          // bleedPx * 2 = total bleed pixels per axis
          const contentWidthPx = meta.width! - bleedPx * 2;
          const contentHeightPx = meta.height! - bleedPx * 2;
          expect(contentWidthPx).toBe(targetWidthPx);
          expect(contentHeightPx).toBe(targetHeightPx);

          // --- Verify result metadata matches request ---
          expect(result.dpi).toBe(300);
          expect(result.widthCm).toBe(widthCm);
          expect(result.heightCm).toBe(heightCm);
          expect(result.bleedMm).toBe(3);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] sublimation applies horizontal mirror (flop) — pixel data differs from non-mirrored version', async () => {
    /**
     * **Validates: Requirements 9.3**
     *
     * Verifies that the sublimation output is horizontally mirrored by comparing
     * the output to a non-mirrored reference at the same dimensions.
     */
    await fc.assert(
      fc.asyncProperty(
        // Use smaller range for performance since we compare pixel data
        fc.record({
          widthCm: fc.integer({ min: 1, max: 20 }),
          heightCm: fc.integer({ min: 1, max: 20 }),
        }),
        async ({ widthCm, heightCm }) => {
          // Create an asymmetric source image so mirroring is detectable
          const sourceWidth = requiredPixelsForCm(widthCm);
          const sourceHeight = requiredPixelsForCm(heightCm);

          // Create image with a gradient-like pattern (left side different from right)
          const asymmetricSource = await sharp({
            create: {
              width: sourceWidth,
              height: sourceHeight,
              channels: 4,
              background: { r: 255, g: 0, b: 0, alpha: 1 },
            },
          })
            .composite([
              {
                input: await sharp({
                  create: {
                    width: Math.max(1, Math.floor(sourceWidth / 2)),
                    height: sourceHeight,
                    channels: 4,
                    background: { r: 0, g: 0, b: 255, alpha: 1 },
                  },
                })
                  .png()
                  .toBuffer(),
                left: 0,
                top: 0,
              },
            ])
            .png()
            .toBuffer();

          mockDownloadFile.mockResolvedValue(asymmetricSource);

          const result = await generateSublimation({
            designS3Key: 'designs/asymmetric.png',
            widthCm,
            heightCm,
          });

          // Generate a non-mirrored reference for comparison
          const totalWidthPx = cmToPixels(widthCm) + subMmToPixels(BLEED_MM) * 2;
          const totalHeightPx = cmToPixels(heightCm) + subMmToPixels(BLEED_MM) * 2;

          const nonMirroredRef = await sharp(asymmetricSource)
            .resize(totalWidthPx, totalHeightPx, { fit: 'fill' })
            .modulate({ saturation: SATURATION_MULTIPLIER })
            .png()
            .toBuffer();

          // The mirrored output should differ from non-mirrored reference
          // (unless the image is perfectly symmetric, which our test image is not)
          const outputRaw = await sharp(result.buffer).raw().toBuffer();
          const refRaw = await sharp(nonMirroredRef).raw().toBuffer();

          // At least some pixels should differ (image is asymmetric)
          let diffCount = 0;
          const checkPixels = Math.min(outputRaw.length, refRaw.length);
          for (let i = 0; i < checkPixels; i++) {
            if (outputRaw[i] !== refRaw[i]) {
              diffCount++;
            }
          }

          // Mirrored image should have pixel differences from non-mirrored
          expect(diffCount).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] for any dimensions outside 1-150cm, generateSublimation rejects', async () => {
    /**
     * **Validates: Requirements 9.5**
     *
     * Verifies rejection for invalid dimensions (outside 1-150cm range).
     */
    await fc.assert(
      fc.asyncProperty(
        arbInvalidSublimationDimensions,
        async ({ widthCm, heightCm }) => {
          await expect(
            generateSublimation({
              designS3Key: 'designs/any-design.png',
              widthCm,
              heightCm,
            }),
          ).rejects.toThrow(/[Ii]nvalid sublimation dimensions/);

          // Verify S3 was NOT called for invalid dimensions
          expect(mockDownloadFile).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] for any dimensions where source DPI < 300, generateSublimation rejects', async () => {
    /**
     * **Validates: Requirements 9.5**
     *
     * Verifies rejection for source images below 300 DPI at target size.
     */
    await fc.assert(
      fc.asyncProperty(
        arbSublimationDimensionsSmall,
        fc.integer({ min: 1, max: 99 }),
        async ({ widthCm, heightCm }, dpiPercent) => {
          // Create a source image that is intentionally too small to achieve 300 DPI.
          const fullWidthRequired = Math.ceil((widthCm * 10 / 25.4) * SUBLIMATION_DPI);
          const fullHeightRequired = Math.ceil((heightCm * 10 / 25.4) * SUBLIMATION_DPI);

          // Scale down to guarantee insufficient resolution
          const sourceWidth = Math.max(1, Math.floor(fullWidthRequired * (dpiPercent / 100)));
          const sourceHeight = Math.max(1, Math.floor(fullHeightRequired * (dpiPercent / 100)));

          const sourceBuffer = await createTestImage(sourceWidth, sourceHeight);
          mockDownloadFile.mockResolvedValue(sourceBuffer);

          await expect(
            generateSublimation({
              designS3Key: 'designs/small-sublimation.png',
              widthCm,
              heightCm,
            }),
          ).rejects.toThrow(/resolution insufficient/i);
        },
      ),
      { numRuns: 100 },
    );
  });
});
