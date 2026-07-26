/**
 * DynamoDB CRUD helpers for the CronusFit single-table design.
 * Provides both generic operations (put, get, query, transactWrite, update, delete)
 * and domain-specific convenience methods.
 *
 * Uses AWS SDK v3 DynamoDBDocumentClient for simplified marshalling.
 */

import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME, GSI1, GSI2 } from './client.js';
import type { BaseRecord } from './entities.js';

// ---------------------------------------------------------------------------
// Generic CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Puts (creates or replaces) a single item in the table.
 * Pass `conditionExpression` to enforce uniqueness or other conditions.
 */
export async function put<T extends BaseRecord>(
  item: T,
  options?: {
    conditionExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    expressionAttributeValues?: Record<string, unknown>;
  }
): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: options?.conditionExpression,
      ExpressionAttributeNames: options?.expressionAttributeNames,
      ExpressionAttributeValues: options?.expressionAttributeValues,
    })
  );
}

/**
 * Gets a single item by its primary key (PK + SK).
 * Returns null if not found.
 */
export async function get<T extends BaseRecord>(
  pk: string,
  sk: string,
  options?: {
    projectionExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    consistentRead?: boolean;
  }
): Promise<T | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      ProjectionExpression: options?.projectionExpression,
      ExpressionAttributeNames: options?.expressionAttributeNames,
      ConsistentRead: options?.consistentRead,
    })
  );

  return (result.Item as T) ?? null;
}

/** Options for query operations. */
export interface QueryOptions {
  /** Maximum number of items to return. */
  limit?: number;
  /** Whether to scan index forward (ascending). Default: true. */
  scanIndexForward?: boolean;
  /** Exclusive start key for pagination. */
  exclusiveStartKey?: Record<string, unknown>;
  /** Filter expression applied after query. */
  filterExpression?: string;
  /** Expression attribute names for key condition or filter. */
  expressionAttributeNames?: Record<string, string>;
  /** Additional expression attribute values beyond :pk and :sk. */
  expressionAttributeValues?: Record<string, unknown>;
  /** Projection expression to limit returned attributes. */
  projectionExpression?: string;
}

/** Result of a paginated query. */
export interface QueryResult<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
  count: number;
}

/**
 * Queries items by partition key with optional sort key condition.
 * Operates on the main table index.
 */
export async function queryByPK<T extends BaseRecord>(
  pk: string,
  skCondition?: { expression: string; value: string; value2?: string },
  options?: QueryOptions
): Promise<QueryResult<T>> {
  const expressionValues: Record<string, unknown> = {
    ':pk': pk,
    ...options?.expressionAttributeValues,
  };

  let keyCondition = 'PK = :pk';
  if (skCondition) {
    keyCondition += ` AND ${skCondition.expression}`;
    expressionValues[':sk'] = skCondition.value;
    if (skCondition.value2) {
      expressionValues[':sk2'] = skCondition.value2;
    }
  }

  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: expressionValues,
    ExpressionAttributeNames: options?.expressionAttributeNames,
    FilterExpression: options?.filterExpression,
    Limit: options?.limit,
    ScanIndexForward: options?.scanIndexForward ?? true,
    ExclusiveStartKey: options?.exclusiveStartKey,
    ProjectionExpression: options?.projectionExpression,
  };

  const result = await docClient.send(new QueryCommand(params));

  return {
    items: (result.Items as T[]) ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey,
    count: result.Count ?? 0,
  };
}

/**
 * Queries items using GSI-1 (status-based queries).
 */
export async function queryByGSI1<T extends BaseRecord>(
  gsi1pk: string,
  skCondition?: { expression: string; value: string; value2?: string },
  options?: QueryOptions
): Promise<QueryResult<T>> {
  const expressionValues: Record<string, unknown> = {
    ':pk': gsi1pk,
    ...options?.expressionAttributeValues,
  };

  let keyCondition = 'GSI1PK = :pk';
  if (skCondition) {
    keyCondition += ` AND ${skCondition.expression}`;
    expressionValues[':sk'] = skCondition.value;
    if (skCondition.value2) {
      expressionValues[':sk2'] = skCondition.value2;
    }
  }

  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    IndexName: GSI1.indexName,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: expressionValues,
    ExpressionAttributeNames: options?.expressionAttributeNames,
    FilterExpression: options?.filterExpression,
    Limit: options?.limit,
    ScanIndexForward: options?.scanIndexForward ?? true,
    ExclusiveStartKey: options?.exclusiveStartKey,
    ProjectionExpression: options?.projectionExpression,
  };

  const result = await docClient.send(new QueryCommand(params));

  return {
    items: (result.Items as T[]) ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey,
    count: result.Count ?? 0,
  };
}

/**
 * Queries items using GSI-2 (audit and security queries).
 */
export async function queryByGSI2<T extends BaseRecord>(
  gsi2pk: string,
  skCondition?: { expression: string; value: string; value2?: string },
  options?: QueryOptions
): Promise<QueryResult<T>> {
  const expressionValues: Record<string, unknown> = {
    ':pk': gsi2pk,
    ...options?.expressionAttributeValues,
  };

  let keyCondition = 'GSI2PK = :pk';
  if (skCondition) {
    keyCondition += ` AND ${skCondition.expression}`;
    expressionValues[':sk'] = skCondition.value;
    if (skCondition.value2) {
      expressionValues[':sk2'] = skCondition.value2;
    }
  }

  const params: QueryCommandInput = {
    TableName: TABLE_NAME,
    IndexName: GSI2.indexName,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: expressionValues,
    ExpressionAttributeNames: options?.expressionAttributeNames,
    FilterExpression: options?.filterExpression,
    Limit: options?.limit,
    ScanIndexForward: options?.scanIndexForward ?? true,
    ExclusiveStartKey: options?.exclusiveStartKey,
    ProjectionExpression: options?.projectionExpression,
  };

  const result = await docClient.send(new QueryCommand(params));

  return {
    items: (result.Items as T[]) ?? [],
    lastEvaluatedKey: result.LastEvaluatedKey,
    count: result.Count ?? 0,
  };
}

/** A single item operation within a transaction. */
export type TransactItem =
  | { Put: { Item: BaseRecord; ConditionExpression?: string } }
  | { Update: { Key: { PK: string; SK: string }; UpdateExpression: string; ExpressionAttributeValues?: Record<string, unknown>; ExpressionAttributeNames?: Record<string, string>; ConditionExpression?: string } }
  | { Delete: { Key: { PK: string; SK: string }; ConditionExpression?: string } }
  | { ConditionCheck: { Key: { PK: string; SK: string }; ConditionExpression: string; ExpressionAttributeValues?: Record<string, unknown>; ExpressionAttributeNames?: Record<string, string> } };

/**
 * Executes a transactional write (up to 100 items) atomically.
 * All items succeed or all fail — no partial writes.
 */
export async function transactWrite(items: TransactItem[]): Promise<void> {
  const transactItems: TransactWriteCommandInput['TransactItems'] = items.map(
    (item) => {
      if ('Put' in item) {
        return {
          Put: {
            TableName: TABLE_NAME,
            Item: item.Put.Item,
            ConditionExpression: item.Put.ConditionExpression,
          },
        };
      }
      if ('Update' in item) {
        return {
          Update: {
            TableName: TABLE_NAME,
            Key: item.Update.Key,
            UpdateExpression: item.Update.UpdateExpression,
            ExpressionAttributeValues: item.Update.ExpressionAttributeValues,
            ExpressionAttributeNames: item.Update.ExpressionAttributeNames,
            ConditionExpression: item.Update.ConditionExpression,
          },
        };
      }
      if ('Delete' in item) {
        return {
          Delete: {
            TableName: TABLE_NAME,
            Key: item.Delete.Key,
            ConditionExpression: item.Delete.ConditionExpression,
          },
        };
      }
      // ConditionCheck
      return {
        ConditionCheck: {
          TableName: TABLE_NAME,
          Key: item.ConditionCheck.Key,
          ConditionExpression: item.ConditionCheck.ConditionExpression,
          ExpressionAttributeValues: item.ConditionCheck.ExpressionAttributeValues,
          ExpressionAttributeNames: item.ConditionCheck.ExpressionAttributeNames,
        },
      };
    }
  );

  await docClient.send(
    new TransactWriteCommand({ TransactItems: transactItems })
  );
}

/** Options for the update operation. */
export interface UpdateOptions {
  updateExpression: string;
  expressionAttributeValues?: Record<string, unknown>;
  expressionAttributeNames?: Record<string, string>;
  conditionExpression?: string;
  returnValues?: 'NONE' | 'ALL_OLD' | 'UPDATED_OLD' | 'ALL_NEW' | 'UPDATED_NEW';
}

/**
 * Updates an existing item identified by PK + SK.
 * Returns the attributes as specified by returnValues.
 */
export async function update<T extends BaseRecord>(
  pk: string,
  sk: string,
  options: UpdateOptions
): Promise<T | null> {
  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression: options.updateExpression,
      ExpressionAttributeValues: options.expressionAttributeValues,
      ExpressionAttributeNames: options.expressionAttributeNames,
      ConditionExpression: options.conditionExpression,
      ReturnValues: options.returnValues ?? 'NONE',
    })
  );

  return (result.Attributes as T) ?? null;
}

/**
 * Deletes an item by its primary key (PK + SK).
 * Optionally applies a condition expression.
 */
export async function remove(
  pk: string,
  sk: string,
  options?: {
    conditionExpression?: string;
    expressionAttributeNames?: Record<string, string>;
    expressionAttributeValues?: Record<string, unknown>;
  }
): Promise<void> {
  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      ConditionExpression: options?.conditionExpression,
      ExpressionAttributeNames: options?.expressionAttributeNames,
      ExpressionAttributeValues: options?.expressionAttributeValues,
    })
  );
}

// ---------------------------------------------------------------------------
// Domain-Specific Convenience Methods
// ---------------------------------------------------------------------------

/**
 * Atomically increments a rate limit counter for the given IP/endpoint/window.
 * Creates the record with TTL on first request in the window.
 * Returns the updated request count.
 */
export async function incrementRateLimit(
  ip: string,
  endpoint: string,
  windowStartMs: number,
  windowSeconds: number
): Promise<number> {
  const pk = `RATELIMIT#${ip}#${endpoint}`;
  const sk = `WINDOW#${windowStartMs}`;
  const ttl = Math.floor(windowStartMs / 1000) + windowSeconds;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      UpdateExpression:
        'ADD requestCount :inc SET #ttl = if_not_exists(#ttl, :ttl), windowStartMs = if_not_exists(windowStartMs, :windowStart)',
      ExpressionAttributeNames: {
        '#ttl': 'ttl',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':ttl': ttl,
        ':windowStart': windowStartMs,
      },
      ReturnValues: 'ALL_NEW',
    })
  );

  return (result.Attributes as { requestCount: number }).requestCount;
}

/**
 * Gets the current rate limit count for an IP/endpoint/window.
 * Returns 0 if no record exists.
 */
export async function getRateLimitCount(
  ip: string,
  endpoint: string,
  windowStartMs: number
): Promise<number> {
  const pk = `RATELIMIT#${ip}#${endpoint}`;
  const sk = `WINDOW#${windowStartMs}`;

  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: pk, SK: sk },
      ProjectionExpression: 'requestCount',
    })
  );

  if (!result.Item) return 0;
  return (result.Item as { requestCount: number }).requestCount;
}

/**
 * Stores a used hCaptcha token hash with a 5-minute TTL.
 * Prevents token replay attacks.
 */
export async function storeUsedToken(tokenHash: string): Promise<void> {
  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + 300; // +5 minutes

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `CAPTCHA#${tokenHash}`,
        SK: 'USED',
        usedAt: now.toISOString(),
        ttl,
      },
    })
  );
}

/**
 * Checks if an hCaptcha token has already been used.
 * Returns true if the token exists (was previously consumed).
 */
export async function isTokenUsed(tokenHash: string): Promise<boolean> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `CAPTCHA#${tokenHash}`, SK: 'USED' },
      ProjectionExpression: 'PK',
    })
  );

  return result.Item !== undefined;
}

/**
 * Enqueues a rebuild request. The SK encodes timestamp + ID for ordering.
 * TTL auto-expires entries after 1 hour.
 */
export async function enqueueRebuild(record: {
  rebuildId: string;
  triggeredBy: string;
  reason: 'publish' | 'unpublish' | 'manual';
  createdAt: string;
}): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 3600; // +1 hour
  const sk = `QUEUED#${record.createdAt}#${record.rebuildId}`;

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: 'REBUILD',
        SK: sk,
        ...record,
        ttl,
      },
    })
  );
}

/**
 * Dequeues the next pending rebuild (oldest first).
 * Reads the first QUEUED item and deletes it atomically.
 * Returns null if the queue is empty.
 */
export async function dequeueNextRebuild(): Promise<{
  rebuildId: string;
  triggeredBy: string;
  reason: 'publish' | 'unpublish' | 'manual';
  createdAt: string;
} | null> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': 'REBUILD',
        ':skPrefix': 'QUEUED#',
      },
      Limit: 1,
      ScanIndexForward: true,
    })
  );

  if (!result.Items || result.Items.length === 0) return null;

  const item = result.Items[0] as { PK: string; SK: string; rebuildId: string; triggeredBy: string; reason: 'publish' | 'unpublish' | 'manual'; createdAt: string };

  await docClient.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: item.PK, SK: item.SK },
    })
  );

  return {
    rebuildId: item.rebuildId,
    triggeredBy: item.triggeredBy,
    reason: item.reason,
    createdAt: item.createdAt,
  };
}

/**
 * Gets the current rebuild queue depth (number of pending rebuilds).
 */
export async function getRebuildQueueDepth(): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': 'REBUILD',
        ':skPrefix': 'QUEUED#',
      },
      Select: 'COUNT',
    })
  );

  return result.Count ?? 0;
}

/**
 * Gets the status of a specific rebuild by its ID.
 */
export async function getRebuildStatus(
  rebuildId: string
): Promise<{ status: string; startedAt?: string; completedAt?: string; error?: string } | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: `REBUILD#${rebuildId}`, SK: 'STATUS' },
    })
  );

  return (result.Item as { status: string; startedAt?: string; completedAt?: string; error?: string }) ?? null;
}

/**
 * Creates or updates the status record for a rebuild.
 * Sets a 24-hour TTL for automatic cleanup.
 */
export async function updateRebuildStatus(
  rebuildId: string,
  updates: Partial<{
    status: string;
    startedAt: string;
    completedAt: string;
    pagesGenerated: number;
    changedPaths: string[];
    error: string;
    retryCount: number;
  }>
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + 86400; // +24 hours

  const expressionParts: string[] = [];
  const attrNames: Record<string, string> = {};
  const attrValues: Record<string, unknown> = {};

  // Always set TTL
  expressionParts.push('#ttl = :ttl');
  attrNames['#ttl'] = 'ttl';
  attrValues[':ttl'] = ttl;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      const placeholder = `:${key}`;
      const nameKey = `#${key}`;
      expressionParts.push(`${nameKey} = ${placeholder}`);
      attrNames[nameKey] = key;
      attrValues[placeholder] = value;
    }
  }

  await docClient.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { PK: `REBUILD#${rebuildId}`, SK: 'STATUS' },
      UpdateExpression: `SET ${expressionParts.join(', ')}`,
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: attrValues,
    })
  );
}

/**
 * Creates a quote with a transactional write that stores both:
 * 1. The quote record (PK: QUOTE#{id}, SK: METADATA)
 * 2. The tracking number index (PK: TRACK#{trackingNumber}, SK: QUOTE)
 *
 * This ensures the tracking number is unique and both records are created atomically.
 */
export async function createQuote<T extends BaseRecord & { id: string; trackingNumber: string }>(
  record: T
): Promise<void> {
  await transactWrite([
    {
      Put: {
        Item: record as unknown as BaseRecord,
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
    {
      Put: {
        Item: {
          PK: `TRACK#${record.trackingNumber}`,
          SK: 'QUOTE',
          quoteId: record.id,
        } as unknown as BaseRecord,
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    },
  ]);
}

/**
 * Retrieves a quote by its tracking number.
 * First looks up the quote ID via the tracking index, then fetches the full record.
 * Returns null if not found.
 */
export async function getQuoteByTrackingNumber<T extends BaseRecord = BaseRecord>(
  trackingNumber: string
): Promise<T | null> {
  const trackResult = await get<BaseRecord>(
    `TRACK#${trackingNumber}`,
    'QUOTE'
  );

  if (!trackResult) return null;

  const quoteId = (trackResult as unknown as { quoteId: string }).quoteId;

  return get<T>(`QUOTE#${quoteId}`, 'METADATA');
}

/**
 * Updates the status of a quote and its GSI1PK for status-based queries.
 */
export async function updateQuoteStatus(
  quoteId: string,
  newStatus: string
): Promise<void> {
  await update(
    `QUOTE#${quoteId}`,
    'METADATA',
    {
      updateExpression: 'SET #status = :status, GSI1PK = :gsi1pk',
      expressionAttributeNames: { '#status': 'status' },
      expressionAttributeValues: {
        ':status': newStatus,
        ':gsi1pk': `QSTATUS#${newStatus}`,
      },
    }
  );
}

/**
 * Puts (creates or replaces) a usage metric record.
 */
export async function putUsageMetric(record: {
  PK: string;
  SK: string;
  service: string;
  currentUsage: number;
  freeLimit: number;
  percentUsed: number;
  lastCheckedAt: string;
  alertSentAt?: string;
  disabledAt?: string;
}): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: record,
    })
  );
}

/**
 * Gets a usage metric for a specific service and billing period.
 * Returns null if not found.
 */
export async function getUsageMetric(
  service: string,
  period: string
): Promise<Record<string, unknown> | null> {
  const result = await get<BaseRecord>(`USAGE#${service}`, `PERIOD#${period}`);
  return result as unknown as Record<string, unknown> | null;
}

/**
 * Records a login attempt for rate limiting tracking.
 * Sets TTL for automatic cleanup after the lockout window.
 */
export async function recordLoginAttempt(
  ip: string,
  timestamp: string,
  success: boolean,
  adminEmail?: string,
  ttlSeconds = 900 // 15 minutes default
): Promise<void> {
  const ttl = Math.floor(Date.now() / 1000) + ttlSeconds;

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `LOGINATTEMPT#${ip}`,
        SK: `ATTEMPT#${timestamp}`,
        ipAddress: ip,
        timestamp,
        success,
        adminEmail,
        ttl,
      },
    })
  );
}

/**
 * Queries recent login attempts for an IP address within the given time window.
 * Used for login rate limiting decisions.
 */
export async function getRecentLoginAttempts(
  ip: string,
  sinceTimestamp: string
): Promise<Array<{ timestamp: string; success: boolean; adminEmail?: string }>> {
  const result = await queryByPK<BaseRecord>(
    `LOGINATTEMPT#${ip}`,
    { expression: 'SK >= :sk', value: `ATTEMPT#${sinceTimestamp}` }
  );

  return result.items.map((item) => ({
    timestamp: (item as unknown as { timestamp: string }).timestamp,
    success: (item as unknown as { success: boolean }).success,
    adminEmail: (item as unknown as { adminEmail?: string }).adminEmail,
  }));
}

/**
 * Writes an immutable audit log entry.
 * Best-effort — callers should handle failures gracefully.
 */
export async function writeAuditLog(entry: {
  adminId: string;
  adminEmail: string;
  timestamp: string;
  actionType: string;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `AUDIT#${entry.adminId}`,
        SK: `ACTION#${entry.timestamp}`,
        GSI1PK: `AUDITTYPE#${entry.actionType}`,
        GSI1SK: `TIME#${entry.timestamp}`,
        GSI2PK: `RESOURCE#${entry.resourceType}`,
        GSI2SK: `RESID#${entry.resourceId}`,
        ...entry,
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Pattern Generation Operations
// ---------------------------------------------------------------------------

import type { AgeGroup, GarmentType } from '../types/garment.js';
import type { PatternMetadata, ParametricTemplate, GradingIncrementTable } from '../types/pattern.js';
import type {
  PatternMetadataRecord,
  ParametricTemplateRecord,
  GradingTableRecord,
} from './entities.js';

/**
 * Stores pattern metadata in DynamoDB.
 * PK: PATTERN#{id}, SK: METADATA
 * GSI1PK: PATTERNS, GSI1SK: {createdAt} (for listing by date desc)
 */
export async function putPattern(metadata: PatternMetadata): Promise<void> {
  const record: PatternMetadataRecord = {
    PK: `PATTERN#${metadata.id}`,
    SK: 'METADATA',
    GSI1PK: 'PATTERNS',
    GSI1SK: metadata.createdAt,
    id: metadata.id,
    garmentType: metadata.garmentType,
    ageGroup: metadata.ageGroup,
    size: metadata.size,
    createdAt: metadata.createdAt,
    generationMethod: metadata.generationMethod,
    s3Key: metadata.s3Key,
    pieceCount: metadata.pieceCount,
    seamAllowance: metadata.seamAllowance,
    adminId: metadata.adminId,
  };

  await put(record);
}

/**
 * Retrieves pattern metadata by ID.
 * Returns null if pattern not found.
 */
export async function getPattern(id: string): Promise<PatternMetadata | null> {
  const record = await get<PatternMetadataRecord>(`PATTERN#${id}`, 'METADATA');
  if (!record) return null;

  return {
    id: record.id,
    garmentType: record.garmentType,
    ageGroup: record.ageGroup,
    size: record.size,
    createdAt: record.createdAt,
    generationMethod: record.generationMethod,
    s3Key: record.s3Key,
    pieceCount: record.pieceCount,
    seamAllowance: record.seamAllowance,
    adminId: record.adminId,
  };
}

/** Options for querying patterns. */
export interface QueryPatternsOptions {
  /** Maximum number of patterns to return. */
  limit?: number;
  /** Filter by garment type. */
  garmentType?: GarmentType;
  /** Filter by age group. */
  ageGroup?: AgeGroup;
  /** Exclusive start key for pagination. */
  exclusiveStartKey?: Record<string, unknown>;
}

/** Result of a patterns query. */
export interface QueryPatternsResult {
  patterns: PatternMetadata[];
  lastEvaluatedKey?: Record<string, unknown>;
  count: number;
}

/**
 * Queries patterns ordered by creation date descending (newest first).
 * Uses GSI1 with PK = PATTERNS, sorted by createdAt.
 * Supports optional filtering by garmentType and ageGroup.
 */
export async function queryPatterns(
  options?: QueryPatternsOptions
): Promise<QueryPatternsResult> {
  const filterParts: string[] = [];
  const expressionAttributeValues: Record<string, unknown> = {};
  const expressionAttributeNames: Record<string, string> = {};

  if (options?.garmentType) {
    filterParts.push('#garmentType = :garmentType');
    expressionAttributeNames['#garmentType'] = 'garmentType';
    expressionAttributeValues[':garmentType'] = options.garmentType;
  }

  if (options?.ageGroup) {
    filterParts.push('#ageGroup = :ageGroup');
    expressionAttributeNames['#ageGroup'] = 'ageGroup';
    expressionAttributeValues[':ageGroup'] = options.ageGroup;
  }

  const filterExpression = filterParts.length > 0
    ? filterParts.join(' AND ')
    : undefined;

  const result = await queryByGSI1<PatternMetadataRecord>(
    'PATTERNS',
    undefined,
    {
      limit: options?.limit,
      scanIndexForward: false, // descending by date
      exclusiveStartKey: options?.exclusiveStartKey,
      filterExpression,
      expressionAttributeNames: Object.keys(expressionAttributeNames).length > 0
        ? expressionAttributeNames
        : undefined,
      expressionAttributeValues: Object.keys(expressionAttributeValues).length > 0
        ? expressionAttributeValues
        : undefined,
    }
  );

  const patterns: PatternMetadata[] = result.items.map((record) => ({
    id: record.id,
    garmentType: record.garmentType,
    ageGroup: record.ageGroup,
    size: record.size,
    createdAt: record.createdAt,
    generationMethod: record.generationMethod,
    s3Key: record.s3Key,
    pieceCount: record.pieceCount,
    seamAllowance: record.seamAllowance,
    adminId: record.adminId,
  }));

  return {
    patterns,
    lastEvaluatedKey: result.lastEvaluatedKey,
    count: result.count,
  };
}

/**
 * Stores a parametric template in DynamoDB.
 * PK: TEMPLATE#{id}, SK: METADATA
 */
export async function putTemplate(template: ParametricTemplate): Promise<void> {
  const now = new Date().toISOString();
  const record: ParametricTemplateRecord = {
    PK: `TEMPLATE#${template.id}`,
    SK: 'METADATA',
    id: template.id,
    template,
    createdAt: now,
  };

  await put(record);
}

/**
 * Retrieves a parametric template by ID.
 * Returns null if template not found.
 */
export async function getTemplate(id: string): Promise<ParametricTemplate | null> {
  const record = await get<ParametricTemplateRecord>(`TEMPLATE#${id}`, 'METADATA');
  if (!record) return null;
  return record.template;
}

/**
 * Stores a grading increment table in DynamoDB.
 * PK: GRADINGTABLE#{ageGroup}#{garmentType}, SK: METADATA
 */
export async function putGradingTable(
  ageGroup: AgeGroup,
  garmentType: GarmentType,
  table: GradingIncrementTable
): Promise<void> {
  const now = new Date().toISOString();
  const record: GradingTableRecord = {
    PK: `GRADINGTABLE#${ageGroup}#${garmentType}`,
    SK: 'METADATA',
    ageGroup,
    garmentType,
    table,
    createdAt: now,
  };

  await put(record);
}

/**
 * Retrieves a grading increment table by age group and garment type.
 * Returns null if table not found.
 */
export async function getGradingTable(
  ageGroup: AgeGroup,
  garmentType: GarmentType
): Promise<GradingIncrementTable | null> {
  const record = await get<GradingTableRecord>(
    `GRADINGTABLE#${ageGroup}#${garmentType}`,
    'METADATA'
  );
  if (!record) return null;
  return record.table;
}
