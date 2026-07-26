/**
 * Unit tests for the quote client response module (src/modules/quote/response.ts).
 *
 * Covers:
 * - Token validation (empty, invalid)
 * - Action validation (must be accept/reject)
 * - Quote not found by token
 * - Status transition enforcement (only 'quoted' → accepted/rejected)
 * - Expired quote handling
 * - Admin notification with exponential backoff (retry logic)
 * - Status update only after successful notification
 * - Conditional write conflict handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

// Mock dependencies before imports
vi.mock('../../../src/db/operations.js', () => ({
  get: vi.fn(),
  update: vi.fn(),
  queryByGSI1: vi.fn(),
}));

import {
  respondToQuote,
  calculateBackoffDelay,
  _internals,
  type QuoteResponseInput,
} from '../../../src/modules/quote/response.js';
import { get, update, queryByGSI1 } from '../../../src/db/operations.js';
import type { QuoteRecord } from '../../../src/db/entities.js';

const sesMock = mockClient(SESClient);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function quotedQuoteRecord(): QuoteRecord {
  return {
    PK: 'QUOTE#quote-001',
    SK: 'METADATA',
    GSI1PK: 'QSTATUS#quoted',
    GSI1SK: 'CREATED#2024-01-15T10:00:00.000Z',
    id: 'quote-001',
    trackingNumber: 'CFABC12345',
    clientName: 'María López',
    email: 'maria@example.com',
    phone: '+573009876543',
    productId: 'prod-001',
    productName: 'Camiseta Deportiva',
    quantity: 100,
    ageGroup: 'adult',
    sizes: ['M', 'L', 'XL'],
    status: 'quoted',
    unitPrice: 25000,
    totalPrice: 2500000,
    currency: 'COP',
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    quoteLinkToken: 'a'.repeat(64),
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-16T10:00:00.000Z',
  };
}

function validAcceptInput(): QuoteResponseInput {
  return {
    token: 'a'.repeat(64),
    action: 'accept',
  };
}

function validRejectInput(): QuoteResponseInput {
  return {
    token: 'a'.repeat(64),
    action: 'reject',
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-msg-id' });

  // Default: quote found via GSI1 query
  vi.mocked(queryByGSI1).mockResolvedValue({
    items: [quotedQuoteRecord()],
    count: 1,
  });
  vi.mocked(update).mockResolvedValue(null);

  // Make sleep instant for tests
  _internals.sleep = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  sesMock.reset();
});

// ---------------------------------------------------------------------------
// Backoff Calculation
// ---------------------------------------------------------------------------

describe('calculateBackoffDelay', () => {
  it('should return 500ms for attempt 0', () => {
    expect(calculateBackoffDelay(0)).toBe(500);
  });

  it('should return 1000ms for attempt 1', () => {
    expect(calculateBackoffDelay(1)).toBe(1000);
  });

  it('should return 2000ms for attempt 2', () => {
    expect(calculateBackoffDelay(2)).toBe(2000);
  });

  it('should return 4000ms for attempt 3', () => {
    expect(calculateBackoffDelay(3)).toBe(4000);
  });

  it('should return 8000ms for attempt 4', () => {
    expect(calculateBackoffDelay(4)).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('respondToQuote - Validation', () => {
  it('should reject empty token', async () => {
    const result = await respondToQuote({ token: '', action: 'accept' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.message).toContain('Token');
    }
  });

  it('should reject whitespace-only token', async () => {
    const result = await respondToQuote({ token: '   ', action: 'accept' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
    }
  });

  it('should reject invalid action', async () => {
    const result = await respondToQuote({ token: 'a'.repeat(64), action: 'cancel' as never });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('validation');
      expect(result.error.message).toContain('accept');
    }
  });
});

// ---------------------------------------------------------------------------
// Quote Not Found
// ---------------------------------------------------------------------------

describe('respondToQuote - Not Found', () => {
  it('should return not_found when no quote matches token', async () => {
    vi.mocked(queryByGSI1).mockResolvedValue({ items: [], count: 0 });

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('not_found');
    }
  });
});

// ---------------------------------------------------------------------------
// Invalid Status
// ---------------------------------------------------------------------------

describe('respondToQuote - Invalid Status', () => {
  it('should reject when quote is already accepted', async () => {
    vi.mocked(queryByGSI1).mockResolvedValue({
      items: [{ ...quotedQuoteRecord(), status: 'accepted' }],
      count: 1,
    });

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_status');
      expect(result.error.message).toContain('aceptada');
    }
  });

  it('should reject when quote is already rejected', async () => {
    vi.mocked(queryByGSI1).mockResolvedValue({
      items: [{ ...quotedQuoteRecord(), status: 'rejected' }],
      count: 1,
    });

    const result = await respondToQuote(validRejectInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_status');
      expect(result.error.message).toContain('rechazada');
    }
  });
});

// ---------------------------------------------------------------------------
// Expired Quote
// ---------------------------------------------------------------------------

describe('respondToQuote - Expired Quote', () => {
  it('should reject when quote validUntil is in the past', async () => {
    const expiredQuote = {
      ...quotedQuoteRecord(),
      validUntil: '2020-01-01T00:00:00.000Z',
    };
    vi.mocked(queryByGSI1).mockResolvedValue({ items: [expiredQuote], count: 1 });

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('expired');
      expect(result.error.message).toContain('expirado');
    }
  });

  it('should accept when quote has no validUntil (no expiry)', async () => {
    const noExpiryQuote = { ...quotedQuoteRecord(), validUntil: undefined };
    vi.mocked(queryByGSI1).mockResolvedValue({ items: [noExpiryQuote], count: 1 });

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin Notification Retry
// ---------------------------------------------------------------------------

describe('respondToQuote - Admin Notification Retry', () => {
  it('should succeed on first notification attempt', async () => {
    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(true);
    // SES called once (success on first try)
    expect(sesMock.calls()).toHaveLength(1);
  });

  it('should retry notification on failure and succeed if subsequent attempt works', async () => {
    // Fail first, succeed second
    sesMock.reset();
    sesMock
      .on(SendEmailCommand)
      .rejectsOnce(new Error('SES throttled'))
      .resolves({ MessageId: 'retry-msg-id' });

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(true);
    expect(sesMock.calls()).toHaveLength(2);
    expect(_internals.sleep).toHaveBeenCalledWith(500); // First backoff delay
  });

  it('should fail when all notification retries are exhausted', async () => {
    sesMock.reset();
    sesMock.on(SendEmailCommand).rejects(new Error('SES permanently down'));

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('notification_failed');
      expect(result.error.message).toContain('notificar');
    }
  });

  it('should NOT update quote status when notification fails', async () => {
    sesMock.reset();
    sesMock.on(SendEmailCommand).rejects(new Error('SES permanently down'));

    await respondToQuote(validAcceptInput());

    // update should never be called because notification must succeed first
    expect(update).not.toHaveBeenCalled();
  });

  it('should use exponential backoff delays between retries', async () => {
    sesMock.reset();
    sesMock.on(SendEmailCommand).rejects(new Error('SES error'));

    await respondToQuote(validAcceptInput());

    // Should have called sleep with exponential delays (0..4 attempts means 5 sleep calls)
    const sleepCalls = vi.mocked(_internals.sleep).mock.calls.map(c => c[0]);
    expect(sleepCalls).toEqual([500, 1000, 2000, 4000, 8000]);
  });
});

// ---------------------------------------------------------------------------
// Status Update After Notification
// ---------------------------------------------------------------------------

describe('respondToQuote - Status Update', () => {
  it('should update status to accepted on accept action', async () => {
    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('accepted');
    }

    expect(update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(update).mock.calls[0];
    expect(updateCall[2].expressionAttributeValues![':status']).toBe('accepted');
    expect(updateCall[2].expressionAttributeValues![':gsi1pk']).toBe('QSTATUS#accepted');
  });

  it('should update status to rejected on reject action', async () => {
    const result = await respondToQuote(validRejectInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('rejected');
    }

    const updateCall = vi.mocked(update).mock.calls[0];
    expect(updateCall[2].expressionAttributeValues![':status']).toBe('rejected');
    expect(updateCall[2].expressionAttributeValues![':gsi1pk']).toBe('QSTATUS#rejected');
  });

  it('should use conditional write expecting quoted status', async () => {
    await respondToQuote(validAcceptInput());

    const options = vi.mocked(update).mock.calls[0][2];
    expect(options.conditionExpression).toContain(':expectedStatus');
    expect(options.expressionAttributeValues![':expectedStatus']).toBe('quoted');
  });

  it('should handle ConditionalCheckFailed (duplicate response)', async () => {
    vi.mocked(update).mockRejectedValue(new Error('ConditionalCheckFailed'));

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid_status');
      expect(result.error.message).toContain('duplicada');
    }
  });

  it('should handle generic storage error on update', async () => {
    vi.mocked(update).mockRejectedValue(new Error('DynamoDB internal error'));

    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('internal');
    }
  });
});

// ---------------------------------------------------------------------------
// Happy Path
// ---------------------------------------------------------------------------

describe('respondToQuote - Happy Path', () => {
  it('should return success with quoteId and accepted status', async () => {
    const result = await respondToQuote(validAcceptInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quoteId).toBe('quote-001');
      expect(result.data.status).toBe('accepted');
    }
  });

  it('should return success with quoteId and rejected status', async () => {
    const result = await respondToQuote(validRejectInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.quoteId).toBe('quote-001');
      expect(result.data.status).toBe('rejected');
    }
  });

  it('should send admin notification before updating status', async () => {
    const callOrder: string[] = [];

    sesMock.reset();
    sesMock.on(SendEmailCommand).callsFake(() => {
      callOrder.push('ses');
      return { MessageId: 'msg-1' };
    });

    vi.mocked(update).mockImplementation(async () => {
      callOrder.push('update');
      return null;
    });

    await respondToQuote(validAcceptInput());

    expect(callOrder).toEqual(['ses', 'update']);
  });
});
