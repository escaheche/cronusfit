/**
 * Unit tests for the mockup compositing engine.
 * Tests design loading/validation, zone placement, proportional scaling,
 * and final composite output at 1200×1600 PNG.
 *
 * Validates: Requirements 4.1, 4.2, 4.3, 4.5, 4.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  compositeDesign,
  ZONE_BOUNDS,
  OUTPUT_WIDTH,
  OUTPUT_HEIGHT,
  CompositorError,
  type CompositeOptions,
} from '../../../src/modules/mockup/compositor.js';

// Mock S3 client
vi.mock('../../../src/storage/s3-client.js', () => ({
  downloadFile: vi.fn(),
  validateFile: vi.fn(),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

import { downloadFile, validateFile } from '../../../src/storage/s3-client.js';

const mockDownloadFile = vi.mocked(downloadFile);
const mockValidateFile = vi.mocked(validateFile);

// --- Test Helpers ---

/** Create a test PNG buffer of specified dimensions using Sharp. */
async function createTestPng(width: number, height: number, color = { r: 255, g: 0, b: 0, alpha: 1 }): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

/** Create a garment template buffer (1200×1600). */
async function createTemplateBuffer(): Promise<Buffer> {
  return createTestPng(OUTPUT_WIDTH, OUTPUT_HEIGHT, { r: 200, g: 200, b: 200, alpha: 1 });
}

// --- Test Suite ---

describe('Mockup Compositor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ZONE_BOUNDS', () => {
    it('defines all five placement zones', () => {
      expect(ZONE_BOUNDS).toHaveProperty('chest');
      expect(ZONE_BOUNDS).toHaveProperty('full-front');
      expect(ZONE_BOUNDS).toHaveProperty('full-back');
      expect(ZONE_BOUNDS).toHaveProperty('left-sleeve');
      expect(ZONE_BOUNDS).toHaveProperty('right-sleeve');
    });

    it('all zones fit within the 1200×1600 canvas', () => {
      for (const [zone, bounds] of Object.entries(ZONE_BOUNDS)) {
        expect(bounds.x, `${zone}.x`).toBeGreaterThanOrEqual(0);
        expect(bounds.y, `${zone}.y`).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width, `${zone} right edge`).toBeLessThanOrEqual(OUTPUT_WIDTH);
        expect(bounds.y + bounds.height, `${zone} bottom edge`).toBeLessThanOrEqual(OUTPUT_HEIGHT);
      }
    });
  });

  describe('compositeDesign', () => {
    it('throws DESIGN_NOT_FOUND when design file is missing from S3', async () => {
      mockDownloadFile.mockResolvedValue(undefined);

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/missing.png',
        placementZone: 'chest',
      };

      try {
        await compositeDesign(options);
        expect.fail('Expected CompositorError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CompositorError);
        expect((error as CompositorError).code).toBe('DESIGN_NOT_FOUND');
      }
    });

    it('throws DESIGN_VALIDATION_FAILED when file format is invalid', async () => {
      const invalidBuffer = Buffer.from('not an image');
      mockDownloadFile.mockResolvedValue(invalidBuffer);
      mockValidateFile.mockReturnValue({ valid: false, errors: ['Invalid file format ".txt"'] });

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/bad.txt',
        placementZone: 'chest',
      };

      try {
        await compositeDesign(options);
        expect.fail('Expected CompositorError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CompositorError);
        expect((error as CompositorError).code).toBe('DESIGN_VALIDATION_FAILED');
      }
    });

    it('throws TEMPLATE_NOT_FOUND when garment base template is missing', async () => {
      const designBuffer = await createTestPng(200, 200);
      // First call: design file → success
      // Second/third calls (front/back template) → undefined
      mockDownloadFile
        .mockResolvedValueOnce(designBuffer) // design
        .mockResolvedValueOnce(undefined) // front template missing
        .mockResolvedValueOnce(undefined); // back template missing
      mockValidateFile.mockReturnValue({ valid: true, errors: [] });

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/logo.png',
        placementZone: 'chest',
      };

      try {
        await compositeDesign(options);
        expect.fail('Expected CompositorError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CompositorError);
        expect((error as CompositorError).code).toBe('TEMPLATE_NOT_FOUND');
        expect((error as CompositorError).message).toMatch(/template not found/i);
      }
    });

    it('produces front and back PNG images at 1200×1600 with no scaling when design fits', async () => {
      const designBuffer = await createTestPng(100, 100);
      const templateBuffer = await createTemplateBuffer();

      // design download, front template, back template
      mockDownloadFile
        .mockResolvedValueOnce(designBuffer)
        .mockResolvedValueOnce(templateBuffer)
        .mockResolvedValueOnce(templateBuffer);
      mockValidateFile.mockReturnValue({ valid: true, errors: [] });

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/small-logo.png',
        placementZone: 'chest',
      };

      const result = await compositeDesign(options);

      // Verify output dimensions
      const frontMeta = await sharp(result.frontImage).metadata();
      const backMeta = await sharp(result.backImage).metadata();

      expect(frontMeta.width).toBe(OUTPUT_WIDTH);
      expect(frontMeta.height).toBe(OUTPUT_HEIGHT);
      expect(frontMeta.format).toBe('png');
      expect(backMeta.width).toBe(OUTPUT_WIDTH);
      expect(backMeta.height).toBe(OUTPUT_HEIGHT);
      expect(backMeta.format).toBe('png');

      // No scaling applied since 100×100 fits within chest zone (400×300)
      expect(result.scalingApplied).toBeUndefined();
    });

    it('scales design proportionally and records percentage when design exceeds zone', async () => {
      // Chest zone is 400×300. A 800×600 design should be scaled to 50%.
      const designBuffer = await createTestPng(800, 600);
      const templateBuffer = await createTemplateBuffer();

      mockDownloadFile
        .mockResolvedValueOnce(designBuffer)
        .mockResolvedValueOnce(templateBuffer)
        .mockResolvedValueOnce(templateBuffer);
      mockValidateFile.mockReturnValue({ valid: true, errors: [] });

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/large-logo.png',
        placementZone: 'chest',
      };

      const result = await compositeDesign(options);

      // 400/800 = 0.5, 300/600 = 0.5 → scaleFactor = 0.5 → 50%
      expect(result.scalingApplied).toBe(50);

      // Still outputs correct dimensions
      const frontMeta = await sharp(result.frontImage).metadata();
      expect(frontMeta.width).toBe(OUTPUT_WIDTH);
      expect(frontMeta.height).toBe(OUTPUT_HEIGHT);
    });

    it('scales based on the most constrained dimension (width)', async () => {
      // Chest zone is 400×300. A 1000×100 design → width ratio = 400/1000 = 0.4, height ratio = 300/100 = 3.0
      // scaleFactor = min(0.4, 3.0) = 0.4 → 40%
      const designBuffer = await createTestPng(1000, 100);
      const templateBuffer = await createTemplateBuffer();

      mockDownloadFile
        .mockResolvedValueOnce(designBuffer)
        .mockResolvedValueOnce(templateBuffer)
        .mockResolvedValueOnce(templateBuffer);
      mockValidateFile.mockReturnValue({ valid: true, errors: [] });

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/wide-banner.png',
        placementZone: 'chest',
      };

      const result = await compositeDesign(options);
      expect(result.scalingApplied).toBe(40);
    });

    it('scales based on the most constrained dimension (height)', async () => {
      // Chest zone is 400×300. A 100×900 design → width ratio = 400/100 = 4.0, height ratio = 300/900 = 0.333
      // scaleFactor = min(4.0, 0.333) = 0.333 → 33%
      const designBuffer = await createTestPng(100, 900);
      const templateBuffer = await createTemplateBuffer();

      mockDownloadFile
        .mockResolvedValueOnce(designBuffer)
        .mockResolvedValueOnce(templateBuffer)
        .mockResolvedValueOnce(templateBuffer);
      mockValidateFile.mockReturnValue({ valid: true, errors: [] });

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/tall-design.png',
        placementZone: 'chest',
      };

      const result = await compositeDesign(options);
      expect(result.scalingApplied).toBe(33);
    });

    it('supports all five placement zones', async () => {
      const zones: Array<CompositeOptions['placementZone']> = [
        'chest',
        'full-front',
        'full-back',
        'left-sleeve',
        'right-sleeve',
      ];

      for (const zone of zones) {
        vi.clearAllMocks();
        const designBuffer = await createTestPng(50, 50);
        const templateBuffer = await createTemplateBuffer();

        mockDownloadFile
          .mockResolvedValueOnce(designBuffer)
          .mockResolvedValueOnce(templateBuffer)
          .mockResolvedValueOnce(templateBuffer);
        mockValidateFile.mockReturnValue({ valid: true, errors: [] });

        const options: CompositeOptions = {
          garmentType: 'camiseta',
          designFileKey: 'designs/logo.png',
          placementZone: zone,
        };

        const result = await compositeDesign(options);
        expect(result.frontImage).toBeInstanceOf(Buffer);
        expect(result.backImage).toBeInstanceOf(Buffer);
      }
    });

    it('supports all standard garment types', async () => {
      const garmentTypes: Array<CompositeOptions['garmentType']> = [
        'camiseta',
        'short',
        'legging',
        'sudadera',
        'tank_top',
      ];

      for (const garmentType of garmentTypes) {
        vi.clearAllMocks();
        const designBuffer = await createTestPng(50, 50);
        const templateBuffer = await createTemplateBuffer();

        mockDownloadFile
          .mockResolvedValueOnce(designBuffer)
          .mockResolvedValueOnce(templateBuffer)
          .mockResolvedValueOnce(templateBuffer);
        mockValidateFile.mockReturnValue({ valid: true, errors: [] });

        const options: CompositeOptions = {
          garmentType,
          designFileKey: 'designs/logo.png',
          placementZone: 'full-front',
        };

        const result = await compositeDesign(options);

        // Verify correct S3 keys were used for templates
        expect(mockDownloadFile).toHaveBeenCalledWith(
          'cronusfit-assets',
          `templates/garment-bases/${garmentType}/front.png`
        );
        expect(mockDownloadFile).toHaveBeenCalledWith(
          'cronusfit-assets',
          `templates/garment-bases/${garmentType}/back.png`
        );
      }
    });

    it('outputs PNG with alpha channel (transparent background)', async () => {
      const designBuffer = await createTestPng(100, 100);
      const templateBuffer = await createTemplateBuffer();

      mockDownloadFile
        .mockResolvedValueOnce(designBuffer)
        .mockResolvedValueOnce(templateBuffer)
        .mockResolvedValueOnce(templateBuffer);
      mockValidateFile.mockReturnValue({ valid: true, errors: [] });

      const options: CompositeOptions = {
        garmentType: 'camiseta',
        designFileKey: 'designs/logo.png',
        placementZone: 'chest',
      };

      const result = await compositeDesign(options);

      const frontMeta = await sharp(result.frontImage).metadata();
      expect(frontMeta.channels).toBe(4); // RGBA = 4 channels = transparent support
    });
  });
});
