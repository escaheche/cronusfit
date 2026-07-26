/**
 * Integration tests for complete exhibition website flows.
 *
 * Validates end-to-end behavior of:
 * - Quote submission pipeline (rate limit → captcha → DynamoDB)
 * - Quote status query pipeline
 * - Site rebuild pipeline (build → S3 → CloudFront invalidation)
 * - Rate limiter multi-request sequences
 * - Cache invalidation retry on CloudFront failures
 * - Usage monitoring threshold breach → SES notification → API disable
 *
 * Validates: Requirements 5.4, 6.4, 9.2, 9.7, 7.1, 2.4, 2.7, 10.7, 10.8
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from '@aws-sdk/client-cloudfront';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent } from 'aws-lambda';

// ---------------------------------------------------------------------------
// Mock modules that perform side effects or complex I/O
// ---------------------------------------------------------------------------

// Mock db/operations for handlers that use it
vi.mock('../../src/db/operations.js', () => ({
  incrementRateLimit: vi.fn(),
  getRateLimitCount: vi.fn().mockResolvedValue(0),
  storeUsedToken: vi.fn().mockResolvedValue(undefined),
  isTokenUsed: vi.fn().mockResolvedValue(false),
  createQuote: vi.fn().mockResolvedValue(undefined),
  getQuoteByTrackingNumber: vi.fn(),
  enqueueRebuild: vi.fn().mockResolvedValue(undefined),
  getRebuildQueueDepth: vi.fn().mockResolvedValue(0),
  dequeueNextRebuild: vi.fn(),
  updateRebuildStatus: vi.fn().mockResolvedValue(undefined),
  putUsageMetric: vi.fn().mockResolvedValue(undefined),
  getUsageMetric: vi.fn().mockResolvedValue(null),
}));

// Mock the site-builder module for rebuild tests
vi.mock('../../src/modules/exhibition/site-builder.js', () => ({
  buildSite: vi.fn(),
}));

// Mock the rebuild module for site-rebuild handler
vi.mock('../../src/modules/exhibition/rebuild.js', () => ({
  processNextRebuild: vi.fn(),
  markRebuildCompleted: vi.fn().mockResolvedValue(undefined),
  markRebuildFailed: vi.fn().mockResolvedValue(undefined),
}));

// Mock node:fs/promises for site-rebuild S3 uploads
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('<html>test</html>')),
}));

// Mock db/client for site-rebuild handler's direct DynamoDB usage
vi.mock('../../src/db/client.js', () => ({
  docClient: { send: vi.fn() },
  TABLE_NAME: 'CronusFit',
}));

// Mock the captcha module's fetch call via the module itself
vi.mock('../../src/modules/security/captcha.js', () => ({
  verifyCaptcha: vi.fn(),
}));

// Mock validation module
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

// Mock sanitize module
vi.mock('../../src/validation/sanitize.js', () => ({
  sanitizeQuoteFields: vi.fn((input: unknown) => input),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { incrementRateLimit, getQuoteByTrackingNumber, putUsageMetric, getUsageMetric } from '../../src/db/operations.js';
import { verifyCaptcha } from '../../src/modules/security/captcha.js';
import { docClient } from '../../src/db/client.js';
import { handler as quoteSubmitHandler } from '../../src/lambdas/quote-submit/handler.js';
import { handler as quoteStatusHandler } from '../../src/lambdas/quote-status/handler.js';
import { handler as siteRebuildHandler } from '../../src/lambdas/site-rebuild/handler.js';
import { invalidateCache } from '../../src/lambdas/site-invalidate/handler.js';
import { handler as monitorHandler, handleThresholdBreach, MONITOR_CONFIG } from '../../src/lambdas/monitor-usage/handler.js';
import { checkRateLimit } from '../../src/modules/security/public-rate-limiter.js';
import { processNextRebuild, markRebuildCompleted } from '../../src/modules/exhibition/rebuild.js';
import { buildSite } from '../../src/modules/exhibition/site-builder.js';
import type { ScheduledEvent } from 'aws-lambda';
import type { UsageCheck, MonitorConfig } from '../../src/types/exhibition.js';

// ---------------------------------------------------------------------------
// AWS SDK Client Mocks
// ---------------------------------------------------------------------------

const cfMock = mockClient(CloudFrontClient);
const cwMock = mockClient(CloudWatchClient);
const s3Mock = mockClient(S3Client);
const lambdaMock = mockClient(LambdaClient);
const sesMock = mockClient(SESClient);
const smMock = mockClient(SecretsManagerClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuoteSubmitEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/quotes',
    headers: {
      'X-Forwarded-For': '203.0.113.50',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientName: 'Juan Pérez',
      email: 'juan@example.com',
      phone: '+573001234567',
      productId: 'prod-001',
      quantity: 10,
      ageGroup: 'adult',
      sizes: ['M', 'L'],
      customizationNotes: 'Logo en pecho',
      captchaToken: 'valid-token-123',
    }),
    pathParameters: null,
    queryStringParameters: null,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
    ...overrides,
  } as APIGatewayProxyEvent;
}

function makeQuoteStatusEvent(trackingNumber: string): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: `/quotes/${trackingNumber}/status`,
    headers: {
      'X-Forwarded-For': '203.0.113.50',
    },
    body: null,
    pathParameters: { trackingNumber },
    queryStringParameters: { captchaToken: 'valid-captcha-token' },
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    isBase64Encoded: false,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  } as unknown as APIGatewayProxyEvent;
}

function makeScheduledEvent(): ScheduledEvent {
  return {
    version: '0',
    id: 'test-event-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789012',
    time: '2024-06-15T12:00:00Z',
    region: 'us-east-1',
    resources: ['arn:aws:events:us-east-1:123456789012:rule/monitor-usage'],
    detail: {},
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  cfMock.reset();
  cwMock.reset();
  s3Mock.reset();
  lambdaMock.reset();
  sesMock.reset();
  smMock.reset();

  // Default AWS SDK responses
  s3Mock.on(PutObjectCommand).resolves({});
  lambdaMock.on(InvokeCommand).resolves({ StatusCode: 202 });
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'msg-001' });
  smMock.on(GetSecretValueCommand).resolves({ SecretString: 'test-hcaptcha-secret' });
  cfMock.on(CreateInvalidationCommand).resolves({
    Invalidation: { Id: 'INV-001', Status: 'InProgress', CreateTime: new Date(), InvalidationBatch: { CallerReference: 'ref', Paths: { Quantity: 1, Items: ['/'] } } },
  });
  cwMock.on(GetMetricStatisticsCommand).resolves({ Datapoints: [] });

  // Default module mock behaviors
  vi.mocked(incrementRateLimit).mockResolvedValue(1); // First request allowed
  vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Full Quote Submission Flow (Validates: Requirement 5.4)
// ===========================================================================

describe('Full quote submission flow', () => {
  it('completes the full pipeline: rate limit → captcha → validation → DynamoDB → 201', async () => {
    // Rate limiter allows (count = 1, under limit of 5)
    vi.mocked(incrementRateLimit).mockResolvedValue(1);
    // Captcha passes
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });

    const event = makeQuoteSubmitEvent();
    const result = await quoteSubmitHandler(event);

    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body);
    expect(body.trackingNumber).toBeDefined();
    expect(body.trackingNumber).toHaveLength(12);
    expect(body.status).toBe('pending');
    expect(body.message).toContain('Cotización recibida exitosamente');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    // 11th request — exceeds the 10 req/hour limit
    vi.mocked(incrementRateLimit).mockResolvedValue(11);

    const event = makeQuoteSubmitEvent();
    const result = await quoteSubmitHandler(event);

    expect(result.statusCode).toBe(429);
    expect(result.headers?.['Retry-After']).toBeDefined();
  });

  it('returns 403 when captcha verification fails', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue(1);
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: false, error: 'invalid_token' });

    const event = makeQuoteSubmitEvent();
    const result = await quoteSubmitHandler(event);

    expect(result.statusCode).toBe(403);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('CAPTCHA');
  });
});

// ===========================================================================
// 2. Full Status Query Flow (Validates: Requirement 6.4)
// ===========================================================================

describe('Full status query flow', () => {
  it('completes the full pipeline: rate limit → captcha → DynamoDB → 200', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue(1);
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });
    vi.mocked(getQuoteByTrackingNumber).mockResolvedValue({
      PK: 'QUOTE#q001',
      SK: 'METADATA',
      GSI1PK: 'QSTATUS#pending',
      GSI1SK: 'CREATED#2024-06-15T10:00:00Z',
      id: 'q001',
      trackingNumber: 'ABC123DEF456',
      clientName: 'María López',
      email: 'maria@example.com',
      phone: '+573009876543',
      productId: 'prod-002',
      productName: 'Conjunto Deportivo Elite',
      quantity: 5,
      ageGroup: 'adult',
      sizes: ['S', 'M'],
      status: 'pending',
      createdAt: '2024-06-15T10:00:00Z',
    });

    const event = makeQuoteStatusEvent('ABC123DEF456');
    const result = await quoteStatusHandler(event);

    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.trackingNumber).toBe('ABC123DEF456');
    expect(body.status).toBe('pending');
    expect(body.submittedAt).toBe('2024-06-15T10:00:00Z');
    expect(body.productName).toBe('Conjunto Deportivo Elite');
  });

  it('returns 404 when tracking number not found', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue(1);
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });
    vi.mocked(getQuoteByTrackingNumber).mockResolvedValue(null);

    const event = makeQuoteStatusEvent('NOTFOUND12345');
    const result = await quoteStatusHandler(event);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('Quote not found');
  });

  it('returns 429 when rate limit is exceeded', async () => {
    vi.mocked(incrementRateLimit).mockResolvedValue(11); // Exceeds 10 req/15min

    const event = makeQuoteStatusEvent('ABC123DEF456');
    const result = await quoteStatusHandler(event);

    expect(result.statusCode).toBe(429);
  });
});

// ===========================================================================
// 3. Site Rebuild Pipeline (Validates: Requirements 9.2, 9.7)
// ===========================================================================

describe('Site rebuild pipeline', () => {
  it('completes full pipeline: dequeue → build → S3 upload → invalidation', async () => {
    // processNextRebuild returns an in-progress rebuild
    vi.mocked(processNextRebuild).mockResolvedValue({
      rebuildId: 'rebuild-001',
      status: 'in_progress',
      startedAt: '2024-06-15T10:00:00Z',
      retryCount: 0,
    });

    // Mock docClient.send for fetchPublishedProducts (QueryCommand)
    vi.mocked(docClient.send).mockResolvedValue({
      Items: [
        {
          PK: 'PRODUCT#prod-001',
          SK: 'METADATA',
          GSI1PK: 'PUBLISHED#true',
          GSI1SK: 'CREATED#2024-06-01T00:00:00Z',
          id: 'prod-001',
          productName: { es: 'Camiseta', en: 'T-Shirt' },
          garmentType: 'tshirt',
          ageGroup: 'adult',
          availableSizes: ['M', 'L', 'XL'],
          frontImageS3Key: 'mockups/prod-001/front.webp',
          backImageS3Key: 'mockups/prod-001/back.webp',
          publishedAt: '2024-06-01T00:00:00Z',
          publishedBy: 'admin-001',
        },
      ],
      LastEvaluatedKey: undefined,
    } as any);

    // buildSite returns success with changed paths
    vi.mocked(buildSite).mockResolvedValue({
      success: true,
      pagesGenerated: 5,
      imagesProcessed: 3,
      cssSize: 12000,
      buildDurationMs: 4500,
      changedPaths: ['index.html', 'products/prod-001/index.html', 'assets/css/main.css'],
    });

    await siteRebuildHandler();

    // Verify S3 uploads were made for each changed path
    const s3Calls = s3Mock.commandCalls(PutObjectCommand);
    expect(s3Calls).toHaveLength(3);

    // Verify cache invalidation Lambda was triggered
    const lambdaCalls = lambdaMock.commandCalls(InvokeCommand);
    expect(lambdaCalls).toHaveLength(1);

    const invokePayload = JSON.parse(
      Buffer.from(lambdaCalls[0].args[0].input.Payload as Uint8Array).toString()
    );
    expect(invokePayload.changedPaths).toEqual([
      'index.html',
      'products/prod-001/index.html',
      'assets/css/main.css',
    ]);

    // Verify rebuild was marked as completed
    expect(markRebuildCompleted).toHaveBeenCalledWith('rebuild-001');
  });

  it('does nothing when rebuild queue is empty', async () => {
    vi.mocked(processNextRebuild).mockResolvedValue({
      rebuildId: '',
      status: 'completed',
      retryCount: 0,
    });

    await siteRebuildHandler();

    // No S3 uploads or Lambda invocations
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    expect(lambdaMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});

// ===========================================================================
// 4. Rate Limiter Multi-Request Sequence (Validates: Requirement 7.1)
// ===========================================================================

describe('Rate limiter multi-request sequence', () => {
  it('allows first 5 requests and denies the 6th with retryAfterSeconds', async () => {
    const config = { endpoint: 'quote-submit' as const, maxRequests: 5, windowSeconds: 900 };
    const ip = '192.168.1.100';

    // Simulate sequential requests: count increments each time
    let callCount = 0;
    vi.mocked(incrementRateLimit).mockImplementation(async () => {
      callCount++;
      return callCount;
    });

    // First 5 calls should be allowed
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit(ip, config);
      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(5 - (i + 1));
    }

    // 6th call should be denied
    const deniedResult = await checkRateLimit(ip, config);
    expect(deniedResult.allowed).toBe(false);
    expect(deniedResult.retryAfterSeconds).toBeDefined();
    expect(deniedResult.retryAfterSeconds).toBeGreaterThan(0);
    expect(deniedResult.retryAfterSeconds).toBeLessThanOrEqual(900);
  });

  it('uses fixed windows aligned to clock boundaries', async () => {
    const config = { endpoint: 'quote-status' as const, maxRequests: 10, windowSeconds: 900 };
    const ip = '10.0.0.1';

    vi.mocked(incrementRateLimit).mockResolvedValue(1);

    const result = await checkRateLimit(ip, config);
    expect(result.allowed).toBe(true);
    expect(result.currentCount).toBe(1);

    // Verify incrementRateLimit was called with correct window alignment
    const call = vi.mocked(incrementRateLimit).mock.calls[0];
    expect(call[0]).toBe(ip);
    expect(call[1]).toBe('quote-status');
    // windowStart should be aligned to 900-second boundaries
    const windowStart = call[2] as number;
    expect(windowStart % (900 * 1000)).toBe(0);
    expect(call[3]).toBe(900);
  });
});

// ===========================================================================
// 5. Cache Invalidation Retry on CloudFront Failures (Validates: Req 2.4, 2.7)
// ===========================================================================

describe('Cache invalidation retry behavior', () => {
  beforeEach(() => {
    // Set env vars needed by the handler
    process.env.ADMIN_EMAIL = 'admin@cronusfit.com';
    process.env.SES_FROM_EMAIL = 'noreply@cronusfit.com';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.SES_FROM_EMAIL;
  });

  it('retries on failure and succeeds on 3rd attempt with retriesAttempted: 2', async () => {
    // Fail twice, succeed on third
    cfMock
      .on(CreateInvalidationCommand)
      .rejectsOnce(new Error('Throttled'))
      .rejectsOnce(new Error('Service unavailable'))
      .resolves({
        Invalidation: { Id: 'INV-003', Status: 'InProgress', CreateTime: new Date(), InvalidationBatch: { CallerReference: 'ref', Paths: { Quantity: 1, Items: ['/'] } } },
      });

    // Use fake timers to avoid waiting 10s delays
    vi.useFakeTimers();

    const resultPromise = invalidateCache({
      changedPaths: ['/index.html', '/products/p1/index.html'],
      distributionId: 'E123DISTRIBUTION',
    });

    // Advance through 2 retry delays (10s each)
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;

    vi.useRealTimers();

    expect(result.success).toBe(true);
    expect(result.retriesAttempted).toBe(2);
    expect(result.strategy).toBe('individual');
    expect(result.invalidationId).toBe('INV-003');
  });

  it('notifies Admin via SES when all 3 retries fail', async () => {
    // All 3 attempts fail
    cfMock
      .on(CreateInvalidationCommand)
      .rejectsOnce(new Error('CF Error 1'))
      .rejectsOnce(new Error('CF Error 2'))
      .rejectsOnce(new Error('CF Error 3'));

    vi.useFakeTimers();

    const resultPromise = invalidateCache({
      changedPaths: ['/index.html'],
      distributionId: 'E123DISTRIBUTION',
    });

    // Advance through retry delays
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;

    vi.useRealTimers();

    expect(result.success).toBe(false);
    expect(result.retriesAttempted).toBe(3);
    expect(result.error).toContain('CF Error 3');

    // Verify SES notification was sent
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls.length).toBeGreaterThanOrEqual(1);

    const emailInput = sesCalls[0].args[0].input;
    expect(emailInput.Message?.Subject?.Data).toContain('Cache Invalidation Failed');
    expect(emailInput.Message?.Body?.Text?.Data).toContain('E123DISTRIBUTION');
  });

  it('uses wildcard strategy when more than 15 paths changed', async () => {
    cfMock.on(CreateInvalidationCommand).resolves({
      Invalidation: { Id: 'INV-WILD', Status: 'InProgress', CreateTime: new Date(), InvalidationBatch: { CallerReference: 'ref', Paths: { Quantity: 1, Items: ['/*'] } } },
    });

    const manyPaths = Array.from({ length: 20 }, (_, i) => `/page-${i}.html`);

    const result = await invalidateCache({
      changedPaths: manyPaths,
      distributionId: 'E123DISTRIBUTION',
    });

    expect(result.success).toBe(true);
    expect(result.strategy).toBe('wildcard');

    // Verify the actual invalidation used /*
    const cfCalls = cfMock.commandCalls(CreateInvalidationCommand);
    const paths = cfCalls[0].args[0].input.InvalidationBatch?.Paths?.Items;
    expect(paths).toEqual(['/*']);
  });
});

// ===========================================================================
// 6. Usage Monitoring Threshold Breach (Validates: Requirements 10.7, 10.8)
// ===========================================================================

describe('Usage monitoring threshold breach', () => {
  beforeEach(() => {
    process.env.ADMIN_EMAIL = 'admin@cronusfit.com';
    process.env.SENDER_EMAIL = 'noreply@cronusfit.com';
  });

  afterEach(() => {
    delete process.env.ADMIN_EMAIL;
    delete process.env.SENDER_EMAIL;
  });

  it('sends SES warning notification when service reaches 85% (above 80% threshold)', async () => {
    const check: UsageCheck = {
      service: 'ApiGateway',
      currentUsage: 850000,
      freeLimit: 1000000,
      percentUsed: 85,
    };

    const config: MonitorConfig = {
      checkIntervalMinutes: 5,
      alertThresholdPercent: 80,
      disableThresholdPercent: 100,
      services: [{ service: 'ApiGateway', metric: 'Count', monthlyLimit: 1000000 }],
    };

    vi.mocked(getUsageMetric).mockResolvedValue(null); // No prior alert

    const now = new Date(Date.UTC(2024, 5, 15, 12, 0, 0));
    await handleThresholdBreach(check, config, '2024-06', now);

    // Verify SES was called with warning subject containing 80%
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    const emailInput = sesCalls[0].args[0].input;
    expect(emailInput.Message?.Subject?.Data).toContain('ALERTA');
    expect(emailInput.Message?.Subject?.Data).toContain('85%');
  });

  it('disables API and stores disabled record when service reaches 100%', async () => {
    const check: UsageCheck = {
      service: 'Lambda',
      currentUsage: 1000000,
      freeLimit: 1000000,
      percentUsed: 100,
    };

    const config: MonitorConfig = {
      checkIntervalMinutes: 5,
      alertThresholdPercent: 80,
      disableThresholdPercent: 100,
      services: [{ service: 'Lambda', metric: 'Invocations', monthlyLimit: 1000000 }],
    };

    vi.mocked(getUsageMetric).mockResolvedValue(null); // No prior disable

    const now = new Date(Date.UTC(2024, 5, 15, 12, 0, 0));
    await handleThresholdBreach(check, config, '2024-06', now);

    // Verify SES was called with critical subject
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(1);

    const emailInput = sesCalls[0].args[0].input;
    expect(emailInput.Message?.Subject?.Data).toContain('CRÍTICO');
    expect(emailInput.Message?.Subject?.Data).toContain('100%');

    // Verify DynamoDB putUsageMetric was called with API disabled record
    expect(putUsageMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: 'USAGE#QUOTE_API_DISABLED',
        SK: 'PERIOD#2024-06',
        disabledAt: now.toISOString(),
        currentUsage: 1,
      })
    );
  });

  it('does not send duplicate alerts if already alerted', async () => {
    vi.mocked(getUsageMetric).mockResolvedValue({
      PK: 'USAGE#S3',
      SK: 'PERIOD#2024-06',
      service: 'S3',
      currentUsage: 16000,
      freeLimit: 20000,
      percentUsed: 80,
      lastCheckedAt: '2024-06-14T12:00:00Z',
      alertSentAt: '2024-06-14T12:00:00Z', // Already alerted
    });

    const check: UsageCheck = {
      service: 'S3',
      currentUsage: 17000,
      freeLimit: 20000,
      percentUsed: 85,
    };

    const config: MonitorConfig = {
      checkIntervalMinutes: 5,
      alertThresholdPercent: 80,
      disableThresholdPercent: 100,
      services: [{ service: 'S3', metric: 'NumberOfObjects', monthlyLimit: 20000 }],
    };

    await handleThresholdBreach(check, config, '2024-06', new Date());

    // No emails should be sent
    const sesCalls = sesMock.commandCalls(SendEmailCommand);
    expect(sesCalls).toHaveLength(0);
  });
});
