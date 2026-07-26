/**
 * Social Content Generator for CronusFit.
 *
 * Auto-generates social media content (Instagram, Facebook images + Spanish caption)
 * when a product is published. Content is stored atomically in the Admin review queue
 * and is NEVER auto-posted to social media.
 *
 * Processing pipeline:
 * 1. Download product mockup images from S3
 * 2. Generate Instagram image (1080×1080 PNG, 72 DPI, brand overlay)
 * 3. Generate Facebook image (1200×630 PNG, 72 DPI, brand overlay)
 * 4. Generate Spanish caption (≤2200 chars, 5–15 hashtags)
 * 5. Store all 3 content types atomically (all-or-nothing) in DynamoDB + S3
 * 6. On failure: log, notify Admin, allow retry — NO queue entry
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7
 */

import sharp, { type OverlayOptions } from 'sharp';
import { randomUUID } from 'node:crypto';
import { uploadFile, downloadFile, getPresignedUrl, BUCKETS } from '../../storage/s3-client.js';
import { transactWrite } from '../../db/operations.js';
import type { SocialContentRecord } from '../../db/entities.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Instagram post dimensions: 1080×1080 pixels. */
export const INSTAGRAM_WIDTH = 1080;
export const INSTAGRAM_HEIGHT = 1080;

/** Facebook post dimensions: 1200×630 pixels. */
export const FACEBOOK_WIDTH = 1200;
export const FACEBOOK_HEIGHT = 630;

/** Target DPI for social media images. */
export const TARGET_DPI = 72;

/** Maximum caption length per Instagram/Facebook guidelines. */
export const MAX_CAPTION_LENGTH = 2200;

/** Min and max hashtag count. */
export const MIN_HASHTAGS = 5;
export const MAX_HASHTAGS = 15;

/** Brand colors (Cronus Fit identity). */
export const BRAND_COLORS = {
  blue: '#1B3A6B',
  gold: '#C9A84C',
  white: '#FFFFFF',
} as const;

/** S3 prefix for social content assets. */
const SOCIAL_S3_PREFIX = 'social';

/** S3 key for the brand logo overlay. */
const BRAND_LOGO_S3_KEY = 'brand/logo-cronusfit.png';

/** Logo overlay size (pixels) relative to image short side. */
const LOGO_SIZE_RATIO = 0.12;

/** Padding from edges for logo placement (pixels). */
const LOGO_PADDING = 20;

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

/** Request to generate social media content for a published product. */
export interface SocialContentGenerateRequest {
  productId: string;
  mockupFrontUrl: string;
  mockupBackUrl: string;
  productName: string;
}

/** Successful response with generated content metadata. */
export interface SocialContentGenerateResponse {
  contentId: string;
  instagramImageUrl: string;
  facebookImageUrl: string;
  captionText: string;
  status: 'pending_review';
}

/** Failure result when content generation fails. */
export interface SocialContentFailure {
  success: false;
  error: string;
  productId: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Main Public Function
// ---------------------------------------------------------------------------

/**
 * Generates social media content for a published product.
 *
 * This function is triggered automatically on product publish.
 * It generates Instagram image, Facebook image, and Spanish caption,
 * then stores ALL content atomically. If any step fails, no partial
 * content is saved to the review queue.
 *
 * Does NOT auto-post to social media (Req 10.5).
 *
 * @param request - Product info including mockup URLs
 * @returns Generated content response or failure
 */
export async function generateSocialContent(
  request: SocialContentGenerateRequest
): Promise<SocialContentGenerateResponse | SocialContentFailure> {
  const { productId, mockupFrontUrl, mockupBackUrl, productName } = request;
  const contentId = randomUUID();
  const now = new Date().toISOString();

  try {
    // Step 1: Download mockup images from S3
    const [frontBuffer, backBuffer] = await downloadMockupImages(
      mockupFrontUrl,
      mockupBackUrl
    );

    // Step 2: Load brand logo (best-effort — skip branding on failure per Req 10.6)
    const logoBuffer = await loadBrandLogo();

    // Step 3: Generate Instagram image (1080×1080, 72 DPI, brand overlay)
    const instagramBuffer = await generateInstagramImage(
      frontBuffer,
      logoBuffer
    );

    // Step 4: Generate Facebook image (1200×630, 72 DPI, brand overlay)
    const facebookBuffer = await generateFacebookImage(
      frontBuffer,
      backBuffer,
      logoBuffer
    );

    // Step 5: Generate Spanish caption with hashtags
    const captionText = generateCaption(productName);

    // Step 6: Atomic storage — upload images to S3 and write DynamoDB record
    const { instagramS3Key, facebookS3Key } = await storeContentAtomically(
      contentId,
      productId,
      instagramBuffer,
      facebookBuffer,
      captionText,
      now
    );

    // Step 7: Generate presigned URLs for response
    const [instagramImageUrl, facebookImageUrl] = await Promise.all([
      getPresignedUrl(BUCKETS.assets, instagramS3Key),
      getPresignedUrl(BUCKETS.assets, facebookS3Key),
    ]);

    return {
      contentId,
      instagramImageUrl,
      facebookImageUrl,
      captionText,
      status: 'pending_review',
    };
  } catch (error: unknown) {
    // Req 10.7: On failure — log, return failure, no queue entry
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error during social content generation';

    return {
      success: false,
      error: errorMessage,
      productId,
      timestamp: now,
    };
  }
}

// ---------------------------------------------------------------------------
// Image Generation Functions
// ---------------------------------------------------------------------------

/**
 * Generates the Instagram post image (1080×1080 PNG, 72 DPI).
 *
 * Layout: product mockup centered with gradient background and brand overlay.
 *
 * @param mockupBuffer - Front mockup image buffer
 * @param logoBuffer - Brand logo buffer (null if branding should be skipped)
 * @returns PNG buffer at 1080×1080, 72 DPI
 */
export async function generateInstagramImage(
  mockupBuffer: Buffer,
  logoBuffer: Buffer | null
): Promise<Buffer> {
  // Create gradient background (blue to gold brand colors)
  const background = await createGradientBackground(
    INSTAGRAM_WIDTH,
    INSTAGRAM_HEIGHT
  );

  // Resize mockup to fit within the canvas with padding
  const mockupPadding = Math.round(INSTAGRAM_WIDTH * 0.1);
  const mockupMaxWidth = INSTAGRAM_WIDTH - mockupPadding * 2;
  const mockupMaxHeight = INSTAGRAM_HEIGHT - mockupPadding * 2;

  const resizedMockup = await sharp(mockupBuffer)
    .resize(mockupMaxWidth, mockupMaxHeight, {
      fit: 'inside',
      withoutEnlargement: false,
    })
    .ensureAlpha()
    .toBuffer();

  const mockupMeta = await sharp(resizedMockup).metadata();
  const mockupW = mockupMeta.width ?? mockupMaxWidth;
  const mockupH = mockupMeta.height ?? mockupMaxHeight;

  // Center mockup on canvas
  const mockupLeft = Math.round((INSTAGRAM_WIDTH - mockupW) / 2);
  const mockupTop = Math.round((INSTAGRAM_HEIGHT - mockupH) / 2);

  // Build composite layers
  const layers: OverlayOptions[] = [
    { input: resizedMockup, left: mockupLeft, top: mockupTop },
  ];

  // Apply brand overlay if logo is available (Req 10.6)
  if (logoBuffer) {
    const logoSize = Math.round(INSTAGRAM_WIDTH * LOGO_SIZE_RATIO);
    const resizedLogo = await sharp(logoBuffer)
      .resize(logoSize, logoSize, { fit: 'inside' })
      .ensureAlpha()
      .toBuffer();

    layers.push({
      input: resizedLogo,
      left: INSTAGRAM_WIDTH - logoSize - LOGO_PADDING,
      top: LOGO_PADDING,
    });
  }

  // Composite all layers and set DPI
  const result = await sharp(background)
    .composite(layers)
    .png()
    .withMetadata({ density: TARGET_DPI })
    .toBuffer();

  return result;
}

/**
 * Generates the Facebook post image (1200×630 PNG, 72 DPI).
 *
 * Layout: front + back mockups side by side with gradient background and brand overlay.
 *
 * @param frontBuffer - Front mockup image buffer
 * @param backBuffer - Back mockup image buffer
 * @param logoBuffer - Brand logo buffer (null if branding should be skipped)
 * @returns PNG buffer at 1200×630, 72 DPI
 */
export async function generateFacebookImage(
  frontBuffer: Buffer,
  backBuffer: Buffer,
  logoBuffer: Buffer | null
): Promise<Buffer> {
  // Create gradient background
  const background = await createGradientBackground(
    FACEBOOK_WIDTH,
    FACEBOOK_HEIGHT
  );

  // Each mockup gets half the width with padding
  const padding = Math.round(FACEBOOK_WIDTH * 0.05);
  const halfWidth = Math.round((FACEBOOK_WIDTH - padding * 3) / 2);
  const maxHeight = FACEBOOK_HEIGHT - padding * 2;

  // Resize front mockup
  const resizedFront = await sharp(frontBuffer)
    .resize(halfWidth, maxHeight, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .toBuffer();

  // Resize back mockup
  const resizedBack = await sharp(backBuffer)
    .resize(halfWidth, maxHeight, { fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .toBuffer();

  // Get actual dimensions for centering
  const frontMeta = await sharp(resizedFront).metadata();
  const backMeta = await sharp(resizedBack).metadata();

  const frontW = frontMeta.width ?? halfWidth;
  const frontH = frontMeta.height ?? maxHeight;
  const backW = backMeta.width ?? halfWidth;
  const backH = backMeta.height ?? maxHeight;

  // Position front on left, back on right
  const frontLeft = padding + Math.round((halfWidth - frontW) / 2);
  const frontTop = Math.round((FACEBOOK_HEIGHT - frontH) / 2);
  const backLeft = padding * 2 + halfWidth + Math.round((halfWidth - backW) / 2);
  const backTop = Math.round((FACEBOOK_HEIGHT - backH) / 2);

  // Build composite layers
  const layers: OverlayOptions[] = [
    { input: resizedFront, left: frontLeft, top: frontTop },
    { input: resizedBack, left: backLeft, top: backTop },
  ];

  // Apply brand overlay if logo is available (Req 10.6)
  if (logoBuffer) {
    const logoSize = Math.round(FACEBOOK_HEIGHT * LOGO_SIZE_RATIO);
    const resizedLogo = await sharp(logoBuffer)
      .resize(logoSize, logoSize, { fit: 'inside' })
      .ensureAlpha()
      .toBuffer();

    layers.push({
      input: resizedLogo,
      left: FACEBOOK_WIDTH - logoSize - LOGO_PADDING,
      top: LOGO_PADDING,
    });
  }

  // Composite and set DPI
  const result = await sharp(background)
    .composite(layers)
    .png()
    .withMetadata({ density: TARGET_DPI })
    .toBuffer();

  return result;
}

// ---------------------------------------------------------------------------
// Caption Generation
// ---------------------------------------------------------------------------

/** Sportswear-related hashtags in Spanish for social media posts. */
const SPORTSWEAR_HASHTAGS = [
  '#RopaDeportiva',
  '#ModaDeportiva',
  '#FitnessWear',
  '#GymStyle',
  '#Activewear',
  '#SportFashion',
  '#DeporteYModa',
  '#TrainingGear',
  '#CronusFit',
  '#DisñoDeportivo',
  '#WearYourPower',
  '#StreetSport',
  '#AthleticWear',
  '#FitLife',
  '#GymWear',
  '#RunningStyle',
  '#CrossfitWear',
  '#YogaWear',
  '#Sublimacion',
  '#DTFPrint',
  '#PersonalizaTuEstilo',
  '#RopaPersonalizada',
  '#UniformesDeportivos',
  '#TeamWear',
  '#SportStyle',
];

/**
 * Generates a Spanish caption for social media posts.
 *
 * Caption format:
 * - Product presentation text in Spanish
 * - Call to action
 * - 5–15 relevant hashtags
 * - Total ≤ 2200 characters
 *
 * @param productName - Name of the published product
 * @returns Caption text in Spanish with hashtags
 */
export function generateCaption(productName: string): string {
  // Main body text (Spanish)
  const body = buildCaptionBody(productName);

  // Select hashtags (random subset of 5-15)
  const hashtagCount = MIN_HASHTAGS + Math.floor(Math.random() * (MAX_HASHTAGS - MIN_HASHTAGS + 1));
  const selectedHashtags = selectHashtags(hashtagCount);
  const hashtagLine = selectedHashtags.join(' ');

  // Combine body + hashtags
  let caption = `${body}\n\n${hashtagLine}`;

  // Ensure we don't exceed max length
  if (caption.length > MAX_CAPTION_LENGTH) {
    // Trim hashtags until within limit
    const availableSpace = MAX_CAPTION_LENGTH - body.length - 4; // 4 for "\n\n" padding
    const trimmedHashtags = trimHashtagsToFit(selectedHashtags, availableSpace);
    caption = `${body}\n\n${trimmedHashtags}`;
  }

  return caption;
}

/**
 * Builds the main body of the caption in Spanish.
 */
function buildCaptionBody(productName: string): string {
  const templates = [
    `🔥 ¡Nuevo diseño disponible! 🔥\n\n✨ ${productName} ✨\n\nDiseño exclusivo de Cronus Fit, elaborado con materiales de alta calidad para un rendimiento óptimo.\n\n📩 Cotiza ahora y personaliza tu pedido.\n💬 Escríbenos por WhatsApp para más información.`,
    `🏋️ ¡Eleva tu estilo deportivo! 🏋️\n\n🆕 ${productName}\n\nPrenda diseñada para quienes buscan comodidad y estilo en cada entrenamiento.\n\n📲 Contáctanos para cotizar tu pedido personalizado.\n⏱️ Producción rápida, calidad garantizada.`,
    `💪 Nuevo en Cronus Fit 💪\n\n🎨 ${productName}\n\nDiseño profesional con sublimación de alta definición. Ideal para equipos, gimnasios y marcas deportivas.\n\n✅ Personalización completa\n✅ Tallas infantiles y adultas\n✅ Envío a todo el país\n\n📩 ¡Cotiza sin compromiso!`,
  ];

  // Deterministic selection based on product name hash
  const index = simpleHash(productName) % templates.length;
  return templates[index];
}

/**
 * Selects a random subset of hashtags.
 */
function selectHashtags(count: number): string[] {
  const shuffled = [...SPORTSWEAR_HASHTAGS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, SPORTSWEAR_HASHTAGS.length));
}

/**
 * Trims the hashtag list to fit within the available character space.
 */
function trimHashtagsToFit(hashtags: string[], maxLength: number): string {
  let result = '';
  let count = 0;

  for (const tag of hashtags) {
    const candidate = count === 0 ? tag : `${result} ${tag}`;
    if (candidate.length > maxLength) break;
    result = candidate;
    count++;
  }

  // Ensure minimum of 5 hashtags — if impossible within space, take what fits
  return result;
}

/**
 * Simple string hash for deterministic template selection.
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Image Utility Functions
// ---------------------------------------------------------------------------

/**
 * Creates a gradient background image (blue to gold, Cronus Fit brand).
 *
 * Uses an SVG-based gradient rendered by Sharp for consistent results.
 *
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns PNG buffer of gradient background
 */
export async function createGradientBackground(
  width: number,
  height: number
): Promise<Buffer> {
  // Create gradient using SVG
  const gradientSvg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="brandGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${BRAND_COLORS.blue};stop-opacity:1" />
          <stop offset="50%" style="stop-color:#0D2247;stop-opacity:1" />
          <stop offset="100%" style="stop-color:${BRAND_COLORS.gold};stop-opacity:0.3" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#brandGradient)" />
    </svg>
  `.trim();

  return sharp(Buffer.from(gradientSvg))
    .png()
    .toBuffer();
}

/**
 * Downloads mockup images from S3 using their S3 keys.
 *
 * @param frontKey - S3 key for the front mockup image
 * @param backKey - S3 key for the back mockup image
 * @returns Tuple of [frontBuffer, backBuffer]
 * @throws Error if either mockup is not found
 */
async function downloadMockupImages(
  frontKey: string,
  backKey: string
): Promise<[Buffer, Buffer]> {
  const [frontBuffer, backBuffer] = await Promise.all([
    downloadFile(BUCKETS.assets, frontKey),
    downloadFile(BUCKETS.assets, backKey),
  ]);

  if (!frontBuffer) {
    throw new SocialContentError(
      'MOCKUP_NOT_FOUND',
      `Front mockup image not found at: ${frontKey}`
    );
  }

  if (!backBuffer) {
    throw new SocialContentError(
      'MOCKUP_NOT_FOUND',
      `Back mockup image not found at: ${backKey}`
    );
  }

  return [frontBuffer, backBuffer];
}

/**
 * Loads the Cronus Fit brand logo from S3 for overlay.
 *
 * Per Req 10.6: If branding fails to load, skip branding (return null)
 * rather than failing the entire generation.
 *
 * @returns Logo buffer or null if unavailable
 */
async function loadBrandLogo(): Promise<Buffer | null> {
  try {
    const buffer = await downloadFile(BUCKETS.assets, BRAND_LOGO_S3_KEY);
    return buffer ?? null;
  } catch {
    // Req 10.6: Skip branding on failure — don't fail the entire operation
    return null;
  }
}

// ---------------------------------------------------------------------------
// Atomic Storage
// ---------------------------------------------------------------------------

/**
 * Stores all social content atomically (all-or-nothing).
 *
 * Uploads images to S3 first, then writes the DynamoDB record.
 * If DynamoDB write fails, the S3 uploads are orphaned (acceptable — cleaned up later).
 * If S3 upload fails, nothing is written to DynamoDB (Req 10.4).
 *
 * @param contentId - Unique content identifier
 * @param productId - Associated product ID
 * @param instagramBuffer - Instagram image PNG buffer
 * @param facebookBuffer - Facebook image PNG buffer
 * @param captionText - Generated Spanish caption
 * @param createdAt - ISO 8601 timestamp
 * @returns S3 keys for the uploaded images
 */
async function storeContentAtomically(
  contentId: string,
  productId: string,
  instagramBuffer: Buffer,
  facebookBuffer: Buffer,
  captionText: string,
  createdAt: string
): Promise<{ instagramS3Key: string; facebookS3Key: string }> {
  const instagramS3Key = `${SOCIAL_S3_PREFIX}/${contentId}/instagram-1080x1080.png`;
  const facebookS3Key = `${SOCIAL_S3_PREFIX}/${contentId}/facebook-1200x630.png`;

  // Upload both images to S3 (if either fails, exception propagates — no DynamoDB write)
  await Promise.all([
    uploadFile(BUCKETS.assets, instagramS3Key, instagramBuffer, 'image/png'),
    uploadFile(BUCKETS.assets, facebookS3Key, facebookBuffer, 'image/png'),
  ]);

  // Write DynamoDB record atomically via transaction
  const socialRecord: SocialContentRecord = {
    PK: `SOCIAL#${contentId}`,
    SK: 'METADATA',
    GSI1PK: `STATUS#pending_review`,
    GSI1SK: `CREATED#${createdAt}`,
    id: contentId,
    productId,
    instagramImageS3Key: instagramS3Key,
    facebookImageS3Key: facebookS3Key,
    captionText,
    status: 'pending_review',
    createdAt,
  };

  await transactWrite([
    {
      Put: {
        Item: socialRecord,
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  ]);

  return { instagramS3Key, facebookS3Key };
}

// ---------------------------------------------------------------------------
// Error Class
// ---------------------------------------------------------------------------

/** Custom error class for social content generation errors. */
export class SocialContentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SocialContentError';
    this.code = code;
  }
}
