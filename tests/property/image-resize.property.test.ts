/**
 * Property-based tests for image resize never exceeding maximum dimension.
 *
 * **Validates: Requirements 1.2**
 *
 * Property 1: Image resize never exceeds maximum dimension
 * For any input image with arbitrary width and height, the image processing function
 * SHALL produce a WebP output where the longest side does not exceed 1200 pixels,
 * and the aspect ratio is preserved within ±1 pixel rounding tolerance.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import sharp from 'sharp';
import { resizeImage } from '../../src/modules/exhibition/site-builder.js';

const MAX_SIZE = 1200;

/**
 * Helper to create a test PNG image buffer of specified dimensions using sharp.
 */
async function createTestImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .png()
    .toBuffer();
}

describe('Property 1: Image resize never exceeds maximum dimension', () => {
  it(
    'for any image with longest side > 1200px, output longest side = 1200px',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: MAX_SIZE + 1, max: 5000 }),
          fc.integer({ min: 1, max: 5000 }),
          async (longerSide, shorterSide) => {
            // Randomly assign longer side to width or height
            const width = longerSide >= shorterSide ? longerSide : shorterSide;
            const height = longerSide >= shorterSide ? shorterSide : longerSide;

            const inputBuffer = await createTestImage(width, height);
            const outputBuffer = await resizeImage(inputBuffer, MAX_SIZE);

            const metadata = await sharp(outputBuffer).metadata();
            const outputWidth = metadata.width!;
            const outputHeight = metadata.height!;
            const outputLongestSide = Math.max(outputWidth, outputHeight);

            expect(outputLongestSide).toBe(MAX_SIZE);
          },
        ),
        { numRuns: 20 },
      );
    },
    30000,
  );

  it(
    'for any image with longest side ≤ 1200px, output dimensions unchanged',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: MAX_SIZE }),
          fc.integer({ min: 1, max: MAX_SIZE }),
          async (width, height) => {
            const inputBuffer = await createTestImage(width, height);
            const outputBuffer = await resizeImage(inputBuffer, MAX_SIZE);

            const metadata = await sharp(outputBuffer).metadata();
            const outputWidth = metadata.width!;
            const outputHeight = metadata.height!;

            expect(outputWidth).toBe(width);
            expect(outputHeight).toBe(height);
          },
        ),
        { numRuns: 20 },
      );
    },
    30000,
  );

  it(
    'aspect ratio is preserved: output_width/output_height ≈ input_width/input_height (±1px)',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 1, max: 5000 }),
          async (width, height) => {
            const inputBuffer = await createTestImage(width, height);
            const outputBuffer = await resizeImage(inputBuffer, MAX_SIZE);

            const metadata = await sharp(outputBuffer).metadata();
            const outputWidth = metadata.width!;
            const outputHeight = metadata.height!;

            if (Math.max(width, height) > MAX_SIZE) {
              // Image was resized — check aspect ratio preservation
              // Expected: outputWidth / outputHeight ≈ width / height within ±1px rounding
              const expectedWidth = outputHeight * (width / height);
              const expectedHeight = outputWidth * (height / width);

              const widthDiff = Math.abs(outputWidth - expectedWidth);
              const heightDiff = Math.abs(outputHeight - expectedHeight);

              // At least one of the dimensions should be within ±1px of expected
              expect(Math.min(widthDiff, heightDiff)).toBeLessThanOrEqual(1);
            } else {
              // Image was not resized — dimensions should be unchanged
              expect(outputWidth).toBe(width);
              expect(outputHeight).toBe(height);
            }
          },
        ),
        { numRuns: 20 },
      );
    },
    30000,
  );

  it(
    'output format is always WebP',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5000 }),
          fc.integer({ min: 1, max: 5000 }),
          async (width, height) => {
            const inputBuffer = await createTestImage(width, height);
            const outputBuffer = await resizeImage(inputBuffer, MAX_SIZE);

            const metadata = await sharp(outputBuffer).metadata();
            expect(metadata.format).toBe('webp');
          },
        ),
        { numRuns: 20 },
      );
    },
    30000,
  );
});
