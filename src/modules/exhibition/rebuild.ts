/**
 * Site rebuild pipeline for the CronusFit Exhibition Website.
 *
 * Manages the rebuild queue and orchestrates the full rebuild workflow:
 * 1. Dequeue pending rebuild requests (FIFO)
 * 2. Build static site via site-builder (Eleventy)
 * 3. Upload generated HTML/assets to S3 website bucket
 * 4. Invalidate CloudFront cache for changed paths
 * 5. Complete within 5 minutes of publish/unpublish action (Req 6.2, 6.3)
 *
 * Queue behavior:
 * - If a rebuild is already in progress, new requests are queued (Req 6.2, 6.3)
 * - Queue is processed sequentially (one rebuild at a time)
 * - Debounce window prevents rapid successive rebuilds
 *
 * Validates: Requirements 6.2, 6.3
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';

import {
  enqueueRebuild as dbEnqueueRebuild,
  dequeueNextRebuild,
  getRebuildQueueDepth,
  updateRebuildStatus,
} from '../../db/operations.js';
import { buildSite, fetchPublishedProducts } from './site-builder.js';
import { selectStrategy } from './cache-invalidation.js';
import type {
  RebuildRequest,
  RebuildQueueConfig,
  RebuildStatus,
  BuildResult,
} from '../../types/exhibition.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default configuration for the rebuild queue. */
const DEFAULT_CONFIG: RebuildQueueConfig = {
  maxQueueDepth: 10,
  debounceWindowMs: 60_000,
  retryDelayMs: 30_000,
  maxRetries: 1,
};

/** S3 website bucket for static content. */
const S3_WEBSITE_BUCKET = process.env.S3_WEBSITE_BUCKET ?? 'cronusfit-website';

/** CloudFront distribution ID for cache invalidation. */
const CLOUDFRONT_DISTRIBUTION_ID = process.env.CLOUDFRONT_DISTRIBUTION_ID ?? '';

/** Output directory where Eleventy builds static files. */
const OUTPUT_DIR = process.env.SITE_OUTPUT_DIR ?? 'exhibition-site/_site';

/** AWS SDK clients (reused for Lambda warm starts). */
const s3Client = new S3Client({});
const cloudFrontClient = new CloudFrontClient({});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Tracks the timestamp of the last completed rebuild.
 * Used to enforce the debounce window between sequential rebuilds.
 */
let lastCompletedRebuildAt: number = 0;

// ---------------------------------------------------------------------------
// Queue Management
// ---------------------------------------------------------------------------

/**
 * Enqueues a rebuild request after checking queue depth constraints.
 *
 * - Checks current queue depth against maxQueueDepth (10)
 * - If queue is full, rejects the request
 * - Otherwise, stores the request in DynamoDB with 1-hour TTL and
 *   creates an initial "queued" status record
 *
 * @param request - The rebuild request to enqueue
 * @param config - Optional queue configuration override
 * @returns Whether the request was queued and its position
 */
export async function enqueueRebuild(
  request: RebuildRequest,
  config: RebuildQueueConfig = DEFAULT_CONFIG
): Promise<{ queued: boolean; position: number }> {
  const currentDepth = await getRebuildQueueDepth();

  if (currentDepth >= config.maxQueueDepth) {
    return { queued: false, position: 0 };
  }

  // Store in DynamoDB queue (1-hour TTL is handled by db/operations)
  await dbEnqueueRebuild({
    rebuildId: request.rebuildId,
    triggeredBy: request.triggeredBy,
    reason: request.reason,
    createdAt: request.triggeredAt,
  });

  // Create initial status record
  await updateRebuildStatus(request.rebuildId, {
    status: 'queued',
    retryCount: 0,
  });

  return { queued: true, position: currentDepth + 1 };
}

/**
 * Processes the next rebuild from the queue.
 *
 * - Dequeues the oldest pending rebuild
 * - Enforces the 60-second debounce window since the last completed rebuild
 * - Updates the rebuild status to "in_progress"
 *
 * @param config - Optional queue configuration override
 * @returns The rebuild status, or a status indicating no work available
 */
export async function processNextRebuild(
  config: RebuildQueueConfig = DEFAULT_CONFIG
): Promise<RebuildStatus> {
  const item = await dequeueNextRebuild();

  if (!item) {
    return {
      rebuildId: '',
      status: 'completed',
      retryCount: 0,
    };
  }

  // Enforce debounce window: wait if last rebuild completed too recently
  const now = Date.now();
  const timeSinceLastRebuild = now - lastCompletedRebuildAt;

  if (timeSinceLastRebuild < config.debounceWindowMs) {
    const waitMs = config.debounceWindowMs - timeSinceLastRebuild;
    await delay(waitMs);
  }

  // Mark as in_progress
  const startedAt = new Date().toISOString();
  await updateRebuildStatus(item.rebuildId, {
    status: 'in_progress',
    startedAt,
  });

  return {
    rebuildId: item.rebuildId,
    status: 'in_progress',
    startedAt,
    retryCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Full Rebuild Pipeline
// ---------------------------------------------------------------------------

/** Result of a complete rebuild pipeline execution. */
export interface RebuildPipelineResult {
  /** Whether the full pipeline succeeded. */
  success: boolean;
  /** Rebuild ID from the queue. */
  rebuildId: string;
  /** Number of pages generated during build. */
  pagesGenerated: number;
  /** Number of files uploaded to S3. */
  filesUploaded: number;
  /** Whether CloudFront cache was invalidated. */
  cacheInvalidated: boolean;
  /** Total pipeline duration in milliseconds. */
  durationMs: number;
  /** Error message if the pipeline failed. */
  error?: string;
}

/**
 * Executes the full rebuild pipeline:
 * 1. Dequeue next rebuild from the queue
 * 2. Build static site from published products
 * 3. Upload changed files to S3
 * 4. Invalidate CloudFront cache
 * 5. Mark rebuild as completed
 *
 * Target: complete within 5 minutes (Req 6.2, 6.3).
 *
 * @param config - Optional queue configuration override
 * @returns Pipeline result with success status and metrics
 */
export async function runRebuildPipeline(
  config: RebuildQueueConfig = DEFAULT_CONFIG
): Promise<RebuildPipelineResult> {
  const startTime = Date.now();

  // Step 1: Dequeue
  const rebuildStatus = await processNextRebuild(config);

  if (!rebuildStatus.rebuildId) {
    return {
      success: true,
      rebuildId: '',
      pagesGenerated: 0,
      filesUploaded: 0,
      cacheInvalidated: false,
      durationMs: Date.now() - startTime,
    };
  }

  const { rebuildId } = rebuildStatus;

  try {
    // Step 2: Build static site
    const products = await fetchPublishedProducts();
    const buildResult = await buildSite(products);

    if (!buildResult.success) {
      const errorMsg = buildResult.errors?.map((e) => e.message).join('; ') ?? 'Unknown build error';
      await markRebuildFailed(rebuildId, errorMsg, 0);
      return {
        success: false,
        rebuildId,
        pagesGenerated: 0,
        filesUploaded: 0,
        cacheInvalidated: false,
        durationMs: Date.now() - startTime,
        error: errorMsg,
      };
    }

    // Step 3: Upload changed files to S3
    const filesUploaded = await uploadToS3(buildResult.changedPaths);

    // Step 4: Invalidate CloudFront cache
    let cacheInvalidated = false;
    if (buildResult.changedPaths.length > 0 && CLOUDFRONT_DISTRIBUTION_ID) {
      cacheInvalidated = await invalidateCloudFrontCache(buildResult.changedPaths);
    }

    // Step 5: Mark rebuild as completed
    await markRebuildCompleted(rebuildId);

    return {
      success: true,
      rebuildId,
      pagesGenerated: buildResult.pagesGenerated,
      filesUploaded,
      cacheInvalidated,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await markRebuildFailed(rebuildId, errorMsg, 0);

    return {
      success: false,
      rebuildId,
      pagesGenerated: 0,
      filesUploaded: 0,
      cacheInvalidated: false,
      durationMs: Date.now() - startTime,
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// S3 Upload
// ---------------------------------------------------------------------------

/**
 * Uploads changed files from the build output to the S3 website bucket.
 * Uses differential sync — only uploads files that changed.
 *
 * @param changedPaths - Relative paths of files that changed during the build
 * @returns Number of files successfully uploaded
 */
export async function uploadToS3(changedPaths: string[]): Promise<number> {
  if (changedPaths.length === 0) return 0;

  let uploadCount = 0;

  const uploadPromises = changedPaths.map(async (relativePath) => {
    const filePath = path.join(OUTPUT_DIR, relativePath);

    try {
      const content = await fs.readFile(filePath);
      const contentType = getContentType(relativePath);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_WEBSITE_BUCKET,
          Key: relativePath,
          Body: content,
          ContentType: contentType,
          CacheControl: getCacheControl(relativePath),
        })
      );

      uploadCount++;
    } catch (error) {
      console.error(`Failed to upload ${relativePath}:`, error);
      // Non-fatal: continue with remaining files
    }
  });

  await Promise.all(uploadPromises);
  return uploadCount;
}

// ---------------------------------------------------------------------------
// CloudFront Invalidation
// ---------------------------------------------------------------------------

/**
 * Invalidates CloudFront cache for the given changed paths.
 *
 * Strategy (from cache-invalidation module):
 * - ≤15 paths: invalidate individual paths
 * - >15 paths: wildcard invalidation (/*)
 *
 * @param changedPaths - Relative paths that changed
 * @returns Whether the invalidation was successful
 */
export async function invalidateCloudFrontCache(changedPaths: string[]): Promise<boolean> {
  if (!CLOUDFRONT_DISTRIBUTION_ID || changedPaths.length === 0) return false;

  const strategy = selectStrategy(changedPaths);

  const invalidationPaths =
    strategy === 'wildcard'
      ? ['/*']
      : changedPaths.map((p) => (p.startsWith('/') ? p : `/${p}`));

  try {
    const callerReference = `cronusfit-rebuild-${Date.now()}`;

    await cloudFrontClient.send(
      new CreateInvalidationCommand({
        DistributionId: CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
          CallerReference: callerReference,
          Paths: {
            Quantity: invalidationPaths.length,
            Items: invalidationPaths,
          },
        },
      })
    );

    return true;
  } catch (error) {
    console.error('CloudFront invalidation failed:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Status Management
// ---------------------------------------------------------------------------

/**
 * Marks a rebuild as completed and updates the last completed timestamp.
 * Called after a successful build + upload + invalidation.
 *
 * @param rebuildId - The ID of the completed rebuild
 */
export async function markRebuildCompleted(rebuildId: string): Promise<void> {
  const completedAt = new Date().toISOString();
  lastCompletedRebuildAt = Date.now();

  await updateRebuildStatus(rebuildId, {
    status: 'completed',
    completedAt,
  });
}

/**
 * Marks a rebuild as failed and increments the retry count.
 * Called by the site-rebuild Lambda when a build fails.
 *
 * @param rebuildId - The ID of the failed rebuild
 * @param error - The error message describing the failure
 * @param retryCount - Current retry attempt number
 */
export async function markRebuildFailed(
  rebuildId: string,
  error: string,
  retryCount: number
): Promise<void> {
  await updateRebuildStatus(rebuildId, {
    status: 'failed',
    error,
    retryCount,
  });
}

/**
 * Returns the current rebuild queue depth.
 */
export async function getQueueDepth(): Promise<number> {
  return getRebuildQueueDepth();
}

/**
 * Returns the default rebuild queue configuration.
 */
export function getDefaultConfig(): RebuildQueueConfig {
  return { ...DEFAULT_CONFIG };
}

/**
 * Resets the last completed rebuild timestamp.
 * Exposed for testing purposes only.
 */
export function _resetLastCompletedTimestamp(timestamp: number = 0): void {
  lastCompletedRebuildAt = timestamp;
}

/**
 * Gets the last completed rebuild timestamp.
 * Exposed for testing purposes only.
 */
export function _getLastCompletedTimestamp(): number {
  return lastCompletedRebuildAt;
}

// ---------------------------------------------------------------------------
// Content Type / Cache Helpers
// ---------------------------------------------------------------------------

/**
 * Determines the Content-Type for a file based on its extension.
 */
function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.xml': 'application/xml',
    '.txt': 'text/plain; charset=utf-8',
  };

  return contentTypes[ext] ?? 'application/octet-stream';
}

/**
 * Determines the Cache-Control header based on file type.
 * Static assets (CSS, JS, images, fonts): 24 hours
 * HTML pages: 1 hour (so cache invalidation is effective quickly)
 */
function getCacheControl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const longCacheExtensions = [
    '.css', '.js', '.webp', '.png', '.jpg', '.jpeg',
    '.svg', '.ico', '.woff', '.woff2', '.ttf',
  ];

  if (longCacheExtensions.includes(ext)) {
    return 'public, max-age=86400'; // 24 hours
  }

  return 'public, max-age=3600'; // 1 hour for HTML and other files
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Utility: waits for a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
