/**
 * Quote submission business logic module.
 *
 * Orchestrates the full quote submission pipeline:
 * 1. Verify hCaptcha token
 * 2. Check IP rate limit (10 submissions/IP/hour)
 * 3. Validate all input fields
 * 4. Generate UUID and tracking number (CF-XXXXXXXX format)
 * 5. Store quote in DynamoDB (transactional write: main record + tracking index)
 * 6. Send confirmation email to client (fire-and-forget)
 * 7. Send notification email to admin (fire-and-forget)
 * 8. Return success response with tracking number
 *
 * Email sending is non-blocking — quote acceptance is never delayed by email delivery.
 */

import { randomUUID } from 'node:crypto';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { verifyCaptcha } from '../security/captcha.js';
import { checkPublicRateLimit } from '../security/public-rate-limiter.js';
import {
  validateClientName,
  validateEmail,
  validatePhone,
  validateQuantity,
  validateAgeGroup,
  validateSizes,
  validateCustomizationNotes,
} from '../../validation/quote.js';
import { createQuote } from '../../db/operations.js';
import type { QuoteSubmitRequest, QuoteSubmitResponse } from '../../types/quote.js';
import type { QuoteRecord } from '../../db/entities.js';
import type { AgeGroup } from '../../types/garment.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'no-reply@cronusfit.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';

/** Rate limit endpoint identifier. */
const RATE_LIMIT_ENDPOINT = 'quote-submit';

/** SES client (reused across invocations for Lambda warm starts). */
const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Error returned when quote submission fails. */
export interface QuoteSubmitError {
  /** Error category. */
  type: 'captcha' | 'rate_limit' | 'validation' | 'storage' | 'internal';
  /** Human-readable error message. */
  message: string;
  /** Field-level validation errors (present only for type 'validation'). */
  fieldErrors?: Record<string, string>;
  /** Seconds until the rate limit window resets (present only for type 'rate_limit'). */
  retryAfterSeconds?: number;
}

/** Result of a quote submission attempt. */
export type QuoteSubmitResult =
  | { success: true; data: QuoteSubmitResponse }
  | { success: false; error: QuoteSubmitError };

// ---------------------------------------------------------------------------
// Tracking Number Generation
// ---------------------------------------------------------------------------

/**
 * Generates a tracking number in CF-XXXXXXXX format (alphanumeric uppercase).
 * Uses the first 8 characters of a UUID (without hyphens) for uniqueness.
 */
export function generateTrackingNumber(): string {
  const raw = randomUUID().replace(/-/g, '').substring(0, 8).toUpperCase();
  return `CF${raw}`;
}

// ---------------------------------------------------------------------------
// Email Sending (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Sends a confirmation email to the client. Logs errors but never throws.
 */
function sendClientConfirmation(
  email: string,
  clientName: string,
  trackingNumber: string,
): void {
  const command = new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: { ToAddresses: [email] },
    Message: {
      Subject: { Data: `Cotización recibida - ${trackingNumber}` },
      Body: {
        Text: {
          Data: [
            `Hola ${clientName},`,
            '',
            'Hemos recibido tu solicitud de cotización correctamente.',
            `Tu número de seguimiento es: ${trackingNumber}`,
            '',
            'Te contactaremos pronto con la información de precios.',
            '',
            'Gracias,',
            'Equipo Cronus Fit',
          ].join('\n'),
        },
      },
    },
  });

  // Fire-and-forget: don't await, just log errors
  sesClient.send(command).catch((error: unknown) => {
    console.error('Failed to send client confirmation email:', JSON.stringify({
      trackingNumber,
      email,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

/**
 * Sends a notification email to the admin with quote details. Logs errors but never throws.
 */
function sendAdminNotification(
  quoteId: string,
  trackingNumber: string,
  clientName: string,
  email: string,
  phone: string,
  productId: string,
  quantity: number,
  ageGroup: AgeGroup,
  sizes: string[],
  customizationNotes?: string,
): void {
  const details = [
    `Nueva solicitud de cotización recibida:`,
    '',
    `ID: ${quoteId}`,
    `Tracking: ${trackingNumber}`,
    `Cliente: ${clientName}`,
    `Email: ${email}`,
    `Teléfono: ${phone}`,
    `Producto: ${productId}`,
    `Cantidad: ${quantity}`,
    `Grupo etario: ${ageGroup}`,
    `Tallas: ${sizes.join(', ')}`,
  ];

  if (customizationNotes) {
    details.push(`Notas: ${customizationNotes}`);
  }

  const command = new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: { ToAddresses: [ADMIN_EMAIL] },
    Message: {
      Subject: { Data: `[CronusFit] Nueva cotización - ${trackingNumber}` },
      Body: {
        Text: { Data: details.join('\n') },
      },
    },
  });

  // Fire-and-forget: don't await, just log errors
  sesClient.send(command).catch((error: unknown) => {
    console.error('Failed to send admin notification email:', JSON.stringify({
      trackingNumber,
      quoteId,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

// ---------------------------------------------------------------------------
// Main submission function
// ---------------------------------------------------------------------------

/**
 * Submits a quote request through the full validation and storage pipeline.
 *
 * @param request - The quote submission form data
 * @param clientIp - The client's IP address (extracted from X-Forwarded-For)
 * @returns A result object indicating success with tracking number, or failure with error details
 */
export async function submitQuote(
  request: QuoteSubmitRequest,
  clientIp: string,
): Promise<QuoteSubmitResult> {
  // Step 1: Verify CAPTCHA token
  let captchaResult;
  try {
    captchaResult = await verifyCaptcha(request.captchaToken, clientIp);
  } catch (error: unknown) {
    console.error('CAPTCHA service error:', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      error: {
        type: 'captcha',
        message: 'CAPTCHA service temporarily unavailable',
      },
    };
  }

  if (!captchaResult.valid) {
    return {
      success: false,
      error: {
        type: 'captcha',
        message: `CAPTCHA verification failed: ${captchaResult.error ?? 'unknown'}`,
      },
    };
  }

  // Step 2: Check rate limit (10 submissions/IP/hour)
  let rateLimitResult;
  try {
    rateLimitResult = await checkPublicRateLimit(clientIp, RATE_LIMIT_ENDPOINT);
  } catch (error: unknown) {
    console.error('Rate limit service error:', error instanceof Error ? error.message : String(error));
    return {
      success: false,
      error: {
        type: 'internal',
        message: 'Service temporarily unavailable',
      },
    };
  }

  if (!rateLimitResult.allowed) {
    return {
      success: false,
      error: {
        type: 'rate_limit',
        message: `Rate limit exceeded. Try again in ${rateLimitResult.retryAfterSeconds ?? 3600} seconds`,
        retryAfterSeconds: rateLimitResult.retryAfterSeconds,
      },
    };
  }

  // Step 3: Validate all input fields
  const locale = 'es';
  const fieldErrors: Record<string, string> = {};

  const nameResult = validateClientName(request.clientName, locale);
  if (!nameResult.valid) fieldErrors['clientName'] = nameResult.error!;

  const emailResult = validateEmail(request.email, locale);
  if (!emailResult.valid) fieldErrors['email'] = emailResult.error!;

  const phoneResult = validatePhone(request.phone, locale);
  if (!phoneResult.valid) fieldErrors['phone'] = phoneResult.error!;

  const quantityResult = validateQuantity(request.quantity, locale);
  if (!quantityResult.valid) fieldErrors['quantity'] = quantityResult.error!;

  const ageGroupResult = validateAgeGroup(request.ageGroup, locale);
  if (!ageGroupResult.valid) fieldErrors['ageGroup'] = ageGroupResult.error!;

  // Only validate sizes if ageGroup is valid
  if (ageGroupResult.valid) {
    const sizesResult = validateSizes(request.sizes, request.ageGroup as AgeGroup, locale);
    if (!sizesResult.valid) fieldErrors['sizes'] = sizesResult.error!;
  }

  const notesResult = validateCustomizationNotes(request.customizationNotes, locale);
  if (!notesResult.valid) fieldErrors['customizationNotes'] = notesResult.error!;

  // Validate productId is present
  if (!request.productId || request.productId.trim().length === 0) {
    fieldErrors['productId'] = 'Este campo es obligatorio';
  }

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

  // Step 4: Generate UUID and tracking number
  const quoteId = randomUUID();
  const trackingNumber = generateTrackingNumber();
  const now = new Date().toISOString();

  // Step 5: Store quote in DynamoDB (transactional write)
  const quoteRecord: QuoteRecord = {
    PK: `QUOTE#${quoteId}`,
    SK: 'METADATA',
    GSI1PK: `QSTATUS#pending`,
    GSI1SK: `CREATED#${now}`,
    id: quoteId,
    trackingNumber,
    clientName: request.clientName,
    email: request.email,
    phone: request.phone,
    productId: request.productId,
    productName: request.productId, // Will be enriched by admin workflow
    quantity: request.quantity,
    ageGroup: request.ageGroup as AgeGroup,
    sizes: request.sizes,
    customizationNotes: request.customizationNotes,
    status: 'pending',
    createdAt: now,
  };

  try {
    await createQuote(quoteRecord);
  } catch (error: unknown) {
    console.error('Failed to store quote:', JSON.stringify({
      quoteId,
      trackingNumber,
      error: error instanceof Error ? error.message : String(error),
    }));
    return {
      success: false,
      error: {
        type: 'storage',
        message: 'Failed to process quote request. Please try again.',
      },
    };
  }

  // Step 6: Send confirmation email to client (fire-and-forget, non-blocking)
  sendClientConfirmation(request.email, request.clientName, trackingNumber);

  // Step 7: Send notification email to admin (fire-and-forget, non-blocking)
  sendAdminNotification(
    quoteId,
    trackingNumber,
    request.clientName,
    request.email,
    request.phone,
    request.productId,
    request.quantity,
    request.ageGroup as AgeGroup,
    request.sizes as string[],
    request.customizationNotes,
  );

  // Step 8: Return success response
  return {
    success: true,
    data: {
      quoteId,
      trackingNumber,
      status: 'pending',
    },
  };
}
