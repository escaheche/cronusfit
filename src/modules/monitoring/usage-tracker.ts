/**
 * Usage Tracker module for CronusFit Free Tier monitoring.
 *
 * Provides pure business logic for tracking AWS Free Tier consumption:
 * - Calculating usage percentages relative to monthly limits
 * - Determining alert thresholds (80% warning, 100% critical)
 * - Managing degradation state (disable non-essential at 100%)
 * - Supporting the EventBridge-triggered monitoring Lambda
 *
 * This module is decoupled from the Lambda event structure.
 * The monitor-usage Lambda handler is the entry point that calls these functions.
 *
 * Validates: Requirements 11.8, 11.9, 11.10
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { putUsageMetric, getUsageMetric } from '../../db/operations.js';
import type { UsageMetricRecord } from '../../db/entities.js';
import type { UsageCheck, MonitorConfig, ServiceLimit } from '../../types/exhibition.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AWS service names tracked for Free Tier monitoring. */
export const MONITORED_SERVICES = [
  'S3',
  'CloudFront',
  'ApiGateway',
  'Lambda',
  'DynamoDB',
  'SES',
] as const;

export type MonitoredService = (typeof MONITORED_SERVICES)[number];

/** Free Tier monthly limits per service. */
export const FREE_TIER_LIMITS: Record<MonitoredService, { metric: string; monthlyLimit: number }> = {
  S3: { metric: 'NumberOfObjects', monthlyLimit: 20000 },
  CloudFront: { metric: 'Requests', monthlyLimit: 10_000_000 },
  ApiGateway: { metric: 'Count', monthlyLimit: 1_000_000 },
  Lambda: { metric: 'Invocations', monthlyLimit: 1_000_000 },
  DynamoDB: { metric: 'ConsumedReadCapacityUnits', monthlyLimit: 200_000_000 },
  SES: { metric: 'Send', monthlyLimit: 62_000 },
};

/** Threshold at which an alert email is sent. */
export const ALERT_THRESHOLD_PERCENT = 80;

/** Threshold at which non-essential operations are disabled. */
export const DISABLE_THRESHOLD_PERCENT = 100;

/** DynamoDB key suffix for the API disabled flag. */
export const API_DISABLED_KEY = 'QUOTE_API_DISABLED';

/** DynamoDB key suffix for the social generation disabled flag. */
export const SOCIAL_DISABLED_KEY = 'SOCIAL_GENERATION_DISABLED';

/** DynamoDB key suffix for the mockup generation disabled flag. */
export const MOCKUP_DISABLED_KEY = 'MOCKUP_GENERATION_DISABLED';

// ---------------------------------------------------------------------------
// Clients (initialized lazily to support mocking)
// ---------------------------------------------------------------------------

let _cloudWatchClient: CloudWatchClient | undefined;
let _sesClient: SESClient | undefined;

function getCloudWatchClient(): CloudWatchClient {
  if (!_cloudWatchClient) {
    _cloudWatchClient = new CloudWatchClient({});
  }
  return _cloudWatchClient;
}

function getSesClient(): SESClient {
  if (!_sesClient) {
    _sesClient = new SESClient({});
  }
  return _sesClient;
}

// ---------------------------------------------------------------------------
// Percentage Calculation
// ---------------------------------------------------------------------------

/**
 * Calculates the percentage of Free Tier limit used.
 *
 * @param currentUsage - Current usage value for the billing period
 * @param freeLimit - Monthly Free Tier limit for the service
 * @returns Percentage (0–∞), rounded to 2 decimal places; 0 if freeLimit <= 0
 */
export function calculateUsagePercent(currentUsage: number, freeLimit: number): number {
  if (freeLimit <= 0) return 0;
  return Math.round((currentUsage / freeLimit) * 10000) / 100;
}

/**
 * Determines the alert level for a given usage percentage.
 *
 * @param percentUsed - Current usage as a percentage of the Free Tier limit
 * @returns 'critical' at ≥100%, 'warning' at ≥80%, null below threshold
 */
export function getAlertLevel(percentUsed: number): 'critical' | 'warning' | null {
  if (percentUsed >= DISABLE_THRESHOLD_PERCENT) return 'critical';
  if (percentUsed >= ALERT_THRESHOLD_PERCENT) return 'warning';
  return null;
}

/**
 * Returns true if non-essential operations should be disabled at this usage level.
 * Requirement 11.10: disable at 100%.
 */
export function shouldDisableNonEssential(percentUsed: number): boolean {
  return percentUsed >= DISABLE_THRESHOLD_PERCENT;
}

// ---------------------------------------------------------------------------
// Billing Period Utilities
// ---------------------------------------------------------------------------

/**
 * Gets the current billing period string in YYYY-MM format.
 *
 * @param now - Date to use (defaults to current UTC time)
 * @returns Billing period string, e.g. '2024-06'
 */
export function getBillingPeriod(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Returns true if this is the start of a new billing month.
 * Used to reset counters and restore full functionality.
 *
 * Requirement 11.10: restore on new billing month.
 *
 * @param now - Date to check (defaults to current UTC time)
 * @returns True if it's the 1st day of the month at 00:00 UTC (within 5 min window)
 */
export function isNewBillingMonth(now: Date = new Date()): boolean {
  return now.getUTCDate() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() < 5;
}

// ---------------------------------------------------------------------------
// CloudWatch Metric Queries
// ---------------------------------------------------------------------------

/**
 * Queries CloudWatch for a service's cumulative usage since the start of the billing month.
 *
 * @param service - The service identifier (e.g., 'Lambda', 'S3')
 * @param serviceLimit - Service limit configuration
 * @param now - Reference time (defaults to current UTC time)
 * @returns Cumulative usage count, 0 on query failure
 */
export async function queryServiceUsage(
  service: MonitoredService,
  serviceLimit: { metric: string; monthlyLimit: number },
  now: Date = new Date()
): Promise<number> {
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const namespaceMap: Record<MonitoredService, string> = {
    S3: 'AWS/S3',
    CloudFront: 'AWS/CloudFront',
    ApiGateway: 'AWS/ApiGateway',
    Lambda: 'AWS/Lambda',
    DynamoDB: 'AWS/DynamoDB',
    SES: 'AWS/SES',
  };

  const namespace = namespaceMap[service];

  try {
    const response = await getCloudWatchClient().send(
      new GetMetricStatisticsCommand({
        Namespace: namespace,
        MetricName: serviceLimit.metric,
        StartTime: startOfMonth,
        EndTime: now,
        Period: 2_592_000, // 30 days in seconds — get monthly sum in one datapoint
        Statistics: ['Sum'],
      })
    );

    if (!response.Datapoints || response.Datapoints.length === 0) {
      return 0;
    }

    return response.Datapoints.reduce((sum, dp) => sum + (dp.Sum ?? 0), 0);
  } catch (error) {
    console.error(`Failed to query CloudWatch for ${service}:`, error);
    return 0; // Gracefully skip on failure
  }
}

// ---------------------------------------------------------------------------
// Usage Check
// ---------------------------------------------------------------------------

/**
 * Checks usage for all configured services and returns UsageCheck results.
 *
 * @param config - Monitor configuration with service limits
 * @param now - Reference time (defaults to current UTC time)
 * @returns Array of UsageCheck results for each monitored service
 */
export async function checkAllServices(
  config: MonitorConfig,
  now: Date = new Date()
): Promise<UsageCheck[]> {
  const results: UsageCheck[] = [];

  for (const serviceLimit of config.services) {
    const service = serviceLimit.service as MonitoredService;
    const currentUsage = await queryServiceUsage(service, serviceLimit, now);
    const percentUsed = calculateUsagePercent(currentUsage, serviceLimit.monthlyLimit);

    results.push({
      service: serviceLimit.service,
      currentUsage,
      freeLimit: serviceLimit.monthlyLimit,
      percentUsed,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Threshold Actions
// ---------------------------------------------------------------------------

/**
 * Sends an alert email via SES when a threshold is crossed.
 *
 * Requirement 11.8: Alert within 10 minutes of detection.
 *
 * @param service - The service that triggered the alert
 * @param percentUsed - Current usage percentage
 * @param level - Alert level ('warning' at 80%, 'critical' at 100%)
 * @param period - Current billing period (YYYY-MM)
 */
export async function sendAlertEmail(
  service: string,
  percentUsed: number,
  level: 'warning' | 'critical',
  period: string
): Promise<void> {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';
  const senderEmail = process.env.SENDER_EMAIL ?? 'noreply@cronusfit.com';

  const subject =
    level === 'critical'
      ? `[CRÍTICO] CronusFit: ${service} alcanzó 100% del Free Tier (${period})`
      : `[ALERTA] CronusFit: ${service} al ${percentUsed.toFixed(1)}% del Free Tier (${period})`;

  const body =
    level === 'critical'
      ? [
          `El servicio ${service} ha alcanzado el 100% del límite mensual del Free Tier.`,
          '',
          'Acciones tomadas automáticamente:',
          '• Generación de contenido social: DESHABILITADA',
          '• Generación de nuevos mockups: DESHABILITADA',
          '',
          'Funcionalidad que permanece activa:',
          '• Sitio de exhibición (lectura): ACTIVO',
          '• Datos existentes: ACCESIBLES',
          '',
          `Período de facturación: ${period}`,
          'La funcionalidad completa se restaurará al inicio del próximo mes.',
        ].join('\n')
      : [
          `El servicio ${service} ha alcanzado el ${percentUsed.toFixed(1)}% del límite mensual del Free Tier.`,
          '',
          'Revise el uso actual y considere acciones preventivas.',
          '',
          `Período de facturación: ${period}`,
          'Si alcanza el 100%, las operaciones no esenciales serán deshabilitadas automáticamente.',
        ].join('\n');

  await getSesClient().send(
    new SendEmailCommand({
      Source: senderEmail,
      Destination: { ToAddresses: [adminEmail] },
      Message: {
        Subject: { Data: subject },
        Body: { Text: { Data: body } },
      },
    })
  );
}

/**
 * Disables non-essential operations by storing flags in DynamoDB.
 *
 * Non-essential operations disabled at 100%:
 * - Social content generation
 * - New mockup generation
 * - Quote API write endpoints
 *
 * Requirement 11.10: Disable and confirm before maintaining read-only.
 *
 * @param period - Current billing period (YYYY-MM)
 * @param now - Reference time
 * @returns Object indicating which operations were disabled
 */
export async function disableNonEssentialOperations(
  period: string,
  now: Date = new Date()
): Promise<{ socialDisabled: boolean; mockupDisabled: boolean; apiDisabled: boolean }> {
  const timestamp = now.toISOString();

  const makeRecord = (key: string): UsageMetricRecord => ({
    PK: `USAGE#${key}`,
    SK: `PERIOD#${period}`,
    service: key,
    currentUsage: 1,
    freeLimit: 1,
    percentUsed: 100,
    lastCheckedAt: timestamp,
    disabledAt: timestamp,
  });

  await Promise.all([
    putUsageMetric(makeRecord(SOCIAL_DISABLED_KEY)),
    putUsageMetric(makeRecord(MOCKUP_DISABLED_KEY)),
    putUsageMetric(makeRecord(API_DISABLED_KEY)),
  ]);

  return { socialDisabled: true, mockupDisabled: true, apiDisabled: true };
}

/**
 * Verifies that non-essential operations are disabled by reading back flags from DynamoDB.
 *
 * Requirement 11.10: Confirm disabled before maintaining read-only access.
 *
 * @param period - Current billing period (YYYY-MM)
 * @returns True if all non-essential operations are confirmed disabled
 */
export async function confirmNonEssentialDisabled(period: string): Promise<boolean> {
  const [socialMetric, mockupMetric, apiMetric] = await Promise.all([
    getUsageMetric(SOCIAL_DISABLED_KEY, period),
    getUsageMetric(MOCKUP_DISABLED_KEY, period),
    getUsageMetric(API_DISABLED_KEY, period),
  ]);

  const socialDisabled = !!(socialMetric && socialMetric['disabledAt']);
  const mockupDisabled = !!(mockupMetric && mockupMetric['disabledAt']);
  const apiDisabled = !!(apiMetric && apiMetric['disabledAt']);

  return socialDisabled && mockupDisabled && apiDisabled;
}

/**
 * Checks whether a specific non-essential operation is currently disabled.
 * Used by other Lambda handlers to gate operations at runtime.
 *
 * @param operationKey - The operation key (e.g., SOCIAL_DISABLED_KEY)
 * @param period - Current billing period (YYYY-MM)
 * @returns True if the operation is disabled
 */
export async function isOperationDisabled(
  operationKey: string,
  period: string
): Promise<boolean> {
  const metric = await getUsageMetric(operationKey, period);
  return !!(metric && metric['disabledAt']);
}

/**
 * Re-enables all non-essential operations (clears disabled flags).
 * Called at the start of a new billing month or via manual Admin override.
 *
 * @param period - Current billing period (YYYY-MM)
 * @param now - Reference time
 */
export async function reenableAllOperations(
  period: string,
  now: Date = new Date()
): Promise<void> {
  const timestamp = now.toISOString();

  const makeRecord = (key: string): UsageMetricRecord => ({
    PK: `USAGE#${key}`,
    SK: `PERIOD#${period}`,
    service: key,
    currentUsage: 0,
    freeLimit: 1,
    percentUsed: 0,
    lastCheckedAt: timestamp,
  });

  await Promise.all([
    putUsageMetric(makeRecord(SOCIAL_DISABLED_KEY)),
    putUsageMetric(makeRecord(MOCKUP_DISABLED_KEY)),
    putUsageMetric(makeRecord(API_DISABLED_KEY)),
  ]);
}

// ---------------------------------------------------------------------------
// Full Check Cycle
// ---------------------------------------------------------------------------

/**
 * Persists a usage check result to DynamoDB.
 * Preserves existing alertSentAt and disabledAt to prevent duplicate alerts.
 *
 * @param check - The usage check result
 * @param period - Current billing period (YYYY-MM)
 * @param now - Reference time
 */
export async function persistUsageMetric(
  check: UsageCheck,
  period: string,
  now: Date = new Date()
): Promise<void> {
  const existing = await getUsageMetric(check.service, period);

  const record: UsageMetricRecord = {
    PK: `USAGE#${check.service}`,
    SK: `PERIOD#${period}`,
    service: check.service,
    currentUsage: check.currentUsage,
    freeLimit: check.freeLimit,
    percentUsed: check.percentUsed,
    lastCheckedAt: now.toISOString(),
  };

  // Preserve existing alertSentAt to avoid duplicate alert emails
  if (existing?.alertSentAt) {
    record.alertSentAt = existing.alertSentAt as string;
  }

  // Preserve existing disabledAt to avoid duplicate disable actions
  if (existing?.disabledAt) {
    record.disabledAt = existing.disabledAt as string;
  }

  await putUsageMetric(record);
}

/**
 * Handles a threshold breach for a single service.
 *
 * - At ≥80% (and < 100%): sends warning email (once per period per service)
 * - At ≥100%: sends critical email and disables non-essential operations
 *
 * Requirement 11.8: Alert within 10 minutes of detection.
 * Requirement 11.10: Disable and confirm at 100%.
 *
 * @param check - The usage check result for the service
 * @param config - Monitor configuration with thresholds
 * @param period - Current billing period (YYYY-MM)
 * @param now - Reference time
 */
export async function handleThresholdBreach(
  check: UsageCheck,
  config: MonitorConfig,
  period: string,
  now: Date = new Date()
): Promise<void> {
  const existingMetric = await getUsageMetric(check.service, period);

  if (check.percentUsed >= config.disableThresholdPercent) {
    // 100% critical: disable non-essential + send alert (once per period)
    if (!existingMetric?.disabledAt) {
      await sendAlertEmail(check.service, check.percentUsed, 'critical', period);

      // Disable and confirm (Req 11.10)
      await disableNonEssentialOperations(period, now);
      const confirmed = await confirmNonEssentialDisabled(period);

      if (!confirmed) {
        // Retry once if confirmation fails
        await disableNonEssentialOperations(period, now);
        const retryConfirmed = await confirmNonEssentialDisabled(period);
        if (!retryConfirmed) {
          console.error(`[Monitor] Failed to confirm non-essential ops disabled for ${check.service} in ${period}`);
        }
      }

      // Update the metric record with disabledAt
      const record: UsageMetricRecord = {
        PK: `USAGE#${check.service}`,
        SK: `PERIOD#${period}`,
        service: check.service,
        currentUsage: check.currentUsage,
        freeLimit: check.freeLimit,
        percentUsed: check.percentUsed,
        lastCheckedAt: now.toISOString(),
        disabledAt: now.toISOString(),
      };
      if (existingMetric?.alertSentAt) {
        record.alertSentAt = existingMetric.alertSentAt as string;
      }
      await putUsageMetric(record);
    }
  } else if (check.percentUsed >= config.alertThresholdPercent) {
    // 80–99% warning: send alert (once per period)
    if (!existingMetric?.alertSentAt) {
      await sendAlertEmail(check.service, check.percentUsed, 'warning', period);

      // Update the metric record with alertSentAt
      const record: UsageMetricRecord = {
        PK: `USAGE#${check.service}`,
        SK: `PERIOD#${period}`,
        service: check.service,
        currentUsage: check.currentUsage,
        freeLimit: check.freeLimit,
        percentUsed: check.percentUsed,
        lastCheckedAt: now.toISOString(),
        alertSentAt: now.toISOString(),
      };
      await putUsageMetric(record);
    }
  }
}

/**
 * Runs the complete monitoring check cycle for all services.
 *
 * Orchestrates:
 * 1. Check if new billing month → reset and re-enable operations
 * 2. Query CloudWatch for all service metrics
 * 3. Persist metrics to DynamoDB
 * 4. Handle threshold breaches (alert/disable)
 *
 * @param config - Monitor configuration
 * @param now - Reference time (defaults to current UTC time)
 */
export async function runMonitoringCycle(
  config: MonitorConfig,
  now: Date = new Date()
): Promise<{
  period: string;
  servicesChecked: number;
  alertsSent: number;
  nonEssentialDisabled: boolean;
}> {
  const period = getBillingPeriod(now);

  // New billing month: reset counters and re-enable operations
  if (isNewBillingMonth(now)) {
    await reenableAllOperations(period, now);
    return {
      period,
      servicesChecked: 0,
      alertsSent: 0,
      nonEssentialDisabled: false,
    };
  }

  const usageChecks = await checkAllServices(config, now);
  let alertsSent = 0;
  let nonEssentialDisabled = false;

  for (const check of usageChecks) {
    // Persist metric
    await persistUsageMetric(check, period, now);

    // Handle threshold
    const alertLevel = getAlertLevel(check.percentUsed);
    if (alertLevel) {
      const existingMetric = await getUsageMetric(check.service, period);

      if (alertLevel === 'critical' && !existingMetric?.disabledAt) {
        await handleThresholdBreach(check, config, period, now);
        nonEssentialDisabled = true;
        alertsSent++;
      } else if (alertLevel === 'warning' && !existingMetric?.alertSentAt) {
        await handleThresholdBreach(check, config, period, now);
        alertsSent++;
      }
    }
  }

  return {
    period,
    servicesChecked: usageChecks.length,
    alertsSent,
    nonEssentialDisabled,
  };
}
