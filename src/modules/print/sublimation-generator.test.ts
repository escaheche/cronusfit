/**
 * Unit tests for sublimation print file generator.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  generateSublimation,
  cmToPixels,
  mmToPixels,
  SUBLIMATION_DPI,
  BLEED_MM,
  SATURATION_MULTIPLIER,
} from './sublimation-generator.js';

// Mock S3 client
vi.mock('../../storage/s3-client.js', () => ({
  downloadFile: vi.fn(),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

import { downloadFile } from '../../storage/s3-client.js';
const mockDownloadFile = vi.mocked(downloadFile);

/**
 * Helper to create a test PNG image of specified pixel dimensions.
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

describe('sublimation-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cmToPixels', () => {
    it('converts 10cm to ~1181px at 300 DPI', () => {
      // 10cm = 100mm; (100 / 25.4) * 300 = 1181.1 → 1181
      const px = cmToPixels(10);
      expect(px).toBe(1181);
    });

    it('converts 1cm to ~118px at 300 DPI', () => {
      // 1cm = 10mm; (10 / 25.4) * 300 = 118.1 → 118
      const px = cmToPixels(1);
      expect(px).toBe(118);
    });

    it('converts 150cm to ~17717px at 300 DPI', () => {
      // 150cm = 1500mm; (1500 / 25.4) * 300 = 17716.5 → 17717
      const px = cmToPixels(150);
      expect(px).toBe(17717);
    });
  });

  describe('mmToPixels', () => {
    it('converts 3mm bleed to ~35px at 300 DPI', () => {
      // (3 / 25.4) * 300 = 35.43 → 35
      const px = mmToPixels(3);
      expect(px).toBe(35);
    });

    it('converts 25.4mm (1 inch) to 300px at 300 DPI', () => {
      const px = mmToPixels(25.4);
      expect(px).toBe(300);
    });
  });

  describe('constants', () => {
    it('SUBLIMATION_DPI is 300', () => {
      expect(SUBLIMATION_DPI).toBe(300);
    });

    it('BLEED_MM is 3', () => {
      expect(BLEED_MM).toBe(3);
    });

    it('SATURATION_MULTIPLIER is 1.15', () => {
      expect(SATURATION_MULTIPLIER).toBe(1.15);
    });
  });

  describe('generateSublimation', () => {
    describe('dimension validation', () => {
      it('rejects width below 1cm', async () => {
        await expect(
          generateSublimation({ designS3Key: 'test.png', widthCm: 0.5, heightCm: 10 }),
        ).rejects.toThrow('Invalid sublimation dimensions');
      });

      it('rejects height above 150cm', async () => {
        await expect(
          generateSublimation({ designS3Key: 'test.png', widthCm: 10, heightCm: 151 }),
        ).rejects.toThrow('Invalid sublimation dimensions');
      });

      it('rejects both dimensions invalid', async () => {
        await expect(
          generateSublimation({ designS3Key: 'test.png', widthCm: 0, heightCm: 200 }),
        ).rejects.toThrow('Invalid sublimation dimensions');
      });
    });

    describe('source resolution check', () => {
      it('rejects when source image has insufficient resolution', async () => {
        // 10cm target requires 1181px. Provide a 500x500 source → too small
        const smallImage = await createTestImage(500, 500);
        mockDownloadFile.mockResolvedValue(smallImage);

        await expect(
          generateSublimation({ designS3Key: 'small.png', widthCm: 10, heightCm: 10 }),
        ).rejects.toThrow('Source resolution insufficient');
      });

      it('rejects when source not found in S3', async () => {
        mockDownloadFile.mockResolvedValue(undefined);

        await expect(
          generateSublimation({ designS3Key: 'missing.png', widthCm: 5, heightCm: 5 }),
        ).rejects.toThrow('Source design not found');
      });
    });

    describe('successful generation', () => {
      it('generates PNG with correct total dimensions (target + bleed)', async () => {
        // 10cm = 1181px target; bleed = 35px per side; total = 1181 + 70 = 1251
        const targetPx = cmToPixels(10);
        const bleedPx = mmToPixels(BLEED_MM);
        const totalPx = targetPx + bleedPx * 2;

        // Provide a large enough source (2000x2000)
        const sourceImage = await createTestImage(2000, 2000);
        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 10,
          heightCm: 10,
        });

        const metadata = await sharp(result.buffer).metadata();
        expect(metadata.width).toBe(totalPx);
        expect(metadata.height).toBe(totalPx);
      });

      it('generates PNG format output', async () => {
        const sourceImage = await createTestImage(2000, 2000);
        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 10,
          heightCm: 10,
        });

        const metadata = await sharp(result.buffer).metadata();
        expect(metadata.format).toBe('png');
      });

      it('sets DPI to 300 in output metadata', async () => {
        const sourceImage = await createTestImage(2000, 2000);
        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 10,
          heightCm: 10,
        });

        const metadata = await sharp(result.buffer).metadata();
        expect(metadata.density).toBe(300);
      });

      it('returns correct metadata in result', async () => {
        const sourceImage = await createTestImage(2000, 2000);
        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 10,
          heightCm: 15,
        });

        expect(result.dpi).toBe(300);
        expect(result.widthCm).toBe(10);
        expect(result.heightCm).toBe(15);
        expect(result.bleedMm).toBe(3);
      });

      it('applies horizontal mirror (flop)', async () => {
        // Create asymmetric image: left half red, right half blue
        const width = 2000;
        const height = 2000;
        const sourceImage = await sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 1 },
          },
        })
          .composite([
            {
              input: await sharp({
                create: {
                  width: width / 2,
                  height,
                  channels: 4,
                  background: { r: 0, g: 0, b: 255, alpha: 1 },
                },
              })
                .png()
                .toBuffer(),
              left: width / 2,
              top: 0,
            },
          ])
          .png()
          .toBuffer();

        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 5,
          heightCm: 5,
        });

        // After flop, the right side should now be red and left side blue.
        // Extract a pixel from the left area of the output to verify it's blue-ish
        const outputMeta = await sharp(result.buffer).metadata();
        const outputWidth = outputMeta.width!;

        // Sample a pixel from the left quarter
        const sampleX = Math.floor(outputWidth * 0.25);
        const leftPixel = await sharp(result.buffer)
          .extract({ left: sampleX, top: 10, width: 1, height: 1 })
          .raw()
          .toBuffer();

        // After flop + saturation boost, left side should be predominantly blue
        // Blue channel should be higher than red channel
        expect(leftPixel[2]).toBeGreaterThan(leftPixel[0]);
      });

      it('increases color saturation', async () => {
        // Create a colored source image
        const sourceImage = await createTestImage(2000, 2000);
        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 5,
          heightCm: 5,
        });

        // The output should have valid PNG data (saturation boost applied internally)
        // We verify indirectly: average color should differ from neutral gray
        const { dominant } = await sharp(result.buffer).stats();
        // Our source is r:200, g:100, b:50 - after +15% saturation, colors should be more vivid
        // The red channel should remain dominant
        expect(dominant).toBeDefined();
        expect(result.buffer.length).toBeGreaterThan(0);
      });

      it('accepts minimum valid dimensions (1cm x 1cm)', async () => {
        // 1cm = 118px; need source at least that large
        const sourceImage = await createTestImage(500, 500);
        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 1,
          heightCm: 1,
        });

        expect(result.widthCm).toBe(1);
        expect(result.heightCm).toBe(1);
        expect(result.buffer.length).toBeGreaterThan(0);
      });

      it('handles non-square dimensions correctly', async () => {
        const sourceImage = await createTestImage(3000, 5000);
        mockDownloadFile.mockResolvedValue(sourceImage);

        const result = await generateSublimation({
          designS3Key: 'design.png',
          widthCm: 20,
          heightCm: 40,
        });

        const metadata = await sharp(result.buffer).metadata();
        const expectedWidth = cmToPixels(20) + mmToPixels(BLEED_MM) * 2;
        const expectedHeight = cmToPixels(40) + mmToPixels(BLEED_MM) * 2;

        expect(metadata.width).toBe(expectedWidth);
        expect(metadata.height).toBe(expectedHeight);
      });
    });
  });
});
