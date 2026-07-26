/**
 * DynamoDB Document Client setup for CronusFit single-table design.
 *
 * Uses AWS SDK v3 DynamoDBDocumentClient for simplified marshalling/unmarshalling.
 * Table name is read from DYNAMODB_TABLE environment variable with fallback to 'CronusFit'.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const ddbClient = new DynamoDBClient({});

export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

/** Table name from environment variable or default. */
export const TABLE_NAME =
  process.env.DYNAMODB_TABLE ?? process.env.TABLE_NAME ?? 'CronusFit';

// ---------------------------------------------------------------------------
// Table Schema Constants
// ---------------------------------------------------------------------------

/** Primary key attribute names. */
export const KEY_SCHEMA = {
  PK: 'PK',
  SK: 'SK',
} as const;

/** GSI-1 key attribute names (status-based queries). */
export const GSI1 = {
  indexName: 'GSI1',
  PK: 'GSI1PK',
  SK: 'GSI1SK',
} as const;

/** GSI-2 key attribute names (audit and security queries). */
export const GSI2 = {
  indexName: 'GSI2',
  PK: 'GSI2PK',
  SK: 'GSI2SK',
} as const;

// ---------------------------------------------------------------------------
// PK/SK Pattern Prefixes
// ---------------------------------------------------------------------------

/** Partition key prefixes for all entity types in the single-table design. */
export const PK_PREFIX = {
  PATTERN: 'PATTERN#',
  MOCKUP: 'MOCKUP#',
  PRODUCT: 'PRODUCT#',
  QUOTE: 'QUOTE#',
  TRACK: 'TRACK#',
  SOCIAL: 'SOCIAL#',
  WALOG: 'WALOG#',
  WAQUEUE: 'WAQUEUE',
  USAGE: 'USAGE#',
  TEMPLATE: 'TEMPLATE#',
  AUDIT: 'AUDIT#',
  LOGIN_ATTEMPT: 'LOGINATTEMPT#',
  REBUILD: 'REBUILD',
  GRADE: 'GRADE#',
  GRADINGTABLE: 'GRADINGTABLE#',
  RATELIMIT: 'RATELIMIT#',
  CAPTCHA: 'CAPTCHA#',
} as const;

/** Sort key prefixes and fixed values. */
export const SK_PREFIX = {
  METADATA: 'METADATA',
  PIECE: 'PIECE#',
  SIZE: 'SIZE#',
  AUDIT: 'AUDIT#',
  ACTION: 'ACTION#',
  QUOTE: 'QUOTE',
  MSG: 'MSG#',
  PERIOD: 'PERIOD#',
  VERSION: 'VERSION#',
  QUEUED: 'QUEUED#',
  ATTEMPT: 'ATTEMPT#',
  STATUS: 'STATUS',
  USED: 'USED',
  WINDOW: 'WINDOW#',
} as const;

/** GSI-1 PK prefixes for status and category queries. */
export const GSI1_PK_PREFIX = {
  GARMENT: 'GARMENT#',
  PATTERNS: 'PATTERNS',
  STATUS: 'STATUS#',
  AGEGROUP: 'AGEGROUP#',
  PUBLISHED: 'PUBLISHED#',
  QSTATUS: 'QSTATUS#',
  DELIVERY: 'DELIVERY#',
  ADMIN: 'ADMIN#',
  AUDITTYPE: 'AUDITTYPE#',
} as const;

/** GSI-1 SK prefixes for sorting. */
export const GSI1_SK_PREFIX = {
  CREATED: 'CREATED#',
  GARMENT: 'GARMENT#',
  ACTION: 'ACTION#',
  SENT: 'SENT#',
  TIME: 'TIME#',
} as const;

/** GSI-2 PK prefixes for audit and security queries. */
export const GSI2_PK_PREFIX = {
  RESOURCE: 'RESOURCE#',
} as const;

/** GSI-2 SK prefixes. */
export const GSI2_SK_PREFIX = {
  RESID: 'RESID#',
} as const;
