/**
 * WhatsApp bridge type definitions for CronusFit.
 * Covers Lambda → n8n/WAHA send requests, webhook responses,
 * and delivery log entries.
 */

import type { AgeGroup } from './garment.js';

/** Request payload for sending a WhatsApp message via n8n/WAHA. */
export interface WhatsAppSendRequest {
  /** Type of message being sent. */
  type: 'mockup' | 'quote';
  /** Recipient's phone number in E.164 format. */
  recipientPhone: string;
  /** Message payload (varies by type). */
  payload: MockupSharePayload | QuoteSharePayload;
}

/** Payload for sharing a mockup via WhatsApp. */
export interface MockupSharePayload {
  /** Mockup identifier. */
  mockupId: string;
  /** S3 presigned URL for the front-view image. */
  frontImageUrl: string;
  /** S3 presigned URL for the back-view image. */
  backImageUrl: string;
  /** Product name for display in the message. */
  productName: string;
  /** Whether to include approval buttons (true for approval, false for info-only). */
  includeButtons: boolean;
}

/** Payload for sharing a quote via WhatsApp. */
export interface QuoteSharePayload {
  /** Quote identifier. */
  quoteId: string;
  /** Product name for display in the message. */
  productName: string;
  /** Formatted price string. */
  price: string;
  /** Quoted quantity. */
  quantity: number;
  /** Target age group. */
  ageGroup: AgeGroup;
  /** Size labels from the selected age group. */
  sizes: string[];
}

/**
 * Incoming webhook payload from n8n when a client responds via WhatsApp.
 * Forwarded from WAHA → n8n → API Gateway.
 */
export interface WhatsAppResponseWebhook {
  /** Unique message identifier from WAHA. */
  messageId: string;
  /** Client's phone number. */
  phone: string;
  /** Client's response action. */
  response: 'approve' | 'reject' | 'accept_quote' | 'reject_quote';
  /** Optional text (e.g., rejection reason). */
  text?: string;
  /** Timestamp of the response (UTC ISO 8601). */
  timestamp: string;
  /** Shared secret token for webhook authentication. */
  token: string;
}

/** Entry in the WhatsApp delivery log stored in DynamoDB. */
export interface DeliveryLogEntry {
  /** Unique log entry identifier. */
  logId: string;
  /** Type of message sent. */
  messageType: 'mockup' | 'quote';
  /** Recipient's phone number. */
  recipientPhone: string;
  /** Timestamp when the message was delivered/attempted (UTC ISO 8601). */
  deliveryTimestamp: string;
  /** Current delivery status. */
  status: 'sent' | 'delivered' | 'read' | 'failed';
  /** Client's response text, if applicable. */
  clientResponse?: string;
}
