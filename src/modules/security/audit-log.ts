/**
 * Audit log service for CronusFit.
 *
 * Records all admin actions (pattern generation, mockup approval, publish, etc.)
 * with best-effort semantics — audit writes never block the primary operation.
 *
 * Retry logic: up to 5 retries with exponential backoff (100ms, 200ms, 400ms, 800ms, 1600ms).
 *
 * Provides two write modes:
 * - `recordAuditEntry`: best-effort, catches all errors silently (logs to console.error)
 * - `recordAuditEntryStrict`: throws after all retries exhausted (for operations where audit IS required)
 *
 * Query methods support fetching audit entries by admin, action type, or resource.
 */

import { writeAuditLog, queryByPK, queryByGSI1, queryByGSI2 } from '../../db/operations.js';
import type { AuditLogEntry } from '../../types/security.js';
import type { QueryOptions } from '../../db/operations.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for creating an audit log entry. */
export interface AuditEntryInput {
  /** Admin's Cognito sub identifier. */
  adminId: string;
  /** Admin's email address. */
  adminEmail: string;
  /** Type of action performed (e.g., 'pattern_generate', 'mockup_approve', 'publish', 'quote_price'). */
  actionType: string;
  /** Identifier of the affected resource. */
  resourceId: string;
  /** Type of the affected resource (e.g., 'pattern', 'mockup', 'quote', 'product'). */
  resourceType: string;
  /** Additional metadata about the action. */
  metadata?: Record<string, unknown>;
}

/** Stored audit entry returned from queries. */
export interface AuditEntry {
  adminId: string;
  adminEmail: string;
  timestamp: string;
  actionType: string;
  resourceId: string;
  resourceType: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum number of retry attempts for audit writes. */
const MAX_RETRIES = 5;

/** Base delay in milliseconds for exponential backoff. */
const BASE_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Calculates the delay for a given retry attempt using exponential backoff.
 * Delays: 100ms, 200ms, 400ms, 800ms, 1600ms
 */
export function calculateBackoffDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

/**
 * Internal delay implementation. Exposed via `_internals` for test overriding.
 */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exposed internals for testing. Allows replacing the sleep function
 * without module-level mocking complexity.
 */
export const _internals = {
  sleep: defaultSleep,
};

/**
 * Writes an audit log entry with retry logic.
 * Throws the last error if all retries are exhausted.
 */
async function writeWithRetry(entry: AuditEntryInput): Promise<void> {
  const timestamp = new Date().toISOString();

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await writeAuditLog({
        adminId: entry.adminId,
        adminEmail: entry.adminEmail,
        timestamp,
        actionType: entry.actionType,
        resourceId: entry.resourceId,
        resourceType: entry.resourceType,
        metadata: entry.metadata,
      });
      return; // Success — exit immediately
    } catch (error: unknown) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        const delay = calculateBackoffDelay(attempt);
        await _internals.sleep(delay);
      }
    }
  }

  // All retries exhausted — throw the last error
  throw lastError;
}

// ---------------------------------------------------------------------------
// Public API — Write Operations
// ---------------------------------------------------------------------------

/**
 * Records an audit log entry with best-effort semantics.
 *
 * Never throws — on failure after all retries, logs the error to console.error
 * and returns silently. This ensures the primary operation is never blocked
 * by audit logging failures.
 *
 * @param entry - The audit entry to record
 */
export async function recordAuditEntry(entry: AuditEntryInput): Promise<void> {
  try {
    await writeWithRetry(entry);
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        type: 'AUDIT_WRITE_FAILURE',
        adminId: entry.adminId,
        actionType: entry.actionType,
        resourceId: entry.resourceId,
        resourceType: entry.resourceType,
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
    );
  }
}

/**
 * Records an audit log entry with strict semantics.
 *
 * Throws after all retries are exhausted. Use this for operations where
 * audit recording IS required (e.g., rejection actions per Requirement 5.3).
 *
 * @param entry - The audit entry to record
 * @throws Error if all retry attempts fail
 */
export async function recordAuditEntryStrict(entry: AuditEntryInput): Promise<void> {
  await writeWithRetry(entry);
}

// ---------------------------------------------------------------------------
// Public API — Query Operations
// ---------------------------------------------------------------------------

/**
 * Queries audit entries by admin identity.
 *
 * Uses the main table PK: `AUDIT#{adminId}` with SK prefix `ACTION#`.
 * Results are ordered by timestamp (ascending by default).
 *
 * @param adminId - The admin's Cognito sub identifier
 * @param options - Optional query parameters (limit, pagination, sort order)
 * @returns Array of audit entries for the specified admin
 */
export async function queryAuditByAdmin(
  adminId: string,
  options?: QueryOptions
): Promise<AuditEntry[]> {
  const result = await queryByPK<AuditLogEntry>(
    `AUDIT#${adminId}`,
    { expression: 'begins_with(SK, :sk)', value: 'ACTION#' },
    options
  );

  return result.items.map(mapToAuditEntry);
}

/**
 * Queries audit entries by action type.
 *
 * Uses GSI-1: `AUDITTYPE#{actionType}` with SK prefix `TIME#`.
 * Results are ordered by timestamp (ascending by default).
 *
 * @param actionType - The action type to filter by (e.g., 'mockup_approve')
 * @param options - Optional query parameters (limit, pagination, sort order)
 * @returns Array of audit entries for the specified action type
 */
export async function queryAuditByAction(
  actionType: string,
  options?: QueryOptions
): Promise<AuditEntry[]> {
  const result = await queryByGSI1<AuditLogEntry>(
    `AUDITTYPE#${actionType}`,
    { expression: 'begins_with(GSI1SK, :sk)', value: 'TIME#' },
    options
  );

  return result.items.map(mapToAuditEntry);
}

/**
 * Queries audit entries by resource type and resource ID.
 *
 * Uses GSI-2: `RESOURCE#{resourceType}` with SK `RESID#{resourceId}`.
 *
 * @param resourceType - The resource type (e.g., 'pattern', 'mockup')
 * @param resourceId - The specific resource identifier
 * @returns Array of audit entries for the specified resource
 */
export async function queryAuditByResource(
  resourceType: string,
  resourceId: string
): Promise<AuditEntry[]> {
  const result = await queryByGSI2<AuditLogEntry>(
    `RESOURCE#${resourceType}`,
    { expression: 'GSI2SK = :sk', value: `RESID#${resourceId}` }
  );

  return result.items.map(mapToAuditEntry);
}

// ---------------------------------------------------------------------------
// Internal Mapping
// ---------------------------------------------------------------------------

/**
 * Maps a raw DynamoDB AuditLogEntry record to the public AuditEntry interface.
 */
function mapToAuditEntry(record: AuditLogEntry): AuditEntry {
  return {
    adminId: record.adminId,
    adminEmail: record.adminEmail,
    timestamp: record.timestamp,
    actionType: record.actionType,
    resourceId: record.resourceId,
    resourceType: record.resourceType,
    metadata: record.metadata,
  };
}
