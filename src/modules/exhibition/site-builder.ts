/**
 * Site Builder orchestrator for the CronusFit Exhibition Website.
 *
 * Generates a complete static HTML site using Eleventy from published product data.
 * Processes images with sharp (WebP, 80% quality, max 1200px longest side).
 * Tracks changed file paths for differential S3 sync.
 * Aborts build on malformed product data (preserves previous site).
 * Handles zero-published-products case (generates empty state site).
 * Enforces 60-second build timeout.
 *
 * Pipeline:
 * 1. Query DynamoDB for all published products (GSI1PK = 'PUBLISHED#true')
 * 2. Build products.json data file for Eleventy
 * 3. Process product images (resize + WebP)
 * 4. Run Eleventy build programmatically via child_process
 * 5. Collect and return changed file paths for S3 sync
 */

import { exec } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';

import type { PublishedProductRecord } from '../../db/entities.js';
import { queryByGSI1 } from '../../db/operations.js';
import { getPresignedUrl, BUCKETS } from '../../storage/s3-client.js';
import type { BuildError, BuildResult, SiteBuilderConfig } from '../../types/exhibition.js';

/** Default configuration for the Site Builder. */
const DEFAULT_CONFIG: SiteBuilderConfig = {
  outputDir: 'exhibition-site/_site',
  templateDir: 'exhibition-site',
  imageMaxSize: 1200,
  imageQuality: 80,
  maxProducts: 100,
  buildTimeoutMs: 60000,
};

/** Required fields that every published product must have. */
const REQUIRED_PRODUCT_FIELDS = [
  'id',
  'productName',
  'garmentType',
  'ageGroup',
  'availableSizes',
  'frontImageS3Key',
  'backImageS3Key',
] as const;

/**
 * Product data shape expected by the Eleventy templates.
 * This is what gets written to _data/products.json.
 */
export interface EleventyProductData {
  id: string;
  slug: string;
  productName: { es: string; en: string };
  garmentType: string;
  ageGroup: string;
  availableSizes: string[];
  frontImageUrl: string;
  backImageUrl: string;
  publishedAt: string;
  publishedBy: string;
}

/**
 * Fetches all published products from DynamoDB using GSI-1.
 * Paginates through all results (GSI1PK = 'PUBLISHED#true').
 *
 * @returns Array of published product records
 */
export async function fetchPublishedProducts(): Promise<PublishedProductRecord[]> {
  const allProducts: PublishedProductRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await queryByGSI1<PublishedProductRecord>(
      'PUBLISHED#true',
      undefined,
      {
        scanIndexForward: false, // Newest first
        exclusiveStartKey: lastKey,
      }
    );

    allProducts.push(...result.items);
    lastKey = result.lastEvaluatedKey;
  } while (lastKey);

  return allProducts;
}

/**
 * Generates presigned URLs for a product's front and back images.
 * Falls back to a placeholder path if URL generation fails.
 *
 * @param product - The published product record
 * @returns Object with frontImageUrl and backImageUrl
 */
export async function resolveProductImageUrls(
  product: PublishedProductRecord
): Promise<{ frontImageUrl: string; backImageUrl: string }> {
  let frontImageUrl = '/assets/images/logo-cronusfit.png';
  let backImageUrl = '/assets/images/logo-cronusfit.png';

  try {
    frontImageUrl = await getPresignedUrl(BUCKETS.assets, product.frontImageS3Key);
  } catch {
    // Fall back to placeholder
  }

  try {
    backImageUrl = await getPresignedUrl(BUCKETS.assets, product.backImageS3Key);
  } catch {
    // Fall back to placeholder
  }

  return { frontImageUrl, backImageUrl };
}

/**
 * Transforms a PublishedProductRecord into the data shape needed by Eleventy templates.
 *
 * @param product - The published product record from DynamoDB
 * @param imageUrls - Resolved image URLs (presigned or placeholders)
 * @returns The product data formatted for Eleventy
 */
export function toEleventyProductData(
  product: PublishedProductRecord,
  imageUrls: { frontImageUrl: string; backImageUrl: string }
): EleventyProductData {
  // Generate a URL-safe slug from the product ID
  const slug = product.id;

  return {
    id: product.id,
    slug,
    productName: product.productName,
    garmentType: product.garmentType,
    ageGroup: product.ageGroup,
    availableSizes: product.availableSizes,
    frontImageUrl: imageUrls.frontImageUrl,
    backImageUrl: imageUrls.backImageUrl,
    publishedAt: product.publishedAt,
    publishedBy: product.publishedBy,
  };
}

/**
 * Generates the products.json data file for Eleventy from published products.
 * Fetches products from DynamoDB, resolves image URLs, and writes the data file.
 *
 * @param dataDir - Path to the Eleventy _data directory
 * @param products - Array of published product records (if not provided, fetches from DB)
 * @returns Array of product data written to the file
 */
export async function generateProductsDataFile(
  dataDir: string,
  products: PublishedProductRecord[]
): Promise<EleventyProductData[]> {
  const eleventyProducts: EleventyProductData[] = [];

  for (const product of products) {
    const imageUrls = await resolveProductImageUrls(product);
    eleventyProducts.push(toEleventyProductData(product, imageUrls));
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'products.json'),
    JSON.stringify(eleventyProducts, null, 2)
  );

  return eleventyProducts;
}

/**
 * Validates a single product record for required fields and correct types.
 *
 * @param product - The product record to validate
 * @returns An array of BuildError objects (empty if valid)
 */
export function validateProductData(product: unknown): BuildError[] {
  const errors: BuildError[] = [];

  if (!product || typeof product !== 'object') {
    errors.push({
      type: 'data_fetch',
      message: 'Product data is null or not an object',
    });
    return errors;
  }

  const record = product as Record<string, unknown>;
  const productId = typeof record.id === 'string' ? record.id : undefined;

  // Check all required top-level fields are present and non-empty
  for (const field of REQUIRED_PRODUCT_FIELDS) {
    if (field === 'productName') {
      // productName must be an object with at least { es: string }
      if (
        !record.productName ||
        typeof record.productName !== 'object' ||
        typeof (record.productName as Record<string, unknown>).es !== 'string' ||
        (record.productName as Record<string, unknown>).es === ''
      ) {
        errors.push({
          type: 'data_fetch',
          message: `Missing or invalid required field: productName (must have non-empty 'es' property)`,
          productId,
        });
      }
    } else if (field === 'availableSizes') {
      // availableSizes must be a non-empty array
      if (!Array.isArray(record.availableSizes) || record.availableSizes.length === 0) {
        errors.push({
          type: 'data_fetch',
          message: 'Missing or invalid required field: availableSizes (must be a non-empty array)',
          productId,
        });
      }
    } else {
      // String fields: id, garmentType, ageGroup, frontImageS3Key, backImageS3Key
      if (typeof record[field] !== 'string' || record[field] === '') {
        errors.push({
          type: 'data_fetch',
          message: `Missing or invalid required field: ${field}`,
          productId,
        });
      }
    }
  }

  return errors;
}

/**
 * Resizes an image buffer so the longest side does not exceed maxSize pixels,
 * preserving aspect ratio, and converts to WebP format.
 *
 * @param inputBuffer - Raw image data buffer
 * @param maxSize - Maximum pixel dimension for the longest side (default 1200)
 * @param quality - WebP quality percentage 0-100 (default 80)
 * @returns Processed image buffer in WebP format
 */
export async function resizeImage(
  inputBuffer: Buffer,
  maxSize: number = DEFAULT_CONFIG.imageMaxSize,
  quality: number = DEFAULT_CONFIG.imageQuality
): Promise<Buffer> {
  const metadata = await sharp(inputBuffer).metadata();

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  // Calculate target dimensions preserving aspect ratio
  let targetWidth: number | undefined;
  let targetHeight: number | undefined;

  if (width > maxSize || height > maxSize) {
    if (width >= height) {
      targetWidth = maxSize;
      // sharp auto-calculates height to preserve aspect ratio
    } else {
      targetHeight = maxSize;
      // sharp auto-calculates width to preserve aspect ratio
    }
  }
  // If both sides are within limits, no resize needed (just convert format)

  return sharp(inputBuffer)
    .resize(targetWidth, targetHeight, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality })
    .toBuffer();
}

/**
 * Processes a single product image: reads from the source path, resizes,
 * converts to WebP, and writes to the output path.
 *
 * @param sourcePath - Path to the source image file (local filesystem)
 * @param outputPath - Path where the processed WebP image will be written
 * @param config - Site builder configuration
 * @returns The processed image buffer
 */
export async function processImage(
  sourcePath: string,
  outputPath: string,
  config: SiteBuilderConfig = DEFAULT_CONFIG
): Promise<Buffer> {
  const inputBuffer = await fs.readFile(sourcePath);
  const outputBuffer = await resizeImage(inputBuffer, config.imageMaxSize, config.imageQuality);

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, outputBuffer);

  return outputBuffer;
}

/**
 * Computes MD5 hash of file content for change detection.
 */
async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return createHash('md5').update(content).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Recursively walks a directory and collects all file paths.
 */
async function walkDirectory(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await walkDirectory(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // Directory may not exist yet
  }

  return files;
}

/**
 * Builds a snapshot of file hashes for the output directory.
 * Used for differential sync (detecting which files changed).
 */
async function buildHashSnapshot(outputDir: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const files = await walkDirectory(outputDir);

  for (const file of files) {
    const relativePath = path.relative(outputDir, file);
    const hash = await hashFile(file);
    snapshot.set(relativePath, hash);
  }

  return snapshot;
}

/**
 * Compares two hash snapshots and returns the paths that changed (added or modified).
 */
function getChangedPaths(
  before: Map<string, string>,
  after: Map<string, string>
): string[] {
  const changed: string[] = [];

  for (const [filePath, hash] of after) {
    const previousHash = before.get(filePath);
    if (previousHash !== hash) {
      changed.push(filePath);
    }
  }

  return changed;
}

/**
 * Runs Eleventy via child_process with a timeout.
 *
 * @param config - Site builder configuration
 * @param timeoutMs - Maximum time to wait for Eleventy to complete
 * @returns Promise that resolves on success, rejects on failure or timeout
 */
function runEleventy(config: SiteBuilderConfig, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const cmd = `npx @11ty/eleventy --config=${config.templateDir}/.eleventy.cjs`;

    const childProcess = exec(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) {
          reject(new Error(`Build timeout: Eleventy exceeded ${timeoutMs}ms limit`));
        } else {
          reject(new Error(`Eleventy build failed: ${stderr || error.message}`));
        }
        return;
      }
      resolve(stdout);
    });

    // Ensure cleanup on timeout
    setTimeout(() => {
      if (childProcess.exitCode === null) {
        childProcess.kill('SIGTERM');
      }
    }, timeoutMs);
  });
}

/**
 * Builds the CronusFit Exhibition static site from published product data.
 *
 * Orchestrates:
 * 1. Product data validation (aborts on malformed data)
 * 2. Writing products to Eleventy data file
 * 3. Image processing (resize + WebP conversion)
 * 4. Running Eleventy to generate static HTML
 * 5. Tracking changed file paths for differential S3 sync
 *
 * @param products - Array of published product records from DynamoDB
 * @param config - Optional site builder configuration (uses defaults if omitted)
 * @returns Build result with success status, metrics, and changed paths
 */
export async function buildSite(
  products: PublishedProductRecord[],
  config: SiteBuilderConfig = DEFAULT_CONFIG
): Promise<BuildResult> {
  const startTime = Date.now();
  const errors: BuildError[] = [];
  let imagesProcessed = 0;

  // --- Step 1: Validate all product data ---
  // If any product is malformed, abort the entire build
  for (const product of products) {
    const productErrors = validateProductData(product);
    if (productErrors.length > 0) {
      errors.push(...productErrors);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      pagesGenerated: 0,
      imagesProcessed: 0,
      cssSize: 0,
      buildDurationMs: Date.now() - startTime,
      changedPaths: [],
      errors,
    };
  }

  // --- Step 2: Handle zero products case (empty state site) ---
  // Not an error — generate site with empty product data
  const dataDir = path.join(config.templateDir, '_data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'products.json'),
    JSON.stringify(products, null, 2)
  );

  // --- Step 3: Snapshot previous build for differential detection ---
  const beforeSnapshot = await buildHashSnapshot(config.outputDir);

  // --- Step 4: Process images ---
  const imageOutputDir = path.join(config.outputDir, 'assets', 'images', 'products');
  await fs.mkdir(imageOutputDir, { recursive: true });

  for (const product of products) {
    try {
      // Process front image
      const frontSourcePath = product.frontImageS3Key;
      const frontOutputPath = path.join(imageOutputDir, `${product.id}-front.webp`);

      try {
        await processImage(frontSourcePath, frontOutputPath, config);
        imagesProcessed++;
      } catch (err) {
        errors.push({
          type: 'image_process',
          message: `Failed to process front image: ${err instanceof Error ? err.message : String(err)}`,
          productId: product.id,
        });
      }

      // Process back image
      const backSourcePath = product.backImageS3Key;
      const backOutputPath = path.join(imageOutputDir, `${product.id}-back.webp`);

      try {
        await processImage(backSourcePath, backOutputPath, config);
        imagesProcessed++;
      } catch (err) {
        errors.push({
          type: 'image_process',
          message: `Failed to process back image: ${err instanceof Error ? err.message : String(err)}`,
          productId: product.id,
        });
      }
    } catch (err) {
      errors.push({
        type: 'image_process',
        message: `Unexpected error processing images for product: ${err instanceof Error ? err.message : String(err)}`,
        productId: product.id,
      });
    }
  }

  // Image processing errors are non-fatal for validation but still tracked
  // Only data_fetch errors cause full abort (handled above)

  // --- Step 5: Run Eleventy with timeout enforcement ---
  const elapsedSoFar = Date.now() - startTime;
  const remainingTimeout = Math.max(0, config.buildTimeoutMs - elapsedSoFar);

  if (remainingTimeout <= 0) {
    return {
      success: false,
      pagesGenerated: 0,
      imagesProcessed,
      cssSize: 0,
      buildDurationMs: Date.now() - startTime,
      changedPaths: [],
      errors: [
        {
          type: 'template_render',
          message: `Build timeout exceeded: ${config.buildTimeoutMs}ms limit reached before Eleventy invocation`,
        },
      ],
    };
  }

  try {
    await runEleventy(config, remainingTimeout);
  } catch (err) {
    return {
      success: false,
      pagesGenerated: 0,
      imagesProcessed,
      cssSize: 0,
      buildDurationMs: Date.now() - startTime,
      changedPaths: [],
      errors: [
        {
          type: 'template_render',
          message: err instanceof Error ? err.message : String(err),
        },
      ],
    };
  }

  // --- Step 6: Calculate changed paths for differential S3 sync ---
  const afterSnapshot = await buildHashSnapshot(config.outputDir);
  const changedPaths = getChangedPaths(beforeSnapshot, afterSnapshot);

  // --- Step 7: Calculate pages generated and CSS size ---
  let pagesGenerated = 0;
  let cssSize = 0;

  for (const [filePath] of afterSnapshot) {
    if (filePath.endsWith('.html')) {
      pagesGenerated++;
    }
    if (filePath.endsWith('.css')) {
      try {
        const cssPath = path.join(config.outputDir, filePath);
        const stat = await fs.stat(cssPath);
        cssSize += stat.size;
      } catch {
        // Ignore stat errors
      }
    }
  }

  const buildDurationMs = Date.now() - startTime;

  // Check if we exceeded the timeout during post-processing
  if (buildDurationMs > config.buildTimeoutMs) {
    return {
      success: false,
      pagesGenerated,
      imagesProcessed,
      cssSize,
      buildDurationMs,
      changedPaths: [],
      errors: [
        {
          type: 'template_render',
          message: `Build exceeded ${config.buildTimeoutMs}ms timeout (actual: ${buildDurationMs}ms)`,
        },
      ],
    };
  }

  return {
    success: true,
    pagesGenerated,
    imagesProcessed,
    cssSize,
    buildDurationMs,
    changedPaths,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Full site generation pipeline: fetches products from DynamoDB and builds the site.
 *
 * This is the top-level entry point used by the site-rebuild Lambda.
 * It orchestrates the complete workflow:
 * 1. Fetch all published products from DynamoDB
 * 2. Validate product data
 * 3. Generate products.json for Eleventy
 * 4. Process images
 * 5. Run Eleventy build
 * 6. Return changed paths for S3 upload and CloudFront invalidation
 *
 * @param config - Optional site builder configuration (uses defaults if omitted)
 * @returns Build result with success status, metrics, and changed paths
 */
export async function runBuildPipeline(
  config: SiteBuilderConfig = DEFAULT_CONFIG
): Promise<BuildResult> {
  try {
    const products = await fetchPublishedProducts();
    return buildSite(products, config);
  } catch (err) {
    return {
      success: false,
      pagesGenerated: 0,
      imagesProcessed: 0,
      cssSize: 0,
      buildDurationMs: 0,
      changedPaths: [],
      errors: [
        {
          type: 'data_fetch',
          message: `Failed to fetch published products: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}
