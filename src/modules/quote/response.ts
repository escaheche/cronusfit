/**
 * Quote client response module — Client accepts or rejects a quote via unique link.
 *
 * Flow:
 * 1. Validate response token/link
 * 2. Verify the quote exists and is in 'quoted' status
 * 3. Check if quote has expired (validUntil date)
 * 4. Accept or reject the quote
 * 5. Only commit status change after successful Admin notification (email)
 * 6. Retry Admin notification with exponential backoff on failure
 * 7. Handle expired quotes gracefully
 *
 * Requirements: 7.8, 7.9
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { get, update, queryByGSI1 } from '../../db/operations.js';
import type { QuoteRecord, BaseRecord } from '../../db/entities.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'no-reply@cronusfit.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';

/** Maximum retry attempts for admin notification. */
const MAX_NOTIFICATION_RETRIES = 5;

/** Base delay in ms for exponential backoff (doubles each attempt: 500, 1000, 2000, 4000, 8000). */
const BASE_BACKOFF_MS = 500;

/** SES client (reused across warm invocations). */
const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Client response action. */
export type QuoteResponseAction = 'accept' | 'reject';

/** Input for a client's quote response. */
export interface QuoteResponseInput {
  /** The unique token from the response link. */
  token: string;
  /** Whether the client accepts or rejects the quote. */
  action: QuoteResponseAction;
}

/** Error returned when quote response fails. */
export interface QuoteResponseError {
  type: 'validation' | 'not_found' | 'invalid_status' | 'expired' | 'notification_failed' | 'internal';
  message: string;
}

/** Result of a client quote response attempt. */
export type QuoteResponseResult =
  | { success: true; data: { quoteId: string; status: 'accepted' | 'rejected' } }
  | { success: false; error: QuoteResponseError };

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Exposed internals for testing. Allows replacing the sleep function
 * without module-level mocking complexity.
 */
export const _internals = {
  sleep: defaultSleep,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculates exponential backoff delay for a retry attempt.
 * Delays: 500ms, 1000ms, 2000ms, 4000ms, 8000ms
 */
export function calculateBackoffDelay(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt);
}

/**
 * Finds a quote by its response link token.
 * Scans quoted quotes and checks the token field.
 * Returns null if no quote matches.
 */
async function findQuoteByToken(token: string): Promise<QuoteRecord | null> {
  if (!token || token.trim().length === 0) {
    return null;
  }

  // Query all 'quoted' quotes and filter by token
  // In a production system, we'd add a GSI for the token; here we use filter on GSI1
  const result = await queryByGSI1<QuoteRecord>(
    'QSTATUS#quoted',
    undefined,
    {
      filterExpression: 'quoteLinkToken = :token',
      expressionAttributeValues: { ':token': token },
      limit: 1,
    },
  );

  if (result.items.length > 0) {
    return result.items[0];
  }

  // Also check pending responses that may have been previously attempted
  // (in case of retry scenarios where the quote was found but notification failed)
  return null;
}

/**
 * Sends admin notification email about the client's response.
 * Throws on failure (caller handles retries).
 */
async function sendAdminNotificationEmail(
  quoteId: string,
  trackingNumber: string,
  clientName: string,
  productName: string,
  action: QuoteResponseAction,
  totalPrice?: number,
  currency?: string,
): Promise<void> {
  const actionLabel = action === 'accept' ? 'ACEPTADA' : 'RECHAZADA';

  const body = [
    `Cotización ${actionLabel}`,
    '',
    `La cotización ${trackingNumber} ha sido ${actionLabel.toLowerCase()} por el cliente.`,
    '',
    `Detalles:`,
    `  ID: ${quoteId}`,
    `  Tracking: ${trackingNumber}`,
    `  Cliente: ${clientName}`,
    `  Producto: ${productName}`,
  ];

  if (totalPrice && currency) {
    body.push(`  Precio total: ${currency} ${totalPrice.toLocaleString()}`);
  }

  body.push(
    '',
    `Acción del cliente: ${actionLabel}`,
    '',
    'Revisa la cotización en el panel de administración.',
  );

  const command = new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: { ToAddresses: [ADMIN_EMAIL] },
    Message: {
      Subject: { Data: `[CronusFit] Cotización ${actionLabel} - ${trackingNumber}` },
      Body: {
        Text: { Data: body.join('\n') },
      },
    },
  });

  await sesClient.send(command);
}

/**
 * Attempts to send admin notification with exponential backoff.
 * Returns true if notification was successfully sent, false if all retries exhausted.
 */
async function notifyAdminWithRetry(
  quoteId: string,
  trackingNumber: string,
  clientName: string,
  productName: string,
  action: QuoteResponseAction,
  totalPrice?: number,
  currency?: string,
): Promise<boolean> {
  for (let attempt = 0; attempt <= MAX_NOTIFICATION_RETRIES; attempt++) {
    try {
      await sendAdminNotificationEmail(
        quoteId,
        trackingNumber,
        clientName,
        productName,
        action,
        totalPrice,
        currency,
      );
      return true; // Success
    } catch (error: unknown) {
      console.error(`Admin notification attempt ${attempt + 1}/${MAX_NOTIFICATION_RETRIES + 1} failed:`, JSON.stringify({
        quoteId,
        attempt,
        error: error instanceof Error ? error.message : String(error),
      }));

      if (attempt < MAX_NOTIFICATION_RETRIES) {
        const delay = calculateBackoffDelay(attempt);
        await _internals.sleep(delay);
      }
    }
  }

  return false; // All retries exhausted
}

// ---------------------------------------------------------------------------
// Main Response Function
// ---------------------------------------------------------------------------

/**
 * Processes a client's response (accept/reject) to a quoted quote.
 *
 * Critical behavior: the status update is ONLY committed after the Admin
 * notification email succeeds. If notification fails after all retries,
 * the status remains 'quoted' and the client is informed to try again.
 *
 * @param input - The client's response (token + action)
 * @returns Result indicating success with new status, or failure with error details
 */
export async function respondToQuote(
  input: QuoteResponseInput,
): Promise<QuoteResponseResult> {
  // Step 1: Validate token
  if (!input.token || input.token.trim().length === 0) {
    return {
      success: false,
      error: { type: 'validation', message: 'Token de respuesta es obligatorio' },
    };
  }

  if (!input.action || !['accept', 'reject'].includes(input.action)) {
    return {
      success: false,
      error: { type: 'validation', message: 'Acción debe ser "accept" o "reject"' },
    };
  }

  // Step 2: Find quote by token
  let quoteRecord: QuoteRecord | null;
  try {
    quoteRecord = await findQuoteByToken(input.token);
  } catch (error: unknown) {
    console.error('Error finding quote by token:', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      error: { type: 'internal', message: 'Error al procesar la respuesta' },
    };
  }

  if (!quoteRecord) {
    return {
      success: false,
      error: { type: 'not_found', message: 'Enlace de cotización no válido o expirado' },
    };
  }

  // Step 3: Validate status is 'quoted'
  if (quoteRecord.status !== 'quoted') {
    return {
      success: false,
      error: {
        type: 'invalid_status',
        message: `Esta cotización ya ha sido ${quoteRecord.status === 'accepted' ? 'aceptada' : 'rechazada'}`,
      },
    };
  }

  // Step 4: Check if quote has expired
  if (quoteRecord.validUntil) {
    const expiryDate = new Date(quoteRecord.validUntil);
    if (!isNaN(expiryDate.getTime()) && expiryDate.getTime() < Date.now()) {
      return {
        success: false,
        error: {
          type: 'expired',
          message: 'Esta cotización ha expirado. Solicite una nueva cotización.',
        },
      };
    }
  }

  // Step 5: Send Admin notification FIRST (requirement 7.8/7.9)
  // Status update only happens after successful notification
  const notificationSuccess = await notifyAdminWithRetry(
    quoteRecord.id,
    quoteRecord.trackingNumber,
    quoteRecord.clientName,
    quoteRecord.productName,
    input.action,
    quoteRecord.totalPrice,
    quoteRecord.currency,
  );

  if (!notificationSuccess) {
    return {
      success: false,
      error: {
        type: 'notification_failed',
        message: 'No se pudo notificar al administrador. Intente nuevamente en unos minutos.',
      },
    };
  }

  // Step 6: Commit status change (only after successful admin notification)
  const newStatus = input.action === 'accept' ? 'accepted' : 'rejected';
  const now = new Date().toISOString();

  try {
    await update<QuoteRecord>(
      `QUOTE#${quoteRecord.id}`,
      'METADATA',
      {
        updateExpression: 'SET #status = :status, GSI1PK = :gsi1pk, updatedAt = :updatedAt',
        expressionAttributeNames: { '#status': 'status' },
        expressionAttributeValues: {
          ':status': newStatus,
          ':gsi1pk': `QSTATUS#${newStatus}`,
          ':updatedAt': now,
          ':expectedStatus': 'quoted',
        },
        conditionExpression: '#status = :expectedStatus',
      },
    );
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (errMsg.includes('ConditionalCheckFailed')) {
      return {
        success: false,
        error: {
          type: 'invalid_status',
          message: 'Esta cotización ya ha sido procesada (posible respuesta duplicada)',
        },
      };
    }
    console.error('Failed to update quote status:', errMsg);
    return {
      success: false,
      error: { type: 'internal', message: 'Error al actualizar el estado de la cotización' },
    };
  }

  return {
    success: true,
    data: {
      quoteId: quoteRecord.id,
      status: newStatus,
    },
  };
}
