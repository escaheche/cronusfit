/**
 * WhatsApp Send Service — Lambda → n8n → WAHA pipeline.
 *
 * Handles sending mockup images and quote details to clients via WhatsApp.
 * Communication flow: Lambda → n8n (POST webhook) → WAHA → WhatsApp.
 *
 * Features:
 * - Load WAHA credentials from Secrets Manager (cached for warm invocations)
 * - Build appropriate message payload based on type (mockup or quote)
 * - Mockup messages with includeButtons=true include "Aprobar ✓" / "Rechazar ✗" buttons
 * - Quote messages always include "Aceptar Cotización" / "Rechazar Cotización" buttons
 * - Retry logic: 3 attempts with exponential backoff (30s, 60s, 120s)
 * - On all retries failed: queue message in DynamoDB, notify Admin, fall back to email-only
 *
 * Requirements: 12.1, 12.2, 12.3, 12.6, 12.10
 */

import { getCredentials, type PlatformCredentials } from '../security/secrets.js';
import { put } from '../../db/operations.js';
import type {
  WhatsAppSendRequest,
  MockupSharePayload,
  QuoteSharePayload,
} from '../../types/whatsapp.js';
import type { WAMessageQueueRecord } from '../../db/entities.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Retry intervals in milliseconds: 30s, 60s, 120s */
export const RETRY_INTERVALS_MS = [30_000, 60_000, 120_000] as const;

/** Maximum number of retry attempts */
export const MAX_RETRIES = 3;

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Result of a WhatsApp send operation. */
export interface SendResult {
  success: boolean;
  messageId?: string;
  status: 'sent' | 'queued' | 'failed';
  retriesAttempted: number;
  fallbackEmail: boolean;
  error?: string;
}

/** Button definition for interactive WhatsApp messages. */
export interface MessageButton {
  id: string;
  title: string;
}

/** Formatted payload sent to the n8n webhook. */
export interface N8nWebhookPayload {
  type: 'mockup' | 'quote';
  recipientPhone: string;
  images?: { frontUrl: string; backUrl: string };
  text: string;
  buttons?: MessageButton[];
  metadata: {
    entityId: string;
    productName: string;
  };
}

/** Dependencies injection for testability. */
export interface SendServiceDeps {
  /** Function to POST to n8n webhook. Defaults to internal fetch-based implementation. */
  postToWebhook?: (url: string, payload: N8nWebhookPayload, apiKey: string) => Promise<WebhookResponse>;
  /** Function to send fallback email. */
  sendFallbackEmail?: (recipientPhone: string, type: 'mockup' | 'quote', entityId: string) => Promise<void>;
  /** Function to notify Admin of delivery failure. */
  notifyAdmin?: (recipientPhone: string, type: 'mockup' | 'quote', entityId: string, error: string) => Promise<void>;
  /** Function to delay execution (for retry backoff). Defaults to setTimeout-based. */
  delay?: (ms: number) => Promise<void>;
  /** Function to get credentials. Defaults to Secrets Manager loader. */
  getCredentials?: () => Promise<PlatformCredentials>;
  /** Function to generate unique IDs. */
  generateId?: () => string;
}

/** Response from the n8n webhook endpoint. */
export interface WebhookResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Default delay function using setTimeout. */
function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Default unique ID generator. */
function defaultGenerateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
}

/** Default HTTP POST to n8n webhook using Node.js fetch. */
async function defaultPostToWebhook(
  url: string,
  payload: N8nWebhookPayload,
  apiKey: string
): Promise<WebhookResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`n8n webhook returned ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { messageId?: string };
  return {
    success: true,
    messageId: data.messageId,
  };
}

/** Default fallback email sender (placeholder — wired to SES in Lambda handler). */
async function defaultSendFallbackEmail(
  _recipientPhone: string,
  _type: 'mockup' | 'quote',
  _entityId: string
): Promise<void> {
  console.warn(
    JSON.stringify({
      level: 'WARN',
      message: 'Fallback email sending not configured — override via deps',
      timestamp: new Date().toISOString(),
    })
  );
}

/** Default admin notification (placeholder — wired to SES in Lambda handler). */
async function defaultNotifyAdmin(
  recipientPhone: string,
  type: 'mockup' | 'quote',
  entityId: string,
  error: string
): Promise<void> {
  console.error(
    JSON.stringify({
      level: 'ERROR',
      message: 'WhatsApp delivery failed — Admin notification',
      recipientPhone,
      type,
      entityId,
      error,
      timestamp: new Date().toISOString(),
    })
  );
}

// ─── Message Building ────────────────────────────────────────────────────────

/**
 * Builds the n8n webhook payload for a mockup share message.
 */
export function buildMockupPayload(payload: MockupSharePayload): N8nWebhookPayload {
  const text = `🎨 *Mockup: ${payload.productName}*\n\nAquí tienes las vistas frontal y trasera del diseño.`;

  const buttons: MessageButton[] | undefined = payload.includeButtons
    ? [
        { id: 'approve_mockup', title: 'Aprobar ✓' },
        { id: 'reject_mockup', title: 'Rechazar ✗' },
      ]
    : undefined;

  return {
    type: 'mockup',
    recipientPhone: '', // Set by caller
    images: {
      frontUrl: payload.frontImageUrl,
      backUrl: payload.backImageUrl,
    },
    text,
    buttons,
    metadata: {
      entityId: payload.mockupId,
      productName: payload.productName,
    },
  };
}

/**
 * Builds the n8n webhook payload for a quote share message.
 */
export function buildQuotePayload(payload: QuoteSharePayload): N8nWebhookPayload {
  const ageGroupLabel = payload.ageGroup === 'children' ? 'Niños' : 'Adultos';
  const sizesLabel = payload.sizes.join(', ');

  const text = [
    `📋 *Cotización: ${payload.productName}*`,
    '',
    `💰 Precio: ${payload.price}`,
    `📦 Cantidad: ${payload.quantity}`,
    `👤 Grupo: ${ageGroupLabel}`,
    `📏 Tallas: ${sizesLabel}`,
    '',
    'Por favor selecciona una opción:',
  ].join('\n');

  const buttons: MessageButton[] = [
    { id: 'accept_quote', title: 'Aceptar Cotización' },
    { id: 'reject_quote', title: 'Rechazar Cotización' },
  ];

  return {
    type: 'quote',
    recipientPhone: '', // Set by caller
    text,
    buttons,
    metadata: {
      entityId: payload.quoteId,
      productName: payload.productName,
    },
  };
}

// ─── Queue Failed Message ────────────────────────────────────────────────────

/**
 * Stores a failed message in the DynamoDB queue for later retry.
 * PK: WAQUEUE, SK: MSG#{timestamp}#{id}
 */
export async function queueFailedMessage(
  request: WhatsAppSendRequest,
  messageId: string
): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 86400; // 24 hours TTL

  const record: WAMessageQueueRecord = {
    PK: 'WAQUEUE',
    SK: `MSG#${now}#${messageId}`,
    messageId,
    messageType: request.type,
    recipientPhone: request.recipientPhone,
    payload: request.payload as unknown as Record<string, unknown>,
    retryCount: MAX_RETRIES,
    createdAt: now,
    ttl,
  };

  await put(record);
}

// ─── Core Send Logic ─────────────────────────────────────────────────────────

/**
 * Sends a WhatsApp message through the n8n → WAHA pipeline.
 *
 * Flow:
 * 1. Load WAHA credentials from Secrets Manager (cached)
 * 2. Build message payload based on type
 * 3. POST to n8n webhook
 * 4. On failure: retry with exponential backoff (30s, 60s, 120s)
 * 5. After 3 failed retries: queue message, notify Admin, fall back to email
 *
 * @param request - The WhatsApp send request (mockup or quote)
 * @param deps - Optional dependency overrides for testing
 * @returns SendResult indicating delivery status
 */
export async function sendWhatsAppMessage(
  request: WhatsAppSendRequest,
  deps: SendServiceDeps = {}
): Promise<SendResult> {
  const {
    postToWebhook = defaultPostToWebhook,
    sendFallbackEmail = defaultSendFallbackEmail,
    notifyAdmin = defaultNotifyAdmin,
    delay = defaultDelay,
    getCredentials: loadCreds = getCredentials,
    generateId = defaultGenerateId,
  } = deps;

  // 1. Load credentials
  let credentials: PlatformCredentials;
  try {
    credentials = await loadCreds();
  } catch (error) {
    const errMsg = `Failed to load credentials: ${(error as Error).message}`;
    return {
      success: false,
      status: 'failed',
      retriesAttempted: 0,
      fallbackEmail: false,
      error: errMsg,
    };
  }

  // 2. Build payload based on message type
  let webhookPayload: N8nWebhookPayload;
  if (request.type === 'mockup') {
    webhookPayload = buildMockupPayload(request.payload as MockupSharePayload);
  } else {
    webhookPayload = buildQuotePayload(request.payload as QuoteSharePayload);
  }
  webhookPayload.recipientPhone = request.recipientPhone;

  // 3. Attempt delivery with retry logic
  let lastError: string | undefined;
  let retriesAttempted = 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await postToWebhook(
        credentials.n8nWebhookUrl,
        webhookPayload,
        credentials.wahaApiKey
      );

      return {
        success: true,
        messageId: response.messageId,
        status: 'sent',
        retriesAttempted: attempt,
        fallbackEmail: false,
      };
    } catch (error) {
      lastError = (error as Error).message;
      retriesAttempted = attempt + 1;

      // Log retry attempt
      console.warn(
        JSON.stringify({
          level: 'WARN',
          message: `WhatsApp send attempt ${attempt + 1} failed`,
          recipientPhone: request.recipientPhone,
          type: request.type,
          error: lastError,
          nextRetryMs: attempt < MAX_RETRIES ? RETRY_INTERVALS_MS[attempt] : null,
          timestamp: new Date().toISOString(),
        })
      );

      // Wait before next retry (except after the last attempt)
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_INTERVALS_MS[attempt]);
      }
    }
  }

  // 4. All retries exhausted — queue, notify, and fall back to email
  const entityId =
    request.type === 'mockup'
      ? (request.payload as MockupSharePayload).mockupId
      : (request.payload as QuoteSharePayload).quoteId;

  const messageId = generateId();

  // Queue the message for later retry
  try {
    await queueFailedMessage(request, messageId);
  } catch (queueError) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Failed to queue WhatsApp message',
        error: (queueError as Error).message,
        timestamp: new Date().toISOString(),
      })
    );
  }

  // Notify Admin of delivery failure
  try {
    await notifyAdmin(
      request.recipientPhone,
      request.type,
      entityId,
      lastError ?? 'Unknown error'
    );
  } catch (notifyError) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Failed to notify Admin of WhatsApp delivery failure',
        error: (notifyError as Error).message,
        timestamp: new Date().toISOString(),
      })
    );
  }

  // Fall back to email-only delivery
  let fallbackEmail = false;
  try {
    await sendFallbackEmail(request.recipientPhone, request.type, entityId);
    fallbackEmail = true;
  } catch (emailError) {
    console.error(
      JSON.stringify({
        level: 'ERROR',
        message: 'Fallback email also failed',
        error: (emailError as Error).message,
        timestamp: new Date().toISOString(),
      })
    );
  }

  return {
    success: false,
    messageId,
    status: 'queued',
    retriesAttempted,
    fallbackEmail,
    error: lastError,
  };
}
