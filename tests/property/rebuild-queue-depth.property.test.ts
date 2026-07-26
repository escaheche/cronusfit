/**
 * Property-based tests for rebuild queue depth limit.
 *
 * **Validates: Requirements 9.6**
 *
 * Property 20: Rebuild queue depth limit
 * For any sequence of rebuild requests arriving within a 60-second debounce window,
 * the queue SHALL accept at most 10 entries. The 11th and subsequent requests
 * within the same window SHALL be rejected.
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

// Mock db/operations
vi.mock('../../src/db/operations.js', () => ({
  enqueueRebuild: vi.fn().mockResolvedValue(undefined),
  dequeueNextRebuild: vi.fn().mockResolvedValue(null),
  getRebuildQueueDepth: vi.fn().mockResolvedValue(0),
  updateRebuildStatus: vi.fn().mockResolvedValue(undefined),
}));

import { getRebuildQueueDepth } from '../../src/db/operations.js';
import { enqueueRebuild } from '../../src/modules/exhibition/rebuild.js';
import type { RebuildRequest } from '../../src/types/exhibition.js';

describe('Property 20: Rebuild queue depth limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('for any queue depth 0-9, enqueueRebuild succeeds (queued=true)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 9 }),
        fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0),
        fc.constantFrom('publish' as const, 'unpublish' as const, 'manual' as const),
        async (depth, rebuildId, reason) => {
          vi.clearAllMocks();

          // Mock the current queue depth to be within allowed range
          vi.mocked(getRebuildQueueDepth).mockResolvedValueOnce(depth);

          const request: RebuildRequest = {
            rebuildId,
            triggeredBy: 'admin-001',
            triggeredAt: new Date().toISOString(),
            reason,
          };

          const result = await enqueueRebuild(request);

          // Queue SHALL accept when depth < maxQueueDepth (10)
          expect(result.queued).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any queue depth >= 10, enqueueRebuild fails (queued=false)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0),
        fc.constantFrom('publish' as const, 'unpublish' as const, 'manual' as const),
        async (depth, rebuildId, reason) => {
          vi.clearAllMocks();

          // Mock the current queue depth to be at or above the limit
          vi.mocked(getRebuildQueueDepth).mockResolvedValueOnce(depth);

          const request: RebuildRequest = {
            rebuildId,
            triggeredBy: 'admin-001',
            triggeredAt: new Date().toISOString(),
            reason,
          };

          const result = await enqueueRebuild(request);

          // Queue SHALL reject when depth >= maxQueueDepth (10)
          expect(result.queued).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('position always equals depth+1 when queued', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 9 }),
        fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0),
        fc.constantFrom('publish' as const, 'unpublish' as const, 'manual' as const),
        async (depth, rebuildId, reason) => {
          vi.clearAllMocks();

          vi.mocked(getRebuildQueueDepth).mockResolvedValueOnce(depth);

          const request: RebuildRequest = {
            rebuildId,
            triggeredBy: 'admin-001',
            triggeredAt: new Date().toISOString(),
            reason,
          };

          const result = await enqueueRebuild(request);

          // Position SHALL equal depth + 1 when queued successfully
          expect(result.position).toBe(depth + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('position is 0 when rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 10, max: 100 }),
        fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.trim().length > 0),
        fc.constantFrom('publish' as const, 'unpublish' as const, 'manual' as const),
        async (depth, rebuildId, reason) => {
          vi.clearAllMocks();

          vi.mocked(getRebuildQueueDepth).mockResolvedValueOnce(depth);

          const request: RebuildRequest = {
            rebuildId,
            triggeredBy: 'admin-001',
            triggeredAt: new Date().toISOString(),
            reason,
          };

          const result = await enqueueRebuild(request);

          // Position SHALL be 0 when rejected
          expect(result.position).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
