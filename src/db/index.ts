/**
 * CronusFit DynamoDB data layer barrel export.
 *
 * Single-table design with composite keys (PK/SK) and two GSIs:
 * - GSI-1: Status/category-based queries
 * - GSI-2: Audit and security queries
 */

// Client and table schema constants
export {
  docClient,
  TABLE_NAME,
  KEY_SCHEMA,
  GSI1,
  GSI2,
  PK_PREFIX,
  SK_PREFIX,
  GSI1_PK_PREFIX,
  GSI1_SK_PREFIX,
  GSI2_PK_PREFIX,
  GSI2_SK_PREFIX,
} from './client.js';

// Entity record interfaces
export type {
  BaseRecord,
  PatternRecord,
  PatternPieceRecord,
  IncrementTableRecord,
  TemplateRecord,
  MockupRecord,
  ApprovalAuditRecord,
  PublishedProductRecord,
  QuoteRecord,
  QuoteTrackingRecord,
  SocialContentRecord,
  DeliveryLogRecord,
  WAMessageQueueRecord,
  UsageMetricRecord,
  AuditLogEntry,
  LoginAttemptRecord,
  RebuildQueueRecord,
  RebuildStatusRecord,
  RateLimitRecord,
  UsedCaptchaRecord,
  PlacementZone,
  MockupStatus,
  PublishStatus,
  QuoteStatus,
  SocialContentStatus,
  DeliveryStatus,
} from './entities.js';

// CRUD operations
export {
  // Generic operations
  put,
  get,
  queryByPK,
  queryByGSI1,
  queryByGSI2,
  transactWrite,
  update,
  remove,
  // Domain-specific helpers
  incrementRateLimit,
  getRateLimitCount,
  storeUsedToken,
  isTokenUsed,
  enqueueRebuild,
  dequeueNextRebuild,
  getRebuildQueueDepth,
  getRebuildStatus,
  updateRebuildStatus,
  createQuote,
  getQuoteByTrackingNumber,
  updateQuoteStatus,
  putUsageMetric,
  getUsageMetric,
  recordLoginAttempt,
  getRecentLoginAttempts,
  writeAuditLog,
} from './operations.js';

export type { QueryOptions, QueryResult, TransactItem, UpdateOptions } from './operations.js';
