/**
 * Approval workflow state machine for CronusFit mockups.
 *
 * Enforces strict state transitions:
 * - Only `pending_approval` → `approved` or `pending_approval` → `rejected`
 * - All other transitions are rejected with an error and audit log entry
 *
 * Uses DynamoDB conditional writes to guarantee atomic state transitions.
 * Audit logging is best-effort for approvals, strict for rejections (per Req 5.3).
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.7
 */

import { get, update } from '../../db/operations.js';
import type { MockupRecord, MockupStatus } from '../../db/entities.js';
import { recordAuditEntry, recordAuditEntryStrict } from '../security/audit-log.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a successful approval operation. */
export interface ApprovalResult {
  success: true;
  mockupId: string;
  newStatus: 'approved';
  approvalTimestamp: string;
}

/** Result of a successful rejection operation. */
export interface RejectionResult {
  success: true;
  mockupId: string;
  newStatus: 'rejected';
  rejectionReason: string;
}

/** Result of a failed workflow operation. */
export interface WorkflowError {
  success: false;
  error: string;
  code: 'MOCKUP_NOT_FOUND' | 'INVALID_STATE_TRANSITION' | 'INVALID_REJECTION_REASON' | 'CONDITION_CHECK_FAILED' | 'AUDIT_WRITE_FAILED';
}

/** Result of a publication eligibility check. */
export interface PublishEligibility {
  eligible: boolean;
  mockupId: string;
  currentStatus?: MockupStatus;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The only valid source status for approval/rejection transitions. */
const REVIEWABLE_STATUS: MockupStatus = 'pending_approval';

/** Minimum length for a rejection reason. */
const MIN_REJECTION_REASON_LENGTH = 1;

/** Maximum length for a rejection reason. */
const MAX_REJECTION_REASON_LENGTH = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Approves a mockup, transitioning it from `pending_approval` to `approved`.
 *
 * Uses a DynamoDB conditional update to atomically enforce that the mockup
 * is currently in `pending_approval` status. Records the approval timestamp.
 * Audit logging is best-effort — approval succeeds even if audit write fails.
 *
 * @param mockupId - The mockup identifier
 * @param adminId - The approving admin's Cognito sub
 * @param adminEmail - The approving admin's email
 * @returns ApprovalResult on success, WorkflowError on failure
 */
export async function approveMockup(
  mockupId: string,
  adminId: string,
  adminEmail: string
): Promise<ApprovalResult | WorkflowError> {
  // Fetch the mockup to validate it exists and check current status
  const mockup = await get<MockupRecord>(`MOCKUP#${mockupId}`, 'METADATA');

  if (!mockup) {
    return {
      success: false,
      error: `Mockup '${mockupId}' not found`,
      code: 'MOCKUP_NOT_FOUND',
    };
  }

  // Check if the mockup is in a reviewable state
  if (mockup.status !== REVIEWABLE_STATUS) {
    // Log the invalid attempt (best-effort)
    recordAuditEntry({
      adminId,
      adminEmail,
      actionType: 'mockup_approve_invalid',
      resourceId: mockupId,
      resourceType: 'mockup',
      metadata: {
        attemptedTransition: `${mockup.status} → approved`,
        currentStatus: mockup.status,
      },
    }).catch(() => {
      // Best-effort — don't block the error response
    });

    return {
      success: false,
      error: `Cannot approve mockup '${mockupId}': current status is '${mockup.status}', expected '${REVIEWABLE_STATUS}'`,
      code: 'INVALID_STATE_TRANSITION',
    };
  }

  // Perform the conditional update atomically
  const approvalTimestamp = new Date().toISOString();

  try {
    await update<MockupRecord>(
      `MOCKUP#${mockupId}`,
      'METADATA',
      {
        updateExpression: 'SET #status = :newStatus, #approvalTs = :approvalTs, GSI1PK = :gsi1pk',
        expressionAttributeNames: {
          '#status': 'status',
          '#approvalTs': 'approvalTimestamp',
          '#currentStatus': 'status',
        },
        expressionAttributeValues: {
          ':newStatus': 'approved',
          ':approvalTs': approvalTimestamp,
          ':gsi1pk': 'STATUS#approved',
          ':expectedStatus': REVIEWABLE_STATUS,
        },
        conditionExpression: '#currentStatus = :expectedStatus',
        returnValues: 'NONE',
      }
    );
  } catch (error: unknown) {
    // ConditionalCheckFailedException means a concurrent update changed the status
    if (isConditionalCheckFailed(error)) {
      return {
        success: false,
        error: `Conditional check failed: mockup '${mockupId}' status was changed concurrently`,
        code: 'CONDITION_CHECK_FAILED',
      };
    }
    throw error;
  }

  // Best-effort audit logging — don't block on failure
  recordAuditEntry({
    adminId,
    adminEmail,
    actionType: 'mockup_approve',
    resourceId: mockupId,
    resourceType: 'mockup',
    metadata: {
      approvalTimestamp,
      previousStatus: REVIEWABLE_STATUS,
    },
  }).catch(() => {
    // Best-effort — approval already succeeded
  });

  return {
    success: true,
    mockupId,
    newStatus: 'approved',
    approvalTimestamp,
  };
}

/**
 * Rejects a mockup, transitioning it from `pending_approval` to `rejected`.
 *
 * Requires a rejection reason (1–500 characters). Uses a DynamoDB conditional
 * update to atomically enforce that the mockup is currently in `pending_approval`
 * status. Per Requirement 5.3, audit logging is STRICT — if the audit trail
 * recording fails, the entire rejection is prevented.
 *
 * @param mockupId - The mockup identifier
 * @param adminId - The rejecting admin's Cognito sub
 * @param adminEmail - The rejecting admin's email
 * @param reason - The rejection reason (1–500 characters)
 * @returns RejectionResult on success, WorkflowError on failure
 */
export async function rejectMockup(
  mockupId: string,
  adminId: string,
  adminEmail: string,
  reason: string
): Promise<RejectionResult | WorkflowError> {
  // Validate rejection reason
  const trimmedReason = reason.trim();
  if (
    trimmedReason.length < MIN_REJECTION_REASON_LENGTH ||
    trimmedReason.length > MAX_REJECTION_REASON_LENGTH
  ) {
    return {
      success: false,
      error: `Rejection reason must be between ${MIN_REJECTION_REASON_LENGTH} and ${MAX_REJECTION_REASON_LENGTH} characters (got ${trimmedReason.length})`,
      code: 'INVALID_REJECTION_REASON',
    };
  }

  // Fetch the mockup to validate it exists and check current status
  const mockup = await get<MockupRecord>(`MOCKUP#${mockupId}`, 'METADATA');

  if (!mockup) {
    return {
      success: false,
      error: `Mockup '${mockupId}' not found`,
      code: 'MOCKUP_NOT_FOUND',
    };
  }

  // Check if the mockup is in a reviewable state
  if (mockup.status !== REVIEWABLE_STATUS) {
    // Log the invalid attempt (best-effort)
    recordAuditEntry({
      adminId,
      adminEmail,
      actionType: 'mockup_reject_invalid',
      resourceId: mockupId,
      resourceType: 'mockup',
      metadata: {
        attemptedTransition: `${mockup.status} → rejected`,
        currentStatus: mockup.status,
        reason: trimmedReason,
      },
    }).catch(() => {
      // Best-effort — don't block the error response
    });

    return {
      success: false,
      error: `Cannot reject mockup '${mockupId}': current status is '${mockup.status}', expected '${REVIEWABLE_STATUS}'`,
      code: 'INVALID_STATE_TRANSITION',
    };
  }

  // Per Requirement 5.3: audit trail recording for rejection is STRICT.
  // If the audit write fails, the entire rejection operation is prevented.
  try {
    await recordAuditEntryStrict({
      adminId,
      adminEmail,
      actionType: 'mockup_reject',
      resourceId: mockupId,
      resourceType: 'mockup',
      metadata: {
        rejectionReason: trimmedReason,
        previousStatus: REVIEWABLE_STATUS,
      },
    });
  } catch (error: unknown) {
    return {
      success: false,
      error: `Rejection prevented: audit trail recording failed — ${error instanceof Error ? error.message : String(error)}`,
      code: 'AUDIT_WRITE_FAILED',
    };
  }

  // Perform the conditional update atomically
  try {
    await update<MockupRecord>(
      `MOCKUP#${mockupId}`,
      'METADATA',
      {
        updateExpression: 'SET #status = :newStatus, #reason = :reason, GSI1PK = :gsi1pk',
        expressionAttributeNames: {
          '#status': 'status',
          '#reason': 'rejectionReason',
          '#currentStatus': 'status',
        },
        expressionAttributeValues: {
          ':newStatus': 'rejected',
          ':reason': trimmedReason,
          ':gsi1pk': 'STATUS#rejected',
          ':expectedStatus': REVIEWABLE_STATUS,
        },
        conditionExpression: '#currentStatus = :expectedStatus',
        returnValues: 'NONE',
      }
    );
  } catch (error: unknown) {
    if (isConditionalCheckFailed(error)) {
      return {
        success: false,
        error: `Conditional check failed: mockup '${mockupId}' status was changed concurrently`,
        code: 'CONDITION_CHECK_FAILED',
      };
    }
    throw error;
  }

  return {
    success: true,
    mockupId,
    newStatus: 'rejected',
    rejectionReason: trimmedReason,
  };
}

/**
 * Checks whether a mockup is eligible for publication.
 *
 * Per Requirement 5.4: only mockups with status 'approved' can be published.
 *
 * @param mockupId - The mockup identifier to check
 * @returns PublishEligibility indicating whether the mockup can be published
 */
export async function canPublishMockup(mockupId: string): Promise<PublishEligibility> {
  const mockup = await get<MockupRecord>(`MOCKUP#${mockupId}`, 'METADATA');

  if (!mockup) {
    return {
      eligible: false,
      mockupId,
      reason: `Mockup '${mockupId}' not found`,
    };
  }

  if (mockup.status !== 'approved') {
    return {
      eligible: false,
      mockupId,
      currentStatus: mockup.status,
      reason: `Mockup must have status 'approved' to be published (current: '${mockup.status}')`,
    };
  }

  return {
    eligible: true,
    mockupId,
    currentStatus: mockup.status,
  };
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Checks if an error is a DynamoDB ConditionalCheckFailedException.
 */
function isConditionalCheckFailed(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { name?: string; __type?: string };
    return (
      err.name === 'ConditionalCheckFailedException' ||
      err.__type === 'com.amazonaws.dynamodb.v20120810#ConditionalCheckFailedException'
    );
  }
  return false;
}
