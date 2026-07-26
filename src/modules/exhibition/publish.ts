/**
 * Product publication workflow for the CronusFit Exhibition Website.
 *
 * Enforces publication rules:
 * - Only mockups with status "approved" can be published (Req 6.5)
 * - NO auto-publish on approval — separate explicit Admin action required (Req 6.4)
 * - Publishing/unpublishing triggers a site rebuild via the queue (Req 6.2, 6.3)
 * - If a rebuild is already in progress, the new request is queued (Req 6.2, 6.3)
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { randomUUID } from 'node:crypto';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../db/client.js';
import { get, enqueueRebuild, getRebuildQueueDepth } from '../../db/operations.js';
import type { MockupRecord } from '../../db/entities.js';
import type { PublishAction, PublishResult } from '../../types/exhibition.js';
import type { AgeGroup } from '../../types/garment.js';

/** Maximum number of pending rebuilds allowed in the queue. */
const MAX_QUEUE_DEPTH = 10;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Extended publish request with product metadata for first-time publication. */
export interface PublishProductRequest {
  /** ID of the mockup to publish (must have status "approved"). */
  mockupId: string;
  /** Display name of the product (bilingual). */
  productName: { es: string; en: string };
  /** Target age groups for this product. */
  targetAgeGroups: AgeGroup[];
  /** Available sizes for this product. */
  availableSizes: string[];
  /** Admin performing the action (Cognito sub). */
  adminId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Publishes an approved mockup as a product on the exhibition website.
 *
 * Steps:
 * 1. Validate that the mockup exists and has status "approved" (Req 6.5)
 * 2. Create or update the PRODUCT record with GSI1PK = PUBLISHED#true
 * 3. Update the mockup's publishStatus to "published"
 * 4. Enqueue a site rebuild (Req 6.2)
 *
 * This is always an explicit Admin action — never triggered automatically
 * on approval (Req 6.4).
 *
 * @param request - The publish request with mockup ID and product metadata
 * @returns PublishResult indicating success/failure and queue position
 */
export async function publishProduct(request: PublishProductRequest): Promise<PublishResult> {
  const { mockupId, productName, targetAgeGroups, availableSizes, adminId } = request;

  // Step 1: Fetch the mockup and validate its approval status
  const mockup = await get<MockupRecord>(`MOCKUP#${mockupId}`, 'METADATA');

  if (!mockup) {
    return {
      success: false,
      rebuildQueued: false,
      error: `Mockup not found: ${mockupId}`,
    };
  }

  // Req 6.5: Only approved mockups can be published
  if (mockup.status !== 'approved') {
    return {
      success: false,
      rebuildQueued: false,
      error: `Cannot publish: mockup status is "${mockup.status}", only approved mockups can be published`,
    };
  }

  // Step 2: Check rebuild queue depth before proceeding
  const queueDepth = await getRebuildQueueDepth();
  if (queueDepth >= MAX_QUEUE_DEPTH) {
    return {
      success: false,
      rebuildQueued: false,
      error: `Rebuild queue is full (${MAX_QUEUE_DEPTH} pending). Retry after current rebuilds complete.`,
    };
  }

  // Step 3: Create or update PRODUCT record marked as published
  const now = new Date().toISOString();
  const productId = mockupId; // Use mockup ID as product ID (1:1 mapping)

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `PRODUCT#${productId}`,
        SK: 'METADATA',
        GSI1PK: 'PUBLISHED#true',
        GSI1SK: `CREATED#${now}`,
        id: productId,
        mockupId,
        productName,
        garmentType: mockup.garmentType,
        ageGroup: targetAgeGroups[0] ?? mockup.garmentType,
        availableSizes,
        frontImageS3Key: mockup.frontImageS3Key,
        backImageS3Key: mockup.backImageS3Key,
        publishedAt: now,
        publishedBy: adminId,
      },
    })
  );

  // Step 4: Update mockup's publishStatus to "published"
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `MOCKUP#${mockupId}`, SK: 'METADATA' },
      UpdateExpression: 'SET publishStatus = :ps, publishedAt = :publishedAt',
      ExpressionAttributeValues: {
        ':ps': 'published',
        ':publishedAt': now,
      },
    })
  );

  // Step 5: Enqueue rebuild request (Req 6.2 — queue if rebuild in progress)
  const rebuildId = randomUUID();
  await enqueueRebuild({
    rebuildId,
    triggeredBy: adminId,
    reason: 'publish',
    createdAt: now,
  });

  return {
    success: true,
    rebuildQueued: true,
    queuePosition: queueDepth + 1,
  };
}

/**
 * Publishes using the simpler PublishAction interface (used by Lambda handler).
 * Delegates to publishProduct with minimal metadata defaults.
 */
export async function publishProductFromAction(action: PublishAction): Promise<PublishResult> {
  const { mockupId, adminId } = action;

  // Look up mockup for metadata
  const mockup = await get<MockupRecord>(`MOCKUP#${mockupId}`, 'METADATA');

  if (!mockup) {
    return {
      success: false,
      rebuildQueued: false,
      error: `Mockup not found: ${mockupId}`,
    };
  }

  if (mockup.status !== 'approved') {
    return {
      success: false,
      rebuildQueued: false,
      error: `Cannot publish: mockup status is "${mockup.status}", only approved mockups can be published`,
    };
  }

  // Check if product record already exists
  const existingProduct = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `PRODUCT#${mockupId}`, SK: 'METADATA' },
    })
  );

  const queueDepth = await getRebuildQueueDepth();
  if (queueDepth >= MAX_QUEUE_DEPTH) {
    return {
      success: false,
      rebuildQueued: false,
      error: `Rebuild queue is full (${MAX_QUEUE_DEPTH} pending). Retry after current rebuilds complete.`,
    };
  }

  const now = new Date().toISOString();

  if (existingProduct.Item) {
    // Product already exists — just update its publish status
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { PK: `PRODUCT#${mockupId}`, SK: 'METADATA' },
        UpdateExpression:
          'SET GSI1PK = :gsi1pk, GSI1SK = :gsi1sk, publishedAt = :publishedAt, publishedBy = :publishedBy',
        ExpressionAttributeValues: {
          ':gsi1pk': 'PUBLISHED#true',
          ':gsi1sk': `CREATED#${now}`,
          ':publishedAt': now,
          ':publishedBy': adminId,
        },
      })
    );
  } else {
    // Create new product record from mockup data
    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: `PRODUCT#${mockupId}`,
          SK: 'METADATA',
          GSI1PK: 'PUBLISHED#true',
          GSI1SK: `CREATED#${now}`,
          id: mockupId,
          mockupId,
          productName: { es: `Producto ${mockupId.slice(0, 8)}`, en: `Product ${mockupId.slice(0, 8)}` },
          garmentType: mockup.garmentType,
          ageGroup: 'adult',
          availableSizes: [],
          frontImageS3Key: mockup.frontImageS3Key,
          backImageS3Key: mockup.backImageS3Key,
          publishedAt: now,
          publishedBy: adminId,
        },
      })
    );
  }

  // Update mockup's publishStatus
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `MOCKUP#${mockupId}`, SK: 'METADATA' },
      UpdateExpression: 'SET publishStatus = :ps, publishedAt = :publishedAt',
      ExpressionAttributeValues: {
        ':ps': 'published',
        ':publishedAt': now,
      },
    })
  );

  // Enqueue rebuild
  const rebuildId = randomUUID();
  await enqueueRebuild({
    rebuildId,
    triggeredBy: adminId,
    reason: 'publish',
    createdAt: now,
  });

  return {
    success: true,
    rebuildQueued: true,
    queuePosition: queueDepth + 1,
  };
}

/**
 * Unpublishes a product from the exhibition site.
 *
 * Validates that the product exists and is currently published,
 * removes its published status in DynamoDB, updates the mockup's
 * publishStatus back to "unpublished", and enqueues a site rebuild (Req 6.3).
 *
 * @param productId - The product ID to unpublish
 * @param adminId - Admin performing the action (Cognito sub)
 * @returns PublishResult indicating success/failure and queue position
 */
export async function unpublishProduct(
  productId: string,
  adminId: string
): Promise<PublishResult> {
  // Fetch product from DynamoDB
  const productResult = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
    })
  );

  if (!productResult.Item) {
    return {
      success: false,
      rebuildQueued: false,
      error: `Product not found: ${productId}`,
    };
  }

  const product = productResult.Item;

  // Check if product is currently published
  if (product.GSI1PK !== 'PUBLISHED#true') {
    return {
      success: false,
      rebuildQueued: false,
      error: `Product is not currently published: ${productId}`,
    };
  }

  // Check rebuild queue depth before proceeding
  const queueDepth = await getRebuildQueueDepth();
  if (queueDepth >= MAX_QUEUE_DEPTH) {
    return {
      success: false,
      rebuildQueued: false,
      error: `Rebuild queue is full (${MAX_QUEUE_DEPTH} pending). Retry after current rebuilds complete.`,
    };
  }

  // Update product: remove published status
  const now = new Date().toISOString();
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
      UpdateExpression:
        'SET GSI1PK = :gsi1pk, unpublishedAt = :unpublishedAt, unpublishedBy = :unpublishedBy REMOVE publishedAt, publishedBy',
      ExpressionAttributeValues: {
        ':gsi1pk': 'PUBLISHED#false',
        ':unpublishedAt': now,
        ':unpublishedBy': adminId,
      },
    })
  );

  // Update the associated mockup's publishStatus back to "unpublished"
  const mockupId = (product.mockupId as string) ?? productId;
  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `MOCKUP#${mockupId}`, SK: 'METADATA' },
      UpdateExpression: 'SET publishStatus = :ps REMOVE publishedAt',
      ExpressionAttributeValues: {
        ':ps': 'unpublished',
      },
    })
  );

  // Enqueue rebuild request (Req 6.3 — queue if rebuild in progress)
  const rebuildId = randomUUID();
  await enqueueRebuild({
    rebuildId,
    triggeredBy: adminId,
    reason: 'unpublish',
    createdAt: now,
  });

  return {
    success: true,
    rebuildQueued: true,
    queuePosition: queueDepth + 1,
  };
}

/**
 * Checks if a mockup is eligible for publication.
 *
 * A mockup can only be published if its status is "approved".
 * This prevents accidental publication of pending or rejected mockups (Req 6.5).
 *
 * @param mockupId - The mockup ID to check
 * @returns Object indicating eligibility and reason
 */
export async function canPublish(mockupId: string): Promise<{
  eligible: boolean;
  reason?: string;
  mockupStatus?: string;
}> {
  const mockup = await get<MockupRecord>(`MOCKUP#${mockupId}`, 'METADATA');

  if (!mockup) {
    return {
      eligible: false,
      reason: `Mockup '${mockupId}' not found`,
    };
  }

  if (mockup.status !== 'approved') {
    return {
      eligible: false,
      mockupStatus: mockup.status,
      reason: `Only approved mockups can be published (current status: '${mockup.status}')`,
    };
  }

  return {
    eligible: true,
    mockupStatus: mockup.status,
  };
}
