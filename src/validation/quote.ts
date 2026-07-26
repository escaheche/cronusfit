/**
 * Quote form and tracking number validation functions.
 *
 * All validators return a ValidationResult with localized error messages
 * based on the provided locale (es/en).
 */

import type { AgeGroup } from '../types/garment.js';
import type { Locale, ValidationResult } from './common.js';
import { valid, invalid } from './common.js';

/** Valid sizes for children age group (2T–16). */
const CHILDREN_SIZES: ReadonlySet<string> = new Set([
  '2T', '4T', '6', '8', '10', '12', '14', '16',
]);

/** Valid sizes for adult age group (XS–6XL). */
const ADULT_SIZES: ReadonlySet<string> = new Set([
  'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL',
]);

/**
 * RFC 5322 simplified email regex.
 * Covers the vast majority of valid email addresses in practice.
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/**
 * E.164 phone number regex.
 * Starts with +, followed by 7 to 15 digits.
 */
const PHONE_REGEX = /^\+\d{7,15}$/;

/**
 * Tracking number regex.
 * Alphanumeric, 1-36 characters.
 */
const TRACKING_REGEX = /^[a-zA-Z0-9]{1,36}$/;

/**
 * Validate client name (required, 1-100 characters).
 */
export function validateClientName(
  name: string | undefined | null,
  locale: Locale,
): ValidationResult {
  if (name === undefined || name === null || name.trim().length === 0) {
    return invalid('quote.error.required', locale);
  }
  if (name.length > 100) {
    return invalid('quote.error.name_too_long', locale);
  }
  return valid();
}

/**
 * Validate email address (required, RFC 5322 format).
 */
export function validateEmail(
  email: string | undefined | null,
  locale: Locale,
): ValidationResult {
  if (email === undefined || email === null || email.trim().length === 0) {
    return invalid('quote.error.required', locale);
  }
  if (!EMAIL_REGEX.test(email)) {
    return invalid('quote.error.email_invalid', locale);
  }
  return valid();
}

/**
 * Validate phone number (required, E.164 format: + followed by 7-15 digits).
 */
export function validatePhone(
  phone: string | undefined | null,
  locale: Locale,
): ValidationResult {
  if (phone === undefined || phone === null || phone.trim().length === 0) {
    return invalid('quote.error.required', locale);
  }
  if (!PHONE_REGEX.test(phone)) {
    return invalid('quote.error.phone_invalid', locale);
  }
  return valid();
}

/**
 * Validate quantity (required, integer between 1 and 10000).
 */
export function validateQuantity(
  quantity: number | undefined | null,
  locale: Locale,
): ValidationResult {
  if (quantity === undefined || quantity === null) {
    return invalid('quote.error.required', locale);
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    return invalid('quote.error.quantity_invalid', locale);
  }
  return valid();
}

/**
 * Validate age group (required, must be 'children' or 'adult').
 */
export function validateAgeGroup(
  ageGroup: string | undefined | null,
  locale: Locale,
): ValidationResult {
  if (ageGroup === undefined || ageGroup === null || ageGroup.trim().length === 0) {
    return invalid('quote.error.required', locale);
  }
  if (ageGroup !== 'children' && ageGroup !== 'adult') {
    return invalid('quote.error.age_group_invalid', locale);
  }
  return valid();
}

/**
 * Validate sizes array (required, non-empty, all sizes must be valid for the age group).
 */
export function validateSizes(
  sizes: string[] | undefined | null,
  ageGroup: AgeGroup,
  locale: Locale,
): ValidationResult {
  if (sizes === undefined || sizes === null || sizes.length === 0) {
    return invalid('quote.error.sizes_invalid', locale);
  }

  const validSizes = ageGroup === 'children' ? CHILDREN_SIZES : ADULT_SIZES;
  const allValid = sizes.every((size) => validSizes.has(size));

  if (!allValid) {
    return invalid('quote.error.sizes_invalid', locale);
  }
  return valid();
}

/**
 * Validate customization notes (optional, max 1000 characters).
 */
export function validateCustomizationNotes(
  notes: string | undefined | null,
  locale: Locale,
): ValidationResult {
  if (notes === undefined || notes === null || notes.length === 0) {
    return valid();
  }
  if (notes.length > 1000) {
    return invalid('quote.error.notes_too_long', locale);
  }
  return valid();
}

/**
 * Validate tracking number (alphanumeric, 1-36 chars, reject empty/whitespace-only).
 */
export function validateTrackingNumber(
  trackingNumber: string | undefined | null,
  locale: Locale,
): ValidationResult {
  if (
    trackingNumber === undefined ||
    trackingNumber === null ||
    trackingNumber.trim().length === 0
  ) {
    return invalid('quote.error.required', locale);
  }
  if (!TRACKING_REGEX.test(trackingNumber)) {
    return invalid('quote.error.tracking_invalid', locale);
  }
  return valid();
}
