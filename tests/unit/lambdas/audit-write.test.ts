/**
 * Unit tests for the audit-write Lambda handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the audit-log module
vi.mock('../../../src/modules/security/audit-log.js', () => ({
  recordAuditEntryStrict: vi.fn(),
}));

import { handler } from '../../../src/lambdas/audit-write/handler.js';
import { recordAuditEntryStrict } from '../../../src/modules/security/audit-log.js';

const mockRecordAuditEntryStrict = vi.mocked(recordAuditEntryStrict);

describe('audit-write handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return success with zero counts for empty entries array', async () => {
    const result = await handler({ entries: [] }, {} as any, (() => {}) as any);

    expect(result).toEqual({ success: true, written: 0, failed: 0 });
    expect(mockRecordAuditEntryStrict).not.toHaveBeenCalled();
  });

  it('should return success with zero counts for missing entries', async () => {
    const result = await handler({ entries: undefined as any }, {} as any, (() => {}) as any);

    expect(result).toEqual({ success: true, written: 0, failed: 0 });
  });

  it('should write all entries successfully', async () => {
    mockRecordAuditEntryStrict.mockResolvedValue(undefined);

    const entries = [
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'pattern_generate',
        resourceId: 'pattern-123',
        resourceType: 'pattern',
      },
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'mockup_approve',
        resourceId: 'mockup-456',
        resourceType: 'mockup',
      },
    ];

    const result = await handler({ entries }, {} as any, (() => {}) as any);

    expect(result).toEqual({ success: true, written: 2, failed: 0 });
    expect(mockRecordAuditEntryStrict).toHaveBeenCalledTimes(2);
    expect(mockRecordAuditEntryStrict).toHaveBeenCalledWith(entries[0]);
    expect(mockRecordAuditEntryStrict).toHaveBeenCalledWith(entries[1]);
  });

  it('should report failures without blocking other entries', async () => {
    mockRecordAuditEntryStrict
      .mockResolvedValueOnce(undefined) // First entry succeeds
      .mockRejectedValueOnce(new Error('DynamoDB timeout')) // Second entry fails
      .mockResolvedValueOnce(undefined); // Third entry succeeds

    const entries = [
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'publish',
        resourceId: 'product-1',
        resourceType: 'product',
      },
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'quote_price',
        resourceId: 'quote-2',
        resourceType: 'quote',
      },
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'mockup_reject',
        resourceId: 'mockup-3',
        resourceType: 'mockup',
      },
    ];

    const result = await handler({ entries }, {} as any, (() => {}) as any);

    expect(result).toEqual({
      success: false,
      written: 2,
      failed: 1,
      errors: ['[quote_price/quote-2]: DynamoDB timeout'],
    });
  });

  it('should report all failures when every entry fails', async () => {
    mockRecordAuditEntryStrict.mockRejectedValue(new Error('Service unavailable'));

    const entries = [
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'pattern_generate',
        resourceId: 'p-1',
        resourceType: 'pattern',
      },
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'mockup_approve',
        resourceId: 'm-2',
        resourceType: 'mockup',
      },
    ];

    const result = await handler({ entries }, {} as any, (() => {}) as any);

    expect(result).toEqual({
      success: false,
      written: 0,
      failed: 2,
      errors: [
        '[pattern_generate/p-1]: Service unavailable',
        '[mockup_approve/m-2]: Service unavailable',
      ],
    });
  });

  it('should not include errors key when all entries succeed', async () => {
    mockRecordAuditEntryStrict.mockResolvedValue(undefined);

    const entries = [
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'publish',
        resourceId: 'product-1',
        resourceType: 'product',
      },
    ];

    const result = await handler({ entries }, {} as any, (() => {}) as any);

    expect(result).toEqual({ success: true, written: 1, failed: 0 });
    expect(result).not.toHaveProperty('errors');
  });

  it('should pass metadata to recordAuditEntryStrict', async () => {
    mockRecordAuditEntryStrict.mockResolvedValue(undefined);

    const entries = [
      {
        adminId: 'admin-1',
        adminEmail: 'admin@cronusfit.com',
        actionType: 'pattern_generate',
        resourceId: 'pattern-789',
        resourceType: 'pattern',
        metadata: { garmentType: 'camiseta', ageGroup: 'adult' },
      },
    ];

    const result = await handler({ entries }, {} as any, (() => {}) as any);

    expect(result).toEqual({ success: true, written: 1, failed: 0 });
    expect(mockRecordAuditEntryStrict).toHaveBeenCalledWith(entries[0]);
  });
});
