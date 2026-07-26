/**
 * Site Cache Invalidation Lambda Handler
 *
 * Invalidates CloudFront cached paths after a successful site rebuild.
 *
 * Strategy:
 * - If ≤15 changed paths: invalidate individual paths
 * - If >15 changed paths: use wildcard invalidation (/*)
 *
 * Retry logic:
 * - Retries up to 3 times with 10-second intervals on failure
 * - Notifies Admin via SES if all retries fail (stale cache warning)
 *
 * Exported:
 * - handler: Lambda entry point
 * - invalidateCache: Core logic (exported for testing)
 */

import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

import type {
  InvalidationRequest,
  InvalidationResult,
} from '../../types/exhibition.js';

/** Maximum number of individual paths before switching to wildcard. */
const MAX_INDIVIDUAL_PATHS = 15;

/** Maximum retry attempts on failure. */
const MAX_RETRIES = 3;

/** Delay between retries in milliseconds. */
const RETRY_DELAY_MS = 10_000;

/** AWS SDK clients (reused across invocations for Lambda warm starts). */
const cloudFrontClient = new CloudFrontClient({});
const sesClient = new SESClient({});

/**
 * Lambda handler entry point.
 * Receives an InvalidationRequest payload (changedPaths + distributionId).
 */
export async function handler(event: InvalidationRequest): Promise<InvalidationResult> {
  return invalidateCache(event);
}

/**
 * Core cache invalidation logic.
 *
 * Determines the invalidation strategy (individual vs wildcard),
 * retries up to 3 times on failure, and notifies Admin if all retries fail.
 *
 * @param request - The invalidation request containing changed paths and distribution ID.
 * @returns The result of the invalidation attempt.
 */
export async function invalidateCache(
  request: InvalidationRequest
): Promise<InvalidationResult> {
  const { changedPaths, distributionId } = request;

  if (!distributionId) {
    return {
      success: false,
      strategy: changedPaths.length > MAX_INDIVIDUAL_PATHS ? 'wildcard' : 'individual',
      retriesAttempted: 0,
      error: 'Missing distributionId',
    };
  }

  if (changedPaths.length === 0) {
    return {
      success: true,
      strategy: 'individual',
      retriesAttempted: 0,
    };
  }

  const strategy: 'individual' | 'wildcard' =
    changedPaths.length > MAX_INDIVIDUAL_PATHS ? 'wildcard' : 'individual';

  const paths =
    strategy === 'wildcard'
      ? ['/*']
      : changedPaths.map((p) => (p.startsWith('/') ? p : `/${p}`));

  let lastError: string | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const callerReference = `cronusfit-${Date.now()}-${attempt}`;

      const result = await cloudFrontClient.send(
        new CreateInvalidationCommand({
          DistributionId: distributionId,
          InvalidationBatch: {
            CallerReference: callerReference,
            Paths: {
              Quantity: paths.length,
              Items: paths,
            },
          },
        })
      );

      const invalidationId = result.Invalidation?.Id;

      return {
        success: true,
        invalidationId,
        strategy,
        retriesAttempted: attempt,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(
        `Cache invalidation attempt ${attempt + 1}/${MAX_RETRIES} failed: ${lastError}`
      );

      // Wait before retrying (skip delay after last attempt)
      if (attempt < MAX_RETRIES - 1) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted — notify Admin
  await notifyAdminStaleCache(distributionId, paths, lastError ?? 'Unknown error');

  return {
    success: false,
    strategy,
    retriesAttempted: MAX_RETRIES,
    error: lastError,
  };
}

/**
 * Sends an SES email notification to the Admin when cache invalidation
 * fails after all retries (stale cache warning).
 */
async function notifyAdminStaleCache(
  distributionId: string,
  paths: string[],
  errorMessage: string
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL ?? '';
  const sesFromEmail = process.env.SES_FROM_EMAIL ?? '';

  if (!adminEmail || !sesFromEmail) {
    console.error(
      'Cannot send stale cache notification: ADMIN_EMAIL or SES_FROM_EMAIL not configured'
    );
    return;
  }

  const pathList =
    paths.length <= 10
      ? paths.join('\n  ')
      : `${paths.slice(0, 10).join('\n  ')}\n  ... and ${paths.length - 10} more`;

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: sesFromEmail,
        Destination: {
          ToAddresses: [adminEmail],
        },
        Message: {
          Subject: {
            Data: `[CronusFit] Cache Invalidation Failed — Stale Content Warning`,
            Charset: 'UTF-8',
          },
          Body: {
            Text: {
              Data: [
                `Cache invalidation failed after ${MAX_RETRIES} attempts.`,
                ``,
                `Distribution: ${distributionId}`,
                `Paths attempted:`,
                `  ${pathList}`,
                `Last error: ${errorMessage}`,
                `Timestamp: ${new Date().toISOString()}`,
                ``,
                `The site content has been updated in S3, but CloudFront may still`,
                `serve stale cached content until the next successful invalidation`,
                `or the cache TTL expires.`,
              ].join('\n'),
              Charset: 'UTF-8',
            },
          },
        },
      })
    );
  } catch (sesError) {
    console.error('Failed to send stale cache notification via SES:', sesError);
  }
}

/** Utility: waits for a given number of milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
