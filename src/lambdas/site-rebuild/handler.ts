/**
 * Site Rebuild Lambda Handler
 *
 * Triggered by the rebuild queue (invoked after publish/unpublish actions).
 * Orchestrates the site rebuild pipeline:
 *
 * 1. Process next rebuild from queue
 * 2. Fetch all published products from DynamoDB (GSI1PK = 'PUBLISHED#true')
 * 3. Invoke Eleventy via the site-builder module (60s timeout)
 * 4. Upload changed files to S3 (differential sync)
 * 5. Trigger cache invalidation Lambda for updated paths
 * 6. On failure: retry once after 30s; notify Admin via SES if retry fails
 *
 * This Lambda is a thin orchestration layer wiring together existing modules.
 */

import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { docClient, TABLE_NAME } from '../../db/client.js';
import type { PublishedProductRecord } from '../../db/entities.js';
import {
  processNextRebuild,
  markRebuildCompleted,
  markRebuildFailed,
} from '../../modules/exhibition/rebuild.js';
import { buildSite } from '../../modules/exhibition/site-builder.js';
import type { BuildResult } from '../../types/exhibition.js';

/** Environment variables. */
const S3_BUCKET = process.env.SITE_BUCKET_NAME ?? '';
const INVALIDATE_FUNCTION_NAME = process.env.INVALIDATE_FUNCTION_NAME ?? '';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? '';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? '';
const GSI1_INDEX_NAME = process.env.GSI1_INDEX_NAME ?? 'GSI1';

/** AWS SDK clients (reused across invocations for Lambda warm starts). */
const s3Client = new S3Client({});
const lambdaClient = new LambdaClient({});
const sesClient = new SESClient({});

/** Retry delay in milliseconds. */
const RETRY_DELAY_MS = 30_000;

/**
 * Lambda handler entry point.
 * Processes the next rebuild from the queue.
 */
export async function handler(): Promise<void> {
  // Step 1: Dequeue next rebuild
  const rebuildStatus = await processNextRebuild();

  if (!rebuildStatus.rebuildId) {
    // No pending rebuilds
    return;
  }

  const { rebuildId } = rebuildStatus;

  try {
    // Step 2: Execute the build
    const result = await executeBuild();

    if (result.success) {
      // Step 3: Upload changed files to S3
      await uploadChangedFiles(result.changedPaths);

      // Step 4: Trigger cache invalidation
      await triggerInvalidation(result.changedPaths);

      // Step 5: Mark rebuild as completed
      await markRebuildCompleted(rebuildId);
    } else {
      // Build failed — attempt retry
      const errorMsg = result.errors?.map((e) => e.message).join('; ') ?? 'Unknown build error';
      await handleBuildFailure(rebuildId, errorMsg, 0);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await handleBuildFailure(rebuildId, errorMsg, 0);
  }
}

/**
 * Fetches all published products from DynamoDB via GSI1 and invokes the site builder.
 */
async function executeBuild(): Promise<BuildResult> {
  const products = await fetchPublishedProducts();
  return buildSite(products);
}

/**
 * Fetches all published products from DynamoDB using GSI1 (GSI1PK = 'PUBLISHED#true').
 * Paginates through all results.
 */
async function fetchPublishedProducts(): Promise<PublishedProductRecord[]> {
  const products: PublishedProductRecord[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: GSI1_INDEX_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': 'PUBLISHED#true',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      products.push(...(result.Items as PublishedProductRecord[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return products;
}

/**
 * Uploads changed files to S3 using differential sync.
 * Only uploads files whose paths are in the changedPaths list.
 */
async function uploadChangedFiles(changedPaths: string[]): Promise<void> {
  if (changedPaths.length === 0) return;

  const outputDir = 'exhibition-site/_site';

  const uploadPromises = changedPaths.map(async (relativePath) => {
    const filePath = path.join(outputDir, relativePath);

    try {
      const content = await fs.readFile(filePath);
      const contentType = getContentType(relativePath);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: relativePath,
          Body: content,
          ContentType: contentType,
          CacheControl: getCacheControl(relativePath),
        })
      );
    } catch (error) {
      console.error(`Failed to upload ${relativePath}:`, error);
      throw error;
    }
  });

  await Promise.all(uploadPromises);
}

/**
 * Triggers the site-invalidate Lambda with the list of changed paths.
 */
async function triggerInvalidation(changedPaths: string[]): Promise<void> {
  if (changedPaths.length === 0) return;

  const payload = JSON.stringify({
    changedPaths,
    distributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID ?? '',
  });

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: INVALIDATE_FUNCTION_NAME,
      InvocationType: 'Event', // Async invocation
      Payload: Buffer.from(payload),
    })
  );
}

/**
 * Handles a build failure with retry logic.
 * Retries once after 30s. If retry also fails, notifies Admin via SES.
 */
async function handleBuildFailure(
  rebuildId: string,
  errorMessage: string,
  retryCount: number
): Promise<void> {
  if (retryCount < 1) {
    // Retry once after 30s delay
    console.warn(`Build failed (attempt ${retryCount + 1}), retrying in 30s: ${errorMessage}`);
    await markRebuildFailed(rebuildId, errorMessage, retryCount);
    await delay(RETRY_DELAY_MS);

    try {
      const retryResult = await executeBuild();

      if (retryResult.success) {
        await uploadChangedFiles(retryResult.changedPaths);
        await triggerInvalidation(retryResult.changedPaths);
        await markRebuildCompleted(rebuildId);
        return;
      }

      // Retry build also returned failure
      const retryError =
        retryResult.errors?.map((e) => e.message).join('; ') ?? 'Unknown build error on retry';
      await markRebuildFailed(rebuildId, retryError, retryCount + 1);
      await notifyAdminFailure(rebuildId, retryError);
    } catch (retryError) {
      const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
      await markRebuildFailed(rebuildId, retryErrorMsg, retryCount + 1);
      await notifyAdminFailure(rebuildId, retryErrorMsg);
    }
  } else {
    // Already retried, mark failed and notify
    await markRebuildFailed(rebuildId, errorMessage, retryCount);
    await notifyAdminFailure(rebuildId, errorMessage);
  }
}

/**
 * Sends an SES email notification to the Admin when a rebuild fails after retry.
 */
async function notifyAdminFailure(rebuildId: string, errorMessage: string): Promise<void> {
  if (!ADMIN_EMAIL || !SES_FROM_EMAIL) {
    console.error('Cannot send admin notification: ADMIN_EMAIL or SES_FROM_EMAIL not configured');
    return;
  }

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: SES_FROM_EMAIL,
        Destination: {
          ToAddresses: [ADMIN_EMAIL],
        },
        Message: {
          Subject: {
            Data: `[CronusFit] Site Rebuild Failed — ${rebuildId}`,
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: [
                `Site rebuild failed after retry.`,
                ``,
                `Rebuild ID: ${rebuildId}`,
                `Error: ${errorMessage}`,
                `Timestamp: ${new Date().toISOString()}`,
                ``,
                `The previously published site remains live.`,
                `Please investigate and trigger a manual rebuild when ready.`,
              ].join('\n'),
              Charset: 'UTF-8',
            },
          },
        },
      })
    );
  } catch (sesError) {
    console.error('Failed to send admin notification via SES:', sesError);
  }
}

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
 * Static assets (CSS, JS, images, fonts, SVG): 24 hours
 * HTML pages: 1 hour
 */
function getCacheControl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const longCacheExtensions = ['.css', '.js', '.webp', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.ttf'];

  if (longCacheExtensions.includes(ext)) {
    return 'public, max-age=86400'; // 24 hours
  }

  return 'public, max-age=3600'; // 1 hour for HTML and other files
}

/** Utility: waits for a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
