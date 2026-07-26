/**
 * Quote Submit Lambda Handler
 *
 * POST /api/quotes — public endpoint (CAPTCHA + rate limit, no JWT)
 *
 * Thin wrapper that:
 * 1. Extracts client IP from X-Forwarded-For
 * 2. Checks rate limit (10 submissions/IP/hour)
 * 3. Parses and validates request body JSON
 * 4. Verifies hCaptcha token
 * 5. Validates input fields
 * 6. Stores quote in DynamoDB (transactional write)
 * 7. Fires confirmation emails (non-blocking)
 * 8. Returns 201 with tracking number
 *
 * @module lambdas/quote-submit
 * @requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.11, 13.6, 13.7
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { randomUUID } from 'node:crypto';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { extractClientIp, checkRateLimit } from '../../modules/security/public-rate-limiter.js';
import { verifyCaptcha } from '../../modules/security/captcha.js';
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
import type { QuoteRecord } from '../../db/entities.js';
import type { AgeGroup } from '../../types/garment.js';
import type { RateLimitConfig } from '../../types/security.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL ?? 'no-reply@cronusfit.com';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@cronusfit.com';

const RATE_LIMIT_CONFIG: RateLimitConfig = {
  endpoint: 'quote-submit',
  maxRequests: parseInt(process.env.QUOTE_RATE_LIMIT_MAX ?? '10', 10),
  windowSeconds: parseInt(process.env.QUOTE_RATE_LIMIT_WINDOW_SECONDS ?? '3600', 10),
};

const sesClient = new SESClient({});

// ---------------------------------------------------------------------------
// CORS Headers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Content-Type': 'application/json',
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (event): Promise<APIGatewayProxyResult> => {
  try {
    // Step 1: Extract client IP
    const clientIp = extractClientIp(event.headers['X-Forwarded-For'] ?? event.headers['x-forwarded-for']);
    if (!clientIp) {
      return errorResponse(400, 'Missing X-Forwarded-For header');
    }

    // Step 2: Check rate limit
    let rateLimitResult;
    try {
      rateLimitResult = await checkRateLimit(clientIp, RATE_LIMIT_CONFIG);
    } catch {
      return errorResponse(503, 'Service temporarily unavailable. Please try again later.');
    }

    if (!rateLimitResult.allowed) {
      const retryAfter = rateLimitResult.retryAfterSeconds ?? 3600;
      return {
        statusCode: 429,
        headers: { ...CORS_HEADERS, 'Retry-After': String(retryAfter) },
        body: JSON.stringify({
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
        }),
      };
    }

    // Step 3: Parse request body
    if (!event.body) {
      return errorResponse(400, 'Request body is required');
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body) as Record<string, unknown>;
    } catch {
      return errorResponse(400, 'Invalid JSON in request body');
    }

    // Step 4: Verify hCaptcha token
    const captchaToken = body.captchaToken as string | undefined;
    if (!captchaToken || typeof captchaToken !== 'string' || captchaToken.trim() === '') {
      return errorResponse(403, 'CAPTCHA token is required');
    }

    let captchaResult;
    try {
      captchaResult = await verifyCaptcha(captchaToken, clientIp);
    } catch {
      return errorResponse(503, 'CAPTCHA service temporarily unavailable');
    }

    if (!captchaResult.valid) {
      if (captchaResult.error === 'service_unavailable') {
        return errorResponse(503, 'CAPTCHA service temporarily unavailable');
      }
      return errorResponse(403, `CAPTCHA verification failed: ${captchaResult.error ?? 'unknown'}`);
    }

    // Step 5: Validate input fields
    const locale = 'es';
    const fieldErrors: Record<string, string> = {};

    const nameResult = validateClientName(body.clientName as string, locale);
    if (!nameResult.valid) fieldErrors['clientName'] = nameResult.error!;

    const emailResult = validateEmail(body.email as string, locale);
    if (!emailResult.valid) fieldErrors['email'] = emailResult.error!;

    const phoneResult = validatePhone(body.phone as string, locale);
    if (!phoneResult.valid) fieldErrors['phone'] = phoneResult.error!;

    const quantityResult = validateQuantity(body.quantity as number, locale);
    if (!quantityResult.valid) fieldErrors['quantity'] = quantityResult.error!;

    const ageGroupResult = validateAgeGroup(body.ageGroup as string, locale);
    if (!ageGroupResult.valid) fieldErrors['ageGroup'] = ageGroupResult.error!;

    // Validate sizes only if ageGroup is valid
    if (ageGroupResult.valid) {
      const sizesResult = validateSizes(
        body.sizes as string[],
        body.ageGroup as AgeGroup,
        locale,
      );
      if (!sizesResult.valid) fieldErrors['sizes'] = sizesResult.error!;
    }

    const notesResult = validateCustomizationNotes(body.customizationNotes as string | undefined, locale);
    if (!notesResult.valid) fieldErrors['customizationNotes'] = notesResult.error!;

    // Validate productId
    if (!body.productId || typeof body.productId !== 'string' || body.productId.trim().length === 0) {
      fieldErrors['productId'] = 'Este campo es obligatorio';
    }

    if (Object.keys(fieldErrors).length > 0) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: 'Validation failed',
          errors: fieldErrors,
        }),
      };
    }

    // Step 6: Generate IDs and store quote
    const quoteId = randomUUID();
    const trackingNumber = generateTrackingNumber();
    const now = new Date().toISOString();

    const quoteRecord: QuoteRecord = {
      PK: `QUOTE#${quoteId}`,
      SK: 'METADATA',
      GSI1PK: 'QSTATUS#pending',
      GSI1SK: `CREATED#${now}`,
      id: quoteId,
      trackingNumber,
      clientName: body.clientName as string,
      email: body.email as string,
      phone: body.phone as string,
      productId: body.productId as string,
      productName: body.productId as string, // Enriched later by admin
      quantity: body.quantity as number,
      ageGroup: body.ageGroup as AgeGroup,
      sizes: body.sizes as QuoteRecord['sizes'],
      customizationNotes: body.customizationNotes as string | undefined,
      status: 'pending',
      createdAt: now,
    };

    try {
      await createQuote(quoteRecord);
    } catch {
      return errorResponse(503, 'Failed to process quote request. Please try again.');
    }

    // Step 7: Fire emails (non-blocking)
    sendClientConfirmation(body.email as string, body.clientName as string, trackingNumber);
    sendAdminNotification(quoteRecord);

    // Step 8: Return success
    return {
      statusCode: 201,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        message: 'Cotización recibida exitosamente',
        quoteId,
        trackingNumber,
        status: 'pending',
      }),
    };
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        type: 'QUOTE_SUBMIT_UNHANDLED_ERROR',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
    );
    return errorResponse(500, 'Internal server error');
  }
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates a tracking number in CF-XXXXXXXXX format (12 chars total).
 */
function generateTrackingNumber(): string {
  const raw = randomUUID().replace(/-/g, '').substring(0, 9).toUpperCase();
  return `CF-${raw}`;
}

/**
 * Sends a confirmation email to the client (fire-and-forget).
 */
function sendClientConfirmation(email: string, clientName: string, trackingNumber: string): void {
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

  sesClient.send(command).catch((error: unknown) => {
    console.error('Failed to send client confirmation email:', JSON.stringify({
      trackingNumber,
      email,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

/**
 * Sends notification email to admin (fire-and-forget).
 */
function sendAdminNotification(record: QuoteRecord): void {
  const details = [
    'Nueva solicitud de cotización recibida:',
    '',
    `ID: ${record.id}`,
    `Tracking: ${record.trackingNumber}`,
    `Cliente: ${record.clientName}`,
    `Email: ${record.email}`,
    `Teléfono: ${record.phone}`,
    `Producto: ${record.productId}`,
    `Cantidad: ${record.quantity}`,
    `Grupo etario: ${record.ageGroup}`,
    `Tallas: ${record.sizes.join(', ')}`,
  ];

  if (record.customizationNotes) {
    details.push(`Notas: ${record.customizationNotes}`);
  }

  const command = new SendEmailCommand({
    Source: SES_FROM_EMAIL,
    Destination: { ToAddresses: [ADMIN_EMAIL] },
    Message: {
      Subject: { Data: `[CronusFit] Nueva cotización - ${record.trackingNumber}` },
      Body: { Text: { Data: details.join('\n') } },
    },
  });

  sesClient.send(command).catch((error: unknown) => {
    console.error('Failed to send admin notification email:', JSON.stringify({
      trackingNumber: record.trackingNumber,
      quoteId: record.id,
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

/**
 * Build a standardized error response with CORS headers.
 */
function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ message }),
  };
}
