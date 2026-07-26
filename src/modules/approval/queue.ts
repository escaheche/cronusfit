/**
 * Approval Queue — queries mockups with "pending_approval" status.
 *
 * Uses GSI-1 to query mockups by status, ordered by generation date (oldest first).
 * Key pattern: GSI1PK = STATUS#pending_approval, GSI1SK = CREATED#{timestamp}
 *
 * @module approval/queue
 * @see Requirement 5.5 — Mockups pending approval displayed ordered by generation date (oldest → newest)
 */

import { queryByGSI1 } from '../../db/operations.js';
import type { MockupRecord } from '../../db/entities.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for querying the pending approval queue. */
export interface PendingMockupsOptions {
  /** Maximum number of items to return. Default: 20. */
  limit?: number;
  /** Exclusive start key for pagination (opaque string from previous response). */
  startKey?: string;
}

/** A mockup item in the pending approval queue. */
export interface PendingMockupItem {
  id: string;
  patternId: string;
  garmentType: string;
  designS3Key: string;
  frontImageS3Key: string;
  backImageS3Key: string;
  placementZone: string;
  scalingPercentage?: number;
  status: 'pending_approval';
  createdAt: string;
  createdBy: string;
}

/** Paginated response from the pending mockups queue. */
export interface PendingMockupsResult {
  items: PendingMockupItem[];
  /** Opaque cursor for fetching the next page. Undefined if no more items. */
  nextKey?: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const GSI1PK_PENDING = 'STATUS#pending_approval';
const GSI1SK_PREFIX = 'CREATED#';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieves mockups in "pending_approval" status ordered by generation date (oldest first).
 *
 * Uses GSI-1 with ScanIndexForward=true for natural ascending order by timestamp.
 * Supports pagination via opaque startKey cursor.
 *
 * @param options - Optional limit and pagination cursor
 * @returns Paginated list of pending mockups
 */
export async function getPendingMockups(
  options?: PendingMockupsOptions
): Promise<PendingMockupsResult> {
  const limit = options?.limit ?? DEFAULT_LIMIT;

  // Decode pagination cursor if provided
  const exclusiveStartKey = options?.startKey
    ? (JSON.parse(Buffer.from(options.startKey, 'base64url').toString('utf-8')) as Record<string, unknown>)
    : undefined;

  const result = await queryByGSI1<MockupRecord>(
    GSI1PK_PENDING,
    { expression: 'begins_with(GSI1SK, :sk)', value: GSI1SK_PREFIX },
    {
      limit,
      scanIndexForward: true, // oldest first
      exclusiveStartKey,
    }
  );

  // Encode the lastEvaluatedKey as an opaque base64url cursor
  const nextKey = result.lastEvaluatedKey
    ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString('base64url')
    : undefined;

  return {
    items: result.items.map(mapToQueueItem),
    nextKey,
    count: result.count,
  };
}

// ---------------------------------------------------------------------------
// Internal Mapping
// ---------------------------------------------------------------------------

/**
 * Maps a raw DynamoDB MockupRecord to the public PendingMockupItem interface.
 */
function mapToQueueItem(record: MockupRecord): PendingMockupItem {
  return {
    id: record.id,
    patternId: record.patternId,
    garmentType: record.garmentType,
    designS3Key: record.designS3Key,
    frontImageS3Key: record.frontImageS3Key,
    backImageS3Key: record.backImageS3Key,
    placementZone: record.placementZone,
    scalingPercentage: record.scalingPercentage,
    status: 'pending_approval',
    createdAt: record.createdAt,
    createdBy: record.createdBy,
  };
}
