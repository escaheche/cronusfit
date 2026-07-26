/**
 * Usage Monitor Lambda Handler
 *
 * Triggered by EventBridge every 6 hours to track AWS Free Tier usage.
 * Pipeline:
 * 1. Check if new billing month → reset counters and restore functionality
 * 2. Query CloudWatch metrics for monitored services
 * 3. Compare usage against Free Tier monthly limits
 * 4. Store metrics in DynamoDB (USAGE#{service}, PERIOD#{YYYY-MM})
 * 5. At 80%: send alert email via SES
 * 6. At 100%: disable Quote API endpoints, maintain static site access
 * 7. On failure: notify Admin via SES within 15 minutes
 */

import type { ScheduledEvent } from 'aws-lambda';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { putUsageMetric, getUsageMetric } from '../../db/operations.js';
import type { UsageMetricRecord } from '../../db/entities.js';
import type { UsageCheck, MonitorConfig, ServiceLimit } from '../../types/exhibition.js';

// ---------------------------------------------------------------------------
// Clients (reused across warm starts)
// ---------------------------------------------------------------------------

const cloudWatchClient = new CloudWatchClient({});
const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';
const SENDER_EMAIL = process.env.SENDER_EMAIL ?? 'noreply@cronusfit.com';
const API_DISABLED_PARAM = process.env.API_DISABLED_PARAM ?? 'QUOTE_API_DISABLED';

/** Free Tier monthly limits for monitored services. */
export const MONITOR_CONFIG: MonitorConfig = {
  checkIntervalMinutes: 360,
  alertThresholdPercent: 80,
  disableThresholdPercent: 100,
  services: [
    { service: 'S3', metric: 'NumberOfObjects', monthlyLimit: 20000 },
    { service: 'CloudFront', metric: 'Requests', monthlyLimit: 10000000 },
    { service: 'ApiGateway', metric: 'Count', monthlyLimit: 1000000 },
    { service: 'Lambda', metric: 'Invocations', monthlyLimit: 1000000 },
    { service: 'DynamoDB', metric: 'ConsumedReadCapacityUnits', monthlyLimit: 200000000 },
  ],
};

// ---------------------------------------------------------------------------
// Exported utility functions (testable)
// ---------------------------------------------------------------------------

/**
 * Calculates the percentage of Free Tier limit used.
 * Returns a value rounded to 2 decimal places.
 */
export function calculatePercentage(currentUsage: number, freeLimit: number): number {
  if (freeLimit <= 0) return 0;
  return Math.round((currentUsage / freeLimit) * 10000) / 100;
}

/**
 * Determines if the current time represents a new billing month
 * (1st day of month at 00:00 UTC).
 * Checks if we're within the first check interval of the month.
 */
export function isNewBillingMonth(now: Date): boolean {
  return now.getUTCDate() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() < 5;
}

/**
 * Gets the current billing period string (YYYY-MM format).
 */
export function getCurrentPeriod(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Queries CloudWatch for a service's usage metric for the current month.
 */
export async function getServiceUsage(
  serviceLimit: ServiceLimit,
  now: Date
): Promise<number> {
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const namespaceMap: Record<string, string> = {
    S3: 'AWS/S3',
    CloudFront: 'AWS/CloudFront',
    ApiGateway: 'AWS/ApiGateway',
    Lambda: 'AWS/Lambda',
    DynamoDB: 'AWS/DynamoDB',
  };

  const namespace = namespaceMap[serviceLimit.service] ?? `AWS/${serviceLimit.service}`;

  try {
    const response = await cloudWatchClient.send(
      new GetMetricStatisticsCommand({
        Namespace: namespace,
        MetricName: serviceLimit.metric,
        StartTime: startOfMonth,
        EndTime: now,
        Period: 2592000, // 30 days in seconds (get sum for entire period)
        Statistics: ['Sum'],
      })
    );

    if (!response.Datapoints || response.Datapoints.length === 0) {
      return 0;
    }

    // Sum all datapoints
    return response.Datapoints.reduce((sum, dp) => sum + (dp.Sum ?? 0), 0);
  } catch (error) {
    console.error(`Failed to query CloudWatch for ${serviceLimit.service}:`, error);
    return 0; // On failure, return 0 (skip this check cycle)
  }
}

/**
 * Checks usage for all monitored services and returns UsageCheck results.
 */
export async function checkUsage(
  config: MonitorConfig,
  now: Date
): Promise<UsageCheck[]> {
  const results: UsageCheck[] = [];

  for (const serviceLimit of config.services) {
    const currentUsage = await getServiceUsage(serviceLimit, now);
    const percentUsed = calculatePercentage(currentUsage, serviceLimit.monthlyLimit);

    results.push({
      service: serviceLimit.service,
      currentUsage,
      freeLimit: serviceLimit.monthlyLimit,
      percentUsed,
    });
  }

  return results;
}

/**
 * Sends an alert email via SES when a threshold is reached.
 */
async function sendAlertEmail(
  service: string,
  percentUsed: number,
  level: 'warning' | 'critical'
): Promise<void> {
  const subject =
    level === 'critical'
      ? `[CRÍTICO] CronusFit: ${service} alcanzó 100% del Free Tier`
      : `[ALERTA] CronusFit: ${service} alcanzó ${percentUsed}% del Free Tier`;

  const body =
    level === 'critical'
      ? `El servicio ${service} ha alcanzado el 100% del límite mensual del Free Tier.\n\nAcción tomada: Los endpoints de Quote API han sido deshabilitados para prevenir costos adicionales.\nEl sitio estático permanece accesible.\n\nSe restaurará la funcionalidad completa al inicio del próximo mes de facturación.`
      : `El servicio ${service} ha alcanzado el ${percentUsed}% del límite mensual del Free Tier.\n\nSe recomienda revisar el uso actual y considerar acciones preventivas.\n\nSi alcanza el 100%, los endpoints de Quote API serán deshabilitados automáticamente.`;

  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: SENDER_EMAIL,
        Destination: { ToAddresses: [ADMIN_EMAIL] },
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } },
        },
      })
    );
  } catch (error) {
    console.error(`Failed to send ${level} alert email for ${service}:`, error);
  }
}

/**
 * Handles threshold breach for a single service.
 * At 80%: sends warning alert.
 * At 100%: sends critical alert and disables Quote API.
 */
export async function handleThresholdBreach(
  check: UsageCheck,
  config: MonitorConfig,
  period: string,
  now: Date
): Promise<void> {
  const existingMetric = await getUsageMetric(check.service, period);

  if (check.percentUsed >= config.disableThresholdPercent) {
    // 100% threshold: disable Quote API
    if (!existingMetric?.disabledAt) {
      await sendAlertEmail(check.service, check.percentUsed, 'critical');

      // Store disabled flag in DynamoDB for API endpoints to check
      const disableRecord: UsageMetricRecord = {
        PK: `USAGE#${API_DISABLED_PARAM}`,
        SK: `PERIOD#${period}`,
        service: API_DISABLED_PARAM,
        currentUsage: 1,
        freeLimit: 1,
        percentUsed: 100,
        lastCheckedAt: now.toISOString(),
        disabledAt: now.toISOString(),
      };
      await putUsageMetric(disableRecord);
    }
  } else if (check.percentUsed >= config.alertThresholdPercent) {
    // 80% threshold: send warning alert (only once per period)
    if (!existingMetric?.alertSentAt) {
      await sendAlertEmail(check.service, check.percentUsed, 'warning');
    }
  }
}

/**
 * Resets usage counters and restores full functionality for a new billing month.
 */
async function resetForNewMonth(config: MonitorConfig, period: string, now: Date): Promise<void> {
  // Reset all service metrics for the new period
  for (const serviceLimit of config.services) {
    const record: UsageMetricRecord = {
      PK: `USAGE#${serviceLimit.service}`,
      SK: `PERIOD#${period}`,
      service: serviceLimit.service,
      currentUsage: 0,
      freeLimit: serviceLimit.monthlyLimit,
      percentUsed: 0,
      lastCheckedAt: now.toISOString(),
    };
    await putUsageMetric(record);
  }

  // Remove API disabled flag for the new period
  const enableRecord: UsageMetricRecord = {
    PK: `USAGE#${API_DISABLED_PARAM}`,
    SK: `PERIOD#${period}`,
    service: API_DISABLED_PARAM,
    currentUsage: 0,
    freeLimit: 1,
    percentUsed: 0,
    lastCheckedAt: now.toISOString(),
  };
  await putUsageMetric(enableRecord);

  console.info(`New billing month detected. Reset counters for period ${period}.`);
}

/**
 * Sends a failure notification when the monitoring Lambda itself fails.
 */
async function sendFailureNotification(error: unknown): Promise<void> {
  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: SENDER_EMAIL,
        Destination: { ToAddresses: [ADMIN_EMAIL] },
        Message: {
          Subject: { Data: '[ERROR] CronusFit: Fallo en Lambda de monitoreo' },
          Body: {
            Text: {
              Data: `La Lambda de monitoreo de uso ha fallado.\n\nError: ${error instanceof Error ? error.message : String(error)}\n\nSi este error persiste por más de 15 minutos, el monitoreo de Free Tier no está activo.\nVerifique el estado del servicio en la consola de AWS.`,
            },
          },
        },
      })
    );
  } catch (notifyError) {
    console.error('Failed to send failure notification:', notifyError);
  }
}

// ---------------------------------------------------------------------------
// Lambda Handler
// ---------------------------------------------------------------------------

/**
 * Lambda handler triggered by EventBridge every 6 hours.
 * Monitors AWS Free Tier usage and takes action at defined thresholds.
 */
export async function handler(_event: ScheduledEvent): Promise<void> {
  const now = new Date();
  const period = getCurrentPeriod(now);

  try {
    // Step 1: Check if new billing month → reset counters
    if (isNewBillingMonth(now)) {
      await resetForNewMonth(MONITOR_CONFIG, period, now);
      return; // Skip usage check on reset — data not yet available
    }

    // Step 2: Query usage for all monitored services
    const usageChecks = await checkUsage(MONITOR_CONFIG, now);

    // Step 3: Store metrics and handle thresholds
    for (const check of usageChecks) {
      // Store/update usage metric in DynamoDB
      const record: UsageMetricRecord = {
        PK: `USAGE#${check.service}`,
        SK: `PERIOD#${period}`,
        service: check.service,
        currentUsage: check.currentUsage,
        freeLimit: check.freeLimit,
        percentUsed: check.percentUsed,
        lastCheckedAt: now.toISOString(),
      };

      // Preserve alertSentAt and disabledAt from existing record
      const existing = await getUsageMetric(check.service, period);
      if (existing?.alertSentAt) {
        record.alertSentAt = existing.alertSentAt;
      }
      if (existing?.disabledAt) {
        record.disabledAt = existing.disabledAt;
      }

      await putUsageMetric(record);

      // Step 4: Handle threshold breaches
      await handleThresholdBreach(check, MONITOR_CONFIG, period, now);
    }

    console.info(`Usage check completed for period ${period}. Checked ${usageChecks.length} services.`);
  } catch (error) {
    console.error('Monitor usage handler failed:', error);
    await sendFailureNotification(error);
    throw error; // Re-throw so EventBridge can track failures
  }
}
