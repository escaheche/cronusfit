import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db operations module
vi.mock('../../../src/db/operations.js', () => ({
  put: vi.fn(),
  queryByPK: vi.fn(),
}));

import { put, queryByPK } from '../../../src/db/operations.js';
import {
  recordApprovalAction,
  recordApprovalActionStrict,
  getAuditTrailForMockup,
  calculateBackoffDelay,
  _internals,
} from '../../../src/modules/approval/audit.js';
import type { RecordApprovalActionParams } from '../../../src/modules/approval/audit.js';

const mockedPut = vi.mocked(put);
const mockedQueryByPK = vi.mocked(queryByPK);

describe('approval/audit', () => {
  const sampleParams: RecordApprovalActionParams = {
    mockupId: 'mockup-123',
    action: 'approved',
    adminId: 'admin-sub-456',
    adminEmail: 'admin@cronusfit.com',
    timestamp: '2024-06-15T14:30:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Replace sleep with immediate resolution to avoid real delays
    _internals.sleep = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateBackoffDelay', () => {
    it('returns 100ms for attempt 0', () => {
      expect(calculateBackoffDelay(0)).toBe(100);
    });

    it('returns 200ms for attempt 1', () => {
      expect(calculateBackoffDelay(1)).toBe(200);
    });

    it('returns 400ms for attempt 2', () => {
      expect(calculateBackoffDelay(2)).toBe(400);
    });

    it('returns 800ms for attempt 3', () => {
      expect(calculateBackoffDelay(3)).toBe(800);
    });

    it('returns 1600ms for attempt 4', () => {
      expect(calculateBackoffDelay(4)).toBe(1600);
    });
  });

  describe('recordApprovalAction (best-effort)', () => {
    it('writes audit entry on first attempt when successful', async () => {
      mockedPut.mockResolvedValue(undefined);

      await recordApprovalAction(sampleParams);

      expect(mockedPut).toHaveBeenCalledTimes(1);
      expect(mockedPut).toHaveBeenCalledWith({
        PK: 'MOCKUP#mockup-123',
        SK: 'AUDIT#2024-06-15T14:30:00.000Z',
        GSI1PK: 'ADMIN#admin-sub-456',
        GSI1SK: 'ACTION#2024-06-15T14:30:00.000Z',
        mockupId: 'mockup-123',
        action: 'approved',
        adminId: 'admin-sub-456',
        adminEmail: 'admin@cronusfit.com',
        timestamp: '2024-06-15T14:30:00.000Z',
        rejectionReason: undefined,
      });
    });

    it('includes rejectionReason for rejected actions', async () => {
      mockedPut.mockResolvedValue(undefined);

      const rejectParams: RecordApprovalActionParams = {
        ...sampleParams,
        action: 'rejected',
        rejectionReason: 'Design does not match brand guidelines',
      };

      await recordApprovalAction(rejectParams);

      const calledWith = mockedPut.mock.calls[0][0];
      expect(calledWith).toMatchObject({
        action: 'rejected',
        rejectionReason: 'Design does not match brand guidelines',
      });
    });

    it('retries on failure with exponential backoff', async () => {
      mockedPut
        .mockRejectedValueOnce(new Error('DynamoDB timeout'))
        .mockRejectedValueOnce(new Error('DynamoDB timeout'))
        .mockResolvedValue(undefined);

      await recordApprovalAction(sampleParams);

      expect(mockedPut).toHaveBeenCalledTimes(3);
      expect(_internals.sleep).toHaveBeenCalledTimes(2);
      expect(_internals.sleep).toHaveBeenNthCalledWith(1, 100); // attempt 0
      expect(_internals.sleep).toHaveBeenNthCalledWith(2, 200); // attempt 1
    });

    it('never throws even after all retries exhausted', async () => {
      mockedPut.mockRejectedValue(new Error('Persistent failure'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw
      await expect(recordApprovalAction(sampleParams)).resolves.toBeUndefined();

      // Total calls: 1 initial + 5 retries = 6
      expect(mockedPut).toHaveBeenCalledTimes(6);
      consoleSpy.mockRestore();
    });

    it('logs structured error after all retries exhausted', async () => {
      mockedPut.mockRejectedValue(new Error('Connection refused'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await recordApprovalAction(sampleParams);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(loggedMessage);

      expect(parsed.type).toBe('APPROVAL_AUDIT_WRITE_FAILURE');
      expect(parsed.mockupId).toBe('mockup-123');
      expect(parsed.action).toBe('approved');
      expect(parsed.adminId).toBe('admin-sub-456');
      expect(parsed.error).toBe('Connection refused');
      expect(parsed.retriesExhausted).toBe(true);

      consoleSpy.mockRestore();
    });

    it('records invalid_attempt actions', async () => {
      mockedPut.mockResolvedValue(undefined);

      const invalidParams: RecordApprovalActionParams = {
        ...sampleParams,
        action: 'invalid_attempt',
      };

      await recordApprovalAction(invalidParams);

      const calledWith = mockedPut.mock.calls[0][0];
      expect(calledWith).toMatchObject({
        action: 'invalid_attempt',
      });
    });
  });

  describe('recordApprovalActionStrict', () => {
    it('writes audit entry successfully on first attempt', async () => {
      mockedPut.mockResolvedValue(undefined);

      await recordApprovalActionStrict(sampleParams);

      expect(mockedPut).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds on third attempt', async () => {
      mockedPut
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValue(undefined);

      await recordApprovalActionStrict(sampleParams);

      expect(mockedPut).toHaveBeenCalledTimes(3);
    });

    it('throws after all retries exhausted', async () => {
      mockedPut.mockRejectedValue(new Error('Permanent failure'));

      await expect(recordApprovalActionStrict(sampleParams)).rejects.toThrow('Permanent failure');

      // 1 initial + 5 retries = 6 total
      expect(mockedPut).toHaveBeenCalledTimes(6);
    });
  });

  describe('getAuditTrailForMockup', () => {
    it('queries with correct PK and SK prefix', async () => {
      mockedQueryByPK.mockResolvedValue({ items: [], count: 0 });

      await getAuditTrailForMockup('mockup-789');

      expect(mockedQueryByPK).toHaveBeenCalledWith(
        'MOCKUP#mockup-789',
        { expression: 'begins_with(SK, :sk)', value: 'AUDIT#' },
        { scanIndexForward: true }
      );
    });

    it('returns mapped audit entries in chronological order', async () => {
      mockedQueryByPK.mockResolvedValue({
        items: [
          {
            PK: 'MOCKUP#mockup-789',
            SK: 'AUDIT#2024-01-10T08:00:00.000Z',
            GSI1PK: 'ADMIN#admin-1',
            GSI1SK: 'ACTION#2024-01-10T08:00:00.000Z',
            mockupId: 'mockup-789',
            action: 'rejected',
            adminId: 'admin-1',
            adminEmail: 'admin@cronusfit.com',
            timestamp: '2024-01-10T08:00:00.000Z',
            rejectionReason: 'Low quality',
          },
          {
            PK: 'MOCKUP#mockup-789',
            SK: 'AUDIT#2024-01-12T10:00:00.000Z',
            GSI1PK: 'ADMIN#admin-1',
            GSI1SK: 'ACTION#2024-01-12T10:00:00.000Z',
            mockupId: 'mockup-789',
            action: 'approved',
            adminId: 'admin-1',
            adminEmail: 'admin@cronusfit.com',
            timestamp: '2024-01-12T10:00:00.000Z',
          },
        ],
        count: 2,
      });

      const entries = await getAuditTrailForMockup('mockup-789');

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        mockupId: 'mockup-789',
        action: 'rejected',
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        timestamp: '2024-01-10T08:00:00.000Z',
        rejectionReason: 'Low quality',
      });
      expect(entries[1]).toEqual({
        mockupId: 'mockup-789',
        action: 'approved',
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        timestamp: '2024-01-12T10:00:00.000Z',
        rejectionReason: undefined,
      });
    });

    it('returns empty array when no audit entries exist', async () => {
      mockedQueryByPK.mockResolvedValue({ items: [], count: 0 });

      const entries = await getAuditTrailForMockup('mockup-nonexistent');

      expect(entries).toEqual([]);
    });
  });
});
