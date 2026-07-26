/**
 * Quote submission and status type definitions for CronusFit.
 * Used by both the public exhibition website forms and the admin quote management.
 */

import type { AgeGroup, ChildrenSize, AdultSize } from './garment.js';

/** Possible states of a quote throughout its lifecycle. */
export type QuoteStatus = 'pending' | 'quoted' | 'accepted' | 'rejected';

/** Request payload for submitting a quote via the public form (no JWT required). */
export interface QuoteSubmitRequest {
  /** Client's full name (1-100 characters). */
  clientName: string;
  /** Client's email address (valid email format). */
  email: string;
  /** Client's phone number with country code (7-15 digits, WhatsApp-compatible). */
  phone: string;
  /** ID of the product the quote is for. */
  productId: string;
  /** Desired quantity (1-10000 units). */
  quantity: number;
  /** Target age group (children or adult). */
  ageGroup: AgeGroup;
  /** Desired sizes within the selected age group. */
  sizes: ChildrenSize[] | AdultSize[];
  /** Optional customization notes (max 1000 characters). */
  customizationNotes?: string;
  /** hCaptcha verification token. */
  captchaToken: string;
}

/** Response returned after a successful quote submission. */
export interface QuoteSubmitResponse {
  /** Unique quote identifier. */
  quoteId: string;
  /** Tracking number for client-facing status lookups. */
  trackingNumber: string;
  /** Initial status is always 'pending'. */
  status: 'pending';
}

/** Response returned when querying quote status by tracking number. */
export interface QuoteStatusResponse {
  /** The quote's tracking number. */
  trackingNumber: string;
  /** Current status of the quote. */
  status: QuoteStatus;
  /** Name of the product associated with the quote. */
  productName: string;
  /** Timestamp when the quote was submitted (UTC ISO 8601). */
  submittedAt: string;
}
