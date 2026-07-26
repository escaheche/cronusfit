/**
 * WhatsApp Delivery Log — records all WhatsApp message send events.
 *
 * Logs every message sent through the WhatsApp bridge with all required fields:
 * message type, recipient phone, delivery timestamp, delivery status, and client response.
 *
 * Requirements: 12.11
 */

import { put } from '../../db/operations.js';
import type { DeliveryLogEntry } from '../../types/whatsapp.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Input to create a delivery log entry. */
export interface DeliveryLogInput {
  /** Type of message sent. */
  messageType: 'mockup' | 'quote';
  /** Recipient's phone number in E.164 format. */
  recipientPhone: string;
  /** Current delivery status. */
  status: 'sent' | 'delivered' | 'read' | 'failed';
  /** Client's response text, if applicable. */
  clientResponse?: string;
}

/** Dependencies injection for testability. */
export interface DeliveryLogDeps {
  /** Function to generate unique IDs. */
  generateId?: () => string;
  /** Function to get current timestamp. */
  getNow?: () => string;
  /** Function to persist the log entry. */
  persist?: (entry: DeliveryLogRecord) => Promise<void>;
}

/** DynamoDB record for delivery log (PK: WALOG#{phone}, SK: MSG#{timestamp}). */
export interface DeliveryLogRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  logId: string;
  messageType: 'mockup' | 'quote';
  recipientPhone: string;
  deliveryTimestamp: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  clientResponse?: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function defaultGenerateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

function defaultGetNow(): string {
  return new Date().toISOString();
}

async function defaultPersist(entry: DeliveryLogRecord): Promise<void> {
  await put(entry);
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Required fields for a valid delivery log entry. */
const REQUIRED_FIELDS: (keyof DeliveryLogInput)[] = [
  'messageType',
  'recipientPhone',
  'status',
];

const VALID_MESSAGE_TYPES: DeliveryLogInput['messageType'][] = ['mockup', 'quote'];
const VALID_STATUSES: DeliveryLogInput['status'][] = ['sent', 'delivered', 'read', 'failed'];

/**
 * Validates a delivery log input.
 * @returns Array of error messages (empty if valid)
 */
export function validateDeliveryLogInput(input: DeliveryLogInput): string[] {
  const errors: string[] = [];

  if (!input.messageType || !VALID_MESSAGE_TYPES.includes(input.messageType)) {
    errors.push('messageType must be "mockup" or "quote"');
  }

  if (!input.recipientPhone || typeof input.recipientPhone !== 'string' || input.recipientPhone.trim() === '') {
    errors.push('recipientPhone is required');
  }

  if (!input.status || !VALID_STATUSES.includes(input.status)) {
    errors.push('status must be one of: sent, delivered, read, failed');
  }

  return errors;
}

// ─── Core Logic ──────────────────────────────────────────────────────────────

/**
 * Creates a delivery log entry and persists it to DynamoDB.
 *
 * Every WhatsApp message sent through the platform must be logged with:
 * - message type (mockup/quote)
 * - recipient phone number
 * - delivery timestamp (UTC ISO 8601)
 * - delivery status (sent/delivered/read/failed)
 * - client response (if applicable)
 *
 * @param input - The delivery log input data
 * @param deps - Optional dependency overrides for testing
 * @returns The created DeliveryLogEntry or throws on validation failure
 */
export async function logDelivery(
  input: DeliveryLogInput,
  deps: DeliveryLogDeps = {}
): Promise<DeliveryLogEntry> {
  const {
    generateId = defaultGenerateId,
    getNow = defaultGetNow,
    persist = defaultPersist,
  } = deps;

  // Validate input
  const errors = validateDeliveryLogInput(input);
  if (errors.length > 0) {
    throw new Error(`Invalid delivery log input: ${errors.join('; ')}`);
  }

  const logId = generateId();
  const deliveryTimestamp = getNow();

  // Build the DynamoDB record
  const record: DeliveryLogRecord = {
    PK: `WALOG#${input.recipientPhone}`,
    SK: `MSG#${deliveryTimestamp}`,
    GSI1PK: `DELIVERY#${input.status}`,
    GSI1SK: `SENT#${deliveryTimestamp}`,
    logId,
    messageType: input.messageType,
    recipientPhone: input.recipientPhone,
    deliveryTimestamp,
    status: input.status,
    ...(input.clientResponse !== undefined && { clientResponse: input.clientResponse }),
  };

  // Persist to DynamoDB
  await persist(record);

  // Return the public DeliveryLogEntry interface
  return {
    logId,
    messageType: input.messageType,
    recipientPhone: input.recipientPhone,
    deliveryTimestamp,
    status: input.status,
    clientResponse: input.clientResponse,
  };
}
