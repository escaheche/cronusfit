import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../src/lambdas/quote-submit/handler.js';

// Mock dependencies
vi.mock('../../../src/modules/security/public-rate-limiter.js', () => ({
  extractClientIp: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('../../../src/modules/security/captcha.js', () => ({
  verifyCaptcha: vi.fn(),
}));

vi.mock('../../../src/db/operations.js', () => ({
  createQuote: vi.fn(),
}));

import { extractClientIp, checkRateLimit } from '../../../src/modules/security/public-rate-limiter.js';
import { verifyCaptcha } from '../../../src/modules/security/captcha.js';
import { createQuote } from '../../../src/db/operations.js';

const mockedExtractClientIp = vi.mocked(extractClientIp);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);
const mockedVerifyCaptcha = vi.mocked(verifyCaptcha);
const mockedCreateQuote = vi.mocked(createQuote);

/** Helper to create a minimal API Gateway event. */
function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/quotes',
    headers: { 'X-Forwarded-For': '203.0.113.1' },
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

/** Valid quote request body. */
const validBody = {
  clientName: 'Juan Pérez',
  email: 'juan@example.com',
  phone: '+573001234567',
  productId: 'prod-123',
  quantity: 50,
  ageGroup: 'adult',
  sizes: ['M', 'L', 'XL'],
  captchaToken: 'valid-token-abc',
};

describe('quote-submit handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy path mocks
    mockedExtractClientIp.mockReturnValue('203.0.113.1');
    mockedCheckRateLimit.mockResolvedValue({
      allowed: true,
      currentCount: 1,
      remainingRequests: 4,
    });
    mockedVerifyCaptcha.mockResolvedValue({ valid: true });
    mockedCreateQuote.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('IP extraction and rate limiting', () => {
    it('returns 400 when X-Forwarded-For header is missing', async () => {
      mockedExtractClientIp.mockReturnValue(null);

      const event = makeEvent({ headers: {}, body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('X-Forwarded-For');
    });

    it('returns 429 when rate limit is exceeded', async () => {
      mockedCheckRateLimit.mockResolvedValue({
        allowed: false,
        currentCount: 6,
        remainingRequests: 0,
        retryAfterSeconds: 450,
      });

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(429);
      expect(result.headers!['Retry-After']).toBe('450');
      expect(JSON.parse(result.body).message).toContain('450');
    });

    it('returns 503 when rate limiter throws', async () => {
      mockedCheckRateLimit.mockRejectedValue(new Error('DynamoDB error'));

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
    });
  });

  describe('request body parsing', () => {
    it('returns 400 when body is missing', async () => {
      const event = makeEvent({ body: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('body');
    });

    it('returns 400 when body is invalid JSON', async () => {
      const event = makeEvent({ body: 'not json' });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toContain('Invalid JSON');
    });
  });

  describe('hCaptcha verification', () => {
    it('returns 403 when captcha token is invalid', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'invalid_token' });

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toContain('invalid_token');
    });

    it('returns 403 when captcha token is expired', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'expired_token' });

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toContain('expired_token');
    });

    it('returns 403 when captcha token is reused', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'reused_token' });

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toContain('reused_token');
    });

    it('returns 503 when captcha service is unavailable', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'service_unavailable' });

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
    });

    it('returns 503 when verifyCaptcha throws', async () => {
      mockedVerifyCaptcha.mockRejectedValue(new Error('Network error'));

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
    });
  });

  describe('input validation', () => {
    it('returns 400 with field errors for invalid email', async () => {
      const body = { ...validBody, email: 'not-an-email' };
      const event = makeEvent({ body: JSON.stringify(body) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.errors).toHaveProperty('email');
    });

    it('returns 400 with field errors for invalid phone', async () => {
      const body = { ...validBody, phone: '123' };
      const event = makeEvent({ body: JSON.stringify(body) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.errors).toHaveProperty('phone');
    });

    it('returns 400 with field errors for invalid quantity', async () => {
      const body = { ...validBody, quantity: 0 };
      const event = makeEvent({ body: JSON.stringify(body) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.errors).toHaveProperty('quantity');
    });

    it('returns 400 when productId is empty', async () => {
      const body = { ...validBody, productId: '' };
      const event = makeEvent({ body: JSON.stringify(body) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.errors).toHaveProperty('productId');
    });

    it('returns 400 with multiple field errors', async () => {
      const body = { ...validBody, email: 'bad', phone: 'bad', quantity: -1 };
      const event = makeEvent({ body: JSON.stringify(body) });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(Object.keys(parsed.errors).length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('successful submission', () => {
    it('returns 201 with tracking number on success', async () => {
      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(201);
      const parsed = JSON.parse(result.body);
      expect(parsed.trackingNumber).toBeDefined();
      expect(parsed.trackingNumber.length).toBe(12);
      expect(parsed.status).toBe('pending');
      expect(parsed.message).toBeDefined();
    });

    it('calls createQuote with correct record structure', async () => {
      const event = makeEvent({ body: JSON.stringify(validBody) });
      await handler(event);

      expect(mockedCreateQuote).toHaveBeenCalledTimes(1);
      const record = mockedCreateQuote.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(record.PK).toMatch(/^QUOTE#/);
      expect(record.SK).toBe('METADATA');
      expect(record.GSI1PK).toBe('QSTATUS#pending');
      expect(record.GSI1SK).toMatch(/^CREATED#/);
      expect(record.status).toBe('pending');
      expect(record.trackingNumber).toBeDefined();
    });

    it('includes CORS headers in success response', async () => {
      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers!['Content-Type']).toBe('application/json');
    });

    it('returns 503 when createQuote fails', async () => {
      mockedCreateQuote.mockRejectedValue(new Error('DynamoDB transaction error'));

      const event = makeEvent({ body: JSON.stringify(validBody) });
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
      expect(JSON.parse(result.body).message).toContain('try again');
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers on error responses', async () => {
      mockedExtractClientIp.mockReturnValue(null);

      const event = makeEvent({ headers: {} });
      const result = await handler(event);

      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    });
  });
});
