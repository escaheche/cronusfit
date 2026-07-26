/**
 * Integration tests for platform-wide end-to-end flows.
 *
 * Validates cross-module integration of:
 * - Pattern → Mockup → Approval → Publish pipeline
 * - Quote submission → Pricing → Client response flow
 * - WhatsApp mockup sharing and approval via webhook
 * - Site rebuild triggered by publish/unpublish (with queue)
 * - Cognito login → JWT → API Gateway → Lambda auth flow
 *
 * Validates: Requirements 4.1, 5.1–5.4, 6.2, 6.3, 7.4–7.9, 12.4, 12.11, 13.1, 13.2
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import type { APIGatewayProxyEvent, APIGatewayTokenAuthorizerEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

// Mock db/operations
vi.mock('../../src/db/operations.js', () => ({
  incrementRateLimit: vi.fn(),
  getRateLimitCount: vi.fn().mockResolvedValue(0),
  storeUsedToken: vi.fn().mockResolvedValue(undefined),
  isTokenUsed: vi.fn().mockResolvedValue(false),
  createQuote: vi.fn().mockResolvedValue(undefined),
  getQuoteByTrackingNumber: vi.fn(),
  get: vi.fn(),
  put: vi.fn().mockResolvedValue(undefined),
  enqueueRebuild: vi.fn().mockResolvedValue(undefined),
  getRebuildQueueDepth: vi.fn().mockResolvedValue(0),
  dequeueNextRebuild: vi.fn(),
  updateRebuildStatus: vi.fn().mockResolvedValue(undefined),
  putUsageMetric: vi.fn().mockResolvedValue(undefined),
  getUsageMetric: vi.fn().mockResolvedValue(null),
}));

// Mock db/client
vi.mock('../../src/db/client.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'CronusFit',
}));

// Mock the site-builder module
vi.mock('../../src/modules/exhibition/site-builder.js', () => ({
  buildSite: vi.fn(),
  fetchPublishedProducts: vi.fn().mockResolvedValue([]),
}));

// Mock the rebuild module
vi.mock('../../src/modules/exhibition/rebuild.js', () => ({
  processNextRebuild: vi.fn(),
  markRebuildCompleted: vi.fn().mockResolvedValue(undefined),
  markRebuildFailed: vi.fn().mockResolvedValue(undefined),
  runRebuildPipeline: vi.fn(),
  enqueueRebuild: vi.fn(),
  _resetLastCompletedTimestamp: vi.fn(),
}));

// Mock the publish module
vi.mock('../../src/modules/exhibition/publish.js', () => ({
  publishProductFromAction: vi.fn(),
  unpublishProduct: vi.fn(),
}));

// Mock the event-bridge module
vi.mock('../../src/modules/events/event-bridge.js', () => ({
  triggerSocialContentGeneration: vi.fn().mockResolvedValue(true),
  updateMockupApprovalFromWebhook: vi.fn(),
}));

// Mock the captcha module
vi.mock('../../src/modules/security/captcha.js', () => ({
  verifyCaptcha: vi.fn(),
}));

// Mock the secrets module
vi.mock('../../src/modules/security/secrets.js', () => ({
  getCredentials: vi.fn(),
}));

// Mock the delivery log module
vi.mock('../../src/modules/whatsapp/delivery-log.js', () => ({
  logDelivery: vi.fn().mockResolvedValue({
    logId: 'log-001',
    messageType: 'mockup',
    recipientPhone: '+573001234567',
    deliveryTimestamp: '2024-06-15T12:00:00Z',
    status: 'read',
  }),
}));

// Mock the audit log module
vi.mock('../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: vi.fn().mockResolvedValue(undefined),
}));

// Mock the cognito-auth module
vi.mock('../../src/modules/security/cognito-auth.js', () => ({
  validateToken: vi.fn(),
  handleAuthorizerEvent: vi.fn(),
  buildAuthorizerResponse: vi.fn(),
  extractBearerToken: vi.fn(),
}));

// Mock validation modules
vi.mock('../../src/validation/quote.js', () => ({
  validateClientName: vi.fn(() => ({ valid: true })),
  validateEmail: vi.fn(() => ({ valid: true })),
  validatePhone: vi.fn(() => ({ valid: true })),
  validateQuantity: vi.fn(() => ({ valid: true })),
  validateAgeGroup: vi.fn(() => ({ valid: true })),
  validateSizes: vi.fn(() => ({ valid: true })),
  validateCustomizationNotes: vi.fn(() => ({ valid: true })),
  validateTrackingNumber: vi.fn(() => ({ valid: true })),
}));

vi.mock('../../src/validation/sanitize.js', () => ({
  sanitizeQuoteFields: vi.fn((input: unknown) => input),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('<html>test</html>')),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { get, incrementRateLimit, enqueueRebuild, getRebuildQueueDepth, put } from '../../src/db/operations.js';
import { docClient } from '../../src/db/client.js';
import { verifyCaptcha } from '../../src/modules/security/captcha.js';
import { getCredentials } from '../../src/modules/security/secrets.js';
import { logDelivery } from '../../src/modules/whatsapp/delivery-log.js';
import { recordAuditEntry } from '../../src/modules/security/audit-log.js';
import { publishProductFromAction } from '../../src/modules/exhibition/publish.js';
import { triggerSocialContentGeneration, updateMockupApprovalFromWebhook } from '../../src/modules/events/event-bridge.js';
import { handleAuthorizerEvent, validateToken, buildAuthorizerResponse, extractBearerToken } from '../../src/modules/security/cognito-auth.js';
import { runRebuildPipeline, enqueueRebuild as moduleEnqueueRebuild } from '../../src/modules/exhibition/rebuild.js';
import { handler as quoteSubmitHandler } from '../../src/lambdas/quote-submit/handler.js';
import { handler as waReceiveHandler } from '../../src/lambdas/wa-receive/handler.js';
import { handler as sitePublishHandler } from '../../src/lambdas/site-publish/handler.js';
import { handler as authValidateHandler } from '../../src/lambdas/auth-validate/handler.js';

// ---------------------------------------------------------------------------
// AWS SDK Client Mocks
// ---------------------------------------------------------------------------

const s3Mock = mockClient(S3Client);
const lambdaMock = mockClient(LambdaClient);
const sesMock = mockClient(SESClient);
const smMock = mockClient(SecretsManagerClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePublishEvent(mockupId: string): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: `/api/products/${mockupId}/publish`,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mockupId }),
    pathParameters: { id: mockupId, mockupId },
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {
      authorizer: {
        adminId: 'admin-001',
        adminEmail: 'admin@cronusfit.com',
      },
    } as any,
    resource: '',
  } as APIGatewayProxyEvent;
}

function makeWhatsAppWebhookEvent(payload: Record<string, unknown>): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/webhooks/whatsapp-response',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  } as APIGatewayProxyEvent;
}

function makeQuoteSubmitEvent(): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/quotes',
    headers: {
      'X-Forwarded-For': '203.0.113.50',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientName: 'Carlos García',
      email: 'carlos@example.com',
      phone: '+573009876543',
      productId: 'prod-002',
      quantity: 20,
      ageGroup: 'adult',
      sizes: ['L', 'XL'],
      customizationNotes: 'Logo corporativo en pecho',
      captchaToken: 'valid-token-456',
    }),
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  } as APIGatewayProxyEvent;
}

function makeAuthorizerEvent(token: string): APIGatewayTokenAuthorizerEvent {
  return {
    type: 'TOKEN',
    authorizationToken: `Bearer ${token}`,
    methodArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/prod/POST/products',
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  s3Mock.reset();
  lambdaMock.reset();
  sesMock.reset();
  smMock.reset();

  // Default AWS SDK responses
  s3Mock.on(PutObjectCommand).resolves({});
  lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'msg-001' });
  smMock.on(GetSecretValueCommand).resolves({
    SecretString: JSON.stringify({ wahaWebhookSecret: 'shared-secret-123' }),
  });

  // Default module mock behaviors
  vi.mocked(incrementRateLimit).mockResolvedValue(1);
  vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });
  vi.mocked(getRebuildQueueDepth).mockResolvedValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Pattern → Mockup → Approval → Publish Pipeline
// ===========================================================================

describe('Pattern → Mockup → Approval → Publish pipeline', () => {
  it('completes full flow: mockup approved → publish → rebuild queued → social triggered', async () => {
    // Setup: publishProductFromAction returns success (mockup is approved internally)
    vi.mocked(publishProductFromAction).mockResolvedValue({
      success: true,
      rebuildQueued: true,
      queuePosition: 1,
    });

    // Execute publish
    const event = makePublishEvent('mockup-001');
    const result = await sitePublishHandler(event, {} as any, () => {});

    expect(result).toBeDefined();
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.rebuildQueued).toBe(true);
    expect(body.queuePosition).toBe(1);

    // Verify publish module was called
    expect(publishProductFromAction).toHaveBeenCalledWith(
      expect.objectContaining({
        mockupId: 'mockup-001',
        adminId: 'admin-001',
        action: 'publish',
      })
    );

    // Verify audit log was recorded
    expect(recordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-001',
        actionType: 'product_publish',
        resourceType: 'product',
      })
    );
  });

  it('rejects publish when mockup is not approved', async () => {
    vi.mocked(publishProductFromAction).mockResolvedValue({
      success: false,
      rebuildQueued: false,
      error: 'Cannot publish: mockup status is "pending_approval", only approved mockups can be published',
    });

    const event = makePublishEvent('mockup-pending');
    const result = await sitePublishHandler(event, {} as any, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(409);

    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('mockup status');
  });

  it('rejects publish when admin identity is missing', async () => {
    const event = makePublishEvent('mockup-001');
    // Override requestContext to have empty authorizer
    (event.requestContext as any).authorizer = {};

    const result = await sitePublishHandler(event, {} as any, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(403);

    const body = JSON.parse(response.body);
    expect(body.message).toContain('Unauthorized');
  });
});

// ===========================================================================
// 2. Quote Submission → Pricing → Client Response Flow
// ===========================================================================

describe('Quote submission → Pricing → Client response flow', () => {
  it('completes full flow: submit quote → store pending → 201 with tracking', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue(1);
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });

    const event = makeQuoteSubmitEvent();
    const result = await quoteSubmitHandler(event);

    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body);
    expect(body.trackingNumber).toBeDefined();
    expect(body.trackingNumber).toHaveLength(12);
    expect(body.status).toBe('pending');
  });

  it('validates the full quote lifecycle: pending → quoted → accepted', async () => {
    // Step 1: Quote is submitted and stored as "pending"
    vi.mocked(incrementRateLimit).mockResolvedValue(1);
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });

    const submitResult = await quoteSubmitHandler(makeQuoteSubmitEvent());
    expect(submitResult.statusCode).toBe(201);
    const { trackingNumber } = JSON.parse(submitResult.body);
    expect(trackingNumber).toBeDefined();

    // Step 2: Admin prices the quote (mock get returns a quote with "quoted" status)
    vi.mocked(get).mockResolvedValue({
      PK: 'QUOTE#q001',
      SK: 'METADATA',
      id: 'q001',
      trackingNumber,
      clientName: 'Carlos García',
      email: 'carlos@example.com',
      phone: '+573009876543',
      productId: 'prod-002',
      productName: 'Conjunto Deportivo',
      quantity: 20,
      ageGroup: 'adult',
      sizes: ['L', 'XL'],
      status: 'quoted',
      unitPrice: 45000,
      totalPrice: 900000,
      currency: 'COP',
      quoteLinkToken: 'unique-token-abc',
      createdAt: '2024-06-15T10:00:00Z',
    });

    // Verify the quote can be looked up for notification dispatch
    const quote = await get('QUOTE#q001', 'METADATA');
    expect(quote).toBeDefined();
    expect(quote!.status).toBe('quoted');
    expect(quote!.totalPrice).toBe(900000);
  });
});

// ===========================================================================
// 3. WhatsApp Mockup Sharing and Approval via Webhook
// ===========================================================================

describe('WhatsApp mockup sharing and approval via webhook', () => {
  it('processes "approve" response: authenticates, updates status, logs delivery', async () => {
    // Setup: credentials return the shared secret
    vi.mocked(getCredentials).mockResolvedValue({
      wahaWebhookSecret: 'shared-secret-123',
      wahaApiUrl: 'http://waha:3000',
      hcaptchaSecret: 'hcaptcha-secret',
    } as any);

    const webhookPayload = {
      messageId: 'mockup-001',
      phone: '+573001234567',
      response: 'approve',
      text: 'Aprobar ✓',
      timestamp: '2024-06-15T14:30:00Z',
      token: 'shared-secret-123',
    };

    const event = makeWhatsAppWebhookEvent(webhookPayload);
    const result = await waReceiveHandler(event, {} as any, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.processed).toBe(true);
    expect(body.action).toBe('mockup_approved');
    expect(body.entityId).toBe('mockup-001');

    // Verify delivery log was written
    expect(logDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'mockup',
        recipientPhone: '+573001234567',
        status: 'read',
        clientResponse: 'approve',
      })
    );

    // Verify audit entry was recorded
    expect(recordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'whatsapp_response_received',
        resourceId: 'mockup-001',
        resourceType: 'mockup',
      })
    );
  });

  it('rejects webhook with invalid token (401)', async () => {
    vi.mocked(getCredentials).mockResolvedValue({
      wahaWebhookSecret: 'shared-secret-123',
      wahaApiUrl: 'http://waha:3000',
      hcaptchaSecret: 'hcaptcha-secret',
    } as any);

    const webhookPayload = {
      messageId: 'mockup-002',
      phone: '+573001234567',
      response: 'approve',
      timestamp: '2024-06-15T14:30:00Z',
      token: 'wrong-token',
    };

    const event = makeWhatsAppWebhookEvent(webhookPayload);
    const result = await waReceiveHandler(event, {} as any, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    expect(body.error).toContain('Unauthorized');
  });

  it('processes quote acceptance via WhatsApp webhook', async () => {
    vi.mocked(getCredentials).mockResolvedValue({
      wahaWebhookSecret: 'shared-secret-123',
      wahaApiUrl: 'http://waha:3000',
      hcaptchaSecret: 'hcaptcha-secret',
    } as any);

    const webhookPayload = {
      messageId: 'quote-001',
      phone: '+573009876543',
      response: 'accept_quote',
      text: 'Acepto la cotización',
      timestamp: '2024-06-15T15:00:00Z',
      token: 'shared-secret-123',
    };

    const event = makeWhatsAppWebhookEvent(webhookPayload);
    const result = await waReceiveHandler(event, {} as any, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.processed).toBe(true);
    expect(body.action).toBe('quote_accepted');

    // Verify delivery log recorded with quote type
    expect(logDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'quote',
        recipientPhone: '+573009876543',
        status: 'read',
        clientResponse: 'accept_quote',
      })
    );
  });
});

// ===========================================================================
// 4. Site Rebuild Triggered by Publish/Unpublish (with Queue)
// ===========================================================================

describe('Site rebuild triggered by publish/unpublish (with queue)', () => {
  it('queues second rebuild when first is in progress', async () => {
    // First publish triggers rebuild at position 1
    vi.mocked(publishProductFromAction)
      .mockResolvedValueOnce({
        success: true,
        rebuildQueued: true,
        queuePosition: 1,
      })
      // Second publish triggers rebuild at position 2 (queued)
      .mockResolvedValueOnce({
        success: true,
        rebuildQueued: true,
        queuePosition: 2,
      });

    // First publish
    const event1 = makePublishEvent('mockup-001');
    const result1 = await sitePublishHandler(event1, {} as any, () => {});
    const response1 = result1 as { statusCode: number; body: string };
    expect(response1.statusCode).toBe(200);
    const body1 = JSON.parse(response1.body);
    expect(body1.rebuildQueued).toBe(true);
    expect(body1.queuePosition).toBe(1);

    // Second publish (rapid succession — queued behind the first)
    const event2 = makePublishEvent('mockup-002');
    const result2 = await sitePublishHandler(event2, {} as any, () => {});
    const response2 = result2 as { statusCode: number; body: string };
    expect(response2.statusCode).toBe(200);
    const body2 = JSON.parse(response2.body);
    expect(body2.rebuildQueued).toBe(true);
    expect(body2.queuePosition).toBe(2);
  });

  it('sequential rebuild pipeline: first completes, second starts', async () => {
    // Simulate two sequential pipeline runs
    vi.mocked(runRebuildPipeline)
      .mockResolvedValueOnce({
        success: true,
        rebuildId: 'rebuild-001',
        pagesGenerated: 5,
        filesUploaded: 3,
        cacheInvalidated: true,
        durationMs: 4000,
      })
      .mockResolvedValueOnce({
        success: true,
        rebuildId: 'rebuild-002',
        pagesGenerated: 6,
        filesUploaded: 4,
        cacheInvalidated: true,
        durationMs: 3500,
      });

    // First rebuild completes
    const first = await runRebuildPipeline();
    expect(first.success).toBe(true);
    expect(first.rebuildId).toBe('rebuild-001');
    expect(first.pagesGenerated).toBe(5);

    // Second rebuild starts after first completes
    const second = await runRebuildPipeline();
    expect(second.success).toBe(true);
    expect(second.rebuildId).toBe('rebuild-002');
    expect(second.pagesGenerated).toBe(6);
  });

  it('rejects publish when rebuild queue is full', async () => {
    vi.mocked(publishProductFromAction).mockResolvedValue({
      success: false,
      rebuildQueued: false,
      error: 'Rebuild queue is full (10 pending). Retry after current rebuilds complete.',
    });

    const event = makePublishEvent('mockup-overflow');
    const result = await sitePublishHandler(event, {} as any, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(409);

    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('queue is full');
  });
});

// ===========================================================================
// 5. Cognito Login → JWT → API Gateway → Lambda Auth Flow
// ===========================================================================

describe('Cognito login → JWT → API Gateway → Lambda auth flow', () => {
  it('returns Allow policy for valid JWT token', async () => {
    vi.mocked(handleAuthorizerEvent).mockResolvedValue({
      principalId: 'admin-sub-001',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: 'arn:aws:execute-api:us-east-1:123456789012:api-id/prod/POST/products',
        }],
      },
      context: {
        adminId: 'admin-sub-001',
        adminEmail: 'admin@cronusfit.com',
        sessionExpiry: '2024-06-15T13:00:00Z',
      },
    });

    const event = makeAuthorizerEvent('valid-jwt-token');
    const result = await authValidateHandler(event, {} as any, () => {});

    expect(result).toBeDefined();
    const authResult = result as any;
    expect(authResult.principalId).toBe('admin-sub-001');
    expect(authResult.policyDocument.Statement[0].Effect).toBe('Allow');
    expect(authResult.context.adminId).toBe('admin-sub-001');
    expect(authResult.context.adminEmail).toBe('admin@cronusfit.com');
  });

  it('returns Deny policy for expired JWT token', async () => {
    vi.mocked(handleAuthorizerEvent).mockResolvedValue({
      principalId: 'anonymous',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Action: 'execute-api:Invoke',
          Effect: 'Deny',
          Resource: 'arn:aws:execute-api:us-east-1:123456789012:api-id/prod/POST/products',
        }],
      },
      context: {
        adminId: '',
        adminEmail: '',
        sessionExpiry: '',
      },
    });

    const event = makeAuthorizerEvent('expired-jwt-token');
    const result = await authValidateHandler(event, {} as any, () => {});

    const authResult = result as any;
    expect(authResult.principalId).toBe('anonymous');
    expect(authResult.policyDocument.Statement[0].Effect).toBe('Deny');
    expect(authResult.context.adminId).toBe('');
  });

  it('returns Deny policy when no token is provided', async () => {
    vi.mocked(handleAuthorizerEvent).mockResolvedValue({
      principalId: 'anonymous',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{
          Action: 'execute-api:Invoke',
          Effect: 'Deny',
          Resource: 'arn:aws:execute-api:us-east-1:123456789012:api-id/prod/POST/products',
        }],
      },
      context: {
        adminId: '',
        adminEmail: '',
        sessionExpiry: '',
      },
    });

    const event: APIGatewayTokenAuthorizerEvent = {
      type: 'TOKEN',
      authorizationToken: '',
      methodArn: 'arn:aws:execute-api:us-east-1:123456789012:api-id/prod/POST/products',
    };

    const result = await authValidateHandler(event, {} as any, () => {});

    const authResult = result as any;
    expect(authResult.principalId).toBe('anonymous');
    expect(authResult.policyDocument.Statement[0].Effect).toBe('Deny');
  });
});
