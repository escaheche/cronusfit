/**
 * WhatsApp Webhook Receiver — WAHA → n8n → API Gateway.
 *
 * Processes incoming webhook messages from clients who respond via WhatsApp.
 * Authenticates webhooks with a shared secret token and routes responses
 * to the appropriate handlers (mockup approval/rejection, quote acceptance/rejection).
 *
 * Requirements: 12.4, 12.5, 12.7, 12.8, 12.9
 */

import type { WhatsAppResponseWebhook } from '../../types/whatsapp.js';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Result of processing a webhook. */
export interface WebhookProcessResult {
  success: boolean;
  action?: string;
  entityId?: string;
  error?: string;
}

/** Dependencies injection for testability. */
export interface WebhookReceiverDeps {
  /** The valid shared secret token for authentication. */
  validSecret: string;
  /** Handler for mockup approval. */
  onMockupApprove?: (messageId: string, phone: string) => Promise<void>;
  /** Handler for mockup rejection. */
  onMockupReject?: (messageId: string, phone: string, reason?: string) => Promise<void>;
  /** Handler for quote acceptance. */
  onQuoteAccept?: (messageId: string, phone: string) => Promise<void>;
  /** Handler for quote rejection. */
  onQuoteReject?: (messageId: string, phone: string) => Promise<void>;
}

// ─── Authentication ──────────────────────────────────────────────────────────

/**
 * Authenticates an incoming webhook request using the shared secret token.
 *
 * @param token - The token from the webhook payload
 * @param validSecret - The expected shared secret
 * @returns true if the token matches the valid secret
 */
export function authenticateWebhook(token: string, validSecret: string): boolean {
  if (!token || !validSecret) {
    return false;
  }
  // Constant-time comparison to prevent timing attacks
  if (token.length !== validSecret.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ validSecret.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Webhook Processing ──────────────────────────────────────────────────────

/**
 * Processes an incoming WhatsApp response webhook.
 *
 * Flow:
 * 1. Authenticate with shared secret token
 * 2. Route to appropriate handler based on response type
 * 3. Return result indicating success/failure
 *
 * @param webhook - The incoming webhook payload
 * @param deps - Dependencies for processing
 * @returns WebhookProcessResult indicating outcome
 */
export async function processWebhook(
  webhook: WhatsAppResponseWebhook,
  deps: WebhookReceiverDeps
): Promise<WebhookProcessResult> {
  // 1. Authenticate
  if (!authenticateWebhook(webhook.token, deps.validSecret)) {
    return {
      success: false,
      error: 'Authentication failed: invalid shared secret',
    };
  }

  // 2. Route based on response type
  try {
    switch (webhook.response) {
      case 'approve':
        if (deps.onMockupApprove) {
          await deps.onMockupApprove(webhook.messageId, webhook.phone);
        }
        return {
          success: true,
          action: 'mockup_approved',
          entityId: webhook.messageId,
        };

      case 'reject':
        if (deps.onMockupReject) {
          await deps.onMockupReject(webhook.messageId, webhook.phone, webhook.text);
        }
        return {
          success: true,
          action: 'mockup_rejected',
          entityId: webhook.messageId,
        };

      case 'accept_quote':
        if (deps.onQuoteAccept) {
          await deps.onQuoteAccept(webhook.messageId, webhook.phone);
        }
        return {
          success: true,
          action: 'quote_accepted',
          entityId: webhook.messageId,
        };

      case 'reject_quote':
        if (deps.onQuoteReject) {
          await deps.onQuoteReject(webhook.messageId, webhook.phone);
        }
        return {
          success: true,
          action: 'quote_rejected',
          entityId: webhook.messageId,
        };

      default:
        return {
          success: false,
          error: `Unknown response type: ${webhook.response}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      action: webhook.response,
      error: `Processing failed: ${(error as Error).message}`,
    };
  }
}
