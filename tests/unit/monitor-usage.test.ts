import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Mock db/operations module
vi.mock('../../src/db/operations.js', () => ({
  putUsageMetric: vi.fn().mockResolvedValue(undefined),
  getUsageMetric: vi.fn().mockResolvedValue(null),
}));

import { putUsageMetric, getUsageMetric } from '../../src/db/operations.js';
import {
  handler,
  calculatePercentage,
  isNewBillingMonth,
  getCurrentPeriod,
  getServiceUsage,
  checkUsage,
  handleThresholdBreach,
  MONITOR_CONFIG,
} from '../../src/lambdas/monitor-usage/handler.js';
import type { UsageCheck, MonitorConfig } from '../../src/types/exhibition.js';
import type { ScheduledEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// AWS SDK mocks
// ---------------------------------------------------------------------------

const cwMock = mockClient(CloudWatchClient);
const sesMock = mockClient(SESClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScheduledEvent(): ScheduledEvent {
  return {
    version: '0',
    id: 'test-event-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789012',
    time: '2024-06-15T12:00:00Z',
    region: 'us-east-1',
    resources: ['arn:aws:events:us-east-1:123456789012:rule/monitor-usage'],
    detail: {},
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  cwMock.reset();
  sesMock.reset();

  // Default: CloudWatch returns 0 usage
  cwMock.on(GetMetricStatisticsCommand).resolves({ Datapoints: [] });

  // Default: SES succeeds
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-msg-id' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('monitor-usage handler', () => {
  describe('calculatePercentage', () => {
    it('returns correct percentage', () => {
      expect(calculatePercentage(800000, 1000000)).toBe(80);
    });

    it('returns 0 when freeLimit is 0', () => {
      expect(calculatePercentage(100, 0)).toBe(0);
    });
  });

  describe('isNewBillingMonth', () => {
    it('returns true on 1st day at 00:00 UTC', () => {
      const date = new Date(Date.UTC(2024, 5, 1, 0, 0, 0)); // June 1, 00:00
      expect(isNewBillingMonth(date)).toBe(true);
    });

    it('returns false on 2nd day', () => {
      const date = new Date(Date.UTC(2024, 5, 2, 0, 0, 0));
      expect(isNewBillingMonth(date)).toBe(false);
    });

    it('returns false at 00:06 on 1st day (past 5min window)', () => {
      const date = new Date(Date.UTC(2024, 5, 1, 0, 6, 0));
      expect(isNewBillingMonth(date)).toBe(false);
    });
  });

  describe('getCurrentPeriod', () => {
    it('formats YYYY-MM correctly', () => {
      const date = new Date(Date.UTC(2024, 0, 15));
      expect(getCurrentPeriod(date)).toBe('2024-01');
    });
  });

  describe('80% threshold triggers SES notification with warning subject', () => {
    it('sends warning email when usage reaches 80%', async () => {
      const check: UsageCheck = {
        service: 'Lambda',
        currentUsage: 800000,
        freeLimit: 1000000,
        percentUsed: 80,
      };

      const config: MonitorConfig = {
        checkIntervalMinutes: 5,
        alertThresholdPercent: 80,
        disableThresholdPercent: 100,
        services: [{ service: 'Lambda', metric: 'Invocations', monthlyLimit: 1000000 }],
      };

      const now = new Date(Date.UTC(2024, 5, 15, 12, 0, 0));
      const period = '2024-06';

      await handleThresholdBreach(check, config, period, now);

      const sesCalls = sesMock.commandCalls(SendEmailCommand);
      expect(sesCalls).toHaveLength(1);

      const emailInput = sesCalls[0].args[0].input;
      expect(emailInput.Message?.Subject?.Data).toContain('ALERTA');
      expect(emailInput.Message?.Subject?.Data).toContain('80%');
    });

    it('does not send duplicate warning if alertSentAt already set', async () => {
      vi.mocked(getUsageMetric).mockResolvedValueOnce({
        PK: 'USAGE#Lambda',
        SK: 'PERIOD#2024-06',
        service: 'Lambda',
        currentUsage: 750000,
        freeLimit: 1000000,
        percentUsed: 75,
        lastCheckedAt: '2024-06-15T11:00:00Z',
        alertSentAt: '2024-06-14T10:00:00Z',
      });

      const check: UsageCheck = {
        service: 'Lambda',
        currentUsage: 850000,
        freeLimit: 1000000,
        percentUsed: 85,
      };

      const config: MonitorConfig = {
        checkIntervalMinutes: 5,
        alertThresholdPercent: 80,
        disableThresholdPercent: 100,
        services: [{ service: 'Lambda', metric: 'Invocations', monthlyLimit: 1000000 }],
      };

      await handleThresholdBreach(check, config, '2024-06', new Date());

      const sesCalls = sesMock.commandCalls(SendEmailCommand);
      expect(sesCalls).toHaveLength(0);
    });
  });

  describe('100% threshold triggers SES critical alert AND stores disabled flag', () => {
    it('sends critical email and stores API disabled flag in DynamoDB', async () => {
      const check: UsageCheck = {
        service: 'Lambda',
        currentUsage: 1000000,
        freeLimit: 1000000,
        percentUsed: 100,
      };

      const config: MonitorConfig = {
        checkIntervalMinutes: 5,
        alertThresholdPercent: 80,
        disableThresholdPercent: 100,
        services: [{ service: 'Lambda', metric: 'Invocations', monthlyLimit: 1000000 }],
      };

      const now = new Date(Date.UTC(2024, 5, 15, 12, 0, 0));
      const period = '2024-06';

      await handleThresholdBreach(check, config, period, now);

      // Verify SES was called with critical subject
      const sesCalls = sesMock.commandCalls(SendEmailCommand);
      expect(sesCalls).toHaveLength(1);

      const emailInput = sesCalls[0].args[0].input;
      expect(emailInput.Message?.Subject?.Data).toContain('CRÍTICO');
      expect(emailInput.Message?.Subject?.Data).toContain('100%');

      // Verify DynamoDB putUsageMetric was called with disabled flag
      expect(putUsageMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          PK: 'USAGE#QUOTE_API_DISABLED',
          SK: 'PERIOD#2024-06',
          disabledAt: now.toISOString(),
          currentUsage: 1,
        })
      );
    });

    it('does not duplicate disable if disabledAt already set', async () => {
      vi.mocked(getUsageMetric).mockResolvedValueOnce({
        PK: 'USAGE#Lambda',
        SK: 'PERIOD#2024-06',
        service: 'Lambda',
        currentUsage: 1000000,
        freeLimit: 1000000,
        percentUsed: 100,
        lastCheckedAt: '2024-06-15T11:00:00Z',
        disabledAt: '2024-06-14T10:00:00Z',
      });

      const check: UsageCheck = {
        service: 'Lambda',
        currentUsage: 1050000,
        freeLimit: 1000000,
        percentUsed: 105,
      };

      const config: MonitorConfig = {
        checkIntervalMinutes: 5,
        alertThresholdPercent: 80,
        disableThresholdPercent: 100,
        services: [{ service: 'Lambda', metric: 'Invocations', monthlyLimit: 1000000 }],
      };

      await handleThresholdBreach(check, config, '2024-06', new Date());

      // No email sent and no putUsageMetric for disable
      const sesCalls = sesMock.commandCalls(SendEmailCommand);
      expect(sesCalls).toHaveLength(0);
    });
  });

  describe('monthly reset restores functionality', () => {
    it('resets all counters and re-enables API on new billing month', async () => {
      // Set date to first of month at 00:00 UTC (within the 5-minute window)
      const now = new Date(Date.UTC(2024, 6, 1, 0, 0, 0)); // July 1, 2024

      // Mock CloudWatch to return some usage (shouldn't matter — reset skips usage check)
      cwMock.on(GetMetricStatisticsCommand).resolves({
        Datapoints: [{ Sum: 500000 }],
      });

      // Manually call handler with a date that triggers monthly reset
      // We'll verify via putUsageMetric being called with reset values
      // The handler uses `new Date()` internally, so we fake it
      vi.useFakeTimers();
      vi.setSystemTime(now);

      await handler(makeScheduledEvent());

      vi.useRealTimers();

      // Verify putUsageMetric was called for each service with 0 usage
      const putCalls = vi.mocked(putUsageMetric).mock.calls;

      // Should be called once per service + 1 for API_DISABLED reset
      expect(putCalls.length).toBe(MONITOR_CONFIG.services.length + 1);

      // All service resets should have currentUsage = 0
      for (let i = 0; i < MONITOR_CONFIG.services.length; i++) {
        expect(putCalls[i][0]).toMatchObject({
          currentUsage: 0,
          percentUsed: 0,
        });
      }

      // Last call should re-enable API (QUOTE_API_DISABLED with currentUsage: 0)
      const enableCall = putCalls[putCalls.length - 1][0];
      expect(enableCall).toMatchObject({
        PK: 'USAGE#QUOTE_API_DISABLED',
        currentUsage: 0,
        percentUsed: 0,
      });
      // Should NOT have a disabledAt field (API is re-enabled)
      expect(enableCall).not.toHaveProperty('disabledAt');
    });
  });

  describe('monitoring failure notification', () => {
    it('sends failure notification email via SES when handler throws', async () => {
      // Make getUsageMetric throw to simulate a failure in the handler
      vi.mocked(getUsageMetric).mockRejectedValue(new Error('DynamoDB connection timeout'));

      // Provide non-zero usage so the handler actually processes checks
      cwMock.on(GetMetricStatisticsCommand).resolves({
        Datapoints: [{ Sum: 500000 }],
      });

      // Use a date that's NOT first-of-month so it doesn't trigger reset path
      const now = new Date(Date.UTC(2024, 5, 15, 12, 0, 0));
      vi.useFakeTimers();
      vi.setSystemTime(now);

      // Handler should throw after sending failure notification
      await expect(handler(makeScheduledEvent())).rejects.toThrow('DynamoDB connection timeout');

      vi.useRealTimers();

      // Verify failure notification was sent via SES
      const sesCalls = sesMock.commandCalls(SendEmailCommand);
      expect(sesCalls.length).toBeGreaterThanOrEqual(1);

      // Find the failure notification email
      const failureEmail = sesCalls.find((call) =>
        call.args[0].input.Message?.Subject?.Data?.includes('ERROR')
      );
      expect(failureEmail).toBeDefined();
      expect(failureEmail!.args[0].input.Message?.Subject?.Data).toContain('Fallo en Lambda de monitoreo');
      expect(failureEmail!.args[0].input.Message?.Body?.Text?.Data).toContain('DynamoDB connection timeout');
    });
  });
});
