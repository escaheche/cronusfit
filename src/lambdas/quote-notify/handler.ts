/**
 * Quote Notify Lambda Handler
 *
 * Handles quote-related notifications: SES email and WhatsApp messaging.
 *
 * Invoked internally (not directly via API Gateway public route) when:
 * - A quote is priced → send email + WhatsApp to client with quote details
 * - A client accepts/rejects → notify Admin via email + WhatsApp
 *
 * Supports two invocation modes:
 * 1. API Gateway event (POST /api/quotes/{id}/notify) — JWT required
 * 2. Direct Lambda invocation (from quote-process or quote-response handlers)
 *
 * @module lambdas/quote-notify
 * @requirements 7.4, 7.5, 7.7, 7.8, 7.9
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { get } from '../../db/operations.js';
import type { QuoteRecord } from '../../db/entities.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'no-reply@cronusfit.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';
const SITE_BASE_URL = process.env.SITE_BASE_URL ?? 'https://cronusfit.com';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? '';

const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Notification types supported by this handler. */
type NotificationType =
  | 'quote_priced'
  | 'quote_accepted'
  | 'quote_rejected';

interface NotifyRequest {
  quoteId: string;
  type: NotificationType;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // Parse the notification request
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let body: NotifyRequest;
    try {
      body = JSON.parse(event.body) as NotifyRequest;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    if (!body.quoteId) {
      return errorResponse(400, 'quoteId is required');
    }

    if (!body.type || !isValidNotificationType(body.type)) {
      return errorResponse(400, 'type must be one of: quote_priced, quote_accepted, quote_rejected');
    }

    // Fetch the quote record
    const quote = await get<QuoteRecord>(`QUOTE#${body.quoteId}`, 'METADATA');
    if (!quote) {
      return errorResponse(404, `Quote with ID ${body.quoteId} not found`);
    }

    // Dispatch based on notification type
    switch (body.type) {
      case 'quote_priced':
        await handleQuotePriced(quote);
        break;
      case 'quote_accepted':
        await handleQuoteAccepted(quote);
        break;
      case 'quote_rejected':
        await handleQuoteRejected(quote);
        break;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Notification "${body.type}" sent successfully`,
        quoteId: body.quoteId,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'QUOTE_NOTIFY_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, message);
  }
};

// ---------------------------------------------------------------------------
// Notification Handlers
// ---------------------------------------------------------------------------

/**
 * Handles "quote_priced" notification:
 * - Sends email to client with quote details and unique response link
 * - Sends WhatsApp message via n8n with quote details + accept/reject buttons
 */
async function handleQuotePriced(quote: QuoteRecord): Promise<void> {
  const responseLink = `${SITE_BASE_URL}/cotizacion/responder?token=${quote.quoteLinkToken ?? ''}`;

  // Send email to client
  await sendEmail(
    quote.email,
    `Cotización lista - ${quote.trackingNumber}`,
    [
      `Hola ${quote.clientName},`,
      '',
      'Tu cotización ha sido procesada:',
      '',
      `Producto: ${quote.productName}`,
      `Cantidad: ${quote.quantity}`,
      `Precio unitario: ${quote.currency ?? 'COP'} ${quote.unitPrice ?? 0}`,
      `Precio total: ${quote.currency ?? 'COP'} ${quote.totalPrice ?? 0}`,
      `Válido hasta: ${quote.validUntil ?? 'N/A'}`,
      '',
      `Para aceptar o rechazar esta cotización, haz clic aquí:`,
      responseLink,
      '',
      'Gracias,',
      'Equipo Cronus Fit',
    ].join('\n'),
  );

  // Send WhatsApp via n8n webhook (if configured)
  if (N8N_WEBHOOK_URL) {
    await sendWhatsAppNotification({
      type: 'quote',
      recipientPhone: quote.phone,
      payload: {
        quoteId: quote.id,
        productName: quote.productName,
        price: `${quote.currency ?? 'COP'} ${quote.totalPrice ?? 0}`,
        quantity: quote.quantity,
        ageGroup: quote.ageGroup,
        sizes: quote.sizes as string[],
      },
    });
  }
}

/**
 * Handles "quote_accepted" notification:
 * - Sends email to Admin notifying of acceptance
 */
async function handleQuoteAccepted(quote: QuoteRecord): Promise<void> {
  await sendEmail(
    ADMIN_EMAIL,
    `[CronusFit] Cotización aceptada - ${quote.trackingNumber}`,
    [
      'Un cliente ha aceptado una cotización:',
      '',
      `Tracking: ${quote.trackingNumber}`,
      `Cliente: ${quote.clientName}`,
      `Email: ${quote.email}`,
      `Teléfono: ${quote.phone}`,
      `Producto: ${quote.productName}`,
      `Cantidad: ${quote.quantity}`,
      `Precio total: ${quote.currency ?? 'COP'} ${quote.totalPrice ?? 0}`,
      '',
      'Proceder con la producción.',
    ].join('\n'),
  );
}

/**
 * Handles "quote_rejected" notification:
 * - Sends email to Admin notifying of rejection
 */
async function handleQuoteRejected(quote: QuoteRecord): Promise<void> {
  await sendEmail(
    ADMIN_EMAIL,
    `[CronusFit] Cotización rechazada - ${quote.trackingNumber}`,
    [
      'Un cliente ha rechazado una cotización:',
      '',
      `Tracking: ${quote.trackingNumber}`,
      `Cliente: ${quote.clientName}`,
      `Email: ${quote.email}`,
      `Producto: ${quote.productName}`,
      `Cantidad: ${quote.quantity}`,
      `Precio total: ${quote.currency ?? 'COP'} ${quote.totalPrice ?? 0}`,
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Email Helper
// ---------------------------------------------------------------------------

/**
 * Sends an email via SES. Throws on failure for upstream retry handling.
 */
async function sendEmail(to: string, subject: string, bodyText: string): Promise<void> {
  const command = new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Text: { Data: bodyText } },
    },
  });

  try {
    await sesClient.send(command);
  } catch (error: unknown) {
    console.error('SES send failed:', JSON.stringify({
      to,
      subject,
      error: error instanceof Error ? error.message : String(error),
    }));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// WhatsApp Helper
// ---------------------------------------------------------------------------

/**
 * Sends a WhatsApp notification via the n8n webhook.
 * Fire-and-forget with error logging.
 */
async function sendWhatsAppNotification(payload: {
  type: 'quote';
  recipientPhone: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch (error: unknown) {
    console.error('WhatsApp notification failed:', JSON.stringify({
      recipientPhone: payload.recipientPhone,
      error: error instanceof Error ? error.message : String(error),
    }));
    // Don't throw — WhatsApp notification failure should not block the response
  }
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function isValidNotificationType(type: string): type is NotificationType {
  return ['quote_priced', 'quote_accepted', 'quote_rejected'].includes(type);
}

// ---------------------------------------------------------------------------
// Error Response
// ---------------------------------------------------------------------------

function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  };
}
