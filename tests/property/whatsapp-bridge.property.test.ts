/**
 * Property-based tests for WhatsApp Bridge module.
 *
 * **Validates: Requirements 12.3, 12.6, 12.9, 12.10, 12.11**
 *
 * Properties tested:
 * 23. WhatsApp Message Button Logic — verify buttons present only for approval shares, not info-only
 * 24. WhatsApp Quote Message Completeness — verify message contains product name, price, quantity, AgeGroup, sizes, buttons
 * 25. WhatsApp Webhook Authentication — verify acceptance only with valid shared secret
 * 26. WhatsApp Retry with Exponential Backoff — verify 3 retries at 30s/60s/120s, then queue + email fallback
 * 27. WhatsApp Delivery Log Completeness — verify log entry for every message with all required fields
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';

// --- Mocks ---

vi.mock('../../src/db/operations.js', () => ({
  put: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/modules/security/secrets.js', () => ({
  getCredentials: vi.fn().mockResolvedValue({
    wahaApiKey: 'test-api-key',
    wahaWebhookSecret: 'test-webhook-secret',
    n8nWebhookUrl: 'https://n8n.example.com/webhook/whatsapp',
    hcaptchaSecret: 'test-hcaptcha-secret',
  }),
}));

import {
  buildMockupPayload,
  buildQuotePayload,
  sendWhatsAppMessage,
  RETRY_INTERVALS_MS,
  MAX_RETRIES,
} from '../../src/modules/whatsapp/send-service.js';
import type {
  SendServiceDeps,
  WebhookResponse,
  N8nWebhookPayload,
} from '../../src/modules/whatsapp/send-service.js';
import {
  authenticateWebhook,
  processWebhook,
} from '../../src/modules/whatsapp/webhook-receiver.js';
import {
  logDelivery,
  validateDeliveryLogInput,
} from '../../src/modules/whatsapp/delivery-log.js';
import type { DeliveryLogInput, DeliveryLogRecord } from '../../src/modules/whatsapp/delivery-log.js';
import type {
  WhatsAppSendRequest,
  MockupSharePayload,
  QuoteSharePayload,
  WhatsAppResponseWebhook,
} from '../../src/types/whatsapp.js';
import type { AgeGroup } from '../../src/types/garment.js';

// --- Constants ---

const CHILDREN_SIZES = ['2T', '4T', '6', '8', '10', '12', '14', '16'] as const;
const ADULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'] as const;

// --- Generators ---

/** Valid E.164 phone number. */
const arbPhone = fc
  .integer({ min: 7, max: 15 })
  .chain((len) =>
    fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: len, maxLength: len })
      .map((digits) => `+${digits}`),
  );

/** Valid product name (non-empty). */
const arbProductName = fc.string({ minLength: 1, maxLength: 80 }).filter((s) => s.trim().length > 0);

/** Valid mockup ID. */
const arbMockupId = fc.uuid();

/** Valid quote ID. */
const arbQuoteId = fc.uuid();

/** Valid URL string. */
const arbUrl = fc
  .tuple(
    fc.constantFrom('https://s3.amazonaws.com/', 'https://cdn.example.com/'),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 5, maxLength: 30 }),
  )
  .map(([base, path]) => `${base}${path}.png`);

/** Valid age group. */
const arbAgeGroup = fc.constantFrom<AgeGroup>('children', 'adult');

/** Valid sizes for a given age group. */
function arbSizes(ageGroup: AgeGroup): fc.Arbitrary<string[]> {
  const pool = ageGroup === 'children' ? [...CHILDREN_SIZES] : [...ADULT_SIZES];
  return fc.subarray(pool, { minLength: 1 });
}

/** Valid price string. */
const arbPrice = fc
  .tuple(fc.constantFrom('$', 'COP '), fc.integer({ min: 1000, max: 9999999 }))
  .map(([prefix, amount]) => `${prefix}${amount.toLocaleString()}`);

/** Valid quantity. */
const arbQuantity = fc.integer({ min: 1, max: 10000 });

/** Boolean for includeButtons. */
const arbIncludeButtons = fc.boolean();

/** Valid MockupSharePayload. */
const arbMockupPayload: fc.Arbitrary<MockupSharePayload> = fc.record({
  mockupId: arbMockupId,
  frontImageUrl: arbUrl,
  backImageUrl: arbUrl,
  productName: arbProductName,
  includeButtons: arbIncludeButtons,
});

/** Valid QuoteSharePayload. */
const arbQuotePayload: fc.Arbitrary<QuoteSharePayload> = arbAgeGroup.chain((ageGroup) =>
  fc.record({
    quoteId: arbQuoteId,
    productName: arbProductName,
    price: arbPrice,
    quantity: arbQuantity,
    ageGroup: fc.constant(ageGroup),
    sizes: arbSizes(ageGroup),
  }),
);

/** Valid shared secret token (non-empty string). */
const arbSecret = fc.string({ minLength: 8, maxLength: 64 }).filter((s) => s.trim().length > 0);

/** Arbitrary delivery log message type. */
const arbMessageType = fc.constantFrom<'mockup' | 'quote'>('mockup', 'quote');

/** Arbitrary delivery status. */
const arbDeliveryStatus = fc.constantFrom<'sent' | 'delivered' | 'read' | 'failed'>('sent', 'delivered', 'read', 'failed');

/** Arbitrary webhook response type. */
const arbWebhookResponse = fc.constantFrom<WhatsAppResponseWebhook['response']>(
  'approve', 'reject', 'accept_quote', 'reject_quote'
);

// --- Setup ---

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Property 23: WhatsApp Message Button Logic ---

describe('Property 23: WhatsApp Message Button Logic', () => {
  it('[property] mockup messages with includeButtons=true ALWAYS have approval buttons', () => {
    fc.assert(
      fc.property(
        arbMockupPayload.filter((p) => p.includeButtons === true),
        (payload) => {
          const result = buildMockupPayload(payload);

          expect(result.buttons).toBeDefined();
          expect(result.buttons).toHaveLength(2);
          expect(result.buttons![0].title).toBe('Aprobar ✓');
          expect(result.buttons![1].title).toBe('Rechazar ✗');
          expect(result.buttons![0].id).toBe('approve_mockup');
          expect(result.buttons![1].id).toBe('reject_mockup');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] mockup messages with includeButtons=false NEVER have buttons', () => {
    fc.assert(
      fc.property(
        arbMockupPayload.filter((p) => p.includeButtons === false),
        (payload) => {
          const result = buildMockupPayload(payload);

          expect(result.buttons).toBeUndefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] quote messages ALWAYS have acceptance/rejection buttons regardless of input', () => {
    fc.assert(
      fc.property(
        arbQuotePayload,
        (payload) => {
          const result = buildQuotePayload(payload);

          expect(result.buttons).toBeDefined();
          expect(result.buttons).toHaveLength(2);
          expect(result.buttons![0].title).toBe('Aceptar Cotización');
          expect(result.buttons![1].title).toBe('Rechazar Cotización');
          expect(result.buttons![0].id).toBe('accept_quote');
          expect(result.buttons![1].id).toBe('reject_quote');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 24: WhatsApp Quote Message Completeness ---

describe('Property 24: WhatsApp Quote Message Completeness', () => {
  it('[property] quote message text ALWAYS contains product name, price, quantity, age group, and sizes', () => {
    fc.assert(
      fc.property(
        arbQuotePayload,
        (payload) => {
          const result = buildQuotePayload(payload);
          const text = result.text;

          // Product name must appear in the message
          expect(text).toContain(payload.productName);

          // Price must appear in the message
          expect(text).toContain(payload.price);

          // Quantity must appear in the message
          expect(text).toContain(String(payload.quantity));

          // Age group label (Niños/Adultos) must appear
          const expectedAgeLabel = payload.ageGroup === 'children' ? 'Niños' : 'Adultos';
          expect(text).toContain(expectedAgeLabel);

          // All sizes must appear in the message (joined with commas)
          const sizesLabel = payload.sizes.join(', ');
          expect(text).toContain(sizesLabel);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] quote message ALWAYS includes both interactive buttons', () => {
    fc.assert(
      fc.property(
        arbQuotePayload,
        (payload) => {
          const result = buildQuotePayload(payload);

          expect(result.buttons).toBeDefined();
          expect(result.buttons!.length).toBe(2);

          const buttonIds = result.buttons!.map((b) => b.id);
          expect(buttonIds).toContain('accept_quote');
          expect(buttonIds).toContain('reject_quote');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] quote message metadata ALWAYS contains entityId and productName', () => {
    fc.assert(
      fc.property(
        arbQuotePayload,
        (payload) => {
          const result = buildQuotePayload(payload);

          expect(result.metadata.entityId).toBe(payload.quoteId);
          expect(result.metadata.productName).toBe(payload.productName);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 25: WhatsApp Webhook Authentication ---

describe('Property 25: WhatsApp Webhook Authentication', () => {
  it('[property] webhook with matching token ALWAYS authenticates successfully', () => {
    fc.assert(
      fc.property(
        arbSecret,
        (secret) => {
          const result = authenticateWebhook(secret, secret);
          expect(result).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] webhook with non-matching token NEVER authenticates', () => {
    fc.assert(
      fc.property(
        arbSecret,
        arbSecret.filter((s) => s.length > 0),
        (token, validSecret) => {
          // Only test cases where they differ
          fc.pre(token !== validSecret);

          const result = authenticateWebhook(token, validSecret);
          expect(result).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] webhook with empty token NEVER authenticates', () => {
    fc.assert(
      fc.property(
        arbSecret,
        (validSecret) => {
          expect(authenticateWebhook('', validSecret)).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] processWebhook with invalid token ALWAYS returns authentication failure', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSecret,
        arbSecret,
        arbWebhookResponse,
        arbPhone,
        async (validSecret, wrongToken, response, phone) => {
          fc.pre(validSecret !== wrongToken);

          const webhook: WhatsAppResponseWebhook = {
            messageId: 'msg-123',
            phone,
            response,
            timestamp: new Date().toISOString(),
            token: wrongToken,
          };

          const result = await processWebhook(webhook, { validSecret });

          expect(result.success).toBe(false);
          expect(result.error).toContain('Authentication failed');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] processWebhook with valid token ALWAYS succeeds for any response type', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSecret,
        arbWebhookResponse,
        arbPhone,
        async (secret, response, phone) => {
          const webhook: WhatsAppResponseWebhook = {
            messageId: 'msg-456',
            phone,
            response,
            timestamp: new Date().toISOString(),
            token: secret,
          };

          const result = await processWebhook(webhook, { validSecret: secret });

          expect(result.success).toBe(true);
          expect(result.action).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 26: WhatsApp Retry with Exponential Backoff ---

describe('Property 26: WhatsApp Retry with Exponential Backoff', () => {
  it('[property] on persistent failure, retries exactly 3 times with backoff delays 30s/60s/120s', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPhone,
        arbMockupPayload,
        async (phone, mockupPayload) => {
          const delaysCalled: number[] = [];
          let postAttempts = 0;

          const deps: SendServiceDeps = {
            postToWebhook: async () => {
              postAttempts++;
              throw new Error('Service unavailable');
            },
            delay: async (ms: number) => {
              delaysCalled.push(ms);
            },
            sendFallbackEmail: async () => {},
            notifyAdmin: async () => {},
            getCredentials: async () => ({
              wahaApiKey: 'key',
              wahaWebhookSecret: 'secret',
              n8nWebhookUrl: 'https://n8n.example.com/webhook',
              hcaptchaSecret: 'hcaptcha',
            }),
            generateId: () => 'test-id-123',
          };

          const request: WhatsAppSendRequest = {
            type: 'mockup',
            recipientPhone: phone,
            payload: mockupPayload,
          };

          const result = await sendWhatsAppMessage(request, deps);

          // Should have attempted initial + 3 retries = 4 total attempts
          expect(postAttempts).toBe(MAX_RETRIES + 1);

          // Delays should be exactly [30000, 60000, 120000]
          expect(delaysCalled).toEqual([30_000, 60_000, 120_000]);

          // Result should indicate failure with queued status
          expect(result.success).toBe(false);
          expect(result.status).toBe('queued');
          expect(result.retriesAttempted).toBe(MAX_RETRIES + 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] on persistent failure, fallback email is attempted', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPhone,
        arbQuotePayload,
        async (phone, quotePayload) => {
          let emailCalled = false;
          let adminNotified = false;

          const deps: SendServiceDeps = {
            postToWebhook: async () => {
              throw new Error('WAHA unavailable');
            },
            delay: async () => {},
            sendFallbackEmail: async () => {
              emailCalled = true;
            },
            notifyAdmin: async () => {
              adminNotified = true;
            },
            getCredentials: async () => ({
              wahaApiKey: 'key',
              wahaWebhookSecret: 'secret',
              n8nWebhookUrl: 'https://n8n.example.com/webhook',
              hcaptchaSecret: 'hcaptcha',
            }),
            generateId: () => 'test-id-456',
          };

          const request: WhatsAppSendRequest = {
            type: 'quote',
            recipientPhone: phone,
            payload: quotePayload,
          };

          const result = await sendWhatsAppMessage(request, deps);

          // Fallback email must be attempted
          expect(emailCalled).toBe(true);
          expect(result.fallbackEmail).toBe(true);

          // Admin must be notified
          expect(adminNotified).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] on success at first attempt, no retries or fallback occur', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPhone,
        arbMockupPayload,
        async (phone, mockupPayload) => {
          let delayCalled = false;
          let emailCalled = false;

          const deps: SendServiceDeps = {
            postToWebhook: async (): Promise<WebhookResponse> => ({
              success: true,
              messageId: 'msg-success-001',
            }),
            delay: async () => {
              delayCalled = true;
            },
            sendFallbackEmail: async () => {
              emailCalled = true;
            },
            notifyAdmin: async () => {},
            getCredentials: async () => ({
              wahaApiKey: 'key',
              wahaWebhookSecret: 'secret',
              n8nWebhookUrl: 'https://n8n.example.com/webhook',
              hcaptchaSecret: 'hcaptcha',
            }),
            generateId: () => 'test-id-789',
          };

          const request: WhatsAppSendRequest = {
            type: 'mockup',
            recipientPhone: phone,
            payload: mockupPayload,
          };

          const result = await sendWhatsAppMessage(request, deps);

          expect(result.success).toBe(true);
          expect(result.status).toBe('sent');
          expect(result.retriesAttempted).toBe(0);
          expect(result.fallbackEmail).toBe(false);
          expect(delayCalled).toBe(false);
          expect(emailCalled).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] success on Nth retry means no further retries or fallback', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbPhone,
        arbMockupPayload,
        fc.integer({ min: 1, max: MAX_RETRIES }),
        async (phone, mockupPayload, successAttempt) => {
          let attemptCount = 0;
          const delaysCalled: number[] = [];
          let emailCalled = false;

          const deps: SendServiceDeps = {
            postToWebhook: async (): Promise<WebhookResponse> => {
              attemptCount++;
              if (attemptCount <= successAttempt) {
                throw new Error('Temporary failure');
              }
              return { success: true, messageId: 'msg-eventual-success' };
            },
            delay: async (ms: number) => {
              delaysCalled.push(ms);
            },
            sendFallbackEmail: async () => {
              emailCalled = true;
            },
            notifyAdmin: async () => {},
            getCredentials: async () => ({
              wahaApiKey: 'key',
              wahaWebhookSecret: 'secret',
              n8nWebhookUrl: 'https://n8n.example.com/webhook',
              hcaptchaSecret: 'hcaptcha',
            }),
            generateId: () => 'test-id-eventual',
          };

          const request: WhatsAppSendRequest = {
            type: 'mockup',
            recipientPhone: phone,
            payload: mockupPayload,
          };

          const result = await sendWhatsAppMessage(request, deps);

          expect(result.success).toBe(true);
          expect(result.status).toBe('sent');
          expect(result.retriesAttempted).toBe(successAttempt);
          expect(result.fallbackEmail).toBe(false);
          expect(emailCalled).toBe(false);

          // Delays should match exactly the expected intervals for the retries that occurred
          expect(delaysCalled).toEqual(
            RETRY_INTERVALS_MS.slice(0, successAttempt)
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 27: WhatsApp Delivery Log Completeness ---

describe('Property 27: WhatsApp Delivery Log Completeness', () => {
  it('[property] every valid delivery log input produces a log entry with ALL required fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbMessageType,
        arbPhone,
        arbDeliveryStatus,
        fc.option(fc.string({ minLength: 1, maxLength: 200 })),
        async (messageType, phone, status, clientResponse) => {
          let persistedRecord: DeliveryLogRecord | null = null;

          const input: DeliveryLogInput = {
            messageType,
            recipientPhone: phone,
            status,
            ...(clientResponse !== null && { clientResponse }),
          };

          const entry = await logDelivery(input, {
            generateId: () => 'log-id-001',
            getNow: () => '2024-01-15T10:30:00.000Z',
            persist: async (record) => {
              persistedRecord = record;
            },
          });

          // Every log entry must have ALL required fields
          expect(entry.logId).toBeDefined();
          expect(entry.logId.length).toBeGreaterThan(0);
          expect(entry.messageType).toBe(messageType);
          expect(entry.recipientPhone).toBe(phone);
          expect(entry.deliveryTimestamp).toBeDefined();
          expect(entry.deliveryTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
          expect(entry.status).toBe(status);

          // If clientResponse was provided, it must be in the entry
          if (clientResponse !== null) {
            expect(entry.clientResponse).toBe(clientResponse);
          }

          // The persisted record must also have proper DynamoDB keys
          expect(persistedRecord).not.toBeNull();
          expect(persistedRecord!.PK).toBe(`WALOG#${phone}`);
          expect(persistedRecord!.SK).toMatch(/^MSG#/);
          expect(persistedRecord!.GSI1PK).toBe(`DELIVERY#${status}`);
          expect(persistedRecord!.GSI1SK).toMatch(/^SENT#/);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] delivery log validation rejects entries missing required fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<'mockup' | 'quote' | '' | undefined>('' as 'mockup', undefined as unknown as 'mockup'),
        fc.constantFrom('', undefined as unknown as string),
        fc.constantFrom<'sent' | 'delivered' | 'read' | 'failed' | '' | undefined>('' as 'sent', undefined as unknown as 'sent'),
        (messageType, phone, status) => {
          const input = {
            messageType,
            recipientPhone: phone,
            status,
          } as DeliveryLogInput;

          const errors = validateDeliveryLogInput(input);

          // At least one error should be present when any required field is invalid
          expect(errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] delivery log entries have unique log IDs when using default generator', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 50 }),
        async (count) => {
          const logIds = new Set<string>();

          for (let i = 0; i < count; i++) {
            const input: DeliveryLogInput = {
              messageType: 'mockup',
              recipientPhone: '+1234567890',
              status: 'sent',
            };

            const entry = await logDelivery(input, {
              persist: async () => {},
            });

            logIds.add(entry.logId);
          }

          // All log IDs must be unique
          expect(logIds.size).toBe(count);
        },
      ),
      { numRuns: 100 },
    );
  });
});
