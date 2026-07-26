/**
 * Approval Audit Trail — records approval workflow actions as sub-items of mockup records.
 *
 * Stores immutable audit entries for the approval workflow:
 * - PK: MOCKUP#{mockupId}
 * - SK: AUDIT#{timestamp}
 * - GSI1PK: ADMIN#{adminId}
 * - GSI1SK: ACTION#{timestamp}
 *
 * This is SEPARATE from the general security audit-log (src/modules/security/audit-log.ts).
 * This module specifically tracks approval workflow actions and stores them as sub-items
 * of the mockup record for easy per-mockup audit retrieval.
 *
 * Audit writes are best-effort: retry up to 5 times with exponential backoff,
 * but NEVER block the primary approval/rejection operation.
 *
 * @module approval/audit
 * @see Requirement 5.6 — Audit trail of all approval/rejection actions
 * @see Requirement 13.5 — Audit recording with retry queue
 */

import { put, queryByPK } from '../../db/operations.js';
import type { ApprovalAuditRecord } from '../../db/entities.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Action types for the approval audit trail. */
export type ApprovalAction = 'approved' | 'rejected' | 'invalid_attempt';

/** Parameters for recording an approval action. */
export interface RecordApprovalActionParams {
  /** The mockup being acted upon. */
  mockupId: string;
  /** The action performed. */
  action: ApprovalAction;
  /** Admin's Cognito sub identifier. */
  adminId: string;
  /** Admin's email address. */
  adminEmail: string;
  /** ISO 8601 timestamp of the action. */
  timestamp: string;
  /** Reason for rejection (required when action is 'rejected'). */
  rejectionReason?: string;
}

/** A recorded approval audit entry (public interface). */
export interface ApprovalAuditEntry {
  mockupId: string;
  action: ApprovalAction;
  adminId: string;
  adminEmail: string;
  timestamp: string;
  rejectionReason?: string;
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

// ---------------------------------------------------------------------------
// Public API — Write Operations
// ---------------------------------------------------------------------------

/**
 * Records an approval workflow action in the audit trail.
 *
 * Best-effort semantics: retries up to 5 times with exponential backoff,
 * but NEVER throws — on failure after all retries, logs the error via
 * structured logging and returns silently. This ensures the primary
 * approval/rejection operation is never blocked.
 *
 * @param params - The audit action parameters
 */
export async function recordApprovalAction(
  params: RecordApprovalActionParams
): Promise<void> {
  try {
    await writeWithRetry(params);
  } catch (error: unknown) {
    // Best-effort: log failure but never block the primary operation
    console.error(
      JSON.stringify({
        type: 'APPROVAL_AUDIT_WRITE_FAILURE',
        mockupId: params.mockupId,
        action: params.action,
        adminId: params.adminId,
        timestamp: params.timestamp,
        error: error instanceof Error ? error.message : String(error),
        retriesExhausted: true,
      })
    );
  }
}

/**
 * Records an approval workflow action with strict semantics.
 *
 * Throws after all retries are exhausted. Use this for operations where
 * audit recording IS required (e.g., rejection actions per Requirement 5.3).
 *
 * @param params - The audit action parameters
 * @throws Error if all retry attempts fail
 */
export async function recordApprovalActionStrict(
  params: RecordApprovalActionParams
): Promise<void> {
  await writeWithRetry(params);
}

// ---------------------------------------------------------------------------
// Public API — Query Operations
// ---------------------------------------------------------------------------

/**
 * Retrieves the audit trail for a specific mockup.
 *
 * Queries all AUDIT# sub-items under the mockup's PK, ordered by timestamp
 * (ascending by default — oldest first).
 *
 * @param mockupId - The mockup identifier
 * @returns Array of audit entries for the mockup
 */
export async function getAuditTrailForMockup(
  mockupId: string
): Promise<ApprovalAuditEntry[]> {
  const result = await queryByPK<ApprovalAuditRecord>(
    `MOCKUP#${mockupId}`,
    { expression: 'begins_with(SK, :sk)', value: 'AUDIT#' },
    { scanIndexForward: true }
  );

  return result.items.map(mapToAuditEntry);
}

// ---------------------------------------------------------------------------
// Internal — Retry Logic
// ---------------------------------------------------------------------------

/**
 * Writes an approval audit entry with retry logic.
 * Throws the last error if all retries are exhausted.
 */
async function writeWithRetry(params: RecordApprovalActionParams): Promise<void> {
  const record: ApprovalAuditRecord = {
    PK: `MOCKUP#${params.mockupId}`,
    SK: `AUDIT#${params.timestamp}`,
    GSI1PK: `ADMIN#${params.adminId}`,
    GSI1SK: `ACTION#${params.timestamp}`,
    mockupId: params.mockupId,
    action: params.action,
    adminId: params.adminId,
    adminEmail: params.adminEmail,
    timestamp: params.timestamp,
    rejectionReason: params.rejectionReason,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await put(record);
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
// Internal Mapping
// ---------------------------------------------------------------------------

/**
 * Maps a raw DynamoDB ApprovalAuditRecord to the public ApprovalAuditEntry interface.
 */
function mapToAuditEntry(record: ApprovalAuditRecord): ApprovalAuditEntry {
  return {
    mockupId: record.mockupId,
    action: record.action,
    adminId: record.adminId,
    adminEmail: record.adminEmail,
    timestamp: record.timestamp,
    rejectionReason: record.rejectionReason,
  };
}
