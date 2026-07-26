/**
 * Input sanitization utilities for the Exhibition Website.
 *
 * Strips HTML tags and encodes special characters as HTML entities
 * to prevent XSS attacks on quote form text fields.
 */

import { QuoteSubmitRequest } from '../types/quote.js';

/**
 * Sanitizes a single input string by:
 * 1. Stripping all HTML tags
 * 2. Encoding special characters as HTML entities
 *
 * The encoding order is important: `&` is encoded first to avoid
 * double-encoding of other entity references.
 *
 * @param input - The raw input string to sanitize
 * @returns The sanitized string with no HTML tags and encoded special characters
 */
export function sanitizeInput(input: string): string {
  // Step 1: Strip all HTML tags (including self-closing, comments, etc.)
  const stripped = input.replace(/<[^>]*>/g, '');

  // Step 2: Encode special characters as HTML entities
  // IMPORTANT: Encode & first to avoid double-encoding
  return stripped
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Sanitizes all text fields in a QuoteSubmitRequest.
 *
 * Applies `sanitizeInput` to: clientName, email, phone, productId,
 * customizationNotes (if present), and each entry in sizes array.
 * Non-string fields (quantity, ageGroup, captchaToken) are passed through unchanged.
 *
 * @param request - The raw quote submission request
 * @returns A new request object with all text fields sanitized
 */
export function sanitizeQuoteFields(request: QuoteSubmitRequest): QuoteSubmitRequest {
  return {
    ...request,
    clientName: sanitizeInput(request.clientName),
    email: sanitizeInput(request.email),
    phone: sanitizeInput(request.phone),
    productId: sanitizeInput(request.productId),
    sizes: request.sizes.map((size) => sanitizeInput(size)) as typeof request.sizes,
    customizationNotes: request.customizationNotes
      ? sanitizeInput(request.customizationNotes)
      : undefined,
  };
}
