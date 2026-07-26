/**
 * Property-based tests for Approval Workflow module.
 *
 * **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**
 *
 * Properties tested:
 * 12. Approval State Machine Integrity
 * 13. Approval Queue Ordering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// --- Mocks ---

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockQueryByGSI1 = vi.fn();
const mockPut = vi.fn();
const mockQueryByPK = vi.fn();

vi.mock('../../src/db/operations.js', () => ({
  get: (...args: unknown[]) => mockGet(...args),
  update: (...args: unknown[]) => mockUpdate(...args),
  queryByGSI1: (...args: unknown[]) => mockQueryByGSI1(...args),
  queryByPK: (...args: unknown[]) => mockQueryByPK(...args),
  put: (...args: unknown[]) => mockPut(...args),
}));

const mockRecordAuditEntry = vi.fn();
const mockRecordAuditEntryStrict = vi.fn();

vi.mock('../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: (...args: unknown[]) => mockRecordAuditEntry(...args),
  recordAuditEntryStrict: (...args: unknown[]) => mockRecordAuditEntryStrict(...args),
}));

import { approveMockup, rejectMockup, canPublishMockup } from '../../src/modules/approval/workflow.js';
import { getPendingMockups } from '../../src/modules/approval/queue.js';
import type { MockupRecord, MockupStatus } from '../../src/db/entities.js';

// --- Generators ---

/** Arbitrary UUID-like mockup ID. */
const arbMockupId = fc.uuid();

/** Arbitrary admin ID (Cognito sub format). */
const arbAdminId = fc.uuid();

/** Arbitrary admin email. */
const arbAdminEmail = fc.emailAddress();

/** Arbitrary valid rejection reason (1-500 characters). */
const arbValidReason = fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length >= 1 && s.trim().length <= 500);

/** Arbitrary invalid rejection reason — too short (empty or whitespace-only). */
const arbEmptyReason = fc.constantFrom('', '   ', '\t', '\n', '  \n  ');

/** Arbitrary invalid rejection reason — too long (>500 characters after trim). */
const arbTooLongReason = fc.string({ minLength: 501, maxLength: 600 }).filter((s) => s.trim().length > 500);

/** Arbitrary non-reviewable status (approved or rejected). */
const arbNonReviewableStatus = fc.constantFrom<MockupStatus>('approved', 'rejected');

/** Arbitrary ISO 8601 timestamp. */
const arbTimestamp = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map((d) => d.toISOString());

/**
 * Build a mock MockupRecord with the given status and optional fields.
 */
function buildMockupRecord(
  id: string,
  status: MockupStatus,
  createdAt?: string
): MockupRecord {
  const ts = createdAt ?? new Date().toISOString();
  return {
    PK: `MOCKUP#${id}`,
    SK: 'METADATA',
    GSI1PK: `STATUS#${status}`,
    GSI1SK: `CREATED#${ts}`,
    id,
    patternId: 'pattern-001',
    garmentType: 'camiseta',
    designS3Key: `designs/${id}/design.png`,
    frontImageS3Key: `mockups/${id}/front.png`,
    backImageS3Key: `mockups/${id}/back.png`,
    placementZone: 'chest',
    status,
    publishStatus: 'unpublished',
    createdAt: ts,
    createdBy: 'admin-001',
  };
}

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();

  // Default mocks
  mockRecordAuditEntry.mockResolvedValue(undefined);
  mockRecordAuditEntryStrict.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(null);
  mockPut.mockResolvedValue(undefined);
});

// --- Property 12: Approval State Machine Integrity ---

describe('Property 12: Approval State Machine Integrity', () => {
  it('[property] approving a pending_approval mockup ALWAYS succeeds with status=approved', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        arbAdminId,
        arbAdminEmail,
        async (mockupId, adminId, adminEmail) => {
          const mockup = buildMockupRecord(mockupId, 'pending_approval');
          mockGet.mockResolvedValue(mockup);
          mockUpdate.mockResolvedValue(null);
          mockRecordAuditEntry.mockResolvedValue(undefined);

          const result = await approveMockup(mockupId, adminId, adminEmail);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.newStatus).toBe('approved');
            expect(result.mockupId).toBe(mockupId);
            expect(result.approvalTimestamp).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejecting a pending_approval mockup with valid reason (1-500 chars) ALWAYS succeeds', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        arbAdminId,
        arbAdminEmail,
        arbValidReason,
        async (mockupId, adminId, adminEmail, reason) => {
          const mockup = buildMockupRecord(mockupId, 'pending_approval');
          mockGet.mockResolvedValue(mockup);
          mockUpdate.mockResolvedValue(null);
          mockRecordAuditEntryStrict.mockResolvedValue(undefined);

          const result = await rejectMockup(mockupId, adminId, adminEmail, reason);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.newStatus).toBe('rejected');
            expect(result.mockupId).toBe(mockupId);
            expect(result.rejectionReason).toBe(reason.trim());
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] approving a non-pending_approval mockup ALWAYS fails with INVALID_STATE_TRANSITION', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        arbAdminId,
        arbAdminEmail,
        arbNonReviewableStatus,
        async (mockupId, adminId, adminEmail, status) => {
          const mockup = buildMockupRecord(mockupId, status);
          mockGet.mockResolvedValue(mockup);
          mockRecordAuditEntry.mockResolvedValue(undefined);

          const result = await approveMockup(mockupId, adminId, adminEmail);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.code).toBe('INVALID_STATE_TRANSITION');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejecting a non-pending_approval mockup ALWAYS fails with INVALID_STATE_TRANSITION', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        arbAdminId,
        arbAdminEmail,
        arbNonReviewableStatus,
        arbValidReason,
        async (mockupId, adminId, adminEmail, status, reason) => {
          const mockup = buildMockupRecord(mockupId, status);
          mockGet.mockResolvedValue(mockup);
          mockRecordAuditEntry.mockResolvedValue(undefined);

          const result = await rejectMockup(mockupId, adminId, adminEmail, reason);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.code).toBe('INVALID_STATE_TRANSITION');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejection with empty/whitespace-only reason ALWAYS returns INVALID_REJECTION_REASON', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        arbAdminId,
        arbAdminEmail,
        arbEmptyReason,
        async (mockupId, adminId, adminEmail, reason) => {
          // The validation happens before the DB call, so no mock needed for get
          const result = await rejectMockup(mockupId, adminId, adminEmail, reason);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.code).toBe('INVALID_REJECTION_REASON');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejection with reason >500 chars ALWAYS returns INVALID_REJECTION_REASON', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        arbAdminId,
        arbAdminEmail,
        arbTooLongReason,
        async (mockupId, adminId, adminEmail, reason) => {
          const result = await rejectMockup(mockupId, adminId, adminEmail, reason);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.code).toBe('INVALID_REJECTION_REASON');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] for valid rejection, audit entry is recorded (strict) BEFORE state change', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        arbAdminId,
        arbAdminEmail,
        arbValidReason,
        async (mockupId, adminId, adminEmail, reason) => {
          const mockup = buildMockupRecord(mockupId, 'pending_approval');
          mockGet.mockResolvedValue(mockup);

          // Track call order
          const callOrder: string[] = [];
          mockRecordAuditEntryStrict.mockImplementation(async () => {
            callOrder.push('audit');
          });
          mockUpdate.mockImplementation(async () => {
            callOrder.push('update');
            return null;
          });

          const result = await rejectMockup(mockupId, adminId, adminEmail, reason);

          expect(result.success).toBe(true);
          // Audit must be called before the state change (update)
          expect(callOrder.indexOf('audit')).toBeLessThan(callOrder.indexOf('update'));
          // Verify audit was called with correct params
          expect(mockRecordAuditEntryStrict).toHaveBeenCalledWith(
            expect.objectContaining({
              adminId,
              adminEmail,
              actionType: 'mockup_reject',
              resourceId: mockupId,
              resourceType: 'mockup',
            }),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] only approved mockups are eligible for publication', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        fc.constantFrom<MockupStatus>('pending_approval', 'rejected'),
        async (mockupId, status) => {
          const mockup = buildMockupRecord(mockupId, status);
          mockGet.mockResolvedValue(mockup);

          const result = await canPublishMockup(mockupId);

          expect(result.eligible).toBe(false);
          expect(result.mockupId).toBe(mockupId);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] approved mockups ARE eligible for publication', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMockupId,
        async (mockupId) => {
          const mockup = buildMockupRecord(mockupId, 'approved');
          mockGet.mockResolvedValue(mockup);

          const result = await canPublishMockup(mockupId);

          expect(result.eligible).toBe(true);
          expect(result.mockupId).toBe(mockupId);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 13: Approval Queue Ordering ---

describe('Property 13: Approval Queue Ordering', () => {
  it('[property] pending mockups queue ALWAYS returns items in ascending timestamp order (oldest first)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbTimestamp, { minLength: 2, maxLength: 20 }),
        async (timestamps) => {
          // Build mockup records with different creation timestamps
          const mockups: MockupRecord[] = timestamps.map((ts, idx) =>
            buildMockupRecord(`mockup-${idx}`, 'pending_approval', ts),
          );

          // Sort by GSI1SK (CREATED#timestamp) ascending — this is what DynamoDB returns
          const sortedMockups = [...mockups].sort((a, b) =>
            a.GSI1SK.localeCompare(b.GSI1SK),
          );

          mockQueryByGSI1.mockResolvedValue({
            items: sortedMockups,
            lastEvaluatedKey: undefined,
            count: sortedMockups.length,
          });

          const result = await getPendingMockups({ limit: 50 });

          // Verify ordering: each item's createdAt must be <= the next item's createdAt
          for (let i = 1; i < result.items.length; i++) {
            const prev = new Date(result.items[i - 1].createdAt).getTime();
            const curr = new Date(result.items[i].createdAt).getTime();
            expect(prev).toBeLessThanOrEqual(curr);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] queue results ALWAYS have status pending_approval', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbTimestamp, { minLength: 1, maxLength: 15 }),
        async (timestamps) => {
          const mockups: MockupRecord[] = timestamps.map((ts, idx) =>
            buildMockupRecord(`mockup-${idx}`, 'pending_approval', ts),
          );

          const sortedMockups = [...mockups].sort((a, b) =>
            a.GSI1SK.localeCompare(b.GSI1SK),
          );

          mockQueryByGSI1.mockResolvedValue({
            items: sortedMockups,
            lastEvaluatedKey: undefined,
            count: sortedMockups.length,
          });

          const result = await getPendingMockups();

          // Every item in the queue must have status 'pending_approval'
          for (const item of result.items) {
            expect(item.status).toBe('pending_approval');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
