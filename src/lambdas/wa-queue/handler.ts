/**
 * WhatsApp Queue Lambda Handler
 *
 * Processes queued failed WhatsApp messages for retry delivery.
 *
 * Triggered on a schedule or manually to retry messages that failed initial delivery.
 * Reads from the WAQUEUE DynamoDB partition, attempts to resend via n8n/WAHA,
 * and removes successfully sent messages from the queue.
 *
 * @module lambdas/wa-queue
 * @requirements 12.10, 12.11, 12.12, 13.5
 */

import type { APIGatewayProxyHandler, APIGatewayProxyResult } from 'aws-lambda';
import { queryByPK, remove } from '../../db/operations.js';
import { sendWhatsAppMessage } from '../../modules/whatsapp/send-service.js';
import { logDelivery } from '../../modules/whatsapp/delivery-log.js';
import { recordAuditEntry } from '../../modules/security/audit-log.js';
import type { WAMessageQueueRecord } from '../../db/entities.js';
import type { WhatsAppSendRequest, MockupSharePayload, QuoteSharePayload } from '../../types/whatsapp.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum messages to process per invocation to stay within Lambda timeout. */
const MAX_MESSAGES_PER_INVOCATION = 10;

/** Maximum retry count before permanently failing a message. */
const MAX_TOTAL_RETRIES = 6;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: APIGatewayProxyHandler = async (_event): Promise<APIGatewayProxyResult> => {
  try {
    // Fetch queued messages (oldest first)
    const queueResult = await queryByPK<WAMessageQueueRecord>(
      'WAQUEUE',
      { expression: 'begins_with(SK, :sk)', value: 'MSG#' },
      { limit: MAX_MESSAGES_PER_INVOCATION, scanIndexForward: true }
    );

    const messages = queueResult.items;

    if (messages.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          processed: 0,
          succeeded: 0,
          failed: 0,
          permanentlyFailed: 0,
        }),
      };
    }

    let succeeded = 0;
    let failed = 0;
    let permanentlyFailed = 0;

    for (const message of messages) {
      const result = await processQueuedMessage(message);

      switch (result) {
        case 'success':
          succeeded++;
          break;
        case 'retry_later':
          failed++;
          break;
        case 'permanent_failure':
          permanentlyFailed++;
          break;
      }
    }

    // Record audit entry for queue processing batch
    await recordAuditEntry({
      adminId: 'system',
      adminEmail: 'system@cronusfit.com',
      actionType: 'whatsapp_queue_process',
      resourceId: 'batch',
      resourceType: 'wa_queue',
      metadata: {
        processed: messages.length,
        succeeded,
        failed,
        permanentlyFailed,
      },
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        processed: messages.length,
        succeeded,
        failed,
        permanentlyFailed,
      }),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(
      JSON.stringify({
        type: 'WA_QUEUE_UNHANDLED_ERROR',
        error: message,
        timestamp: new Date().toISOString(),
      })
    );
    return errorResponse(500, message);
  }
};

// ---------------------------------------------------------------------------
// Queue Processing
// ---------------------------------------------------------------------------

type ProcessResult = 'success' | 'retry_later' | 'permanent_failure';

/**
 * Processes a single queued message.
 *
 * - If retryCount >= MAX_TOTAL_RETRIES, permanently fails (removes from queue)
 * - Otherwise, attempts to resend and removes from queue on success
 */
async function processQueuedMessage(record: WAMessageQueueRecord): Promise<ProcessResult> {
  // Check if message has exceeded maximum retries
  if (record.retryCount >= MAX_TOTAL_RETRIES) {
    // Permanently fail — remove from queue and log
    await removeFromQueue(record);
    await logPermanentFailure(record);
    return 'permanent_failure';
  }

  // Reconstruct the WhatsApp send request from the queued payload
  const sendRequest: WhatsAppSendRequest = {
    type: record.messageType,
    recipientPhone: record.recipientPhone,
    payload: record.payload as unknown as MockupSharePayload | QuoteSharePayload,
  };

  // Attempt to resend (with its own retry logic — zero retries for queue processing)
  const sendResult = await sendWhatsAppMessage(sendRequest, {
    // Override delay to use short delays for queue processing (not full 30s/60s/120s)
    delay: async (_ms: number) => { /* no delay for queue retries — they've already waited */ },
  });

  if (sendResult.success) {
    // Remove from queue on success
    await removeFromQueue(record);

    // Log successful delivery
    try {
      await logDelivery({
        messageType: record.messageType,
        recipientPhone: record.recipientPhone,
        status: 'sent',
      });
    } catch (logError) {
      console.error(
        JSON.stringify({
          type: 'DELIVERY_LOG_WRITE_FAILURE',
          error: (logError as Error).message,
          timestamp: new Date().toISOString(),
        })
      );
    }

    return 'success';
  }

  // Still failing — leave in queue for next invocation (retryCount already incremented by send-service)
  console.warn(
    JSON.stringify({
      type: 'WA_QUEUE_RETRY_FAILED',
      messageId: record.messageId,
      recipientPhone: record.recipientPhone,
      retryCount: record.retryCount,
      error: sendResult.error,
      timestamp: new Date().toISOString(),
    })
  );

  return 'retry_later';
}

/**
 * Removes a message from the DynamoDB queue.
 */
async function removeFromQueue(record: WAMessageQueueRecord): Promise<void> {
  try {
    await remove(record.PK, record.SK);
  } catch (error) {
    console.error(
      JSON.stringify({
        type: 'WA_QUEUE_REMOVE_FAILED',
        messageId: record.messageId,
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      })
    );
  }
}

/**
 * Logs a permanent delivery failure for a message that has exhausted all retries.
 */
async function logPermanentFailure(record: WAMessageQueueRecord): Promise<void> {
  const entityId = getEntityIdFromPayload(record);

  try {
    await logDelivery({
      messageType: record.messageType,
      recipientPhone: record.recipientPhone,
      status: 'failed',
    });
  } catch (logError) {
    console.error(
      JSON.stringify({
        type: 'DELIVERY_LOG_WRITE_FAILURE',
        error: (logError as Error).message,
        timestamp: new Date().toISOString(),
      })
    );
  }

  // Audit the permanent failure
  await recordAuditEntry({
    adminId: 'system',
    adminEmail: 'system@cronusfit.com',
    actionType: 'whatsapp_permanent_failure',
    resourceId: entityId,
    resourceType: record.messageType,
    metadata: {
      messageId: record.messageId,
      recipientPhone: record.recipientPhone,
      totalRetries: record.retryCount,
    },
  });

  console.error(
    JSON.stringify({
      type: 'WA_MESSAGE_PERMANENT_FAILURE',
      messageId: record.messageId,
      recipientPhone: record.recipientPhone,
      messageType: record.messageType,
      retryCount: record.retryCount,
      timestamp: new Date().toISOString(),
    })
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the entity ID (mockup ID or quote ID) from the queued payload.
 */
function getEntityIdFromPayload(record: WAMessageQueueRecord): string {
  const payload = record.payload as Record<string, unknown>;
  if (record.messageType === 'mockup') {
    return (payload.mockupId as string) ?? record.messageId;
  }
  return (payload.quoteId as string) ?? record.messageId;
}

/**
 * Build a standardized error response.
 */
function errorResponse(statusCode: number, error: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error }),
  };
}
