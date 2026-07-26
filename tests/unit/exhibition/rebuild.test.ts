import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueRebuild,
  processNextRebuild,
  markRebuildCompleted,
  markRebuildFailed,
  getQueueDepth,
  _resetLastCompletedTimestamp,
} from '../../../src/modules/exhibition/rebuild.js';
import type { RebuildRequest, RebuildQueueConfig } from '../../../src/types/exhibition.js';

vi.mock('../../../src/db/operations.js', () => ({
  enqueueRebuild: vi.fn(),
  dequeueNextRebuild: vi.fn(),
  getRebuildQueueDepth: vi.fn(),
  updateRebuildStatus: vi.fn(),
}));

import {
  enqueueRebuild as dbEnqueueRebuild,
  dequeueNextRebuild,
  getRebuildQueueDepth,
  updateRebuildStatus,
} from '../../../src/db/operations.js';

const mockedDbEnqueue = vi.mocked(dbEnqueueRebuild);
const mockedDequeue = vi.mocked(dequeueNextRebuild);
const mockedGetDepth = vi.mocked(getRebuildQueueDepth);
const mockedUpdateStatus = vi.mocked(updateRebuildStatus);

describe('rebuild queue management', () => {
  const config: RebuildQueueConfig = {
    maxQueueDepth: 10,
    debounceWindowMs: 60_000,
    retryDelayMs: 30_000,
    maxRetries: 1,
  };

  const sampleRequest: RebuildRequest = {
    rebuildId: 'rebuild-001',
    triggeredBy: 'admin-123',
    triggeredAt: '2024-01-15T10:00:00.000Z',
    reason: 'publish',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:05:00.000Z'));
    _resetLastCompletedTimestamp(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('enqueueRebuild', () => {
    it('queues a rebuild when queue depth is below max', async () => {
      mockedGetDepth.mockResolvedValue(3);
      mockedDbEnqueue.mockResolvedValue(undefined);
      mockedUpdateStatus.mockResolvedValue(undefined);

      const result = await enqueueRebuild(sampleRequest, config);

      expect(result.queued).toBe(true);
      expect(result.position).toBe(4);
    });

    it('rejects when queue is at max depth', async () => {
      mockedGetDepth.mockResolvedValue(10);

      const result = await enqueueRebuild(sampleRequest, config);

      expect(result.queued).toBe(false);
      expect(result.position).toBe(0);
      expect(mockedDbEnqueue).not.toHaveBeenCalled();
      expect(mockedUpdateStatus).not.toHaveBeenCalled();
    });

    it('rejects when queue exceeds max depth', async () => {
      mockedGetDepth.mockResolvedValue(15);

      const result = await enqueueRebuild(sampleRequest, config);

      expect(result.queued).toBe(false);
      expect(result.position).toBe(0);
    });

    it('stores rebuild in DynamoDB with correct fields', async () => {
      mockedGetDepth.mockResolvedValue(0);
      mockedDbEnqueue.mockResolvedValue(undefined);
      mockedUpdateStatus.mockResolvedValue(undefined);

      await enqueueRebuild(sampleRequest, config);

      expect(mockedDbEnqueue).toHaveBeenCalledWith({
        rebuildId: 'rebuild-001',
        triggeredBy: 'admin-123',
        reason: 'publish',
        createdAt: '2024-01-15T10:00:00.000Z',
      });
    });

    it('creates initial queued status record', async () => {
      mockedGetDepth.mockResolvedValue(0);
      mockedDbEnqueue.mockResolvedValue(undefined);
      mockedUpdateStatus.mockResolvedValue(undefined);

      await enqueueRebuild(sampleRequest, config);

      expect(mockedUpdateStatus).toHaveBeenCalledWith('rebuild-001', {
        status: 'queued',
        retryCount: 0,
      });
    });

    it('returns position 1 when queue is empty', async () => {
      mockedGetDepth.mockResolvedValue(0);
      mockedDbEnqueue.mockResolvedValue(undefined);
      mockedUpdateStatus.mockResolvedValue(undefined);

      const result = await enqueueRebuild(sampleRequest, config);

      expect(result.position).toBe(1);
    });

    it('returns position 10 when queue has 9 items', async () => {
      mockedGetDepth.mockResolvedValue(9);
      mockedDbEnqueue.mockResolvedValue(undefined);
      mockedUpdateStatus.mockResolvedValue(undefined);

      const result = await enqueueRebuild(sampleRequest, config);

      expect(result.queued).toBe(true);
      expect(result.position).toBe(10);
    });
  });

  describe('processNextRebuild', () => {
    it('returns empty completed status when queue is empty', async () => {
      mockedDequeue.mockResolvedValue(null);

      const result = await processNextRebuild(config);

      expect(result.rebuildId).toBe('');
      expect(result.status).toBe('completed');
    });

    it('processes next item and marks as in_progress', async () => {
      mockedDequeue.mockResolvedValue({
        PK: 'REBUILD',
        SK: 'QUEUED#2024-01-15T10:00:00.000Z#rebuild-001',
        rebuildId: 'rebuild-001',
        triggeredBy: 'admin-123',
        reason: 'publish',
        createdAt: '2024-01-15T10:00:00.000Z',
        ttl: 1705315200,
      });
      mockedUpdateStatus.mockResolvedValue(undefined);

      const result = await processNextRebuild(config);

      expect(result.rebuildId).toBe('rebuild-001');
      expect(result.status).toBe('in_progress');
      expect(result.startedAt).toBeDefined();
      expect(mockedUpdateStatus).toHaveBeenCalledWith('rebuild-001', {
        status: 'in_progress',
        startedAt: expect.any(String),
      });
    });

    it('enforces debounce window by waiting', async () => {
      // Last rebuild completed 20 seconds ago (within 60s debounce)
      const twentySecondsAgo = Date.now() - 20_000;
      _resetLastCompletedTimestamp(twentySecondsAgo);

      mockedDequeue.mockResolvedValue({
        PK: 'REBUILD',
        SK: 'QUEUED#2024-01-15T10:04:50.000Z#rebuild-002',
        rebuildId: 'rebuild-002',
        triggeredBy: 'admin-456',
        reason: 'unpublish',
        createdAt: '2024-01-15T10:04:50.000Z',
        ttl: 1705315200,
      });
      mockedUpdateStatus.mockResolvedValue(undefined);

      const processPromise = processNextRebuild(config);

      // Advance timers to cover the 40s remaining debounce
      await vi.advanceTimersByTimeAsync(40_000);

      const result = await processPromise;

      expect(result.rebuildId).toBe('rebuild-002');
      expect(result.status).toBe('in_progress');
    });

    it('skips debounce when enough time has passed', async () => {
      // Last rebuild completed 120 seconds ago (beyond 60s debounce)
      const twoMinutesAgo = Date.now() - 120_000;
      _resetLastCompletedTimestamp(twoMinutesAgo);

      mockedDequeue.mockResolvedValue({
        PK: 'REBUILD',
        SK: 'QUEUED#2024-01-15T10:04:50.000Z#rebuild-003',
        rebuildId: 'rebuild-003',
        triggeredBy: 'admin-789',
        reason: 'manual',
        createdAt: '2024-01-15T10:04:50.000Z',
        ttl: 1705315200,
      });
      mockedUpdateStatus.mockResolvedValue(undefined);

      const result = await processNextRebuild(config);

      expect(result.rebuildId).toBe('rebuild-003');
      expect(result.status).toBe('in_progress');
    });
  });

  describe('markRebuildCompleted', () => {
    it('updates status to completed and stores timestamp', async () => {
      mockedUpdateStatus.mockResolvedValue(undefined);

      await markRebuildCompleted('rebuild-001');

      expect(mockedUpdateStatus).toHaveBeenCalledWith('rebuild-001', {
        status: 'completed',
        completedAt: expect.any(String),
      });
    });
  });

  describe('markRebuildFailed', () => {
    it('updates status to failed with error and retry count', async () => {
      mockedUpdateStatus.mockResolvedValue(undefined);

      await markRebuildFailed('rebuild-001', 'Build timeout', 1);

      expect(mockedUpdateStatus).toHaveBeenCalledWith('rebuild-001', {
        status: 'failed',
        error: 'Build timeout',
        retryCount: 1,
      });
    });
  });

  describe('getQueueDepth', () => {
    it('returns current queue depth from DynamoDB', async () => {
      mockedGetDepth.mockResolvedValue(7);

      const depth = await getQueueDepth();

      expect(depth).toBe(7);
    });
  });
});
