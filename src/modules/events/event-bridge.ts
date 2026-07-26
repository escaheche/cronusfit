/**
 * Event Bridge Module — Cross-module event-driven triggers.
 *
 * Defines the wiring logic for event-driven communication between modules:
 *
 * 1. Product publish → social content generation Lambda (async invoke)
 * 2. Product publish/unpublish → site rebuild pipeline (verified in rebuild.ts)
 * 3. EventBridge schedule (every 6h) → monitoring Lambda (template.yaml)
 * 4. WhatsApp webhook → approval/quote status updates
 * 5. Cross-module SES notifications (via notifications.ts)
 *
 * @module modules/events/event-bridge
 * @requirements 6.2, 6.3, 10.4, 11.8, 12.4, 12.12
 */

import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE_NAME } from '../../db/client.js';

// ---------------------------------------------------------------------------
// Clients (reused across warm starts)
// ---------------------------------------------------------------------------

const lambdaClient = new LambdaClient({});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SOCIAL_GENERATE_FUNCTION_NAME =
  process.env.SOCIAL_GENERATE_FUNCTION_NAME ?? 'cronusfit-social-generate-prod';

// ---------------------------------------------------------------------------
// 1. Product Publish → Social Content Generation (Req 10.4)
// ---------------------------------------------------------------------------

/**
 * Payload sent to the social-generate Lambda when a product is published.
 */
export interface SocialGenerateTriggerPayload {
  productId: string;
  mockupId: string;
  frontImageS3Key: string;
  backImageS3Key: string;
  productName: string;
}

/**
 * Triggers the social content generation Lambda asynchronously after a
 * product is successfully published.
 *
 * This function is called by the site-publish handler after a successful
 * publish action. It invokes the social-generate Lambda with `InvocationType: 'Event'`
 * (fire-and-forget) so it does not block the publish response.
 *
 * If invocation fails, the error is logged but does NOT fail the publish flow.
 * Social content generation can be retried independently.
 *
 * @param payload - Product and mockup details needed for social content generation
 * @returns Whether the invocation was dispatched successfully
 *
 * Validates: Requirement 10.4 (auto-generate on publish)
 */
export async function triggerSocialContentGeneration(
  payload: SocialGenerateTriggerPayload
): Promise<boolean> {
  try {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: SOCIAL_GENERATE_FUNCTION_NAME,
        InvocationType: 'Event', // Async — fire-and-forget
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );

    console.info(
      JSON.stringify({
        type: 'SOCIAL_GENERATE_TRIGGERED',
        productId: payload.productId,
        timestamp: new Date().toISOString(),
      })
    );

    return true;
  } catch (error) {
    // Non-fatal: log error but don't fail the publish flow
    console.error(
      JSON.stringify({
        type: 'SOCIAL_GENERATE_TRIGGER_FAILED',
        productId: payload.productId,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      })
    );

    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. WhatsApp Webhook → Approval/Quote Status Updates (Req 12.4, 12.12)
// ---------------------------------------------------------------------------

/** Valid mockup approval responses from WhatsApp. */
export type MockupApprovalResponse = 'approve' | 'reject';

/** Valid quote responses from WhatsApp. */
export type QuoteResponse = 'accept_quote' | 'reject_quote';

/**
 * Result of processing a WhatsApp webhook event that updates entity status.
 */
export interface WebhookStatusUpdateResult {
  success: boolean;
  entityType: 'mockup' | 'quote';
  entityId: string;
  newStatus: string;
  error?: string;
}

/**
 * Updates mockup approval status based on a WhatsApp webhook response.
 *
 * Called by the wa-receive handler when a client responds to a mockup
 * approval request via WhatsApp (approve/reject).
 *
 * Updates the mockup record in DynamoDB:
 * - approve → status: 'approved', approvedAt timestamp
 * - reject → status: 'rejected', rejectedAt timestamp, rejectionReason
 *
 * @param mockupId - The mockup ID associated with the WhatsApp message
 * @param response - The client's approval response
 * @param rejectionReason - Optional reason if rejecting
 * @returns Result of the status update
 *
 * Validates: Requirement 12.4 (WhatsApp approval responses)
 */
export async function updateMockupApprovalFromWebhook(
  mockupId: string,
  response: MockupApprovalResponse,
  rejectionReason?: string
): Promise<WebhookStatusUpdateResult> {
  const now = new Date().toISOString();

  try {
    if (response === 'approve') {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `MOCKUP#${mockupId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #status = :status, approvedAt = :ts',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'approved',
            ':ts': now,
          },
          ConditionExpression: 'attribute_exists(PK)',
        })
      );

      return {
        success: true,
        entityType: 'mockup',
        entityId: mockupId,
        newStatus: 'approved',
      };
    } else {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `MOCKUP#${mockupId}`, SK: 'METADATA' },
          UpdateExpression:
            'SET #status = :status, rejectedAt = :ts, rejectionReason = :reason',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'rejected',
            ':ts': now,
            ':reason': rejectionReason ?? 'Rechazado vía WhatsApp',
          },
          ConditionExpression: 'attribute_exists(PK)',
        })
      );

      return {
        success: true,
        entityType: 'mockup',
        entityId: mockupId,
        newStatus: 'rejected',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        type: 'MOCKUP_STATUS_UPDATE_FAILED',
        mockupId,
        response,
        error: errorMessage,
        timestamp: now,
      })
    );

    return {
      success: false,
      entityType: 'mockup',
      entityId: mockupId,
      newStatus: response === 'approve' ? 'approved' : 'rejected',
      error: errorMessage,
    };
  }
}

/**
 * Updates quote status based on a WhatsApp webhook response.
 *
 * Called by the wa-receive handler when a client responds to a quote
 * via WhatsApp (accept/reject).
 *
 * Updates the quote record in DynamoDB:
 * - accept_quote → status: 'accepted', acceptedAt timestamp
 * - reject_quote → status: 'rejected', rejectedAt timestamp
 *
 * @param quoteId - The quote ID associated with the WhatsApp message
 * @param response - The client's quote response
 * @returns Result of the status update
 *
 * Validates: Requirement 12.12 (WhatsApp quote responses)
 */
export async function updateQuoteStatusFromWebhook(
  quoteId: string,
  response: QuoteResponse
): Promise<WebhookStatusUpdateResult> {
  const now = new Date().toISOString();

  try {
    if (response === 'accept_quote') {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `QUOTE#${quoteId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #status = :status, acceptedAt = :ts',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'accepted',
            ':ts': now,
          },
          ConditionExpression: 'attribute_exists(PK)',
        })
      );

      return {
        success: true,
        entityType: 'quote',
        entityId: quoteId,
        newStatus: 'accepted',
      };
    } else {
      await docClient.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { PK: `QUOTE#${quoteId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #status = :status, rejectedAt = :ts',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':status': 'rejected',
            ':ts': now,
          },
          ConditionExpression: 'attribute_exists(PK)',
        })
      );

      return {
        success: true,
        entityType: 'quote',
        entityId: quoteId,
        newStatus: 'rejected',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        type: 'QUOTE_STATUS_UPDATE_FAILED',
        quoteId,
        response,
        error: errorMessage,
        timestamp: now,
      })
    );

    return {
      success: false,
      entityType: 'quote',
      entityId: quoteId,
      newStatus: response === 'accept_quote' ? 'accepted' : 'rejected',
      error: errorMessage,
    };
  }
}
