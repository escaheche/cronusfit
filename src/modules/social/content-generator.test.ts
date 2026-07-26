/**
 * Unit tests for the Social Content Generator module.
 *
 * Tests cover:
 * - Instagram image generation (1080×1080, 72 DPI, brand overlay)
 * - Facebook image generation (1200×630, 72 DPI, brand overlay)
 * - Spanish caption generation (≤2200 chars, 5–15 hashtags)
 * - Gradient background creation
 * - Error handling and atomic storage behavior
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';
import {
  generateInstagramImage,
  generateFacebookImage,
  generateCaption,
  createGradientBackground,
  generateSocialContent,
  INSTAGRAM_WIDTH,
  INSTAGRAM_HEIGHT,
  FACEBOOK_WIDTH,
  FACEBOOK_HEIGHT,
  TARGET_DPI,
  MAX_CAPTION_LENGTH,
  MIN_HASHTAGS,
  MAX_HASHTAGS,
} from './content-generator.js';

// Mock AWS dependencies
vi.mock('../../storage/s3-client.js', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn().mockImplementation(async (_bucket: string, key: string) => {
    // Return a simple 100x100 red PNG for mockup images
    if (key.includes('mockup') || key.includes('front') || key.includes('back')) {
      return sharp({
        create: { width: 100, height: 150, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
      }).png().toBuffer();
    }
    // Return a small logo PNG for brand assets
    if (key.includes('logo') || key.includes('brand')) {
      return sharp({
        create: { width: 64, height: 64, channels: 4, background: { r: 27, g: 58, b: 107, alpha: 1 } },
      }).png().toBuffer();
    }
    return undefined;
  }),
  getPresignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

vi.mock('../../db/operations.js', () => ({
  transactWrite: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helper: create test mockup buffers
// ---------------------------------------------------------------------------

async function createTestMockupBuffer(width = 200, height = 300): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 100, g: 150, b: 200, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function createTestLogoBuffer(size = 64): Promise<Buffer> {
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 27, g: 58, b: 107, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Tests: Instagram Image Generation (Req 10.1)
// ---------------------------------------------------------------------------

describe('generateInstagramImage', () => {
  it('should produce a 1080×1080 PNG image', async () => {
    const mockup = await createTestMockupBuffer();
    const logo = await createTestLogoBuffer();

    const result = await generateInstagramImage(mockup, logo);

    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(INSTAGRAM_WIDTH);
    expect(metadata.height).toBe(INSTAGRAM_HEIGHT);
    expect(metadata.format).toBe('png');
  });

  it('should set 72 DPI metadata', async () => {
    const mockup = await createTestMockupBuffer();
    const logo = await createTestLogoBuffer();

    const result = await generateInstagramImage(mockup, logo);

    const metadata = await sharp(result).metadata();
    expect(metadata.density).toBe(TARGET_DPI);
  });

  it('should work without logo (branding skipped per Req 10.6)', async () => {
    const mockup = await createTestMockupBuffer();

    const result = await generateInstagramImage(mockup, null);

    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(INSTAGRAM_WIDTH);
    expect(metadata.height).toBe(INSTAGRAM_HEIGHT);
    expect(metadata.format).toBe('png');
  });

  it('should handle very small mockup images', async () => {
    const smallMockup = await createTestMockupBuffer(50, 50);
    const logo = await createTestLogoBuffer();

    const result = await generateInstagramImage(smallMockup, logo);

    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(INSTAGRAM_WIDTH);
    expect(metadata.height).toBe(INSTAGRAM_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// Tests: Facebook Image Generation (Req 10.2)
// ---------------------------------------------------------------------------

describe('generateFacebookImage', () => {
  it('should produce a 1200×630 PNG image', async () => {
    const front = await createTestMockupBuffer();
    const back = await createTestMockupBuffer();
    const logo = await createTestLogoBuffer();

    const result = await generateFacebookImage(front, back, logo);

    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(FACEBOOK_WIDTH);
    expect(metadata.height).toBe(FACEBOOK_HEIGHT);
    expect(metadata.format).toBe('png');
  });

  it('should set 72 DPI metadata', async () => {
    const front = await createTestMockupBuffer();
    const back = await createTestMockupBuffer();
    const logo = await createTestLogoBuffer();

    const result = await generateFacebookImage(front, back, logo);

    const metadata = await sharp(result).metadata();
    expect(metadata.density).toBe(TARGET_DPI);
  });

  it('should work without logo (branding skipped per Req 10.6)', async () => {
    const front = await createTestMockupBuffer();
    const back = await createTestMockupBuffer();

    const result = await generateFacebookImage(front, back, null);

    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBe(FACEBOOK_WIDTH);
    expect(metadata.height).toBe(FACEBOOK_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// Tests: Caption Generation (Req 10.3)
// ---------------------------------------------------------------------------

describe('generateCaption', () => {
  it('should generate a caption within 2200 characters', () => {
    const caption = generateCaption('Camiseta Deportiva Cronus Pro');

    expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
  });

  it('should generate a caption in Spanish', () => {
    const caption = generateCaption('Short de Entrenamiento Elite');

    // Check for Spanish-language indicators
    expect(caption).toMatch(/[¡!¿?áéíóúñ]|nuevo|diseño|cotiz|calidad/i);
  });

  it('should include between 5 and 15 hashtags', () => {
    const caption = generateCaption('Legging Deportivo Pro');

    const hashtags = caption.match(/#\w+/g) ?? [];
    expect(hashtags.length).toBeGreaterThanOrEqual(MIN_HASHTAGS);
    expect(hashtags.length).toBeLessThanOrEqual(MAX_HASHTAGS);
  });

  it('should include the product name in the caption', () => {
    const productName = 'Conjunto Deportivo Galaxy';
    const caption = generateCaption(productName);

    expect(caption).toContain(productName);
  });

  it('should produce consistent output for the same product name', () => {
    const productName = 'Tank Top Premium';
    const caption1 = generateCaption(productName);
    const caption2 = generateCaption(productName);

    // Body text should be the same (deterministic template selection)
    // Hashtags may vary due to randomness, but body should match
    const body1 = caption1.split('\n\n').slice(0, -1).join('\n\n');
    const body2 = caption2.split('\n\n').slice(0, -1).join('\n\n');
    expect(body1).toBe(body2);
  });

  it('should handle very long product names without exceeding max length', () => {
    const longName = 'A'.repeat(500);
    const caption = generateCaption(longName);

    expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
  });
});

// ---------------------------------------------------------------------------
// Tests: Gradient Background
// ---------------------------------------------------------------------------

describe('createGradientBackground', () => {
  it('should create an image of the specified dimensions', async () => {
    const buffer = await createGradientBackground(800, 600);

    const metadata = await sharp(buffer).metadata();
    expect(metadata.width).toBe(800);
    expect(metadata.height).toBe(600);
    expect(metadata.format).toBe('png');
  });

  it('should create valid PNG for Instagram dimensions', async () => {
    const buffer = await createGradientBackground(INSTAGRAM_WIDTH, INSTAGRAM_HEIGHT);

    const metadata = await sharp(buffer).metadata();
    expect(metadata.width).toBe(INSTAGRAM_WIDTH);
    expect(metadata.height).toBe(INSTAGRAM_HEIGHT);
  });

  it('should create valid PNG for Facebook dimensions', async () => {
    const buffer = await createGradientBackground(FACEBOOK_WIDTH, FACEBOOK_HEIGHT);

    const metadata = await sharp(buffer).metadata();
    expect(metadata.width).toBe(FACEBOOK_WIDTH);
    expect(metadata.height).toBe(FACEBOOK_HEIGHT);
  });
});

// ---------------------------------------------------------------------------
// Tests: Full generateSocialContent flow (Req 10.4, 10.5, 10.6, 10.7)
// ---------------------------------------------------------------------------

describe('generateSocialContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate all content types successfully', async () => {
    const result = await generateSocialContent({
      productId: 'product-123',
      mockupFrontUrl: 'mockups/product-123/front.png',
      mockupBackUrl: 'mockups/product-123/back.png',
      productName: 'Camiseta Deportiva Test',
    });

    // Should not be a failure result
    expect('success' in result && result.success === false).toBe(false);

    // Cast to success type
    const success = result as { contentId: string; instagramImageUrl: string; facebookImageUrl: string; captionText: string; status: string };
    expect(success.contentId).toBeDefined();
    expect(success.instagramImageUrl).toBeDefined();
    expect(success.facebookImageUrl).toBeDefined();
    expect(success.captionText).toBeDefined();
    expect(success.status).toBe('pending_review');
  });

  it('should return failure when mockup images are missing (Req 10.7)', async () => {
    const { downloadFile } = await import('../../storage/s3-client.js');
    vi.mocked(downloadFile).mockResolvedValueOnce(undefined);

    const result = await generateSocialContent({
      productId: 'product-missing',
      mockupFrontUrl: 'mockups/missing/front.png',
      mockupBackUrl: 'mockups/missing/back.png',
      productName: 'Missing Product',
    });

    // Should be a failure result
    expect('success' in result).toBe(true);
    const failure = result as { success: false; error: string; productId: string };
    expect(failure.success).toBe(false);
    expect(failure.error).toContain('not found');
    expect(failure.productId).toBe('product-missing');
  });

  it('should call transactWrite for atomic storage (Req 10.4)', async () => {
    const { transactWrite } = await import('../../db/operations.js');

    await generateSocialContent({
      productId: 'product-atomic',
      mockupFrontUrl: 'mockups/product-atomic/front.png',
      mockupBackUrl: 'mockups/product-atomic/back.png',
      productName: 'Atomic Test Product',
    });

    expect(transactWrite).toHaveBeenCalledTimes(1);
  });

  it('should upload both images to S3 before DynamoDB write (Req 10.4)', async () => {
    const { uploadFile } = await import('../../storage/s3-client.js');

    await generateSocialContent({
      productId: 'product-s3',
      mockupFrontUrl: 'mockups/product-s3/front.png',
      mockupBackUrl: 'mockups/product-s3/back.png',
      productName: 'S3 Test Product',
    });

    // Should upload Instagram + Facebook images
    expect(uploadFile).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(uploadFile).mock.calls;
    // First call: Instagram image
    expect(calls[0][1]).toContain('instagram-1080x1080.png');
    expect(calls[0][3]).toBe('image/png');
    // Second call: Facebook image
    expect(calls[1][1]).toContain('facebook-1200x630.png');
    expect(calls[1][3]).toBe('image/png');
  });

  it('should NOT create queue entry on S3 upload failure (Req 10.7)', async () => {
    const { uploadFile } = await import('../../storage/s3-client.js');
    const { transactWrite } = await import('../../db/operations.js');

    vi.mocked(uploadFile).mockRejectedValueOnce(new Error('S3 upload failed'));

    const result = await generateSocialContent({
      productId: 'product-s3-fail',
      mockupFrontUrl: 'mockups/product-s3-fail/front.png',
      mockupBackUrl: 'mockups/product-s3-fail/back.png',
      productName: 'S3 Failure Test',
    });

    // Should return failure
    const failure = result as { success: false; error: string };
    expect(failure.success).toBe(false);
    expect(failure.error).toContain('S3 upload failed');

    // DynamoDB should NOT have been called
    expect(transactWrite).not.toHaveBeenCalled();
  });
});
