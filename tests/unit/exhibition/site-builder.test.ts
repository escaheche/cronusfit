import { describe, it, expect } from 'vitest';
import {
  validateProductData,
  resizeImage,
} from '../../../src/modules/exhibition/site-builder.js';
import sharp from 'sharp';

describe('validateProductData', () => {
  const validProduct = {
    PK: 'PRODUCT#123',
    SK: 'METADATA' as const,
    GSI1PK: 'PUBLISHED#true' as const,
    GSI1SK: 'CREATED#2024-01-01T00:00:00.000Z',
    id: 'prod-001',
    mockupId: 'mockup-001',
    productName: { es: 'Camiseta Deportiva', en: 'Sports Jersey' },
    garmentType: 'jersey' as const,
    ageGroup: 'adult' as const,
    availableSizes: ['S', 'M', 'L', 'XL'],
    frontImageS3Key: 'images/prod-001-front.png',
    backImageS3Key: 'images/prod-001-back.png',
    publishedAt: '2024-01-01T00:00:00.000Z',
    publishedBy: 'admin-001',
  };

  it('returns no errors for a valid product', () => {
    const errors = validateProductData(validProduct);
    expect(errors).toHaveLength(0);
  });

  it('returns error for null product', () => {
    const errors = validateProductData(null);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('data_fetch');
  });

  it('returns error for undefined product', () => {
    const errors = validateProductData(undefined);
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('data_fetch');
  });

  it('returns error for non-object product', () => {
    const errors = validateProductData('string');
    expect(errors).toHaveLength(1);
    expect(errors[0].type).toBe('data_fetch');
  });

  it('returns error when id is missing', () => {
    const { id, ...noId } = validProduct;
    const errors = validateProductData(noId);
    expect(errors.some((e) => e.message.includes('id'))).toBe(true);
  });

  it('returns error when id is empty string', () => {
    const errors = validateProductData({ ...validProduct, id: '' });
    expect(errors.some((e) => e.message.includes('id'))).toBe(true);
  });

  it('returns error when productName is missing', () => {
    const { productName, ...noName } = validProduct;
    const errors = validateProductData(noName);
    expect(errors.some((e) => e.message.includes('productName'))).toBe(true);
  });

  it('returns error when productName.es is missing', () => {
    const errors = validateProductData({ ...validProduct, productName: { en: 'Jersey' } });
    expect(errors.some((e) => e.message.includes('productName'))).toBe(true);
  });

  it('returns error when productName.es is empty', () => {
    const errors = validateProductData({ ...validProduct, productName: { es: '', en: 'Jersey' } });
    expect(errors.some((e) => e.message.includes('productName'))).toBe(true);
  });

  it('returns error when garmentType is missing', () => {
    const { garmentType, ...noType } = validProduct;
    const errors = validateProductData(noType);
    expect(errors.some((e) => e.message.includes('garmentType'))).toBe(true);
  });

  it('returns error when ageGroup is missing', () => {
    const { ageGroup, ...noAge } = validProduct;
    const errors = validateProductData(noAge);
    expect(errors.some((e) => e.message.includes('ageGroup'))).toBe(true);
  });

  it('returns error when availableSizes is missing', () => {
    const { availableSizes, ...noSizes } = validProduct;
    const errors = validateProductData(noSizes);
    expect(errors.some((e) => e.message.includes('availableSizes'))).toBe(true);
  });

  it('returns error when availableSizes is empty array', () => {
    const errors = validateProductData({ ...validProduct, availableSizes: [] });
    expect(errors.some((e) => e.message.includes('availableSizes'))).toBe(true);
  });

  it('returns error when frontImageS3Key is missing', () => {
    const { frontImageS3Key, ...noFront } = validProduct;
    const errors = validateProductData(noFront);
    expect(errors.some((e) => e.message.includes('frontImageS3Key'))).toBe(true);
  });

  it('returns error when backImageS3Key is missing', () => {
    const { backImageS3Key, ...noBack } = validProduct;
    const errors = validateProductData(noBack);
    expect(errors.some((e) => e.message.includes('backImageS3Key'))).toBe(true);
  });

  it('includes productId in error when id is present', () => {
    const errors = validateProductData({ ...validProduct, garmentType: '' });
    expect(errors[0].productId).toBe('prod-001');
  });

  it('returns multiple errors for product missing multiple fields', () => {
    const errors = validateProductData({
      id: 'prod-bad',
      productName: null,
      garmentType: '',
    });
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe('resizeImage', () => {
  /**
   * Creates a test image buffer with specified dimensions using sharp.
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

  it('preserves images already within max size', async () => {
    const input = await createTestImage(800, 600);
    const output = await resizeImage(input, 1200, 80);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(600);
  });

  it('resizes landscape image where width exceeds max', async () => {
    const input = await createTestImage(2400, 1600);
    const output = await resizeImage(input, 1200, 80);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1200);
    // Aspect ratio: 1600/2400 = 0.667 → 1200*0.667 = 800
    expect(metadata.height).toBe(800);
  });

  it('resizes portrait image where height exceeds max', async () => {
    const input = await createTestImage(1600, 2400);
    const output = await resizeImage(input, 1200, 80);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.height).toBe(1200);
    // Aspect ratio: 1600/2400 = 0.667 → 1200*0.667 = 800
    expect(metadata.width).toBe(800);
  });

  it('resizes square image to max dimension', async () => {
    const input = await createTestImage(2000, 2000);
    const output = await resizeImage(input, 1200, 80);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(1200);
  });

  it('converts to WebP format', async () => {
    const input = await createTestImage(100, 100);
    const output = await resizeImage(input, 1200, 80);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('webp');
  });

  it('does not enlarge small images', async () => {
    const input = await createTestImage(100, 50);
    const output = await resizeImage(input, 1200, 80);
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(50);
  });

  it('respects custom maxSize parameter', async () => {
    const input = await createTestImage(2000, 1000);
    const output = await resizeImage(input, 800, 80);
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(400);
  });

  it('respects custom quality parameter', async () => {
    // Create a gradient image with varied pixel data where quality matters
    const width = 800;
    const height = 800;
    const channels = 3;
    const pixelData = Buffer.alloc(width * height * channels);
    for (let i = 0; i < pixelData.length; i++) {
      pixelData[i] = (i * 7 + 13) % 256; // pseudo-random pattern
    }

    const input = await sharp(pixelData, {
      raw: { width, height, channels },
    })
      .png()
      .toBuffer();

    const highQuality = await resizeImage(input, 1200, 100);
    const lowQuality = await resizeImage(input, 1200, 20);

    // Lower quality should produce smaller buffer for varied pixel data
    expect(lowQuality.length).toBeLessThan(highQuality.length);
  });
});
