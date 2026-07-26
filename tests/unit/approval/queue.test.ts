import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the db operations module
vi.mock('../../../src/db/operations.js', () => ({
  queryByGSI1: vi.fn(),
}));

import { queryByGSI1 } from '../../../src/db/operations.js';
import { getPendingMockups } from '../../../src/modules/approval/queue.js';
import type { MockupRecord } from '../../../src/db/entities.js';

const mockedQueryByGSI1 = vi.mocked(queryByGSI1);

describe('approval/queue', () => {
  const makeMockupRecord = (id: string, createdAt: string): MockupRecord => ({
    PK: `MOCKUP#${id}`,
    SK: 'METADATA',
    GSI1PK: 'STATUS#pending_approval',
    GSI1SK: `CREATED#${createdAt}`,
    id,
    patternId: `pattern-${id}`,
    garmentType: 'camiseta',
    designS3Key: `designs/${id}.png`,
    frontImageS3Key: `mockups/${id}-front.png`,
    backImageS3Key: `mockups/${id}-back.png`,
    placementZone: 'chest',
    status: 'pending_approval',
    publishStatus: 'unpublished',
    createdAt,
    createdBy: 'admin-1',
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getPendingMockups', () => {
    it('queries GSI1 with correct pending_approval status key', async () => {
      mockedQueryByGSI1.mockResolvedValue({
        items: [],
        count: 0,
      });

      await getPendingMockups();

      expect(mockedQueryByGSI1).toHaveBeenCalledWith(
        'STATUS#pending_approval',
        { expression: 'begins_with(GSI1SK, :sk)', value: 'CREATED#' },
        {
          limit: 20,
          scanIndexForward: true,
          exclusiveStartKey: undefined,
        }
      );
    });

    it('returns mapped items ordered by generation date (oldest first)', async () => {
      const older = makeMockupRecord('m-001', '2024-01-10T08:00:00.000Z');
      const newer = makeMockupRecord('m-002', '2024-01-15T10:00:00.000Z');

      mockedQueryByGSI1.mockResolvedValue({
        items: [older, newer],
        count: 2,
      });

      const result = await getPendingMockups();

      expect(result.count).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('m-001');
      expect(result.items[1].id).toBe('m-002');
      expect(result.items[0].status).toBe('pending_approval');
    });

    it('uses scanIndexForward=true for oldest-first ordering', async () => {
      mockedQueryByGSI1.mockResolvedValue({ items: [], count: 0 });

      await getPendingMockups();

      const callOptions = mockedQueryByGSI1.mock.calls[0][2];
      expect(callOptions?.scanIndexForward).toBe(true);
    });

    it('respects custom limit option', async () => {
      mockedQueryByGSI1.mockResolvedValue({ items: [], count: 0 });

      await getPendingMockups({ limit: 5 });

      const callOptions = mockedQueryByGSI1.mock.calls[0][2];
      expect(callOptions?.limit).toBe(5);
    });

    it('decodes startKey for pagination', async () => {
      mockedQueryByGSI1.mockResolvedValue({ items: [], count: 0 });

      const cursorPayload = { PK: 'MOCKUP#m-001', SK: 'METADATA', GSI1PK: 'STATUS#pending_approval', GSI1SK: 'CREATED#2024-01-10T08:00:00.000Z' };
      const encodedKey = Buffer.from(JSON.stringify(cursorPayload)).toString('base64url');

      await getPendingMockups({ startKey: encodedKey });

      const callOptions = mockedQueryByGSI1.mock.calls[0][2];
      expect(callOptions?.exclusiveStartKey).toEqual(cursorPayload);
    });

    it('returns nextKey when lastEvaluatedKey is present', async () => {
      const lastKey = { PK: 'MOCKUP#m-005', SK: 'METADATA', GSI1PK: 'STATUS#pending_approval', GSI1SK: 'CREATED#2024-01-20T00:00:00.000Z' };

      mockedQueryByGSI1.mockResolvedValue({
        items: [makeMockupRecord('m-005', '2024-01-20T00:00:00.000Z')],
        lastEvaluatedKey: lastKey,
        count: 1,
      });

      const result = await getPendingMockups();

      expect(result.nextKey).toBeDefined();
      // Decode the nextKey and verify it encodes the lastEvaluatedKey
      const decoded = JSON.parse(Buffer.from(result.nextKey!, 'base64url').toString('utf-8'));
      expect(decoded).toEqual(lastKey);
    });

    it('returns undefined nextKey when no lastEvaluatedKey', async () => {
      mockedQueryByGSI1.mockResolvedValue({
        items: [makeMockupRecord('m-001', '2024-01-10T08:00:00.000Z')],
        count: 1,
      });

      const result = await getPendingMockups();

      expect(result.nextKey).toBeUndefined();
    });

    it('maps MockupRecord to PendingMockupItem correctly', async () => {
      const record = makeMockupRecord('m-abc', '2024-03-01T12:00:00.000Z');
      record.scalingPercentage = 85;

      mockedQueryByGSI1.mockResolvedValue({
        items: [record],
        count: 1,
      });

      const result = await getPendingMockups();
      const item = result.items[0];

      expect(item).toEqual({
        id: 'm-abc',
        patternId: 'pattern-m-abc',
        garmentType: 'camiseta',
        designS3Key: 'designs/m-abc.png',
        frontImageS3Key: 'mockups/m-abc-front.png',
        backImageS3Key: 'mockups/m-abc-back.png',
        placementZone: 'chest',
        scalingPercentage: 85,
        status: 'pending_approval',
        createdAt: '2024-03-01T12:00:00.000Z',
        createdBy: 'admin-1',
      });
    });

    it('defaults limit to 20 when no options provided', async () => {
      mockedQueryByGSI1.mockResolvedValue({ items: [], count: 0 });

      await getPendingMockups();

      const callOptions = mockedQueryByGSI1.mock.calls[0][2];
      expect(callOptions?.limit).toBe(20);
    });
  });
});
