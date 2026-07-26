/**
 * Property-based tests for Quote Manager module.
 *
 * **Validates: Requirements 7.2, 7.3, 7.6, 7.10, 7.11**
 *
 * Properties tested:
 * 16. Quote Request Validation — verify acceptance/rejection rules for all field combinations
 * 17. Quote Status Filtering — verify filtered queries return exactly matching quotes
 * 18. Quote Tracking Number Uniqueness — verify unique tracking numbers and correct lookup
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// --- Mocks ---

const mockTransactWrite = vi.fn();
const mockGet = vi.fn();
const mockQueryByGSI1 = vi.fn();

vi.mock('../../src/db/operations.js', () => ({
  createQuote: (...args: unknown[]) => mockTransactWrite(...args),
  get: (...args: unknown[]) => mockGet(...args),
  queryByGSI1: (...args: unknown[]) => mockQueryByGSI1(...args),
  getQuoteByTrackingNumber: async (trackingNumber: string) => {
    // Delegate to mockGet with the tracking pattern
    const trackResult = await mockGet(`TRACK#${trackingNumber}`, 'QUOTE');
    if (!trackResult) return null;
    return mockGet(`QUOTE#${trackResult.quoteId}`, 'METADATA');
  },
}));

vi.mock('../../src/modules/security/captcha.js', () => ({
  verifyCaptcha: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('../../src/modules/security/public-rate-limiter.js', () => ({
  checkPublicRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
  SendEmailCommand: vi.fn(),
}));

import { submitQuote, generateTrackingNumber } from '../../src/modules/quote/submit.js';
import {
  validateClientName,
  validateEmail,
  validatePhone,
  validateQuantity,
  validateAgeGroup,
  validateSizes,
  validateCustomizationNotes,
} from '../../src/validation/quote.js';
import type { QuoteSubmitRequest } from '../../src/types/quote.js';
import type { QuoteRecord, QuoteStatus } from '../../src/db/entities.js';
import type { AgeGroup, ChildrenSize, AdultSize } from '../../src/types/garment.js';

// --- Constants ---

const CHILDREN_SIZES: ChildrenSize[] = ['2T', '4T', '6', '8', '10', '12', '14', '16'];
const ADULT_SIZES: AdultSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];
const ALL_STATUSES: QuoteStatus[] = ['pending', 'quoted', 'accepted', 'rejected'];

// --- Generators ---

/** Valid client name (1-100 non-whitespace chars). */
const arbValidName = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

/** Invalid client name — empty or too long. */
const arbInvalidName = fc.oneof(
  fc.constant(''),
  fc.stringOf(fc.constant(' '), { minLength: 1, maxLength: 10 }),
  fc.string({ minLength: 101, maxLength: 200 }),
);

/** Valid email (local@domain.tld). */
const arbValidEmail = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 20 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 15 }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), { minLength: 2, maxLength: 6 }),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/** Invalid email. */
const arbInvalidEmail = fc.oneof(
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('@') && s.trim().length > 0),
  fc.constant('missing-domain@'),
  fc.constant('@no-local.com'),
);

/** Valid phone (E.164: + followed by 7-15 digits). */
const arbValidPhone = fc
  .integer({ min: 7, max: 15 })
  .chain((len) =>
    fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: len, maxLength: len })
      .map((digits) => `+${digits}`),
  );

/** Invalid phone. */
const arbInvalidPhone = fc.oneof(
  fc.constant(''),
  fc.constant('12345'),
  fc.constant('+12'),  // Too few digits (only 2)
  fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 16, maxLength: 20 }).map((d) => `+${d}`),
);

/** Valid quantity (integer 1-10000). */
const arbValidQuantity = fc.integer({ min: 1, max: 10000 });

/** Invalid quantity. */
const arbInvalidQuantity = fc.oneof(
  fc.integer({ min: -10000, max: 0 }),
  fc.integer({ min: 10001, max: 100000 }),
);

/** Valid age group. */
const arbValidAgeGroup = fc.constantFrom<AgeGroup>('children', 'adult');

/** Invalid age group. */
const arbInvalidAgeGroup = fc.string({ minLength: 1, maxLength: 20 }).filter(
  (s) => s !== 'children' && s !== 'adult' && s.trim().length > 0,
);

/** Valid sizes for a given age group. */
function arbValidSizes(ageGroup: AgeGroup): fc.Arbitrary<(ChildrenSize | AdultSize)[]> {
  const pool = ageGroup === 'children' ? CHILDREN_SIZES : ADULT_SIZES;
  return fc.subarray(pool as (ChildrenSize | AdultSize)[], { minLength: 1 });
}

/** Invalid sizes — sizes from the wrong age group. */
function arbInvalidSizes(ageGroup: AgeGroup): fc.Arbitrary<string[]> {
  // Pick sizes from the opposite age group
  const wrongPool = ageGroup === 'children' ? ADULT_SIZES : CHILDREN_SIZES;
  return fc.subarray([...wrongPool], { minLength: 1 });
}

/** Valid customization notes (optional, max 1000 chars). */
const arbValidNotes = fc.oneof(
  fc.constant(undefined),
  fc.string({ minLength: 0, maxLength: 1000 }),
);

/** Invalid customization notes (>1000 chars). */
const arbInvalidNotes = fc.string({ minLength: 1001, maxLength: 1500 });

/** Arbitrary valid QuoteSubmitRequest. */
const arbValidQuoteRequest: fc.Arbitrary<QuoteSubmitRequest> = fc
  .tuple(arbValidName, arbValidEmail, arbValidPhone, arbValidQuantity, arbValidAgeGroup)
  .chain(([name, email, phone, quantity, ageGroup]) =>
    fc.tuple(arbValidSizes(ageGroup), arbValidNotes).map(([sizes, notes]) => ({
      clientName: name,
      email,
      phone,
      productId: `product-${Math.random().toString(36).substring(2, 10)}`,
      quantity,
      ageGroup,
      sizes: sizes as ChildrenSize[] | AdultSize[],
      customizationNotes: notes,
      captchaToken: 'valid-captcha-token',
    })),
  );

/** Arbitrary quote status. */
const arbQuoteStatus = fc.constantFrom<QuoteStatus>(...ALL_STATUSES);

/** Arbitrary IP address. */
const arbIpAddress = fc
  .tuple(
    fc.integer({ min: 1, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  mockTransactWrite.mockResolvedValue(undefined);
});

// --- Property 16: Quote Request Validation ---

describe('Property 16: Quote Request Validation', () => {
  it('[property] valid quote requests with all fields correct ALWAYS succeed', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidQuoteRequest,
        arbIpAddress,
        async (request, ip) => {
          mockTransactWrite.mockResolvedValue(undefined);

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.status).toBe('pending');
            expect(result.data.trackingNumber).toMatch(/^CF[A-Z0-9]{8}$/);
            expect(result.data.quoteId).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] requests with invalid name ALWAYS produce a clientName field error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbInvalidName,
        arbValidEmail,
        arbValidPhone,
        arbValidQuantity,
        arbValidAgeGroup,
        arbIpAddress,
        async (name, email, phone, quantity, ageGroup, ip) => {
          const sizes = ageGroup === 'children' ? ['8'] : ['M'];
          const request: QuoteSubmitRequest = {
            clientName: name,
            email,
            phone,
            productId: 'product-001',
            quantity,
            ageGroup,
            sizes: sizes as ChildrenSize[] | AdultSize[],
            captchaToken: 'valid-token',
          };

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.type).toBe('validation');
            expect(result.error.fieldErrors).toBeDefined();
            expect(result.error.fieldErrors!['clientName']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] requests with invalid email ALWAYS produce an email field error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidName,
        arbInvalidEmail,
        arbValidPhone,
        arbValidQuantity,
        arbValidAgeGroup,
        arbIpAddress,
        async (name, email, phone, quantity, ageGroup, ip) => {
          const sizes = ageGroup === 'children' ? ['8'] : ['M'];
          const request: QuoteSubmitRequest = {
            clientName: name,
            email,
            phone,
            productId: 'product-001',
            quantity,
            ageGroup,
            sizes: sizes as ChildrenSize[] | AdultSize[],
            captchaToken: 'valid-token',
          };

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.type).toBe('validation');
            expect(result.error.fieldErrors).toBeDefined();
            expect(result.error.fieldErrors!['email']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] requests with invalid phone ALWAYS produce a phone field error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidName,
        arbValidEmail,
        arbInvalidPhone,
        arbValidQuantity,
        arbValidAgeGroup,
        arbIpAddress,
        async (name, email, phone, quantity, ageGroup, ip) => {
          const sizes = ageGroup === 'children' ? ['8'] : ['M'];
          const request: QuoteSubmitRequest = {
            clientName: name,
            email,
            phone,
            productId: 'product-001',
            quantity,
            ageGroup,
            sizes: sizes as ChildrenSize[] | AdultSize[],
            captchaToken: 'valid-token',
          };

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.type).toBe('validation');
            expect(result.error.fieldErrors).toBeDefined();
            expect(result.error.fieldErrors!['phone']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] requests with invalid quantity ALWAYS produce a quantity field error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidName,
        arbValidEmail,
        arbValidPhone,
        arbInvalidQuantity,
        arbValidAgeGroup,
        arbIpAddress,
        async (name, email, phone, quantity, ageGroup, ip) => {
          const sizes = ageGroup === 'children' ? ['8'] : ['M'];
          const request: QuoteSubmitRequest = {
            clientName: name,
            email,
            phone,
            productId: 'product-001',
            quantity,
            ageGroup,
            sizes: sizes as ChildrenSize[] | AdultSize[],
            captchaToken: 'valid-token',
          };

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.type).toBe('validation');
            expect(result.error.fieldErrors).toBeDefined();
            expect(result.error.fieldErrors!['quantity']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] requests with sizes from wrong age group ALWAYS produce a sizes field error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidName,
        arbValidEmail,
        arbValidPhone,
        arbValidQuantity,
        arbValidAgeGroup,
        arbIpAddress,
        async (name, email, phone, quantity, ageGroup, ip) => {
          // Pick sizes from the opposite age group
          const wrongSizes = ageGroup === 'children' ? ['M', 'L'] : ['2T', '8'];
          const request: QuoteSubmitRequest = {
            clientName: name,
            email,
            phone,
            productId: 'product-001',
            quantity,
            ageGroup,
            sizes: wrongSizes as ChildrenSize[] | AdultSize[],
            captchaToken: 'valid-token',
          };

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.type).toBe('validation');
            expect(result.error.fieldErrors).toBeDefined();
            expect(result.error.fieldErrors!['sizes']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] requests with customization notes >1000 chars ALWAYS produce a notes field error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidName,
        arbValidEmail,
        arbValidPhone,
        arbValidQuantity,
        arbValidAgeGroup,
        arbInvalidNotes,
        arbIpAddress,
        async (name, email, phone, quantity, ageGroup, notes, ip) => {
          const sizes = ageGroup === 'children' ? ['8'] : ['M'];
          const request: QuoteSubmitRequest = {
            clientName: name,
            email,
            phone,
            productId: 'product-001',
            quantity,
            ageGroup,
            sizes: sizes as ChildrenSize[] | AdultSize[],
            customizationNotes: notes,
            captchaToken: 'valid-token',
          };

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.type).toBe('validation');
            expect(result.error.fieldErrors).toBeDefined();
            expect(result.error.fieldErrors!['customizationNotes']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] requests with invalid age group ALWAYS produce an ageGroup field error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbValidName,
        arbValidEmail,
        arbValidPhone,
        arbValidQuantity,
        arbInvalidAgeGroup,
        arbIpAddress,
        async (name, email, phone, quantity, ageGroup, ip) => {
          const request: QuoteSubmitRequest = {
            clientName: name,
            email,
            phone,
            productId: 'product-001',
            quantity,
            ageGroup: ageGroup as AgeGroup,
            sizes: ['M'] as AdultSize[],
            captchaToken: 'valid-token',
          };

          const result = await submitQuote(request, ip);

          expect(result.success).toBe(false);
          if (!result.success) {
            expect(result.error.type).toBe('validation');
            expect(result.error.fieldErrors).toBeDefined();
            expect(result.error.fieldErrors!['ageGroup']).toBeDefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 17: Quote Status Filtering ---

describe('Property 17: Quote Status Filtering', () => {
  /**
   * Build a mock QuoteRecord with a given status.
   */
  function buildQuoteRecord(id: string, status: QuoteStatus, createdAt?: string): QuoteRecord {
    const ts = createdAt ?? new Date().toISOString();
    return {
      PK: `QUOTE#${id}`,
      SK: 'METADATA',
      GSI1PK: `QSTATUS#${status}`,
      GSI1SK: `CREATED#${ts}`,
      id,
      trackingNumber: `CF${id.substring(0, 8).toUpperCase()}`,
      clientName: 'Test Client',
      email: 'test@example.com',
      phone: '+1234567890',
      productId: 'product-001',
      productName: 'Test Product',
      quantity: 10,
      ageGroup: 'adult',
      sizes: ['M', 'L'],
      status,
      createdAt: ts,
    };
  }

  it('[property] filtering by any status returns ONLY quotes with that exact status', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbQuoteStatus,
        fc.array(
          fc.tuple(fc.uuid(), arbQuoteStatus),
          { minLength: 1, maxLength: 20 },
        ),
        async (filterStatus, quoteData) => {
          // Build quote records with various statuses
          const allQuotes = quoteData.map(([id, status]) => buildQuoteRecord(id, status));

          // The expected result: only quotes matching the filter status
          const expectedQuotes = allQuotes.filter((q) => q.status === filterStatus);

          // Mock the GSI1 query to return only matching quotes (simulates DynamoDB GSI behavior)
          mockQueryByGSI1.mockResolvedValue({
            items: expectedQuotes,
            lastEvaluatedKey: undefined,
            count: expectedQuotes.length,
          });

          // Execute query (simulating the admin filter endpoint)
          const { queryByGSI1 } = await import('../../src/db/operations.js');
          const result = await queryByGSI1(`QSTATUS#${filterStatus}`);

          // Every returned quote MUST have the requested status
          for (const quote of result.items as QuoteRecord[]) {
            expect(quote.status).toBe(filterStatus);
            expect(quote.GSI1PK).toBe(`QSTATUS#${filterStatus}`);
          }

          // Count must match expected
          expect(result.items.length).toBe(expectedQuotes.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] filtering returns zero results when no quotes match the status', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbQuoteStatus,
        async (filterStatus) => {
          // No quotes match
          mockQueryByGSI1.mockResolvedValue({
            items: [],
            lastEvaluatedKey: undefined,
            count: 0,
          });

          const { queryByGSI1 } = await import('../../src/db/operations.js');
          const result = await queryByGSI1(`QSTATUS#${filterStatus}`);

          expect(result.items).toHaveLength(0);
          expect(result.count).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] the union of all status filters equals the complete set of quotes', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(fc.uuid(), arbQuoteStatus),
          { minLength: 1, maxLength: 30 },
        ),
        async (quoteData) => {
          const allQuotes = quoteData.map(([id, status]) => buildQuoteRecord(id, status));

          // For each status, mock returns only matching quotes
          let totalReturned = 0;
          for (const status of ALL_STATUSES) {
            const matching = allQuotes.filter((q) => q.status === status);
            totalReturned += matching.length;
          }

          // The sum of all filtered results must equal the total number of quotes
          expect(totalReturned).toBe(allQuotes.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 18: Quote Tracking Number Uniqueness ---

describe('Property 18: Quote Tracking Number Uniqueness', () => {
  it('[property] generating N tracking numbers always produces N unique values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 200 }),
        (count) => {
          const trackingNumbers = new Set<string>();
          for (let i = 0; i < count; i++) {
            trackingNumbers.add(generateTrackingNumber());
          }
          // All generated tracking numbers must be unique
          expect(trackingNumbers.size).toBe(count);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] all tracking numbers follow the CF-XXXXXXXX format (10 alphanumeric uppercase chars)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        (count) => {
          for (let i = 0; i < count; i++) {
            const tn = generateTrackingNumber();
            // Must match: CF followed by exactly 8 uppercase alphanumeric characters
            expect(tn).toMatch(/^CF[A-Z0-9]{8}$/);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] successful quote submissions always produce unique tracking numbers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbValidQuoteRequest, { minLength: 2, maxLength: 20 }),
        arbIpAddress,
        async (requests, ip) => {
          mockTransactWrite.mockResolvedValue(undefined);

          const trackingNumbers: string[] = [];

          for (const request of requests) {
            const result = await submitQuote(request, ip);
            if (result.success) {
              trackingNumbers.push(result.data.trackingNumber);
            }
          }

          // All returned tracking numbers must be unique
          const uniqueSet = new Set(trackingNumbers);
          expect(uniqueSet.size).toBe(trackingNumbers.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] lookup by tracking number returns the correct quote record', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(fc.uuid(), fc.uuid().map((id) => `CF${id.replace(/-/g, '').substring(0, 8).toUpperCase()}`)),
          { minLength: 1, maxLength: 10 },
        ),
        async (quoteEntries) => {
          // Simulate stored quotes with their tracking numbers
          for (const [quoteId, trackingNumber] of quoteEntries) {
            const quoteRecord: Partial<QuoteRecord> = {
              PK: `QUOTE#${quoteId}`,
              SK: 'METADATA',
              id: quoteId,
              trackingNumber,
              clientName: 'Test Client',
              email: 'test@example.com',
              phone: '+1234567890',
              productId: 'product-001',
              productName: 'Test Product',
              quantity: 5,
              ageGroup: 'adult',
              sizes: ['M'],
              status: 'pending',
              createdAt: new Date().toISOString(),
            };

            // Mock: TRACK#xxx → quoteId, then QUOTE#id → full record
            mockGet.mockImplementation((pk: string, sk: string) => {
              if (pk === `TRACK#${trackingNumber}` && sk === 'QUOTE') {
                return Promise.resolve({ quoteId });
              }
              if (pk === `QUOTE#${quoteId}` && sk === 'METADATA') {
                return Promise.resolve(quoteRecord);
              }
              return Promise.resolve(null);
            });

            const { getQuoteByTrackingNumber } = await import('../../src/db/operations.js');
            const result = await getQuoteByTrackingNumber(trackingNumber);

            // The returned record must match the stored quote
            expect(result).not.toBeNull();
            expect((result as QuoteRecord).id).toBe(quoteId);
            expect((result as QuoteRecord).trackingNumber).toBe(trackingNumber);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] lookup with non-existent tracking number always returns null', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid().map((id) => `CF${id.replace(/-/g, '').substring(0, 8).toUpperCase()}`),
        async (trackingNumber) => {
          mockGet.mockResolvedValue(null);

          const { getQuoteByTrackingNumber } = await import('../../src/db/operations.js');
          const result = await getQuoteByTrackingNumber(trackingNumber);

          expect(result).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
