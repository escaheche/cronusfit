import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AuditEntryInput } from '../../../src/modules/security/audit-log.js';

// Mock the db operations module
vi.mock('../../../src/db/operations.js', () => ({
  writeAuditLog: vi.fn(),
  queryByPK: vi.fn(),
  queryByGSI1: vi.fn(),
  queryByGSI2: vi.fn(),
}));

import { writeAuditLog, queryByPK, queryByGSI1, queryByGSI2 } from '../../../src/db/operations.js';
import {
  recordAuditEntry,
  recordAuditEntryStrict,
  queryAuditByAdmin,
  queryAuditByAction,
  queryAuditByResource,
  calculateBackoffDelay,
  _internals,
} from '../../../src/modules/security/audit-log.js';

const mockedWriteAuditLog = vi.mocked(writeAuditLog);
const mockedQueryByPK = vi.mocked(queryByPK);
const mockedQueryByGSI1 = vi.mocked(queryByGSI1);
const mockedQueryByGSI2 = vi.mocked(queryByGSI2);

describe('audit-log', () => {
  const sampleEntry: AuditEntryInput = {
    adminId: 'cognito-sub-123',
    adminEmail: 'admin@cronusfit.com',
    actionType: 'mockup_approve',
    resourceId: 'mockup-456',
    resourceType: 'mockup',
    metadata: { reason: 'quality approved' },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T14:30:00.000Z'));
    // Replace sleep with immediate resolution to avoid real delays
    _internals.sleep = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  describe('recordAuditEntry (best-effort)', () => {
    it('writes audit entry on first attempt when successful', async () => {
      mockedWriteAuditLog.mockResolvedValue(undefined);

      await recordAuditEntry(sampleEntry);

      expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1);
      expect(mockedWriteAuditLog).toHaveBeenCalledWith({
        adminId: 'cognito-sub-123',
        adminEmail: 'admin@cronusfit.com',
        timestamp: '2024-06-15T14:30:00.000Z',
        actionType: 'mockup_approve',
        resourceId: 'mockup-456',
        resourceType: 'mockup',
        metadata: { reason: 'quality approved' },
      });
    });

    it('never throws even when all retries fail', async () => {
      mockedWriteAuditLog.mockRejectedValue(new Error('DynamoDB unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(recordAuditEntry(sampleEntry)).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('logs error to console.error when all retries fail', async () => {
      mockedWriteAuditLog.mockRejectedValue(new Error('DynamoDB unavailable'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await recordAuditEntry(sampleEntry);

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logOutput = consoleSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logOutput);
      expect(parsed.type).toBe('AUDIT_WRITE_FAILURE');
      expect(parsed.adminId).toBe('cognito-sub-123');
      expect(parsed.actionType).toBe('mockup_approve');
      expect(parsed.error).toBe('DynamoDB unavailable');

      consoleSpy.mockRestore();
    });

    it('retries up to 5 times on failure (6 total attempts)', async () => {
      mockedWriteAuditLog.mockRejectedValue(new Error('DynamoDB error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await recordAuditEntry(sampleEntry);

      // 1 initial + 5 retries = 6 total calls
      expect(mockedWriteAuditLog).toHaveBeenCalledTimes(6);

      consoleSpy.mockRestore();
    });

    it('succeeds on second attempt after first failure', async () => {
      mockedWriteAuditLog
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValue(undefined);

      await recordAuditEntry(sampleEntry);

      expect(mockedWriteAuditLog).toHaveBeenCalledTimes(2);
    });

    it('succeeds on fifth retry after 4 failures', async () => {
      mockedWriteAuditLog
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockRejectedValueOnce(new Error('Fail 3'))
        .mockRejectedValueOnce(new Error('Fail 4'))
        .mockResolvedValue(undefined);

      await recordAuditEntry(sampleEntry);

      expect(mockedWriteAuditLog).toHaveBeenCalledTimes(5);
    });

    it('does not include metadata when not provided', async () => {
      mockedWriteAuditLog.mockResolvedValue(undefined);
      const entryNoMeta: AuditEntryInput = {
        adminId: 'sub-789',
        adminEmail: 'other@cronusfit.com',
        actionType: 'pattern_generate',
        resourceId: 'pat-001',
        resourceType: 'pattern',
      };

      await recordAuditEntry(entryNoMeta);

      expect(mockedWriteAuditLog).toHaveBeenCalledWith({
        adminId: 'sub-789',
        adminEmail: 'other@cronusfit.com',
        timestamp: '2024-06-15T14:30:00.000Z',
        actionType: 'pattern_generate',
        resourceId: 'pat-001',
        resourceType: 'pattern',
        metadata: undefined,
      });
    });
  });

  describe('recordAuditEntryStrict', () => {
    it('writes audit entry successfully on first attempt', async () => {
      mockedWriteAuditLog.mockResolvedValue(undefined);

      await expect(recordAuditEntryStrict(sampleEntry)).resolves.toBeUndefined();

      expect(mockedWriteAuditLog).toHaveBeenCalledTimes(1);
    });

    it('throws after all retries are exhausted', async () => {
      mockedWriteAuditLog.mockRejectedValue(new Error('Persistent failure'));

      await expect(recordAuditEntryStrict(sampleEntry)).rejects.toThrow('Persistent failure');

      expect(mockedWriteAuditLog).toHaveBeenCalledTimes(6);
    });

    it('succeeds on retry after transient failure', async () => {
      mockedWriteAuditLog
        .mockRejectedValueOnce(new Error('Transient'))
        .mockRejectedValueOnce(new Error('Transient'))
        .mockResolvedValue(undefined);

      await expect(recordAuditEntryStrict(sampleEntry)).resolves.toBeUndefined();

      expect(mockedWriteAuditLog).toHaveBeenCalledTimes(3);
    });
  });

  describe('queryAuditByAdmin', () => {
    it('queries with correct PK and SK prefix', async () => {
      mockedQueryByPK.mockResolvedValue({ items: [], count: 0 });

      await queryAuditByAdmin('admin-sub-001');

      expect(mockedQueryByPK).toHaveBeenCalledWith(
        'AUDIT#admin-sub-001',
        { expression: 'begins_with(SK, :sk)', value: 'ACTION#' },
        undefined
      );
    });

    it('returns mapped audit entries', async () => {
      mockedQueryByPK.mockResolvedValue({
        items: [
          {
            PK: 'AUDIT#admin-sub-001',
            SK: 'ACTION#2024-06-15T14:00:00.000Z',
            GSI1PK: 'AUDITTYPE#publish',
            GSI1SK: 'TIME#2024-06-15T14:00:00.000Z',
            adminId: 'admin-sub-001',
            adminEmail: 'admin@cronusfit.com',
            timestamp: '2024-06-15T14:00:00.000Z',
            actionType: 'publish',
            resourceId: 'prod-001',
            resourceType: 'product',
            metadata: { productName: 'Camiseta XL' },
          },
        ],
        count: 1,
      } as any);

      const results = await queryAuditByAdmin('admin-sub-001');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        adminId: 'admin-sub-001',
        adminEmail: 'admin@cronusfit.com',
        timestamp: '2024-06-15T14:00:00.000Z',
        actionType: 'publish',
        resourceId: 'prod-001',
        resourceType: 'product',
        metadata: { productName: 'Camiseta XL' },
      });
    });

    it('passes query options through', async () => {
      mockedQueryByPK.mockResolvedValue({ items: [], count: 0 });

      await queryAuditByAdmin('admin-sub-001', { limit: 10, scanIndexForward: false });

      expect(mockedQueryByPK).toHaveBeenCalledWith(
        'AUDIT#admin-sub-001',
        { expression: 'begins_with(SK, :sk)', value: 'ACTION#' },
        { limit: 10, scanIndexForward: false }
      );
    });
  });

  describe('queryAuditByAction', () => {
    it('queries GSI1 with correct PK and SK prefix', async () => {
      mockedQueryByGSI1.mockResolvedValue({ items: [], count: 0 });

      await queryAuditByAction('mockup_approve');

      expect(mockedQueryByGSI1).toHaveBeenCalledWith(
        'AUDITTYPE#mockup_approve',
        { expression: 'begins_with(GSI1SK, :sk)', value: 'TIME#' },
        undefined
      );
    });

    it('returns mapped audit entries from GSI1', async () => {
      mockedQueryByGSI1.mockResolvedValue({
        items: [
          {
            PK: 'AUDIT#sub-001',
            SK: 'ACTION#2024-06-15T10:00:00.000Z',
            GSI1PK: 'AUDITTYPE#mockup_approve',
            GSI1SK: 'TIME#2024-06-15T10:00:00.000Z',
            adminId: 'sub-001',
            adminEmail: 'admin@test.com',
            timestamp: '2024-06-15T10:00:00.000Z',
            actionType: 'mockup_approve',
            resourceId: 'mock-123',
            resourceType: 'mockup',
          },
        ],
        count: 1,
      } as any);

      const results = await queryAuditByAction('mockup_approve');

      expect(results).toHaveLength(1);
      expect(results[0].actionType).toBe('mockup_approve');
      expect(results[0].resourceId).toBe('mock-123');
    });
  });

  describe('queryAuditByResource', () => {
    it('queries GSI2 with correct PK and SK', async () => {
      mockedQueryByGSI2.mockResolvedValue({ items: [], count: 0 });

      await queryAuditByResource('pattern', 'pat-001');

      expect(mockedQueryByGSI2).toHaveBeenCalledWith(
        'RESOURCE#pattern',
        { expression: 'GSI2SK = :sk', value: 'RESID#pat-001' }
      );
    });

    it('returns mapped audit entries from GSI2', async () => {
      mockedQueryByGSI2.mockResolvedValue({
        items: [
          {
            PK: 'AUDIT#sub-002',
            SK: 'ACTION#2024-06-15T12:00:00.000Z',
            GSI1PK: 'AUDITTYPE#pattern_generate',
            GSI1SK: 'TIME#2024-06-15T12:00:00.000Z',
            GSI2PK: 'RESOURCE#pattern',
            GSI2SK: 'RESID#pat-001',
            adminId: 'sub-002',
            adminEmail: 'admin2@test.com',
            timestamp: '2024-06-15T12:00:00.000Z',
            actionType: 'pattern_generate',
            resourceId: 'pat-001',
            resourceType: 'pattern',
          },
        ],
        count: 1,
      } as any);

      const results = await queryAuditByResource('pattern', 'pat-001');

      expect(results).toHaveLength(1);
      expect(results[0].resourceType).toBe('pattern');
      expect(results[0].adminId).toBe('sub-002');
    });
  });
});
