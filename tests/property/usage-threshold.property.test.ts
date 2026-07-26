/**
 * Property-based tests for usage threshold detection and response.
 *
 * **Validates: Requirements 11.8, 11.10**
 *
 * Property 22: Free Tier Threshold Alerting
 * For any AWS service usage level, the monitoring system SHALL trigger an alert if and only if
 * usage exceeds 80% of the monthly Free Tier limit, and SHALL disable non-essential operations
 * while maintaining read-only access to the Exhibition Website if and only if usage reaches 100%.
 * Percentage = (currentUsage / freeLimit) × 100, rounded to 2 decimal places.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// Hoist mock function so it's accessible in vi.mock factories
const mockSend = vi.hoisted(() => vi.fn().mockResolvedValue({}));

// Mock db/operations (putUsageMetric, getUsageMetric)
vi.mock('../../src/db/operations.js', () => ({
  putUsageMetric: vi.fn().mockResolvedValue(undefined),
  getUsageMetric: vi.fn().mockResolvedValue(null),
}));

// Mock SES client
vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn(() => ({ send: mockSend })),
  SendEmailCommand: vi.fn((input: unknown) => ({ input })),
}));

// Mock CloudWatch client (not used in these tests directly, but imported by handler)
vi.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: vi.fn(() => ({ send: vi.fn() })),
  GetMetricStatisticsCommand: vi.fn(),
}));

import { calculatePercentage, handleThresholdBreach, MONITOR_CONFIG } from '../../src/lambdas/monitor-usage/handler.js';
import { putUsageMetric, getUsageMetric } from '../../src/db/operations.js';
import type { UsageCheck, MonitorConfig } from '../../src/types/exhibition.js';

describe('Property 22: Free Tier Threshold Alerting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calculatePercentage produces (currentUsage / freeLimit) × 100 rounded to 2 decimal places', () => {
    fc.assert(
      fc.property(
        // Generate positive usage values (integers representing request counts, bytes, etc.)
        fc.integer({ min: 0, max: 1_000_000_000 }),
        // Generate positive free limits (must be > 0 for valid calculation)
        fc.integer({ min: 1, max: 1_000_000_000 }),
        (currentUsage, freeLimit) => {
          const result = calculatePercentage(currentUsage, freeLimit);

          // Expected: (currentUsage / freeLimit) * 100, rounded to 2 decimal places
          const expected = Math.round((currentUsage / freeLimit) * 10000) / 100;

          expect(result).toBe(expected);

          // Result should always have at most 2 decimal places
          const decimalPart = result.toString().split('.')[1];
          if (decimalPart) {
            expect(decimalPart.length).toBeLessThanOrEqual(2);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('calculatePercentage returns 0 when freeLimit is zero or negative', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 0 }),
        (currentUsage, invalidLimit) => {
          const result = calculatePercentage(currentUsage, invalidLimit);
          expect(result).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any percentUsed >= 80%, alert should be triggered', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate service names
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 20 }),
        // Generate percentUsed values >= 80% but < 100% (use integer from 8000 to 9999 and divide by 100)
        fc.integer({ min: 8000, max: 9999 }).map((n) => n / 100),
        async (service, percentUsed) => {
          vi.clearAllMocks();

          // No existing metric (alert not yet sent)
          vi.mocked(getUsageMetric).mockResolvedValueOnce(null);
          vi.mocked(putUsageMetric).mockResolvedValue(undefined);

          const check: UsageCheck = {
            service,
            currentUsage: percentUsed * 100, // Arbitrary values that produce the percentUsed
            freeLimit: 10000,
            percentUsed,
          };

          const config: MonitorConfig = {
            checkIntervalMinutes: 5,
            alertThresholdPercent: 80,
            disableThresholdPercent: 100,
            services: [],
          };

          const period = '2024-06';
          const now = new Date('2024-06-15T12:00:00Z');

          await handleThresholdBreach(check, config, period, now);

          // Alert email (warning) should be sent since percentUsed >= 80% and < 100%
          expect(mockSend).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('for any percentUsed >= 100%, API should be disabled but static site remains accessible', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate service names
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 1, maxLength: 20 }),
        // Generate percentUsed values >= 100% (use integer from 10000 to 50000 and divide by 100)
        fc.integer({ min: 10000, max: 50000 }).map((n) => n / 100),
        async (service, percentUsed) => {
          vi.clearAllMocks();

          // No existing metric (not yet disabled)
          vi.mocked(getUsageMetric).mockResolvedValueOnce(null);
          vi.mocked(putUsageMetric).mockResolvedValue(undefined);

          const check: UsageCheck = {
            service,
            currentUsage: percentUsed * 100,
            freeLimit: 10000,
            percentUsed,
          };

          const config: MonitorConfig = {
            checkIntervalMinutes: 5,
            alertThresholdPercent: 80,
            disableThresholdPercent: 100,
            services: [],
          };

          const period = '2024-06';
          const now = new Date('2024-06-15T12:00:00Z');

          await handleThresholdBreach(check, config, period, now);

          // Critical alert email should be sent
          expect(mockSend).toHaveBeenCalledTimes(1);

          // putUsageMetric should be called with the QUOTE_API_DISABLED flag
          // This disables API while the static site (S3 + CloudFront) remains accessible
          expect(putUsageMetric).toHaveBeenCalled();
          const putCalls = vi.mocked(putUsageMetric).mock.calls;
          const disableCall = putCalls.find(
            (call) => call[0].PK.includes('QUOTE_API_DISABLED'),
          );
          expect(disableCall).toBeDefined();
          expect(disableCall![0].disabledAt).toBeDefined();
          expect(disableCall![0].percentUsed).toBe(100);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('MONITOR_CONFIG uses correct thresholds (80% alert, 100% disable)', () => {
    expect(MONITOR_CONFIG.alertThresholdPercent).toBe(80);
    expect(MONITOR_CONFIG.disableThresholdPercent).toBe(100);
  });
});
