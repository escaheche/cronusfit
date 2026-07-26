import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../../../src/lambdas/quote-status/handler.js';

// Mock dependencies
vi.mock('../../../src/modules/security/public-rate-limiter.js', () => ({
  extractClientIp: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('../../../src/modules/security/captcha.js', () => ({
  verifyCaptcha: vi.fn(),
}));

vi.mock('../../../src/db/operations.js', () => ({
  getQuoteByTrackingNumber: vi.fn(),
}));

import { extractClientIp, checkRateLimit } from '../../../src/modules/security/public-rate-limiter.js';
import { verifyCaptcha } from '../../../src/modules/security/captcha.js';
import { getQuoteByTrackingNumber } from '../../../src/db/operations.js';

const mockedExtractClientIp = vi.mocked(extractClientIp);
const mockedCheckRateLimit = vi.mocked(checkRateLimit);
const mockedVerifyCaptcha = vi.mocked(verifyCaptcha);
const mockedGetQuoteByTrackingNumber = vi.mocked(getQuoteByTrackingNumber);

/** Helper to create a minimal API Gateway event for GET /quotes/{trackingNumber}/status. */
function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/quotes/ABC123/status',
    headers: { 'X-Forwarded-For': '203.0.113.1' },
    multiValueHeaders: {},
    queryStringParameters: { captchaToken: 'valid-captcha-token' },
    multiValueQueryStringParameters: null,
    pathParameters: { trackingNumber: 'ABC123' },
    stageVariables: null,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
    resource: '',
    body: null,
    isBase64Encoded: false,
    ...overrides,
  };
}

/** Mock quote record returned from DynamoDB. */
const mockQuoteRecord = {
  PK: 'QUOTE#quote-001',
  SK: 'METADATA',
  GSI1PK: 'QSTATUS#pending',
  GSI1SK: 'CREATED#2024-01-15T10:30:00.000Z',
  id: 'quote-001',
  trackingNumber: 'ABC123',
  clientName: 'Juan Pérez',
  email: 'juan@example.com',
  phone: '+573001234567',
  productId: 'prod-123',
  productName: 'Camiseta Deportiva',
  quantity: 50,
  ageGroup: 'adult' as const,
  sizes: ['M', 'L', 'XL'],
  status: 'pending' as const,
  createdAt: '2024-01-15T10:30:00.000Z',
};

describe('quote-status handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default happy path mocks
    mockedExtractClientIp.mockReturnValue('203.0.113.1');
    mockedCheckRateLimit.mockResolvedValue({
      allowed: true,
      currentCount: 1,
      remainingRequests: 9,
    });
    mockedVerifyCaptcha.mockResolvedValue({ valid: true });
    mockedGetQuoteByTrackingNumber.mockResolvedValue(mockQuoteRecord);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful status query', () => {
    it('returns 200 with QuoteStatusResponse on success', async () => {
      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body);
      expect(parsed.trackingNumber).toBe('ABC123');
      expect(parsed.status).toBe('pending');
      expect(parsed.submittedAt).toBe('2024-01-15T10:30:00.000Z');
      expect(parsed.productName).toBe('Camiseta Deportiva');
    });

    it('calls getQuoteByTrackingNumber with correct tracking number', async () => {
      const event = makeEvent();
      await handler(event);

      expect(mockedGetQuoteByTrackingNumber).toHaveBeenCalledWith('ABC123');
    });
  });

  describe('not-found tracking number', () => {
    it('returns 404 when tracking number is not found in database', async () => {
      mockedGetQuoteByTrackingNumber.mockResolvedValue(null);

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(404);
      const parsed = JSON.parse(result.body);
      expect(parsed.message).toBeDefined();
    });
  });

  describe('rate limit exceeded', () => {
    it('returns 429 with Retry-After header when rate limit is exceeded', async () => {
      mockedCheckRateLimit.mockResolvedValue({
        allowed: false,
        currentCount: 11,
        remainingRequests: 0,
        retryAfterSeconds: 600,
      });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(429);
      expect(result.headers!['Retry-After']).toBe('600');
      const parsed = JSON.parse(result.body);
      expect(parsed.message).toBeDefined();
    });

    it('returns 503 when rate limiter throws an error', async () => {
      mockedCheckRateLimit.mockRejectedValue(new Error('DynamoDB unavailable'));

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
    });
  });

  describe('invalid captcha', () => {
    it('returns 403 when captcha token is invalid', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'invalid_token' });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const parsed = JSON.parse(result.body);
      expect(parsed.message).toBeDefined();
    });

    it('returns 403 when captcha token is expired', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'expired_token' });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
    });

    it('returns 403 when captcha token is reused', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'reused_token' });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
    });

    it('returns 503 when captcha service is unavailable', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'service_unavailable' });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
    });

    it('returns 503 when verifyCaptcha throws', async () => {
      mockedVerifyCaptcha.mockRejectedValue(new Error('Network error'));

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
    });
  });

  describe('missing captcha token', () => {
    it('returns 403 when captchaToken query parameter is missing', async () => {
      const event = makeEvent({ queryStringParameters: null });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const parsed = JSON.parse(result.body);
      expect(parsed.message).toContain('captcha');
    });

    it('returns 403 when captchaToken is empty string', async () => {
      const event = makeEvent({ queryStringParameters: { captchaToken: '' } });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
      const parsed = JSON.parse(result.body);
      expect(parsed.message).toContain('captcha');
    });

    it('returns 403 when captchaToken is whitespace only', async () => {
      const event = makeEvent({ queryStringParameters: { captchaToken: '   ' } });
      const result = await handler(event);

      expect(result.statusCode).toBe(403);
    });
  });

  describe('invalid tracking number format', () => {
    it('returns 400 for tracking number with special characters', async () => {
      const event = makeEvent({ pathParameters: { trackingNumber: 'ABC!@#$%' } });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });

    it('returns 400 for tracking number longer than 36 characters', async () => {
      const event = makeEvent({
        pathParameters: { trackingNumber: 'A'.repeat(37) },
      });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });
  });

  describe('missing X-Forwarded-For header', () => {
    it('returns 400 when X-Forwarded-For header is missing', async () => {
      mockedExtractClientIp.mockReturnValue(null);

      const event = makeEvent({ headers: {} });
      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const parsed = JSON.parse(result.body);
      expect(parsed.message).toContain('X-Forwarded-For');
    });
  });

  describe('database error', () => {
    it('returns 503 when DynamoDB throws an error', async () => {
      mockedGetQuoteByTrackingNumber.mockRejectedValue(new Error('DynamoDB read error'));

      const event = makeEvent();
      const result = await handler(event);

      expect(result.statusCode).toBe(503);
    });
  });

  describe('CORS headers', () => {
    it('includes CORS headers on successful response', async () => {
      const event = makeEvent();
      const result = await handler(event);

      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
      expect(result.headers!['Access-Control-Allow-Headers']).toBe('Content-Type');
      expect(result.headers!['Access-Control-Allow-Methods']).toBe('GET,OPTIONS');
      expect(result.headers!['Content-Type']).toBe('application/json');
    });

    it('includes CORS headers on 400 error response', async () => {
      mockedExtractClientIp.mockReturnValue(null);

      const event = makeEvent({ headers: {} });
      const result = await handler(event);

      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    });

    it('includes CORS headers on 404 response', async () => {
      mockedGetQuoteByTrackingNumber.mockResolvedValue(null);

      const event = makeEvent();
      const result = await handler(event);

      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    });

    it('includes CORS headers on 429 rate-limited response', async () => {
      mockedCheckRateLimit.mockResolvedValue({
        allowed: false,
        currentCount: 11,
        remainingRequests: 0,
        retryAfterSeconds: 300,
      });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    });

    it('includes CORS headers on 403 captcha error response', async () => {
      mockedVerifyCaptcha.mockResolvedValue({ valid: false, error: 'invalid_token' });

      const event = makeEvent();
      const result = await handler(event);

      expect(result.headers!['Access-Control-Allow-Origin']).toBe('*');
    });
  });
});
