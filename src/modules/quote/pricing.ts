/**
 * Quote pricing module — Admin sets pricing on a pending quote.
 *
 * Flow:
 * 1. Validate pricing input (positive numbers, valid currency, valid expiry date)
 * 2. Update quote status from 'pending' to 'quoted' using conditional DynamoDB write
 * 3. Generate unique response link/token for client
 * 4. Trigger email notification via SES with quote details and response link
 * 5. Trigger WhatsApp notification via send service
 * 6. Record audit log entry
 *
 * Requirements: 7.7, 7.8, 7.9, 7.10
 */

import { randomUUID, randomBytes } from 'node:crypto';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { get, update } from '../../db/operations.js';
import { recordAuditEntry } from '../security/audit-log.js';
import type { QuoteRecord } from '../../db/entities.js';
import type { BaseRecord } from '../../db/entities.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'no-reply@cronusfit.com';
const BASE_URL = process.env.BASE_URL ?? 'https://cronusfit.com';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL ?? '';

/** SES client (reused across warm invocations). */
const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for setting a price on a quote. */
export interface QuotePriceInput {
  /** Quote ID to price. */
  quoteId: string;
  /** Price per unit. */
  unitPrice: number;
  /** Total price for the order. */
  totalPrice: number;
  /** Currency code (ISO 4217, e.g., COP, USD). */
  currency: string;
  /** Date until the quote is valid (ISO 8601). */
  validUntil: string;
  /** Optional notes from the admin. */
  notes?: string;
}

/** Admin identity context passed from the Lambda authorizer. */
export interface AdminContext {
  adminId: string;
  adminEmail: string;
}

/** Error returned when pricing fails. */
export interface QuotePriceError {
  type: 'validation' | 'not_found' | 'invalid_status' | 'storage' | 'internal';
  message: string;
  fieldErrors?: Record<string, string>;
}

/** Result of a quote pricing attempt. */
export type QuotePriceResult =
  | { success: true; data: { quoteId: string; status: 'quoted'; quoteLinkToken: string } }
  | { success: false; error: QuotePriceError };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Supported currency codes (ISO 4217 subset commonly used). */
const VALID_CURRENCIES = new Set([
  'COP', 'USD', 'EUR', 'MXN', 'BRL', 'ARS', 'CLP', 'PEN', 'GBP',
]);

/**
 * Validates pricing input fields.
 * Returns field-level errors if any field is invalid.
 */
export function validatePriceInput(input: QuotePriceInput): Record<string, string> {
  const errors: Record<string, string> = {};

  // quoteId
  if (!input.quoteId || input.quoteId.trim().length === 0) {
    errors['quoteId'] = 'El ID de cotización es obligatorio';
  }

  // unitPrice must be positive
  if (input.unitPrice === undefined || input.unitPrice === null) {
    errors['unitPrice'] = 'El precio unitario es obligatorio';
  } else if (typeof input.unitPrice !== 'number' || !isFinite(input.unitPrice) || input.unitPrice <= 0) {
    errors['unitPrice'] = 'El precio unitario debe ser un número positivo';
  }

  // totalPrice must be positive
  if (input.totalPrice === undefined || input.totalPrice === null) {
    errors['totalPrice'] = 'El precio total es obligatorio';
  } else if (typeof input.totalPrice !== 'number' || !isFinite(input.totalPrice) || input.totalPrice <= 0) {
    errors['totalPrice'] = 'El precio total debe ser un número positivo';
  }

  // currency must be valid ISO 4217
  if (!input.currency || input.currency.trim().length === 0) {
    errors['currency'] = 'La moneda es obligatoria';
  } else if (!VALID_CURRENCIES.has(input.currency.toUpperCase())) {
    errors['currency'] = `Moneda no soportada. Monedas válidas: ${[...VALID_CURRENCIES].join(', ')}`;
  }

  // validUntil must be a valid future date
  if (!input.validUntil || input.validUntil.trim().length === 0) {
    errors['validUntil'] = 'La fecha de validez es obligatoria';
  } else {
    const validDate = new Date(input.validUntil);
    if (isNaN(validDate.getTime())) {
      errors['validUntil'] = 'La fecha de validez no es un formato de fecha válido (use ISO 8601)';
    } else if (validDate.getTime() <= Date.now()) {
      errors['validUntil'] = 'La fecha de validez debe ser en el futuro';
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Token Generation
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically secure URL-safe token for client quote response links.
 * 32 bytes → 64 hex characters.
 */
export function generateQuoteLinkToken(): string {
  return randomBytes(32).toString('hex');
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Sends the quote details email to the client with the unique response link.
 * Throws on failure (caller handles retry).
 */
async function sendQuoteEmail(
  email: string,
  clientName: string,
  productName: string,
  unitPrice: number,
  totalPrice: number,
  currency: string,
  quantity: number,
  validUntil: string,
  responseUrl: string,
  notes?: string,
): Promise<void> {
  const body = [
    `Hola ${clientName},`,
    '',
    'Tu cotización ha sido procesada. Aquí están los detalles:',
    '',
    `Producto: ${productName}`,
    `Cantidad: ${quantity}`,
    `Precio unitario: ${currency} ${unitPrice.toLocaleString()}`,
    `Precio total: ${currency} ${totalPrice.toLocaleString()}`,
    `Válida hasta: ${new Date(validUntil).toLocaleDateString('es-CO')}`,
  ];

  if (notes) {
    body.push(`Notas: ${notes}`);
  }

  body.push(
    '',
    'Para aceptar o rechazar esta cotización, visita el siguiente enlace:',
    responseUrl,
    '',
    'Gracias,',
    'Equipo Cronus Fit',
  );

  const command = new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Cotización lista - ${productName}` },
      Body: {
        Text: { Data: body.join('\n') },
      },
    },
  });

  await sesClient.send(command);
}

/**
 * Sends quote details via WhatsApp using the n8n webhook endpoint.
 * Fire-and-forget — logs errors but does not throw.
 */
async function sendQuoteWhatsApp(
  phone: string,
  quoteId: string,
  productName: string,
  price: string,
  quantity: number,
  ageGroup: string,
  sizes: string[],
): Promise<void> {
  if (!N8N_WEBHOOK_URL) {
    console.warn('N8N_WEBHOOK_URL not configured, skipping WhatsApp notification');
    return;
  }

  const payload = {
    type: 'quote',
    recipientPhone: phone,
    payload: {
      quoteId,
      productName,
      price,
      quantity,
      ageGroup,
      sizes,
    },
  };

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('WhatsApp notification failed:', JSON.stringify({
        quoteId,
        status: response.status,
        statusText: response.statusText,
      }));
    }
  } catch (error: unknown) {
    console.error('WhatsApp notification error:', JSON.stringify({
      quoteId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

// ---------------------------------------------------------------------------
// Main Pricing Function
// ---------------------------------------------------------------------------

/**
 * Sets the price on a pending quote, transitions it to 'quoted' status,
 * generates a unique response link, and sends notifications.
 *
 * @param input - The pricing details from the admin
 * @param admin - The authenticated admin identity
 * @returns Result indicating success or failure with error details
 */
export async function priceQuote(
  input: QuotePriceInput,
  admin: AdminContext,
): Promise<QuotePriceResult> {
  // Step 1: Validate pricing input
  const fieldErrors = validatePriceInput(input);
  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      error: {
        type: 'validation',
        message: 'Validation failed',
        fieldErrors,
      },
    };
  }

  // Step 2: Fetch the existing quote
  let quoteRecord: QuoteRecord | null;
  try {
    quoteRecord = await get<QuoteRecord>(`QUOTE#${input.quoteId}`, 'METADATA');
  } catch (error: unknown) {
    console.error('Failed to fetch quote:', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      error: { type: 'internal', message: 'Error retrieving quote' },
    };
  }

  if (!quoteRecord) {
    return {
      success: false,
      error: { type: 'not_found', message: `Cotización ${input.quoteId} no encontrada` },
    };
  }

  // Step 3: Validate current status is 'pending'
  if (quoteRecord.status !== 'pending') {
    return {
      success: false,
      error: {
        type: 'invalid_status',
        message: `La cotización tiene estado '${quoteRecord.status}', solo se puede cotizar desde 'pending'`,
      },
    };
  }

  // Step 4: Generate unique response token
  const quoteLinkToken = generateQuoteLinkToken();
  const now = new Date().toISOString();

  // Step 5: Update quote with pricing and status → 'quoted' (conditional write)
  try {
    await update<QuoteRecord>(
      `QUOTE#${input.quoteId}`,
      'METADATA',
      {
        updateExpression: [
          'SET #status = :status',
          'GSI1PK = :gsi1pk',
          'unitPrice = :unitPrice',
          'totalPrice = :totalPrice',
          'currency = :currency',
          'validUntil = :validUntil',
          'quoteLinkToken = :token',
          'updatedAt = :updatedAt',
        ].join(', '),
        expressionAttributeNames: { '#status': 'status' },
        expressionAttributeValues: {
          ':status': 'quoted',
          ':gsi1pk': 'QSTATUS#quoted',
          ':unitPrice': input.unitPrice,
          ':totalPrice': input.totalPrice,
          ':currency': input.currency.toUpperCase(),
          ':validUntil': input.validUntil,
          ':token': quoteLinkToken,
          ':updatedAt': now,
          ':expectedStatus': 'pending',
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
          message: 'La cotización ya no está en estado pendiente (posible actualización concurrente)',
        },
      };
    }
    console.error('Failed to update quote pricing:', errMsg);
    return {
      success: false,
      error: { type: 'storage', message: 'Error al actualizar la cotización' },
    };
  }

  // Step 6: Send notifications (email + WhatsApp)
  const responseUrl = `${BASE_URL}/cotizacion/respuesta?token=${quoteLinkToken}`;
  const priceFormatted = `${input.currency.toUpperCase()} ${input.totalPrice.toLocaleString()}`;

  // Email: fire-and-forget (log errors but don't fail the operation)
  sendQuoteEmail(
    quoteRecord.email,
    quoteRecord.clientName,
    quoteRecord.productName,
    input.unitPrice,
    input.totalPrice,
    input.currency.toUpperCase(),
    quoteRecord.quantity,
    input.validUntil,
    responseUrl,
    input.notes,
  ).catch((error: unknown) => {
    console.error('Failed to send quote email:', JSON.stringify({
      quoteId: input.quoteId,
      email: quoteRecord!.email,
      error: error instanceof Error ? error.message : String(error),
    }));
  });

  // WhatsApp: fire-and-forget
  sendQuoteWhatsApp(
    quoteRecord.phone,
    input.quoteId,
    quoteRecord.productName,
    priceFormatted,
    quoteRecord.quantity,
    quoteRecord.ageGroup,
    quoteRecord.sizes as string[],
  ).catch((error: unknown) => {
    console.error('Failed to send WhatsApp notification:', JSON.stringify({
      quoteId: input.quoteId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });

  // Step 7: Record audit log entry (best-effort)
  recordAuditEntry({
    adminId: admin.adminId,
    adminEmail: admin.adminEmail,
    actionType: 'quote_price',
    resourceId: input.quoteId,
    resourceType: 'quote',
    metadata: {
      unitPrice: input.unitPrice,
      totalPrice: input.totalPrice,
      currency: input.currency.toUpperCase(),
      validUntil: input.validUntil,
    },
  });

  return {
    success: true,
    data: {
      quoteId: input.quoteId,
      status: 'quoted',
      quoteLinkToken,
    },
  };
}
