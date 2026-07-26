/**
 * Property-based tests for publish requires approved mockup status.
 *
 * **Validates: Requirements 6.4, 6.5**
 *
 * Property 14: Publication Filter Invariant
 * For any mockup with status other than "approved", the publish action
 * SHALL be rejected with an error. Only approved mockups can be published.
 * Publishing is always an explicit Admin action (no auto-publish on approval).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

// Mock DynamoDB client
vi.mock('../../src/db/client.js', () => ({
  docClient: {
    send: vi.fn(),
  },
  TABLE_NAME: 'CronusFit',
}));

// Mock db/operations (enqueueRebuild, getRebuildQueueDepth, get)
vi.mock('../../src/db/operations.js', () => ({
  enqueueRebuild: vi.fn().mockResolvedValue(undefined),
  getRebuildQueueDepth: vi.fn().mockResolvedValue(0),
  get: vi.fn(),
}));

import { docClient } from '../../src/db/client.js';
import { getRebuildQueueDepth, get } from '../../src/db/operations.js';
import { publishProductFromAction, canPublish } from '../../src/modules/exhibition/publish.js';

describe('Property 14: Publication Filter Invariant — only approved mockups can be published', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('for any mockup with status !== "approved", publish returns success=false with error (Req 6.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate mockup IDs
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        // Generate admin IDs
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        // Generate non-approved mockup statuses
        fc.constantFrom('pending_approval', 'rejected'),
        async (mockupId, adminId, mockupStatus) => {
          vi.clearAllMocks();

          // Mock get() to return a mockup with non-approved status
          vi.mocked(get).mockResolvedValueOnce({
            PK: `MOCKUP#${mockupId}`,
            SK: 'METADATA',
            id: mockupId,
            status: mockupStatus,
            publishStatus: 'unpublished',
            garmentType: 'camiseta',
            frontImageS3Key: 'mockups/front.png',
            backImageS3Key: 'mockups/back.png',
          } as any);

          const result = await publishProductFromAction({
            productId: mockupId,
            mockupId,
            action: 'publish',
            adminId,
          });

          // Publish SHALL be rejected for non-approved mockups
          expect(result.success).toBe(false);
          expect(result.rebuildQueued).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error).toContain(mockupStatus);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any approved mockup (and queue not full), publish succeeds (Req 6.1, 6.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate mockup IDs
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        // Generate admin IDs
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        // Generate queue depths that are not full (0..9)
        fc.integer({ min: 0, max: 9 }),
        async (mockupId, adminId, queueDepth) => {
          vi.clearAllMocks();

          // Mock get() to return an approved mockup
          vi.mocked(get).mockResolvedValueOnce({
            PK: `MOCKUP#${mockupId}`,
            SK: 'METADATA',
            id: mockupId,
            status: 'approved',
            publishStatus: 'unpublished',
            garmentType: 'camiseta',
            frontImageS3Key: 'mockups/front.png',
            backImageS3Key: 'mockups/back.png',
          } as any);

          // Mock DynamoDB send for GetCommand (existing product check) - no existing product
          vi.mocked(docClient.send).mockResolvedValueOnce({
            Item: undefined,
          } as any);

          // Mock queue depth (not full)
          vi.mocked(getRebuildQueueDepth).mockResolvedValueOnce(queueDepth);

          // Mock PutCommand (create product)
          vi.mocked(docClient.send).mockResolvedValueOnce({} as any);

          // Mock UpdateCommand (update mockup publishStatus)
          vi.mocked(docClient.send).mockResolvedValueOnce({} as any);

          const result = await publishProductFromAction({
            productId: mockupId,
            mockupId,
            action: 'publish',
            adminId,
          });

          // Publish SHALL succeed for approved mockups
          expect(result.success).toBe(true);
          expect(result.rebuildQueued).toBe(true);
          expect(result.queuePosition).toBe(queueDepth + 1);
          expect(result.error).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('canPublish returns eligible=false for non-approved mockups (Req 6.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        fc.constantFrom('pending_approval', 'rejected'),
        async (mockupId, status) => {
          vi.clearAllMocks();

          vi.mocked(get).mockResolvedValueOnce({
            PK: `MOCKUP#${mockupId}`,
            SK: 'METADATA',
            id: mockupId,
            status,
          } as any);

          const eligibility = await canPublish(mockupId);

          expect(eligibility.eligible).toBe(false);
          expect(eligibility.reason).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('canPublish returns eligible=true only for approved mockups (Req 6.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        async (mockupId) => {
          vi.clearAllMocks();

          vi.mocked(get).mockResolvedValueOnce({
            PK: `MOCKUP#${mockupId}`,
            SK: 'METADATA',
            id: mockupId,
            status: 'approved',
          } as any);

          const eligibility = await canPublish(mockupId);

          expect(eligibility.eligible).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
