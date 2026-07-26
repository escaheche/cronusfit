/**
 * Cross-Module Notification Helper — Unified SES email interface.
 *
 * Provides a single, consistent SES notification layer used by all modules:
 * - quote-notify: sends quote confirmations and price notifications
 * - quote-submit: sends receipt confirmation to client
 * - monitor-usage: sends threshold alerts to Admin
 * - monitor-alert: sends critical degradation alerts
 * - site-rebuild: sends build failure notifications
 *
 * All modules share the same sender email, CORS-safe error handling,
 * and bilingual template support (Spanish primary, English secondary).
 *
 * @module modules/events/notifications
 * @requirements 7.4, 7.5, 11.8, 6.2, 6.3
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// ---------------------------------------------------------------------------
// Client (reused across warm starts)
// ---------------------------------------------------------------------------

const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SENDER_EMAIL = process.env.SENDER_EMAIL ?? 'noreply@cronusfit.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported notification categories across the platform. */
export type NotificationCategory =
  | 'quote_received'
  | 'quote_priced'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'usage_warning'
  | 'usage_critical'
  | 'operations_disabled'
  | 'operations_restored'
  | 'rebuild_failed'
  | 'rebuild_completed'
  | 'general_admin';

/** Email notification request structure. */
export interface NotificationRequest {
  /** Recipient email address(es). */
  to: string | string[];
  /** Notification category for template selection. */
  category: NotificationCategory;
  /** Email subject line. */
  subject: string;
  /** Plain text email body. */
  body: string;
  /** Optional HTML body (falls back to text body if not provided). */
  htmlBody?: string;
  /** Optional reply-to address. */
  replyTo?: string;
}

/** Result of sending a notification. */
export interface NotificationResult {
  /** Whether the notification was sent successfully. */
  success: boolean;
  /** SES message ID on success. */
  messageId?: string;
  /** Error message on failure. */
  error?: string;
  /** Timestamp of the send attempt. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sends an email notification via AWS SES.
 *
 * This is the primary entry point for all cross-module email notifications.
 * It handles formatting, error logging, and returns a consistent result.
 *
 * @param request - Notification details (recipient, subject, body)
 * @returns NotificationResult indicating success or failure
 */
export async function sendNotification(
  request: NotificationRequest
): Promise<NotificationResult> {
  const timestamp = new Date().toISOString();
  const recipients = Array.isArray(request.to) ? request.to : [request.to];

  try {
    const command = new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: {
        ToAddresses: recipients,
      },
      Message: {
        Subject: { Data: request.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: request.body, Charset: 'UTF-8' },
          ...(request.htmlBody
            ? { Html: { Data: request.htmlBody, Charset: 'UTF-8' } }
            : {}),
        },
      },
      ...(request.replyTo ? { ReplyToAddresses: [request.replyTo] } : {}),
    });

    const result = await sesClient.send(command);

    return {
      success: true,
      messageId: result.MessageId,
      timestamp,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        type: 'NOTIFICATION_SEND_FAILED',
        category: request.category,
        recipients,
        error: errorMessage,
        timestamp,
      })
    );

    return {
      success: false,
      error: errorMessage,
      timestamp,
    };
  }
}

/**
 * Sends an admin notification via SES.
 *
 * Convenience wrapper that sends to the configured ADMIN_EMAIL.
 * Used by monitor-usage, monitor-alert, and site-rebuild modules.
 *
 * @param subject - Email subject line
 * @param body - Plain text body
 * @param category - Notification category for logging
 * @returns NotificationResult
 */
export async function notifyAdmin(
  subject: string,
  body: string,
  category: NotificationCategory = 'general_admin'
): Promise<NotificationResult> {
  return sendNotification({
    to: ADMIN_EMAIL,
    category,
    subject,
    body,
  });
}

/**
 * Sends a quote confirmation email to the client.
 *
 * Called by quote-submit handler after successfully storing a quote request.
 * Includes the tracking number for status lookup.
 *
 * @param clientEmail - Client's email address
 * @param clientName - Client's name
 * @param trackingNumber - Quote tracking number for status lookup
 * @returns NotificationResult
 */
export async function sendQuoteConfirmation(
  clientEmail: string,
  clientName: string,
  trackingNumber: string
): Promise<NotificationResult> {
  const subject = `CronusFit — Cotización recibida (${trackingNumber})`;
  const body = [
    `Hola ${clientName},`,
    '',
    'Hemos recibido tu solicitud de cotización correctamente.',
    '',
    `Tu número de seguimiento es: ${trackingNumber}`,
    '',
    'Puedes consultar el estado de tu cotización en cualquier momento en:',
    `https://cronusfit.com/estado/?tracking=${trackingNumber}`,
    '',
    'Te enviaremos la cotización detallada por este medio y por WhatsApp.',
    '',
    '¡Gracias por confiar en Cronus Fit!',
    '',
    '— Equipo Cronus Fit',
  ].join('\n');

  return sendNotification({
    to: clientEmail,
    category: 'quote_received',
    subject,
    body,
    replyTo: ADMIN_EMAIL,
  });
}

/**
 * Sends a quote priced notification to the client.
 *
 * Called by quote-notify when a quote has been priced by the Admin.
 *
 * @param clientEmail - Client's email address
 * @param clientName - Client's name
 * @param trackingNumber - Quote tracking number
 * @param totalPrice - Formatted total price string
 * @param currency - Currency code (e.g., 'COP')
 * @returns NotificationResult
 */
export async function sendQuotePricedNotification(
  clientEmail: string,
  clientName: string,
  trackingNumber: string,
  totalPrice: string,
  currency: string
): Promise<NotificationResult> {
  const subject = `CronusFit — Tu cotización está lista (${trackingNumber})`;
  const body = [
    `Hola ${clientName},`,
    '',
    '¡Tu cotización está lista!',
    '',
    `Número de seguimiento: ${trackingNumber}`,
    `Total: ${totalPrice} ${currency}`,
    '',
    'Responde a este correo o por WhatsApp para aceptar la cotización.',
    '',
    'Consulta los detalles completos en:',
    `https://cronusfit.com/estado/?tracking=${trackingNumber}`,
    '',
    '— Equipo Cronus Fit',
  ].join('\n');

  return sendNotification({
    to: clientEmail,
    category: 'quote_priced',
    subject,
    body,
    replyTo: ADMIN_EMAIL,
  });
}

/**
 * Sends a usage threshold alert to the Admin.
 *
 * Called by monitor-usage/monitor-alert when a service reaches 80% or 100%.
 *
 * @param service - AWS service name (e.g., 'Lambda', 'S3')
 * @param percentUsed - Current usage percentage
 * @param level - 'warning' (80%) or 'critical' (100%)
 * @param period - Billing period (YYYY-MM)
 * @returns NotificationResult
 */
export async function sendUsageAlert(
  service: string,
  percentUsed: number,
  level: 'warning' | 'critical',
  period: string
): Promise<NotificationResult> {
  const category: NotificationCategory =
    level === 'critical' ? 'usage_critical' : 'usage_warning';

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
          'Funcionalidad activa:',
          '• Sitio de exhibición (lectura): ACTIVO',
          '• Consulta de estado de cotizaciones: ACTIVO',
          '',
          `Período de facturación: ${period}`,
          'La funcionalidad se restaurará al inicio del próximo mes.',
        ].join('\n')
      : [
          `El servicio ${service} ha alcanzado el ${percentUsed.toFixed(1)}% del límite mensual del Free Tier.`,
          '',
          'Se recomienda revisar el uso actual.',
          '',
          `Período de facturación: ${period}`,
          'Si alcanza el 100%, las operaciones no esenciales serán deshabilitadas.',
        ].join('\n');

  return notifyAdmin(subject, body, category);
}

/**
 * Sends a rebuild failure notification to the Admin.
 *
 * Called by site-rebuild handler when a rebuild fails after retry.
 *
 * @param rebuildId - The failed rebuild ID
 * @param errorMessage - Description of the failure
 * @returns NotificationResult
 */
export async function sendRebuildFailureNotification(
  rebuildId: string,
  errorMessage: string
): Promise<NotificationResult> {
  const subject = `[ERROR] CronusFit: Fallo en reconstrucción del sitio (${rebuildId.slice(0, 8)})`;
  const body = [
    'La reconstrucción del sitio de exhibición ha fallado después del reintento.',
    '',
    `Rebuild ID: ${rebuildId}`,
    `Error: ${errorMessage}`,
    `Timestamp: ${new Date().toISOString()}`,
    '',
    'El sitio previamente publicado sigue activo.',
    'Investigue y ejecute una reconstrucción manual cuando esté listo.',
  ].join('\n');

  return notifyAdmin(subject, body, 'rebuild_failed');
}

/**
 * Returns the configured admin email address.
 * Useful for modules that need to know the admin recipient without
 * accessing the environment variable directly.
 */
export function getAdminEmail(): string {
  return ADMIN_EMAIL;
}

/**
 * Returns the configured sender email address.
 */
export function getSenderEmail(): string {
  return SENDER_EMAIL;
}
