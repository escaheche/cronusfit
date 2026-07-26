import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock AWS SDK clients before importing the handler
vi.mock('@aws-sdk/client-cloudfront', () => {
  const mockSend = vi.fn();
  return {
    CloudFrontClient: vi.fn(() => ({ send: mockSend })),
    CreateInvalidationCommand: vi.fn((input) => ({ input })),
    __mockSend: mockSend,
  };
});

vi.mock('@aws-sdk/client-ses', () => {
  const mockSend = vi.fn();
  return {
    SESClient: vi.fn(() => ({ send: mockSend })),
    SendEmailCommand: vi.fn((input) => ({ input })),
    __mockSend: mockSend,
  };
});

// Access mocked send functions
import * as cfModule from '@aws-sdk/client-cloudfront';
import * as sesModule from '@aws-sdk/client-ses';

const cfMockSend = (cfModule as unknown as { __mockSend: ReturnType<typeof vi.fn> }).__mockSend;
const sesMockSend = (sesModule as unknown as { __mockSend: ReturnType<typeof vi.fn> }).__mockSend;

import { handler, invalidateCache } from '../../../src/lambdas/site-invalidate/handler.js';
import type { InvalidationRequest } from '../../../src/types/exhibition.js';

describe('site-invalidate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('ADMIN_EMAIL', 'admin@cronusfit.com');
    vi.stubEnv('SES_FROM_EMAIL', 'noreply@cronusfit.com');

    // Default: CloudFront succeeds
    cfMockSend.mockResolvedValue({
      Invalidation: { Id: 'INV-123' },
    });
    sesMockSend.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('strategy selection', () => {
    it('uses individual strategy when ≤15 paths', async () => {
      const request: InvalidationRequest = {
        changedPaths: ['/index.html', '/products/p1/index.html'],
        distributionId: 'DIST-ABC',
      };

      const result = await invalidateCache(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('individual');
      expect(result.invalidationId).toBe('INV-123');
    });

    it('uses individual strategy for exactly 15 paths', async () => {
      const paths = Array.from({ length: 15 }, (_, i) => `/page-${i}.html`);
      const request: InvalidationRequest = {
        changedPaths: paths,
        distributionId: 'DIST-ABC',
      };

      const result = await invalidateCache(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('individual');
    });

    it('uses wildcard strategy when >15 paths', async () => {
      const paths = Array.from({ length: 16 }, (_, i) => `/page-${i}.html`);
      const request: InvalidationRequest = {
        changedPaths: paths,
        distributionId: 'DIST-ABC',
      };

      const result = await invalidateCache(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('wildcard');
    });

    it('passes /* to CloudFront for wildcard strategy', async () => {
      const paths = Array.from({ length: 20 }, (_, i) => `/page-${i}.html`);
      const request: InvalidationRequest = {
        changedPaths: paths,
        distributionId: 'DIST-ABC',
      };

      await invalidateCache(request);

      const command = vi.mocked(cfModule.CreateInvalidationCommand);
      expect(command).toHaveBeenCalledWith(
        expect.objectContaining({
          InvalidationBatch: expect.objectContaining({
            Paths: expect.objectContaining({
              Items: ['/*'],
              Quantity: 1,
            }),
          }),
        })
      );
    });

    it('prefixes paths with / when missing', async () => {
      const request: InvalidationRequest = {
        changedPaths: ['index.html', 'products/p1/index.html'],
        distributionId: 'DIST-ABC',
      };

      await invalidateCache(request);

      const command = vi.mocked(cfModule.CreateInvalidationCommand);
      expect(command).toHaveBeenCalledWith(
        expect.objectContaining({
          InvalidationBatch: expect.objectContaining({
            Paths: expect.objectContaining({
              Items: ['/index.html', '/products/p1/index.html'],
              Quantity: 2,
            }),
          }),
        })
      );
    });
  });

  describe('edge cases', () => {
    it('returns success immediately for empty changedPaths', async () => {
      const request: InvalidationRequest = {
        changedPaths: [],
        distributionId: 'DIST-ABC',
      };

      const result = await invalidateCache(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('individual');
      expect(result.retriesAttempted).toBe(0);
      expect(cfMockSend).not.toHaveBeenCalled();
    });

    it('returns failure when distributionId is missing', async () => {
      const request: InvalidationRequest = {
        changedPaths: ['/index.html'],
        distributionId: '',
      };

      const result = await invalidateCache(request);

      expect(result.success).toBe(false);
      expect(result.error).toContain('distributionId');
      expect(cfMockSend).not.toHaveBeenCalled();
    });
  });

  describe('retry logic', () => {
    // Use fake timers for retry delay tests
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries up to 3 times on failure then notifies Admin', async () => {
      cfMockSend.mockRejectedValue(new Error('CloudFront throttled'));

      const request: InvalidationRequest = {
        changedPaths: ['/index.html'],
        distributionId: 'DIST-ABC',
      };

      const promise = invalidateCache(request);

      // Advance past all retry delays
      await vi.advanceTimersByTimeAsync(10_000); // 1st retry delay
      await vi.advanceTimersByTimeAsync(10_000); // 2nd retry delay

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.retriesAttempted).toBe(3);
      expect(result.error).toContain('CloudFront throttled');
      expect(cfMockSend).toHaveBeenCalledTimes(3);
      expect(sesMockSend).toHaveBeenCalledTimes(1);
    });

    it('succeeds on second attempt and reports 1 retry', async () => {
      cfMockSend
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce({ Invalidation: { Id: 'INV-456' } });

      const request: InvalidationRequest = {
        changedPaths: ['/index.html'],
        distributionId: 'DIST-ABC',
      };

      const promise = invalidateCache(request);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.retriesAttempted).toBe(1);
      expect(result.invalidationId).toBe('INV-456');
      expect(sesMockSend).not.toHaveBeenCalled();
    });

    it('succeeds on third attempt and reports 2 retries', async () => {
      cfMockSend
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce({ Invalidation: { Id: 'INV-789' } });

      const request: InvalidationRequest = {
        changedPaths: ['/index.html'],
        distributionId: 'DIST-ABC',
      };

      const promise = invalidateCache(request);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(10_000);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.retriesAttempted).toBe(2);
      expect(result.invalidationId).toBe('INV-789');
      expect(sesMockSend).not.toHaveBeenCalled();
    });
  });

  describe('Admin notification on failure', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not send SES email if ADMIN_EMAIL is not configured', async () => {
      vi.stubEnv('ADMIN_EMAIL', '');
      cfMockSend.mockRejectedValue(new Error('Fail'));

      const request: InvalidationRequest = {
        changedPaths: ['/index.html'],
        distributionId: 'DIST-ABC',
      };

      const promise = invalidateCache(request);
      await vi.advanceTimersByTimeAsync(20_000);
      await promise;

      expect(sesMockSend).not.toHaveBeenCalled();
    });

    it('handles SES send failure gracefully', async () => {
      cfMockSend.mockRejectedValue(new Error('CF Fail'));
      sesMockSend.mockRejectedValue(new Error('SES Fail'));

      const request: InvalidationRequest = {
        changedPaths: ['/index.html'],
        distributionId: 'DIST-ABC',
      };

      const promise = invalidateCache(request);
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await promise;

      // Should still return the invalidation failure even if SES fails
      expect(result.success).toBe(false);
      expect(result.retriesAttempted).toBe(3);
    });
  });

  describe('handler function', () => {
    it('delegates to invalidateCache', async () => {
      const request: InvalidationRequest = {
        changedPaths: ['/index.html'],
        distributionId: 'DIST-ABC',
      };

      const result = await handler(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('individual');
    });
  });
});
