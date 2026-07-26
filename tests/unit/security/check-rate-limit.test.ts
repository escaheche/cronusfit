import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit } from '../../../src/modules/security/public-rate-limiter.js';
import type { RateLimitConfig } from '../../../src/types/security.js';

// Mock the incrementRateLimit function from db/operations
vi.mock('../../../src/db/operations.js', () => ({
  incrementRateLimit: vi.fn(),
}));

import { incrementRateLimit } from '../../../src/db/operations.js';

const mockedIncrement = vi.mocked(incrementRateLimit);

describe('checkRateLimit', () => {
  const quoteSubmitConfig: RateLimitConfig = {
    endpoint: 'quote-submit',
    maxRequests: 5,
    windowSeconds: 900,
  };

  const quoteStatusConfig: RateLimitConfig = {
    endpoint: 'quote-status',
    maxRequests: 10,
    windowSeconds: 900,
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-15T10:07:30.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('allows request when count is within limit', async () => {
    mockedIncrement.mockResolvedValue(1);

    const result = await checkRateLimit('192.168.1.1', quoteSubmitConfig);

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1);
    expect(result.remainingRequests).toBe(4);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it('allows request at exactly maxRequests', async () => {
    mockedIncrement.mockResolvedValue(5);

    const result = await checkRateLimit('192.168.1.1', quoteSubmitConfig);

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(5);
    expect(result.remainingRequests).toBe(0);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it('denies request when count exceeds limit', async () => {
    mockedIncrement.mockResolvedValue(6);

    const result = await checkRateLimit('192.168.1.1', quoteSubmitConfig);

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(6);
    expect(result.remainingRequests).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('calculates retryAfterSeconds correctly when denied', async () => {
    // Time is 10:07:30 → now = 1705312050000
    // windowMs = 900000 (15 min)
    // windowStart = Math.floor(1705312050000 / 900000) * 900000
    // windowEnd = windowStart + 900000
    // retryAfter = Math.ceil((windowEnd - now) / 1000)
    const now = new Date('2024-01-15T10:07:30.000Z').getTime();
    const windowMs = 900 * 1000;
    const windowStart = Math.floor(now / windowMs) * windowMs;
    const expectedRetryAfter = Math.ceil((windowStart + windowMs - now) / 1000);

    mockedIncrement.mockResolvedValue(6);

    const result = await checkRateLimit('192.168.1.1', quoteSubmitConfig);

    expect(result.retryAfterSeconds).toBe(expectedRetryAfter);
  });

  it('passes correct windowStart to incrementRateLimit', async () => {
    mockedIncrement.mockResolvedValue(1);

    await checkRateLimit('10.0.0.5', quoteSubmitConfig);

    const now = new Date('2024-01-15T10:07:30.000Z').getTime();
    const windowMs = 900 * 1000;
    const expectedWindowStart = Math.floor(now / windowMs) * windowMs;

    expect(mockedIncrement).toHaveBeenCalledWith(
      '10.0.0.5',
      'quote-submit',
      expectedWindowStart,
      900
    );
  });

  it('uses quote-status config with higher limit', async () => {
    mockedIncrement.mockResolvedValue(8);

    const result = await checkRateLimit('10.0.0.1', quoteStatusConfig);

    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(8);
    expect(result.remainingRequests).toBe(2);
  });

  it('denies quote-status requests after 10', async () => {
    mockedIncrement.mockResolvedValue(11);

    const result = await checkRateLimit('10.0.0.1', quoteStatusConfig);

    expect(result.allowed).toBe(false);
    expect(result.currentCount).toBe(11);
    expect(result.remainingRequests).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('remainingRequests never goes negative', async () => {
    mockedIncrement.mockResolvedValue(100);

    const result = await checkRateLimit('10.0.0.1', quoteSubmitConfig);

    expect(result.remainingRequests).toBe(0);
  });
});
