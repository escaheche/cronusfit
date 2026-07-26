/**
 * Monitor Alert Lambda Handler
 *
 * Handles threshold breach alerts and degradation logic for Free Tier monitoring.
 * Invoked when the monitor-usage handler detects a threshold breach, or via
 * EventBridge/SNS trigger. Responsibilities:
 *
 * 1. Process threshold breach events (80% warning, 100% critical)
 * 2. Send alert emails via SES (warning at 80%, critical at 100%)
 * 3. Disable non-essential operations at 100% (social content generation, new mockup generation)
 * 4. Confirm non-essential disabled before maintaining read-only access
 * 5. Maintain read-only Exhibition Website access at 100%
 * 6. Re-enable functionality on new billing month or manual override
 *
 * @module lambdas/monitor-alert
 * @requirements 11.1–11.10
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { putUsageMetric, getUsageMetric } from '../../db/operations.js';
import type { UsageMetricRecord } from '../../db/entities.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event payload sent to this Lambda by the monitor-usage handler or EventBridge. */
export interface AlertEvent {
  /** Type of alert action requested. */
  action: 'threshold_breach' | 'reenable' | 'status_check';
  /** Service that triggered the alert (e.g., 'S3', 'Lambda'). */
  service?: string;
  /** Current usage percentage (0–100+). */
  percentUsed?: number;
  /** Alert level based on threshold crossed. */
  level?: 'warning' | 'critical';
  /** Current billing period in YYYY-MM format. */
  period?: string;
  /** Timestamp of detection (ISO 8601). */
  detectedAt?: string;
  /** Admin override flag for manual re-enable. */
  manualOverride?: boolean;
}

/** Result returned by the alert handler. */
export interface AlertResult {
  /** Whether the alert was processed successfully. */
  success: boolean;
  /** Action that was taken. */
  actionTaken: string;
  /** Whether non-essential operations are currently disabled. */
  nonEssentialDisabled: boolean;
  /** Timestamp of the action (ISO 8601). */
  timestamp: string;
  /** Error message if processing failed. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Non-essential operation flags stored in DynamoDB
// ---------------------------------------------------------------------------

/** DynamoDB key for the social content generation disabled flag. */
const SOCIAL_DISABLED_KEY = 'SOCIAL_GENERATION_DISABLED';

/** DynamoDB key for the mockup generation disabled flag. */
const MOCKUP_DISABLED_KEY = 'MOCKUP_GENERATION_DISABLED';

/** DynamoDB key for the Quote API disabled flag (existing pattern from monitor-usage). */
const API_DISABLED_KEY = 'QUOTE_API_DISABLED';

// ---------------------------------------------------------------------------
// Clients (reused across warm starts)
// ---------------------------------------------------------------------------

const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';
const SENDER_EMAIL = process.env.SENDER_EMAIL ?? 'noreply@cronusfit.com';

// ---------------------------------------------------------------------------
// Exported utility functions (testable)
// ---------------------------------------------------------------------------

/**
 * Sends an alert email to the Admin when a threshold is crossed.
 * Warning emails are sent at 80%, critical emails at 100%.
 * Requirement 11.8: alert within 10 minutes of detection.
 */
export async function sendThresholdAlert(
  service: string,
  percentUsed: number,
  level: 'warning' | 'critical',
  period: string
): Promise<void> {
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
          '• Quote API (endpoints de escritura): DESHABILITADA',
          '',
          'Funcionalidad que permanece activa:',
          '• Sitio de exhibición (lectura): ACTIVO',
          '• Consulta de estado de cotizaciones: ACTIVO',
          '• Datos existentes: ACCESIBLES',
          '',
          `Período de facturación: ${period}`,
          'La funcionalidad completa se restaurará al inicio del próximo mes de facturación.',
          'Para restaurar manualmente, invoque este Lambda con action: "reenable" y manualOverride: true.',
        ].join('\n')
      : [
          `El servicio ${service} ha alcanzado el ${percentUsed.toFixed(1)}% del límite mensual del Free Tier.`,
          '',
          'Se recomienda revisar el uso actual y considerar acciones preventivas.',
          '',
          `Período de facturación: ${period}`,
          'Si alcanza el 100%, las operaciones no esenciales serán deshabilitadas automáticamente.',
        ].join('\n');

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
}

/**
 * Disables non-essential operations by storing flags in DynamoDB.
 * Non-essential: social content generation, new mockup generation.
 * Requirement 11.10: disable and confirm before maintaining read-only.
 */
export async function disableNonEssentialOperations(
  period: string,
  now: Date
): Promise<{ socialDisabled: boolean; mockupDisabled: boolean; apiDisabled: boolean }> {
  const timestamp = now.toISOString();

  const socialRecord: UsageMetricRecord = {
    PK: `USAGE#${SOCIAL_DISABLED_KEY}`,
    SK: `PERIOD#${period}`,
    service: SOCIAL_DISABLED_KEY,
    currentUsage: 1,
    freeLimit: 1,
    percentUsed: 100,
    lastCheckedAt: timestamp,
    disabledAt: timestamp,
  };

  const mockupRecord: UsageMetricRecord = {
    PK: `USAGE#${MOCKUP_DISABLED_KEY}`,
    SK: `PERIOD#${period}`,
    service: MOCKUP_DISABLED_KEY,
    currentUsage: 1,
    freeLimit: 1,
    percentUsed: 100,
    lastCheckedAt: timestamp,
    disabledAt: timestamp,
  };

  const apiRecord: UsageMetricRecord = {
    PK: `USAGE#${API_DISABLED_KEY}`,
    SK: `PERIOD#${period}`,
    service: API_DISABLED_KEY,
    currentUsage: 1,
    freeLimit: 1,
    percentUsed: 100,
    lastCheckedAt: timestamp,
    disabledAt: timestamp,
  };

  await putUsageMetric(socialRecord);
  await putUsageMetric(mockupRecord);
  await putUsageMetric(apiRecord);

  return { socialDisabled: true, mockupDisabled: true, apiDisabled: true };
}

/**
 * Confirms that non-essential operations have been successfully disabled.
 * Reads back the flags from DynamoDB to verify.
 * Requirement 11.10: confirm disabled before maintaining read-only.
 */
export async function confirmNonEssentialDisabled(period: string): Promise<boolean> {
  const socialMetric = await getUsageMetric(SOCIAL_DISABLED_KEY, period);
  const mockupMetric = await getUsageMetric(MOCKUP_DISABLED_KEY, period);
  const apiMetric = await getUsageMetric(API_DISABLED_KEY, period);

  const socialDisabled = !!(socialMetric && socialMetric['disabledAt']);
  const mockupDisabled = !!(mockupMetric && mockupMetric['disabledAt']);
  const apiDisabled = !!(apiMetric && apiMetric['disabledAt']);

  return socialDisabled && mockupDisabled && apiDisabled;
}

/**
 * Checks if a specific non-essential operation is currently disabled.
 * Used by other Lambdas to gate operations at runtime.
 */
export async function isOperationDisabled(
  operationKey: string,
  period: string
): Promise<boolean> {
  const metric = await getUsageMetric(operationKey, period);
  return !!(metric && metric['disabledAt']);
}

/**
 * Re-enables all non-essential operations for a given period.
 * Called at the start of a new billing month or via manual Admin override.
 */
export async function reenableOperations(
  period: string,
  now: Date
): Promise<void> {
  const timestamp = now.toISOString();

  const keys = [SOCIAL_DISABLED_KEY, MOCKUP_DISABLED_KEY, API_DISABLED_KEY];

  for (const key of keys) {
    const record: UsageMetricRecord = {
      PK: `USAGE#${key}`,
      SK: `PERIOD#${period}`,
      service: key,
      currentUsage: 0,
      freeLimit: 1,
      percentUsed: 0,
      lastCheckedAt: timestamp,
    };
    await putUsageMetric(record);
  }
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
 * Gets current degradation status for the billing period.
 */
export async function getDegradationStatus(period: string): Promise<{
  socialDisabled: boolean;
  mockupDisabled: boolean;
  apiDisabled: boolean;
}> {
  const socialMetric = await getUsageMetric(SOCIAL_DISABLED_KEY, period);
  const mockupMetric = await getUsageMetric(MOCKUP_DISABLED_KEY, period);
  const apiMetric = await getUsageMetric(API_DISABLED_KEY, period);

  return {
    socialDisabled: !!(socialMetric && socialMetric['disabledAt']),
    mockupDisabled: !!(mockupMetric && mockupMetric['disabledAt']),
    apiDisabled: !!(apiMetric && apiMetric['disabledAt']),
  };
}

// ---------------------------------------------------------------------------
// Lambda Handler
// ---------------------------------------------------------------------------

/**
 * Lambda handler for alert processing and degradation management.
 * Processes threshold breach events, manages service degradation,
 * and handles re-enablement.
 */
export async function handler(event: AlertEvent): Promise<AlertResult> {
  const now = new Date();
  const timestamp = now.toISOString();
  const period = event.period ?? getCurrentPeriod(now);

  try {
    switch (event.action) {
      case 'threshold_breach': {
        if (!event.service || event.percentUsed === undefined || !event.level) {
          return {
            success: false,
            actionTaken: 'none',
            nonEssentialDisabled: false,
            timestamp,
            error: 'Missing required fields: service, percentUsed, level',
          };
        }

        // Send alert email (Req 11.8: within 10 minutes of detection)
        await sendThresholdAlert(event.service, event.percentUsed, event.level, period);

        if (event.level === 'critical') {
          // Req 11.10: Disable non-essential operations at 100%
          await disableNonEssentialOperations(period, now);

          // Req 11.10: Confirm disabled before maintaining read-only
          const confirmed = await confirmNonEssentialDisabled(period);

          if (!confirmed) {
            // Retry once on confirmation failure
            await disableNonEssentialOperations(period, now);
            const retryConfirmed = await confirmNonEssentialDisabled(period);

            if (!retryConfirmed) {
              console.error('Failed to confirm non-essential operations disabled after retry');
              return {
                success: false,
                actionTaken: 'disable_attempted',
                nonEssentialDisabled: false,
                timestamp,
                error: 'Failed to confirm non-essential operations are disabled',
              };
            }
          }

          console.info(
            `Critical threshold: ${event.service} at ${event.percentUsed}%. ` +
            `Non-essential operations disabled for period ${period}.`
          );

          return {
            success: true,
            actionTaken: 'disabled_non_essential',
            nonEssentialDisabled: true,
            timestamp,
          };
        }

        // Warning level (80%): alert sent, no degradation
        console.info(
          `Warning threshold: ${event.service} at ${event.percentUsed}%. ` +
          `Alert sent for period ${period}.`
        );

        const status = await getDegradationStatus(period);

        return {
          success: true,
          actionTaken: 'alert_sent',
          nonEssentialDisabled: status.socialDisabled && status.mockupDisabled && status.apiDisabled,
          timestamp,
        };
      }

      case 'reenable': {
        if (!event.manualOverride) {
          return {
            success: false,
            actionTaken: 'none',
            nonEssentialDisabled: true,
            timestamp,
            error: 'Manual override flag required to re-enable operations',
          };
        }

        await reenableOperations(period, now);

        // Send confirmation email to Admin
        await sesClient.send(
          new SendEmailCommand({
            Source: SENDER_EMAIL,
            Destination: { ToAddresses: [ADMIN_EMAIL] },
            Message: {
              Subject: { Data: `[INFO] CronusFit: Operaciones restauradas (${period})` },
              Body: {
                Text: {
                  Data: [
                    'Las operaciones no esenciales han sido restauradas manualmente.',
                    '',
                    'Operaciones restauradas:',
                    '• Generación de contenido social',
                    '• Generación de nuevos mockups',
                    '• Quote API (endpoints de escritura)',
                    '',
                    `Período: ${period}`,
                    `Restaurado: ${timestamp}`,
                    '',
                    'ADVERTENCIA: Si el Free Tier sigue al 100%, se generarán costos.',
                  ].join('\n'),
                },
              },
            },
          })
        );

        console.info(`Operations re-enabled for period ${period} via manual override.`);

        return {
          success: true,
          actionTaken: 'reenabled',
          nonEssentialDisabled: false,
          timestamp,
        };
      }

      case 'status_check': {
        const status = await getDegradationStatus(period);
        const allDisabled = status.socialDisabled && status.mockupDisabled && status.apiDisabled;

        return {
          success: true,
          actionTaken: 'status_reported',
          nonEssentialDisabled: allDisabled,
          timestamp,
        };
      }

      default: {
        return {
          success: false,
          actionTaken: 'none',
          nonEssentialDisabled: false,
          timestamp,
          error: `Unknown action: ${(event as { action: string }).action}`,
        };
      }
    }
  } catch (error) {
    console.error('Monitor alert handler failed:', error);

    // Attempt to notify Admin of handler failure
    try {
      await sesClient.send(
        new SendEmailCommand({
          Source: SENDER_EMAIL,
          Destination: { ToAddresses: [ADMIN_EMAIL] },
          Message: {
            Subject: { Data: '[ERROR] CronusFit: Fallo en Lambda de alertas de monitoreo' },
            Body: {
              Text: {
                Data: [
                  'La Lambda de alertas de monitoreo ha fallado.',
                  '',
                  `Error: ${error instanceof Error ? error.message : String(error)}`,
                  `Evento: ${JSON.stringify(event)}`,
                  '',
                  'Verifique el estado del servicio en la consola de AWS.',
                ].join('\n'),
              },
            },
          },
        })
      );
    } catch (notifyError) {
      console.error('Failed to send failure notification:', notifyError);
    }

    return {
      success: false,
      actionTaken: 'error',
      nonEssentialDisabled: false,
      timestamp,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
