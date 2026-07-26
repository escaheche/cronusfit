/**
 * Property-based tests for Social Content Generator (Property 21).
 *
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.6**
 *
 * Property 21: Social Content Format Specification
 * For any published product with valid mockup images, the Social_Content_Generator SHALL produce:
 *   (a) an Instagram image of exactly 1080×1080 pixels at 72 DPI in PNG format with brand overlay
 *   (b) a Facebook image of exactly 1200×630 pixels at 72 DPI in PNG format with brand overlay
 *   (c) a Spanish caption text of at most 2200 characters containing between 5 and 15 hashtags
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import sharp from 'sharp';

import {
  generateInstagramImage,
  generateFacebookImage,
  generateCaption,
  INSTAGRAM_WIDTH,
  INSTAGRAM_HEIGHT,
  FACEBOOK_WIDTH,
  FACEBOOK_HEIGHT,
  TARGET_DPI,
  MAX_CAPTION_LENGTH,
  MIN_HASHTAGS,
  MAX_HASHTAGS,
} from '../../src/modules/social/content-generator.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/storage/s3-client.js', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  getPresignedUrl: vi.fn().mockResolvedValue('https://cdn.example.com/image.png'),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

vi.mock('../../src/db/operations.js', () => ({
  transactWrite: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Creates a test mockup PNG buffer with specified dimensions.
 */
async function createMockupBuffer(width: number, height: number): Promise<Buffer> {
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

/**
 * Creates a test logo PNG buffer with specified size.
 */
async function createLogoBuffer(size: number): Promise<Buffer> {
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
// Generators
// ---------------------------------------------------------------------------

/**
 * Generates a random valid product name (non-empty string, max 100 chars).
 * Excludes '#' characters to avoid false-positive hashtag counts in caption body.
 * (Real product names like "Camiseta Pro" or "Conjunto Galaxy" never start with #)
 */
const productNameArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0 && !s.includes('#'));

/**
 * Generates a random valid mockup dimension pair (width, height) in pixels.
 * Covers portrait, landscape, and square orientations.
 */
const mockupDimArb = fc.record({
  width: fc.integer({ min: 50, max: 500 }),
  height: fc.integer({ min: 50, max: 700 }),
});

/**
 * Generates a random logo size between 32 and 128 pixels.
 */
const logoSizeArb = fc.integer({ min: 32, max: 128 });

// ---------------------------------------------------------------------------
// Property 21a: Instagram image — exactly 1080×1080 PNG at 72 DPI
// ---------------------------------------------------------------------------

describe('Property 21a: Instagram image specification (Req 10.1)', () => {
  it('Instagram image is ALWAYS exactly 1080×1080 pixels, PNG format, 72 DPI — for any valid mockup', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockupDimArb,
        logoSizeArb,
        async ({ width, height }, logoSize) => {
          const mockupBuffer = await createMockupBuffer(width, height);
          const logoBuffer = await createLogoBuffer(logoSize);

          const result = await generateInstagramImage(mockupBuffer, logoBuffer);

          const metadata = await sharp(result).metadata();

          // (a) Exactly 1080×1080 pixels
          expect(metadata.width).toBe(INSTAGRAM_WIDTH);
          expect(metadata.height).toBe(INSTAGRAM_HEIGHT);
          expect(metadata.width).toBe(1080);
          expect(metadata.height).toBe(1080);

          // (a) PNG format
          expect(metadata.format).toBe('png');

          // (a) 72 DPI metadata
          expect(metadata.density).toBe(TARGET_DPI);
          expect(metadata.density).toBe(72);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Instagram image dimensions are invariant regardless of mockup aspect ratio', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Cover portrait, landscape, and extreme aspect ratios
        fc.integer({ min: 30, height: 30, max: 600 } as any),
        fc.integer({ min: 30, max: 800 }),
        async (width: number, height: number) => {
          const mockupBuffer = await createMockupBuffer(width, height);

          const result = await generateInstagramImage(mockupBuffer, null);

          const metadata = await sharp(result).metadata();

          // Always 1080×1080 regardless of input dimensions
          expect(metadata.width).toBe(INSTAGRAM_WIDTH);
          expect(metadata.height).toBe(INSTAGRAM_HEIGHT);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Instagram image with brand overlay (logo != null) meets all specs (Req 10.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockupDimArb,
        fc.integer({ min: 32, max: 200 }),
        async ({ width, height }, logoSize) => {
          const mockupBuffer = await createMockupBuffer(width, height);
          const logoBuffer = await createLogoBuffer(logoSize);

          // With brand overlay
          const withLogo = await generateInstagramImage(mockupBuffer, logoBuffer);
          const withLogoMeta = await sharp(withLogo).metadata();

          // Spec still met with brand overlay
          expect(withLogoMeta.width).toBe(INSTAGRAM_WIDTH);
          expect(withLogoMeta.height).toBe(INSTAGRAM_HEIGHT);
          expect(withLogoMeta.format).toBe('png');
          expect(withLogoMeta.density).toBe(TARGET_DPI);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Instagram image without brand overlay (logo = null) still meets all specs (Req 10.6 fallback)', async () => {
    await fc.assert(
      fc.asyncProperty(mockupDimArb, async ({ width, height }) => {
        const mockupBuffer = await createMockupBuffer(width, height);

        // Branding skipped (logo unavailable — Req 10.6 allows this)
        const result = await generateInstagramImage(mockupBuffer, null);
        const metadata = await sharp(result).metadata();

        expect(metadata.width).toBe(INSTAGRAM_WIDTH);
        expect(metadata.height).toBe(INSTAGRAM_HEIGHT);
        expect(metadata.format).toBe('png');
        expect(metadata.density).toBe(TARGET_DPI);
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21b: Facebook image — exactly 1200×630 PNG at 72 DPI
// ---------------------------------------------------------------------------

describe('Property 21b: Facebook image specification (Req 10.2)', () => {
  it('Facebook image is ALWAYS exactly 1200×630 pixels, PNG format, 72 DPI — for any valid mockup pair', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockupDimArb,
        mockupDimArb,
        logoSizeArb,
        async (frontDim, backDim, logoSize) => {
          const frontBuffer = await createMockupBuffer(frontDim.width, frontDim.height);
          const backBuffer = await createMockupBuffer(backDim.width, backDim.height);
          const logoBuffer = await createLogoBuffer(logoSize);

          const result = await generateFacebookImage(frontBuffer, backBuffer, logoBuffer);

          const metadata = await sharp(result).metadata();

          // (b) Exactly 1200×630 pixels
          expect(metadata.width).toBe(FACEBOOK_WIDTH);
          expect(metadata.height).toBe(FACEBOOK_HEIGHT);
          expect(metadata.width).toBe(1200);
          expect(metadata.height).toBe(630);

          // (b) PNG format
          expect(metadata.format).toBe('png');

          // (b) 72 DPI metadata
          expect(metadata.density).toBe(TARGET_DPI);
          expect(metadata.density).toBe(72);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Facebook image dimensions are invariant regardless of front/back mockup dimensions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 30, max: 600 }),
        fc.integer({ min: 30, max: 800 }),
        fc.integer({ min: 30, max: 600 }),
        fc.integer({ min: 30, max: 800 }),
        async (fw, fh, bw, bh) => {
          const frontBuffer = await createMockupBuffer(fw, fh);
          const backBuffer = await createMockupBuffer(bw, bh);

          const result = await generateFacebookImage(frontBuffer, backBuffer, null);

          const metadata = await sharp(result).metadata();

          // Always 1200×630 regardless of input
          expect(metadata.width).toBe(FACEBOOK_WIDTH);
          expect(metadata.height).toBe(FACEBOOK_HEIGHT);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Facebook image with brand overlay (logo != null) meets all specs (Req 10.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        mockupDimArb,
        fc.integer({ min: 32, max: 150 }),
        async ({ width, height }, logoSize) => {
          const frontBuffer = await createMockupBuffer(width, height);
          const backBuffer = await createMockupBuffer(width, height);
          const logoBuffer = await createLogoBuffer(logoSize);

          const result = await generateFacebookImage(frontBuffer, backBuffer, logoBuffer);
          const metadata = await sharp(result).metadata();

          expect(metadata.width).toBe(FACEBOOK_WIDTH);
          expect(metadata.height).toBe(FACEBOOK_HEIGHT);
          expect(metadata.format).toBe('png');
          expect(metadata.density).toBe(TARGET_DPI);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21c: Spanish caption — ≤2200 chars, 5–15 hashtags
// ---------------------------------------------------------------------------

describe('Property 21c: Spanish caption specification (Req 10.3)', () => {
  it('caption length is always ≤ 2200 characters for any product name', () => {
    fc.assert(
      fc.property(productNameArb, (productName) => {
        const caption = generateCaption(productName);

        // (c) Caption ≤ 2200 characters
        expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
        expect(caption.length).toBeLessThanOrEqual(2200);
      }),
      { numRuns: 100 },
    );
  });

  it('caption always contains between 5 and 15 hashtags (inclusive) for any product name', () => {
    fc.assert(
      fc.property(productNameArb, (productName) => {
        const caption = generateCaption(productName);

        // Count hashtags only in the dedicated hashtag section (last \n\n block)
        // The body may include product names with arbitrary text; hashtags are
        // appended at the end of the caption separated by \n\n
        const parts = caption.split('\n\n');
        const hashtagSection = parts[parts.length - 1] ?? '';
        const hashtags = hashtagSection.match(/#\w+/g) ?? [];

        // (c) Between 5 and 15 hashtags
        expect(hashtags.length).toBeGreaterThanOrEqual(MIN_HASHTAGS);
        expect(hashtags.length).toBeLessThanOrEqual(MAX_HASHTAGS);
        expect(hashtags.length).toBeGreaterThanOrEqual(5);
        expect(hashtags.length).toBeLessThanOrEqual(15);
      }),
      { numRuns: 100 },
    );
  });

  it('caption contains the product name for any product name', () => {
    fc.assert(
      fc.property(productNameArb, (productName) => {
        const caption = generateCaption(productName);

        // Caption includes the product name
        expect(caption).toContain(productName);
      }),
      { numRuns: 100 },
    );
  });

  it('caption length invariant holds for extremely long product names (up to 80 chars)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 50, maxLength: 80 }).filter((s) => s.trim().length >= 50),
        (productName) => {
          const caption = generateCaption(productName);

          // Still within limit even for long product names
          expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('caption hashtag count is always within [MIN_HASHTAGS, MAX_HASHTAGS] bounds — no exceptions', () => {
    fc.assert(
      fc.property(productNameArb, (productName) => {
        const caption = generateCaption(productName);
        // Count only the dedicated hashtag section (last \n\n-separated block)
        const parts = caption.split('\n\n');
        const hashtagSection = parts[parts.length - 1] ?? '';
        const hashtags = hashtagSection.match(/#\w+/g) ?? [];

        // Both lower and upper bounds enforced
        const hasMinHashtags = hashtags.length >= MIN_HASHTAGS;
        const hasMaxHashtags = hashtags.length <= MAX_HASHTAGS;

        expect(hasMinHashtags && hasMaxHashtags).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('caption is non-empty for any non-empty product name', () => {
    fc.assert(
      fc.property(productNameArb, (productName) => {
        const caption = generateCaption(productName);

        expect(caption.length).toBeGreaterThan(0);
        expect(caption.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 21: Combined invariant — all three outputs simultaneously
// ---------------------------------------------------------------------------

describe('Property 21: Combined social content format — all outputs meet spec simultaneously', () => {
  it('for any valid product, Instagram/Facebook images and caption ALL meet their specs at the same time', async () => {
    await fc.assert(
      fc.asyncProperty(
        productNameArb,
        mockupDimArb,
        logoSizeArb,
        async (productName, { width, height }, logoSize) => {
          const frontBuffer = await createMockupBuffer(width, height);
          const backBuffer = await createMockupBuffer(
            Math.max(30, width - 20),
            Math.max(30, height - 20),
          );
          const logoBuffer = await createLogoBuffer(logoSize);

          // Generate all three content types
          const [instagramResult, facebookResult] = await Promise.all([
            generateInstagramImage(frontBuffer, logoBuffer),
            generateFacebookImage(frontBuffer, backBuffer, logoBuffer),
          ]);
          const caption = generateCaption(productName);

          // (a) Instagram: 1080×1080 PNG at 72 DPI
          const igMeta = await sharp(instagramResult).metadata();
          expect(igMeta.width).toBe(INSTAGRAM_WIDTH);
          expect(igMeta.height).toBe(INSTAGRAM_HEIGHT);
          expect(igMeta.format).toBe('png');
          expect(igMeta.density).toBe(TARGET_DPI);

          // (b) Facebook: 1200×630 PNG at 72 DPI
          const fbMeta = await sharp(facebookResult).metadata();
          expect(fbMeta.width).toBe(FACEBOOK_WIDTH);
          expect(fbMeta.height).toBe(FACEBOOK_HEIGHT);
          expect(fbMeta.format).toBe('png');
          expect(fbMeta.density).toBe(TARGET_DPI);

          // (c) Caption: ≤2200 chars, 5–15 hashtags (counted in the hashtag section)
          const parts = caption.split('\n\n');
          const hashtagSection = parts[parts.length - 1] ?? '';
          const hashtags = hashtagSection.match(/#\w+/g) ?? [];
          expect(caption.length).toBeLessThanOrEqual(MAX_CAPTION_LENGTH);
          expect(hashtags.length).toBeGreaterThanOrEqual(MIN_HASHTAGS);
          expect(hashtags.length).toBeLessThanOrEqual(MAX_HASHTAGS);
        },
      ),
      { numRuns: 50 },
    );
  });
});
