import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db operations module
vi.mock('../../../src/db/operations.js', () => ({
  get: vi.fn(),
  update: vi.fn(),
}));

// Mock the audit-log module
vi.mock('../../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: vi.fn(),
  recordAuditEntryStrict: vi.fn(),
}));

import { get, update } from '../../../src/db/operations.js';
import { recordAuditEntry, recordAuditEntryStrict } from '../../../src/modules/security/audit-log.js';
import {
  approveMockup,
  rejectMockup,
  canPublishMockup,
} from '../../../src/modules/approval/workflow.js';
import type { MockupRecord } from '../../../src/db/entities.js';

const mockedGet = vi.mocked(get);
const mockedUpdate = vi.mocked(update);
const mockedRecordAuditEntry = vi.mocked(recordAuditEntry);
const mockedRecordAuditEntryStrict = vi.mocked(recordAuditEntryStrict);

describe('approval/workflow', () => {
  const adminId = 'admin-sub-001';
  const adminEmail = 'admin@cronusfit.com';
  const mockupId = 'mockup-abc-123';

  const pendingMockup: MockupRecord = {
    PK: `MOCKUP#${mockupId}`,
    SK: 'METADATA',
    GSI1PK: 'STATUS#pending_approval',
    GSI1SK: 'CREATED#2024-06-15T10:00:00.000Z',
    id: mockupId,
    patternId: 'pattern-xyz',
    garmentType: 'camiseta',
    designS3Key: 'mockups/design.png',
    frontImageS3Key: 'mockups/front.png',
    backImageS3Key: 'mockups/back.png',
    placementZone: 'chest',
    status: 'pending_approval',
    publishStatus: 'unpublished',
    createdAt: '2024-06-15T10:00:00.000Z',
    createdBy: adminId,
  };

  const approvedMockup: MockupRecord = {
    ...pendingMockup,
    GSI1PK: 'STATUS#approved',
    status: 'approved',
    approvalTimestamp: '2024-06-15T12:00:00.000Z',
  };

  const rejectedMockup: MockupRecord = {
    ...pendingMockup,
    GSI1PK: 'STATUS#rejected',
    status: 'rejected',
    rejectionReason: 'Low quality',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T14:30:00.000Z'));
    mockedRecordAuditEntry.mockResolvedValue(undefined);
    mockedRecordAuditEntryStrict.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // approveMockup
  // -------------------------------------------------------------------------
  describe('approveMockup', () => {
    it('approves a pending mockup successfully', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      const result = await approveMockup(mockupId, adminId, adminEmail);

      expect(result).toEqual({
        success: true,
        mockupId,
        newStatus: 'approved',
        approvalTimestamp: '2024-06-15T14:30:00.000Z',
      });
    });

    it('performs conditional update with correct parameters', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      await approveMockup(mockupId, adminId, adminEmail);

      expect(mockedUpdate).toHaveBeenCalledWith(
        `MOCKUP#${mockupId}`,
        'METADATA',
        expect.objectContaining({
          conditionExpression: '#currentStatus = :expectedStatus',
          expressionAttributeValues: expect.objectContaining({
            ':newStatus': 'approved',
            ':expectedStatus': 'pending_approval',
            ':gsi1pk': 'STATUS#approved',
          }),
        })
      );
    });

    it('records audit entry (best-effort) after approval', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      await approveMockup(mockupId, adminId, adminEmail);

      expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId,
          adminEmail,
          actionType: 'mockup_approve',
          resourceId: mockupId,
          resourceType: 'mockup',
        })
      );
    });

    it('returns error when mockup is not found', async () => {
      mockedGet.mockResolvedValue(null);

      const result = await approveMockup(mockupId, adminId, adminEmail);

      expect(result).toEqual({
        success: false,
        error: `Mockup '${mockupId}' not found`,
        code: 'MOCKUP_NOT_FOUND',
      });
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it('returns error when mockup is already approved', async () => {
      mockedGet.mockResolvedValue(approvedMockup);

      const result = await approveMockup(mockupId, adminId, adminEmail);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('approved'),
        code: 'INVALID_STATE_TRANSITION',
      });
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it('returns error when mockup is already rejected', async () => {
      mockedGet.mockResolvedValue(rejectedMockup);

      const result = await approveMockup(mockupId, adminId, adminEmail);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('rejected'),
        code: 'INVALID_STATE_TRANSITION',
      });
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it('logs invalid state transition attempt in audit trail', async () => {
      mockedGet.mockResolvedValue(approvedMockup);

      await approveMockup(mockupId, adminId, adminEmail);

      expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'mockup_approve_invalid',
          resourceId: mockupId,
          metadata: expect.objectContaining({
            currentStatus: 'approved',
          }),
        })
      );
    });

    it('handles ConditionalCheckFailedException gracefully', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      const conditionalError = new Error('Condition not met');
      (conditionalError as unknown as { name: string }).name = 'ConditionalCheckFailedException';
      mockedUpdate.mockRejectedValue(conditionalError);

      const result = await approveMockup(mockupId, adminId, adminEmail);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('concurrently'),
        code: 'CONDITION_CHECK_FAILED',
      });
    });

    it('succeeds even if audit write fails (best-effort)', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);
      mockedRecordAuditEntry.mockRejectedValue(new Error('DynamoDB timeout'));

      const result = await approveMockup(mockupId, adminId, adminEmail);

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });
  });

  // -------------------------------------------------------------------------
  // rejectMockup
  // -------------------------------------------------------------------------
  describe('rejectMockup', () => {
    const validReason = 'Design does not meet quality standards';

    it('rejects a pending mockup successfully', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      const result = await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(result).toEqual({
        success: true,
        mockupId,
        newStatus: 'rejected',
        rejectionReason: validReason,
      });
    });

    it('performs conditional update with rejection reason', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(mockedUpdate).toHaveBeenCalledWith(
        `MOCKUP#${mockupId}`,
        'METADATA',
        expect.objectContaining({
          conditionExpression: '#currentStatus = :expectedStatus',
          expressionAttributeValues: expect.objectContaining({
            ':newStatus': 'rejected',
            ':reason': validReason,
            ':expectedStatus': 'pending_approval',
          }),
        })
      );
    });

    it('uses strict audit logging for rejections (Req 5.3)', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(mockedRecordAuditEntryStrict).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId,
          adminEmail,
          actionType: 'mockup_reject',
          resourceId: mockupId,
          resourceType: 'mockup',
          metadata: expect.objectContaining({
            rejectionReason: validReason,
          }),
        })
      );
    });

    it('prevents rejection when audit trail write fails (Req 5.3)', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedRecordAuditEntryStrict.mockRejectedValue(new Error('DynamoDB write failed'));

      const result = await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('audit trail recording failed'),
        code: 'AUDIT_WRITE_FAILED',
      });
      expect(mockedUpdate).not.toHaveBeenCalled();
    });

    it('returns error when reason is empty', async () => {
      const result = await rejectMockup(mockupId, adminId, adminEmail, '');

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('between 1 and 500'),
        code: 'INVALID_REJECTION_REASON',
      });
      expect(mockedGet).not.toHaveBeenCalled();
    });

    it('returns error when reason is only whitespace', async () => {
      const result = await rejectMockup(mockupId, adminId, adminEmail, '   ');

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('between 1 and 500'),
        code: 'INVALID_REJECTION_REASON',
      });
    });

    it('returns error when reason exceeds 500 characters', async () => {
      const longReason = 'x'.repeat(501);

      const result = await rejectMockup(mockupId, adminId, adminEmail, longReason);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('between 1 and 500'),
        code: 'INVALID_REJECTION_REASON',
      });
    });

    it('accepts reason at exactly 500 characters', async () => {
      const maxReason = 'x'.repeat(500);
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      const result = await rejectMockup(mockupId, adminId, adminEmail, maxReason);

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it('accepts reason at exactly 1 character', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      const result = await rejectMockup(mockupId, adminId, adminEmail, 'X');

      expect(result).toEqual(expect.objectContaining({ success: true }));
    });

    it('returns error when mockup is not found', async () => {
      mockedGet.mockResolvedValue(null);

      const result = await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(result).toEqual({
        success: false,
        error: `Mockup '${mockupId}' not found`,
        code: 'MOCKUP_NOT_FOUND',
      });
    });

    it('returns error when mockup is already approved', async () => {
      mockedGet.mockResolvedValue(approvedMockup);

      const result = await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('approved'),
        code: 'INVALID_STATE_TRANSITION',
      });
    });

    it('logs invalid state transition attempt in audit trail', async () => {
      mockedGet.mockResolvedValue(rejectedMockup);

      await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(mockedRecordAuditEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'mockup_reject_invalid',
          metadata: expect.objectContaining({
            currentStatus: 'rejected',
          }),
        })
      );
    });

    it('handles ConditionalCheckFailedException gracefully', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      const conditionalError = new Error('Condition not met');
      (conditionalError as unknown as { name: string }).name = 'ConditionalCheckFailedException';
      mockedUpdate.mockRejectedValue(conditionalError);

      const result = await rejectMockup(mockupId, adminId, adminEmail, validReason);

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('concurrently'),
        code: 'CONDITION_CHECK_FAILED',
      });
    });

    it('trims whitespace from rejection reason', async () => {
      mockedGet.mockResolvedValue(pendingMockup);
      mockedUpdate.mockResolvedValue(null);

      const result = await rejectMockup(mockupId, adminId, adminEmail, '  Quality issue  ');

      expect(result).toEqual(expect.objectContaining({
        success: true,
        rejectionReason: 'Quality issue',
      }));
    });
  });

  // -------------------------------------------------------------------------
  // canPublishMockup
  // -------------------------------------------------------------------------
  describe('canPublishMockup', () => {
    it('returns eligible for approved mockups', async () => {
      mockedGet.mockResolvedValue(approvedMockup);

      const result = await canPublishMockup(mockupId);

      expect(result).toEqual({
        eligible: true,
        mockupId,
        currentStatus: 'approved',
      });
    });

    it('returns ineligible for pending_approval mockups', async () => {
      mockedGet.mockResolvedValue(pendingMockup);

      const result = await canPublishMockup(mockupId);

      expect(result).toEqual({
        eligible: false,
        mockupId,
        currentStatus: 'pending_approval',
        reason: expect.stringContaining('approved'),
      });
    });

    it('returns ineligible for rejected mockups', async () => {
      mockedGet.mockResolvedValue(rejectedMockup);

      const result = await canPublishMockup(mockupId);

      expect(result).toEqual({
        eligible: false,
        mockupId,
        currentStatus: 'rejected',
        reason: expect.stringContaining('approved'),
      });
    });

    it('returns ineligible when mockup is not found', async () => {
      mockedGet.mockResolvedValue(null);

      const result = await canPublishMockup(mockupId);

      expect(result).toEqual({
        eligible: false,
        mockupId,
        reason: expect.stringContaining('not found'),
      });
    });
  });
});
