/**
 * DynamoDB entity record interfaces for the CronusFit single-table design.
 * Each interface represents a distinct entity stored in the CronusFit table.
 *
 * Key patterns follow the convention: PK = ENTITY#{id}, SK = METADATA | SUB#{subId}
 * GSI-1 enables status/category queries, GSI-2 enables audit/security queries.
 */

import type { AgeGroup, ChildrenSize, AdultSize, GarmentType, Size } from '../types/garment.js';
import type { ParametricTemplate, GradingIncrementTable } from '../types/pattern.js';

// ---------------------------------------------------------------------------
// Base Record Type
// ---------------------------------------------------------------------------

/** Base interface for all DynamoDB records in the CronusFit table. */
export interface BaseRecord {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}

// ---------------------------------------------------------------------------
// Pattern Entities
// ---------------------------------------------------------------------------

/**
 * Pattern Record — stores metadata for a generated cutting pattern.
 * PK: PATTERN#{uuid}
 * SK: METADATA
 * GSI1PK: GARMENT#{type}
 * GSI1SK: CREATED#{iso-timestamp}
 */
export interface PatternRecord extends BaseRecord {
  PK: `PATTERN#${string}`;
  SK: 'METADATA';
  GSI1PK: `GARMENT#${string}`;
  GSI1SK: `CREATED#${string}`;
  id: string;
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  measurements: Record<string, number>;
  seamAllowanceCm: number;
  svgS3Key: string;
  pieceCount: number;
  createdAt: string;
  createdBy: string;
  referenceImageS3Key?: string;
}

/**
 * Pattern Piece Record — stores individual pattern piece data.
 * PK: PATTERN#{id}
 * SK: PIECE#{pieceId}
 */
export interface PatternPieceRecord extends BaseRecord {
  PK: `PATTERN#${string}`;
  SK: `PIECE#${string}`;
  pieceId: string;
  name: string;
  cutQuantity: number;
  grainLineAngle: number;
  pathData: string;
  notchPositions: Array<{ x: number; y: number; edge: string }>;
}

/**
 * Grading Increment Table Record — stores size grading increments.
 * PK: GRADE#{garmentType}#{ageGroup}
 * SK: SIZE#{sizeTransition}
 * GSI1PK: AGEGROUP#{ageGroup}
 * GSI1SK: GARMENT#{garmentType}
 */
export interface IncrementTableRecord extends BaseRecord {
  PK: `GRADE#${string}#${string}`;
  SK: `SIZE#${string}`;
  GSI1PK: `AGEGROUP#${string}`;
  GSI1SK: `GARMENT#${string}`;
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  sizeTransition: string;
  increments: Record<string, number>; // controlPoint → increment_cm
}

/**
 * Template Record — stores parametric template versions.
 * PK: TEMPLATE#{type}#{ageGroup}
 * SK: VERSION#{version}
 * GSI1PK: AGEGROUP#{ageGroup}
 * GSI1SK: GARMENT#{type}
 */
export interface TemplateRecord extends BaseRecord {
  PK: `TEMPLATE#${string}#${string}`;
  SK: `VERSION#${string}`;
  GSI1PK: `AGEGROUP#${string}`;
  GSI1SK: `GARMENT#${string}`;
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  version: string;
  s3Key: string;
  controlPointCount: number;
  createdAt: string;
  createdBy: string;
}

// ---------------------------------------------------------------------------
// Pattern Generation Entities (pattern-generation spec)
// ---------------------------------------------------------------------------

/**
 * Pattern Metadata Record — stores metadata for a generated pattern.
 * PK: PATTERN#{id}
 * SK: METADATA
 * GSI1PK: PATTERNS
 * GSI1SK: {createdAt} (ISO 8601 for date-descending listing)
 */
export interface PatternMetadataRecord extends BaseRecord {
  PK: `PATTERN#${string}`;
  SK: 'METADATA';
  GSI1PK: 'PATTERNS';
  GSI1SK: string;
  id: string;
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  size: Size;
  createdAt: string;
  generationMethod: 'parameters' | 'image';
  s3Key: string;
  pieceCount: number;
  seamAllowance: number;
  adminId: string;
}

/**
 * Parametric Template Storage Record — stores the full ParametricTemplate JSON.
 * PK: TEMPLATE#{id}
 * SK: METADATA
 */
export interface ParametricTemplateRecord extends BaseRecord {
  PK: `TEMPLATE#${string}`;
  SK: 'METADATA';
  id: string;
  template: ParametricTemplate;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Grading Increment Table Record — stores increments per age group + garment type.
 * PK: GRADINGTABLE#{ageGroup}#{garmentType}
 * SK: METADATA
 */
export interface GradingTableRecord extends BaseRecord {
  PK: `GRADINGTABLE#${string}#${string}`;
  SK: 'METADATA';
  ageGroup: AgeGroup;
  garmentType: GarmentType;
  table: GradingIncrementTable;
  createdAt: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Mockup Entities
// ---------------------------------------------------------------------------

/** Placement zones for design overlay on garment mockups. */
export type PlacementZone =
  | 'chest'
  | 'full-front'
  | 'full-back'
  | 'left-sleeve'
  | 'right-sleeve';

/** Mockup approval status values. */
export type MockupStatus = 'pending_approval' | 'approved' | 'rejected';

/** Mockup publication status values. */
export type PublishStatus = 'unpublished' | 'published';

/**
 * Mockup Record — stores mockup metadata and status.
 * PK: MOCKUP#{uuid}
 * SK: METADATA
 * GSI1PK: STATUS#{status}
 * GSI1SK: CREATED#{iso-timestamp}
 */
export interface MockupRecord extends BaseRecord {
  PK: `MOCKUP#${string}`;
  SK: 'METADATA';
  GSI1PK: `STATUS#${string}`;
  GSI1SK: `CREATED#${string}`;
  id: string;
  patternId: string;
  garmentType: GarmentType;
  designS3Key: string;
  frontImageS3Key: string;
  backImageS3Key: string;
  placementZone: PlacementZone;
  scalingPercentage?: number;
  status: MockupStatus;
  approvalTimestamp?: string;
  rejectionReason?: string;
  publishedAt?: string;
  publishStatus: PublishStatus;
  createdAt: string;
  createdBy: string;
}

/**
 * Approval Audit Record — immutable log of mockup approval actions.
 * PK: MOCKUP#{id}
 * SK: AUDIT#{timestamp}
 * GSI1PK: ADMIN#{adminId}
 * GSI1SK: ACTION#{timestamp}
 */
export interface ApprovalAuditRecord extends BaseRecord {
  PK: `MOCKUP#${string}`;
  SK: `AUDIT#${string}`;
  GSI1PK: `ADMIN#${string}`;
  GSI1SK: `ACTION#${string}`;
  mockupId: string;
  action: 'approved' | 'rejected' | 'invalid_attempt';
  adminId: string;
  adminEmail: string;
  timestamp: string;
  rejectionReason?: string;
}

// ---------------------------------------------------------------------------
// Product Entity
// ---------------------------------------------------------------------------

/**
 * Published Product Record — product data for the exhibition website.
 * PK: PRODUCT#{id}
 * SK: METADATA
 * GSI1PK: PUBLISHED#{flag}
 * GSI1SK: CREATED#{timestamp}
 */
export interface PublishedProductRecord extends BaseRecord {
  PK: `PRODUCT#${string}`;
  SK: 'METADATA';
  GSI1PK: `PUBLISHED#${string}`;
  GSI1SK: `CREATED#${string}`;
  id: string;
  mockupId: string;
  productName: { es: string; en: string };
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  availableSizes: string[];
  frontImageS3Key: string;
  backImageS3Key: string;
  publishedAt: string;
  publishedBy: string;
}

// ---------------------------------------------------------------------------
// Quote Entities
// ---------------------------------------------------------------------------

/** Quote lifecycle status values. */
export type QuoteStatus = 'pending' | 'quoted' | 'accepted' | 'rejected';

/**
 * Quote Record — stores quote request data submitted by clients.
 * PK: QUOTE#{id}
 * SK: METADATA
 * GSI1PK: QSTATUS#{status}
 * GSI1SK: CREATED#{timestamp}
 */
export interface QuoteRecord extends BaseRecord {
  PK: `QUOTE#${string}`;
  SK: 'METADATA';
  GSI1PK: `QSTATUS#${string}`;
  GSI1SK: `CREATED#${string}`;
  id: string;
  trackingNumber: string;
  clientName: string;
  email: string;
  phone: string;
  productId: string;
  productName: string;
  quantity: number;
  ageGroup: AgeGroup;
  sizes: (ChildrenSize | AdultSize)[];
  customizationNotes?: string;
  status: QuoteStatus;
  unitPrice?: number;
  totalPrice?: number;
  currency?: string;
  validUntil?: string;
  quoteLinkToken?: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Quote Tracking Index — allows lookup by tracking number.
 * PK: TRACK#{trackingNumber}
 * SK: QUOTE
 */
export interface QuoteTrackingRecord extends BaseRecord {
  PK: `TRACK#${string}`;
  SK: 'QUOTE';
  quoteId: string;
}

// ---------------------------------------------------------------------------
// Social Content Entity
// ---------------------------------------------------------------------------

/** Social content review status values. */
export type SocialContentStatus = 'pending_review' | 'approved' | 'rejected';

/**
 * Social Content Record — auto-generated social media content.
 * PK: SOCIAL#{id}
 * SK: METADATA
 * GSI1PK: STATUS#{status}
 * GSI1SK: CREATED#{timestamp}
 */
export interface SocialContentRecord extends BaseRecord {
  PK: `SOCIAL#${string}`;
  SK: 'METADATA';
  GSI1PK: `STATUS#${string}`;
  GSI1SK: `CREATED#${string}`;
  id: string;
  productId: string;
  instagramImageS3Key: string;
  facebookImageS3Key: string;
  captionText: string;
  status: SocialContentStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// WhatsApp Entities
// ---------------------------------------------------------------------------

/** WhatsApp message delivery status values. */
export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

/**
 * Delivery Log Record — logs WhatsApp message delivery status.
 * PK: WALOG#{phone}
 * SK: MSG#{iso-timestamp}
 * GSI1PK: DELIVERY#{status}
 * GSI1SK: SENT#{iso-timestamp}
 */
export interface DeliveryLogRecord extends BaseRecord {
  PK: `WALOG#${string}`;
  SK: `MSG#${string}`;
  GSI1PK: `DELIVERY#${string}`;
  GSI1SK: `SENT#${string}`;
  messageType: 'mockup' | 'quote';
  recipientPhone: string;
  deliveryTimestamp: string;
  status: DeliveryStatus;
  clientResponse?: string;
  relatedEntityId: string;
}

/**
 * WhatsApp Message Queue Record — queued messages for retry.
 * PK: WAQUEUE
 * SK: MSG#{timestamp}#{id}
 */
export interface WAMessageQueueRecord extends BaseRecord {
  PK: 'WAQUEUE';
  SK: `MSG#${string}`;
  messageId: string;
  messageType: 'mockup' | 'quote';
  recipientPhone: string;
  payload: Record<string, unknown>;
  retryCount: number;
  createdAt: string;
  ttl: number;
}

// ---------------------------------------------------------------------------
// Monitoring Entity
// ---------------------------------------------------------------------------

/**
 * Usage Metric Record — tracks AWS service consumption for Free Tier monitoring.
 * PK: USAGE#{service}
 * SK: PERIOD#{YYYY-MM}
 */
export interface UsageMetricRecord extends BaseRecord {
  PK: `USAGE#${string}`;
  SK: `PERIOD#${string}`;
  service: string;
  currentUsage: number;
  freeLimit: number;
  percentUsed: number;
  lastCheckedAt: string;
  alertSentAt?: string;
  disabledAt?: string;
}

// ---------------------------------------------------------------------------
// Security / Audit Entities
// ---------------------------------------------------------------------------

/**
 * Audit Log Entry — immutable record of admin actions.
 * PK: AUDIT#{adminId}
 * SK: ACTION#{timestamp}
 * GSI1PK: AUDITTYPE#{actionType}
 * GSI1SK: TIME#{timestamp}
 * GSI2PK: RESOURCE#{type}
 * GSI2SK: RESID#{resourceId}
 */
export interface AuditLogEntry extends BaseRecord {
  PK: `AUDIT#${string}`;
  SK: `ACTION#${string}`;
  GSI1PK: `AUDITTYPE#${string}`;
  GSI1SK: `TIME#${string}`;
  GSI2PK: `RESOURCE#${string}`;
  GSI2SK: `RESID#${string}`;
  adminId: string;
  adminEmail: string;
  timestamp: string;
  actionType: string;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

/**
 * Login Attempt Record — tracks login attempts for rate limiting.
 * PK: LOGINATTEMPT#{ip}
 * SK: ATTEMPT#{timestamp}
 * TTL-based auto-expiration.
 */
export interface LoginAttemptRecord extends BaseRecord {
  PK: `LOGINATTEMPT#${string}`;
  SK: `ATTEMPT#${string}`;
  ipAddress: string;
  timestamp: string;
  success: boolean;
  adminEmail?: string;
  ttl: number;
}

// ---------------------------------------------------------------------------
// Rebuild Entities
// ---------------------------------------------------------------------------

/**
 * Rebuild Queue Entry — queued site rebuild requests processed sequentially.
 * PK: REBUILD
 * SK: QUEUED#{timestamp}#{rebuildId}
 * TTL: +1 hour (auto-expire stale entries)
 */
export interface RebuildQueueRecord extends BaseRecord {
  PK: 'REBUILD';
  SK: `QUEUED#${string}`;
  rebuildId: string;
  triggeredBy: string;
  reason: 'publish' | 'unpublish' | 'manual';
  createdAt: string;
  ttl: number;
}

/**
 * Rebuild Status Record — tracks the lifecycle of a site rebuild.
 * PK: REBUILD#{rebuildId}
 * SK: STATUS
 * TTL: +24 hours (auto-expire)
 */
export interface RebuildStatusRecord extends BaseRecord {
  PK: `REBUILD#${string}`;
  SK: 'STATUS';
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  startedAt?: string;
  completedAt?: string;
  pagesGenerated?: number;
  changedPaths?: string[];
  error?: string;
  retryCount: number;
  ttl: number;
}

// ---------------------------------------------------------------------------
// Rate Limit / CAPTCHA Entities
// ---------------------------------------------------------------------------

/**
 * Rate Limit Counter — tracks request counts per IP/endpoint per time window.
 * PK: RATELIMIT#{ip}#{endpoint}
 * SK: WINDOW#{windowStartTimestamp}
 * TTL: window end timestamp (auto-expire)
 */
export interface RateLimitRecord extends BaseRecord {
  PK: `RATELIMIT#${string}`;
  SK: `WINDOW#${string}`;
  requestCount: number;
  windowStartMs: number;
  ttl: number;
}

/**
 * Used CAPTCHA Token — prevents hCaptcha token replay attacks.
 * PK: CAPTCHA#{sha256(token)}
 * SK: USED
 * TTL: +5 minutes from creation
 */
export interface UsedCaptchaRecord extends BaseRecord {
  PK: `CAPTCHA#${string}`;
  SK: 'USED';
  usedAt: string;
  ttl: number;
}
