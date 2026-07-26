/**
 * Unit tests for the quote submission module (src/modules/quote/submit.ts).
 *
 * Covers:
 * - CAPTCHA verification (missing, invalid, service unavailable)
 * - Rate limiting (allowed, exceeded)
 * - Field validation (all required fields, boundary values)
 * - Happy path (full pipeline: captcha → rate limit → validate → store → emails)
 * - Storage failure handling
 * - Tracking number format
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Mock external dependencies before imports
vi.mock('../../../src/modules/security/captcha.js', () => ({
  verifyCaptcha: vi.fn(),
}));

vi.mock('../../../src/modules/security/public-rate-limiter.js', () => ({
  checkPublicRateLimit: vi.fn(),
}));

vi.mock('../../../src/db/operations.js', () => ({
  createQuote: vi.fn(),
}));

import { submitQuote, generateTrackingNumber } from '../../../src/modules/quote/submit.js';
import { verifyCaptcha } from '../../../src/modules/security/captcha.js';
import { checkPublicRateLimit } from '../../../src/modules/security/public-rate-limiter.js';
import { createQuote } from '../../../src/db/operations.js';
import type { QuoteSubmitRequest } from '../../../src/types/quote.js';
import type { QuoteRecord } from '../../../src/db/entities.js';

const sesMock = mockClient(SESClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A valid quote submission request for happy path tests. */
function validRequest(): QuoteSubmitRequest {
  return {
    clientName: 'Juan Pérez',
    email: 'juan@example.com',
    phone: '+573001234567',
    productId: 'prod-001',
    quantity: 100,
    ageGroup: 'adult',
    sizes: ['M', 'L', 'XL'],
    customizationNotes: 'Logo en la espalda',
    captchaToken: 'valid-captcha-token',
  };
}

const CLIENT_IP = '192.168.1.100';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-msg-id' });

  // Default mocks: everything passes
  vi.mocked(verifyCaptcha).mockResolvedValue({ valid: true });
  vi.mocked(checkPublicRateLimit).mockResolvedValue({
    allowed: true,
    currentCount: 1,
    remainingRequests: 9,
  });
  vi.mocked(createQuote).mockResolvedValue(undefined);
});

afterEach(() => {
  sesMock.reset();
});

// ---------------------------------------------------------------------------
// Tracking Number
// ---------------------------------------------------------------------------

describe('generateTrackingNumber', () => {
  it('should generate a tracking number in CF-XXXXXXXX format (alphanumeric)', () => {
    const tn = generateTrackingNumber();
    expect(tn).toMatch(/^CF[A-Z0-9]{8}$/);
  });

  it('should generate unique tracking numbers', () => {
    const numbers = new Set(Array.from({ length: 100 }, () => generateTrackingNumber()));
    expect(numbers.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// CAPTCHA Verification
// ---------------------------------------------------------------------------

describe('submitQuote - CAPTCHA', () => {
  it('should reject when CAPTCHA token is invalid', async () => {
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: false, error: 'invalid_token' });

    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('captcha');
      expect(result.error.message).toContain('invalid_token');
    }
  });

  it('should reject when CAPTCHA token is expired', async () => {
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: false, error: 'expired_token' });

    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('captcha');
      expect(result.error.message).toContain('expired_token');
    }
  });

  it('should reject when CAPTCHA token is reused', async () => {
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: false, error: 'reused_token' });

    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('captcha');
      expect(result.error.message).toContain('reused_token');
    }
  });

  it('should handle CAPTCHA service unavailability', async () => {
    vi.mocked(verifyCaptcha).mockRejectedValue(new Error('Network timeout'));

    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('captcha');
      expect(result.error.message).toContain('unavailable');
    }
  });
});

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

describe('submitQuote - Rate Limiting', () => {
  it('should reject when rate limit is exceeded', async () => {
    vi.mocked(checkPublicRateLimit).mockResolvedValue({
      allowed: false,
      currentCount: 11,
      remainingRequests: 0,
      retryAfterSeconds: 2400,
    });

    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('rate_limit');
      expect(result.error.retryAfterSeconds).toBe(2400);
    }
  });

  it('should handle rate limit service failure', async () => {
    vi.mocked(checkPublicRateLimit).mockRejectedValue(new Error('DynamoDB error'));

    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('internal');
    }
  });

  it('should pass the correct endpoint to rate limiter', async () => {
    await submitQuote(validRequest(), CLIENT_IP);

    expect(checkPublicRateLimit).toHaveBeenCalledWith(CLIENT_IP, 'quote-submit');
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('submitQuote - Validation', () => {
  it('should reject when clientName is empty', async () => {
    const req = { ...validRequest(), clientName: '' };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['clientName']).toBeDefined();
    }
  });

  it('should reject when clientName exceeds 100 characters', async () => {
    const req = { ...validRequest(), clientName: 'A'.repeat(101) };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['clientName']).toBeDefined();
    }
  });

  it('should reject invalid email format', async () => {
    const req = { ...validRequest(), email: 'not-an-email' };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['email']).toBeDefined();
    }
  });

  it('should reject phone with too few digits', async () => {
    const req = { ...validRequest(), phone: '+12345' };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['phone']).toBeDefined();
    }
  });

  it('should reject phone with too many digits', async () => {
    const req = { ...validRequest(), phone: '+1234567890123456' };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['phone']).toBeDefined();
    }
  });

  it('should reject quantity of 0', async () => {
    const req = { ...validRequest(), quantity: 0 };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['quantity']).toBeDefined();
    }
  });

  it('should reject quantity exceeding 10000', async () => {
    const req = { ...validRequest(), quantity: 10001 };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['quantity']).toBeDefined();
    }
  });

  it('should reject invalid age group', async () => {
    const req = { ...validRequest(), ageGroup: 'teenager' as never };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['ageGroup']).toBeDefined();
    }
  });

  it('should reject adult sizes when age group is children', async () => {
    const req = { ...validRequest(), ageGroup: 'children' as const, sizes: ['XL'] as never };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['sizes']).toBeDefined();
    }
  });

  it('should reject children sizes when age group is adult', async () => {
    const req = { ...validRequest(), ageGroup: 'adult' as const, sizes: ['2T'] as never };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['sizes']).toBeDefined();
    }
  });

  it('should reject customization notes exceeding 1000 characters', async () => {
    const req = { ...validRequest(), customizationNotes: 'N'.repeat(1001) };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['customizationNotes']).toBeDefined();
    }
  });

  it('should reject when productId is empty', async () => {
    const req = { ...validRequest(), productId: '' };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.fieldErrors?.['productId']).toBeDefined();
    }
  });

  it('should return multiple field errors at once', async () => {
    const req = {
      ...validRequest(),
      clientName: '',
      email: 'bad',
      phone: '123',
      quantity: -1,
    };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      const errors = result.error.fieldErrors!;
      expect(Object.keys(errors).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('should accept optional customization notes when empty', async () => {
    const req = { ...validRequest(), customizationNotes: undefined };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe('submitQuote - Storage', () => {
  it('should handle DynamoDB storage failure', async () => {
    vi.mocked(createQuote).mockRejectedValue(new Error('DynamoDB write failed'));

    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('storage');
    }
  });

  it('should store quote with status pending and correct DynamoDB keys', async () => {
    await submitQuote(validRequest(), CLIENT_IP);

    expect(createQuote).toHaveBeenCalledTimes(1);
    const storedRecord = vi.mocked(createQuote).mock.calls[0][0] as QuoteRecord;

    expect(storedRecord.PK).toMatch(/^QUOTE#/);
    expect(storedRecord.SK).toBe('METADATA');
    expect(storedRecord.GSI1PK).toBe('QSTATUS#pending');
    expect(storedRecord.GSI1SK).toMatch(/^CREATED#/);
    expect(storedRecord.status).toBe('pending');
    expect(storedRecord.trackingNumber).toMatch(/^CF[A-Z0-9]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// Happy Path
// ---------------------------------------------------------------------------

describe('submitQuote - Happy Path', () => {
  it('should return success with quoteId, trackingNumber, and pending status', async () => {
    const result = await submitQuote(validRequest(), CLIENT_IP);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quoteId).toBeDefined();
      expect(result.data.trackingNumber).toMatch(/^CF[A-Z0-9]{8}$/);
      expect(result.data.status).toBe('pending');
    }
  });

  it('should call verifyCaptcha with token and IP', async () => {
    const req = validRequest();
    await submitQuote(req, CLIENT_IP);

    expect(verifyCaptcha).toHaveBeenCalledWith(req.captchaToken, CLIENT_IP);
  });

  it('should store the correct client data in the quote record', async () => {
    const req = validRequest();
    await submitQuote(req, CLIENT_IP);

    const storedRecord = vi.mocked(createQuote).mock.calls[0][0] as QuoteRecord;
    expect(storedRecord.clientName).toBe(req.clientName);
    expect(storedRecord.email).toBe(req.email);
    expect(storedRecord.phone).toBe(req.phone);
    expect(storedRecord.productId).toBe(req.productId);
    expect(storedRecord.quantity).toBe(req.quantity);
    expect(storedRecord.ageGroup).toBe(req.ageGroup);
    expect(storedRecord.sizes).toEqual(req.sizes);
    expect(storedRecord.customizationNotes).toBe(req.customizationNotes);
  });

  it('should accept children sizes with children age group', async () => {
    const req = {
      ...validRequest(),
      ageGroup: 'children' as const,
      sizes: ['4T', '6', '8'] as never,
    };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(true);
  });

  it('should accept minimum valid values (name=1 char, quantity=1)', async () => {
    const req = {
      ...validRequest(),
      clientName: 'A',
      quantity: 1,
      sizes: ['M'] as never,
    };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(true);
  });

  it('should accept maximum valid values (name=100 chars, quantity=10000, notes=1000 chars)', async () => {
    const req = {
      ...validRequest(),
      clientName: 'A'.repeat(100),
      quantity: 10000,
      customizationNotes: 'N'.repeat(1000),
    };
    const result = await submitQuote(req, CLIENT_IP);

    expect(result.success).toBe(true);
  });

  it('should verify CAPTCHA before checking rate limit', async () => {
    vi.mocked(verifyCaptcha).mockResolvedValue({ valid: false, error: 'invalid_token' });

    await submitQuote(validRequest(), CLIENT_IP);

    expect(verifyCaptcha).toHaveBeenCalledTimes(1);
    expect(checkPublicRateLimit).not.toHaveBeenCalled();
  });

  it('should not store quote if validation fails', async () => {
    const req = { ...validRequest(), email: 'invalid' };
    await submitQuote(req, CLIENT_IP);

    expect(createQuote).not.toHaveBeenCalled();
  });
});
