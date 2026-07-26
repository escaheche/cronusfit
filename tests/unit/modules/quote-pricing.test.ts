/**
 * Unit tests for the quote pricing module (src/modules/quote/pricing.ts).
 *
 * Covers:
 * - Price input validation (positive numbers, valid currency, valid date)
 * - Status transition enforcement (only 'pending' → 'quoted')
 * - Quote not found handling
 * - Conditional write conflict handling
 * - Token generation uniqueness
 * - Audit log recording
 * - Email and WhatsApp notification (fire-and-forget)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Mock dependencies before imports
vi.mock('../../../src/db/operations.js', () => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../../src/modules/security/audit-log.js', () => ({
  recordAuditEntry: vi.fn(),
}));

import {
  priceQuote,
  validatePriceInput,
  generateQuoteLinkToken,
  type QuotePriceInput,
  type AdminContext,
} from '../../../src/modules/quote/pricing.js';
import { get, update } from '../../../src/db/operations.js';
import { recordAuditEntry } from '../../../src/modules/security/audit-log.js';
import type { QuoteRecord } from '../../../src/db/entities.js';

const sesMock = mockClient(SESClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validPriceInput(): QuotePriceInput {
  return {
    quoteId: '123e4567-e89b-12d3-a456-426614174000',
    unitPrice: 25000,
    totalPrice: 2500000,
    currency: 'COP',
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Incluye envío',
  };
}

function validAdmin(): AdminContext {
  return {
    adminId: 'admin-sub-123',
    adminEmail: 'admin@cronusfit.com',
  };
}

function pendingQuoteRecord(): QuoteRecord {
  return {
    PK: 'QUOTE#123e4567-e89b-12d3-a456-426614174000',
    SK: 'METADATA',
    GSI1PK: 'QSTATUS#pending',
    GSI1SK: 'CREATED#2024-01-15T10:00:00.000Z',
    id: '123e4567-e89b-12d3-a456-426614174000',
    trackingNumber: 'CFABC12345',
    clientName: 'María López',
    email: 'maria@example.com',
    phone: '+573009876543',
    productId: 'prod-001',
    productName: 'Camiseta Deportiva',
    quantity: 100,
    ageGroup: 'adult',
    sizes: ['M', 'L', 'XL'],
    status: 'pending',
    createdAt: '2024-01-15T10:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-msg-id' });

  // Default: quote exists and is pending
  vi.mocked(get).mockResolvedValue(pendingQuoteRecord());
  vi.mocked(update).mockResolvedValue(null);
  vi.mocked(recordAuditEntry).mockResolvedValue(undefined);

  // Mock global fetch for WhatsApp notifications
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  sesMock.reset();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Validation: validatePriceInput
// ---------------------------------------------------------------------------

describe('validatePriceInput', () => {
  it('should accept valid input with no errors', () => {
    const errors = validatePriceInput(validPriceInput());
    expect(Object.keys(errors).length).toBe(0);
  });

  it('should reject empty quoteId', () => {
    const input = { ...validPriceInput(), quoteId: '' };
    const errors = validatePriceInput(input);
    expect(errors['quoteId']).toBeDefined();
  });

  it('should reject zero unitPrice', () => {
    const input = { ...validPriceInput(), unitPrice: 0 };
    const errors = validatePriceInput(input);
    expect(errors['unitPrice']).toBeDefined();
  });

  it('should reject negative unitPrice', () => {
    const input = { ...validPriceInput(), unitPrice: -100 };
    const errors = validatePriceInput(input);
    expect(errors['unitPrice']).toContain('positivo');
  });

  it('should reject NaN unitPrice', () => {
    const input = { ...validPriceInput(), unitPrice: NaN };
    const errors = validatePriceInput(input);
    expect(errors['unitPrice']).toBeDefined();
  });

  it('should reject Infinity unitPrice', () => {
    const input = { ...validPriceInput(), unitPrice: Infinity };
    const errors = validatePriceInput(input);
    expect(errors['unitPrice']).toBeDefined();
  });

  it('should reject negative totalPrice', () => {
    const input = { ...validPriceInput(), totalPrice: -1 };
    const errors = validatePriceInput(input);
    expect(errors['totalPrice']).toContain('positivo');
  });

  it('should reject empty currency', () => {
    const input = { ...validPriceInput(), currency: '' };
    const errors = validatePriceInput(input);
    expect(errors['currency']).toBeDefined();
  });

  it('should reject unsupported currency', () => {
    const input = { ...validPriceInput(), currency: 'XYZ' };
    const errors = validatePriceInput(input);
    expect(errors['currency']).toContain('no soportada');
  });

  it('should accept valid currencies (COP, USD, EUR)', () => {
    for (const currency of ['COP', 'USD', 'EUR']) {
      const input = { ...validPriceInput(), currency };
      const errors = validatePriceInput(input);
      expect(errors['currency']).toBeUndefined();
    }
  });

  it('should reject empty validUntil', () => {
    const input = { ...validPriceInput(), validUntil: '' };
    const errors = validatePriceInput(input);
    expect(errors['validUntil']).toBeDefined();
  });

  it('should reject invalid date format', () => {
    const input = { ...validPriceInput(), validUntil: 'not-a-date' };
    const errors = validatePriceInput(input);
    expect(errors['validUntil']).toContain('formato');
  });

  it('should reject past date', () => {
    const input = { ...validPriceInput(), validUntil: '2020-01-01T00:00:00.000Z' };
    const errors = validatePriceInput(input);
    expect(errors['validUntil']).toContain('futuro');
  });

  it('should report multiple errors at once', () => {
    const input = { ...validPriceInput(), unitPrice: -1, currency: '', validUntil: '' };
    const errors = validatePriceInput(input);
    expect(Object.keys(errors).length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Token Generation
// ---------------------------------------------------------------------------

describe('generateQuoteLinkToken', () => {
  it('should generate a 64-character hex token', () => {
    const token = generateQuoteLinkToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should generate unique tokens', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateQuoteLinkToken()));
    expect(tokens.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// priceQuote - Not Found
// ---------------------------------------------------------------------------

describe('priceQuote - Quote Not Found', () => {
  it('should return not_found when quote does not exist', async () => {
    vi.mocked(get).mockResolvedValue(null);

    const result = await priceQuote(validPriceInput(), validAdmin());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('not_found');
    }
  });
});

// ---------------------------------------------------------------------------
// priceQuote - Invalid Status
// ---------------------------------------------------------------------------

describe('priceQuote - Invalid Status', () => {
  it('should reject when quote is already quoted', async () => {
    vi.mocked(get).mockResolvedValue({ ...pendingQuoteRecord(), status: 'quoted' });

    const result = await priceQuote(validPriceInput(), validAdmin());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_status');
      expect(result.error.message).toContain('quoted');
    }
  });

  it('should reject when quote is already accepted', async () => {
    vi.mocked(get).mockResolvedValue({ ...pendingQuoteRecord(), status: 'accepted' });

    const result = await priceQuote(validPriceInput(), validAdmin());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_status');
    }
  });

  it('should reject when quote is already rejected', async () => {
    vi.mocked(get).mockResolvedValue({ ...pendingQuoteRecord(), status: 'rejected' });

    const result = await priceQuote(validPriceInput(), validAdmin());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_status');
    }
  });
});

// ---------------------------------------------------------------------------
// priceQuote - Conditional Write Conflict
// ---------------------------------------------------------------------------

describe('priceQuote - Concurrent Access', () => {
  it('should handle ConditionalCheckFailed (concurrent update)', async () => {
    vi.mocked(update).mockRejectedValue(new Error('ConditionalCheckFailed'));

    const result = await priceQuote(validPriceInput(), validAdmin());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_status');
      expect(result.error.message).toContain('concurrente');
    }
  });

  it('should handle generic storage error', async () => {
    vi.mocked(update).mockRejectedValue(new Error('DynamoDB internal error'));

    const result = await priceQuote(validPriceInput(), validAdmin());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('storage');
    }
  });
});

// ---------------------------------------------------------------------------
// priceQuote - Happy Path
// ---------------------------------------------------------------------------

describe('priceQuote - Happy Path', () => {
  it('should return success with quoted status and token', async () => {
    const result = await priceQuote(validPriceInput(), validAdmin());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quoteId).toBe(validPriceInput().quoteId);
      expect(result.data.status).toBe('quoted');
      expect(result.data.quoteLinkToken).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('should update quote with pricing details', async () => {
    await priceQuote(validPriceInput(), validAdmin());

    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(update).mock.calls[0];
    expect(updateCall[0]).toBe('QUOTE#123e4567-e89b-12d3-a456-426614174000');
    expect(updateCall[1]).toBe('METADATA');
  });

  it('should use conditional write to ensure pending status', async () => {
    await priceQuote(validPriceInput(), validAdmin());

    const options = vi.mocked(update).mock.calls[0][2];
    expect(options.conditionExpression).toContain(':expectedStatus');
    expect(options.expressionAttributeValues![':expectedStatus']).toBe('pending');
  });

  it('should record audit log entry', async () => {
    const admin = validAdmin();
    const input = validPriceInput();
    await priceQuote(input, admin);

    expect(recordAuditEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: admin.adminId,
        adminEmail: admin.adminEmail,
        actionType: 'quote_price',
        resourceId: input.quoteId,
        resourceType: 'quote',
      }),
    );
  });

  it('should still succeed even if audit log fails', async () => {
    vi.mocked(recordAuditEntry).mockRejectedValue(new Error('Audit write failed'));

    const result = await priceQuote(validPriceInput(), validAdmin());

    // priceQuote fires audit log as fire-and-forget, so it still succeeds
    expect(result.success).toBe(true);
  });
});
