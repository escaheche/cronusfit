/**
 * Unit tests for the approval-audit Lambda handler.
 *
 * Tests:
 * - GET /api/mockups/{id}/audit — returns audit trail for a mockup
 * - Validation errors (missing ID, unsupported method)
 * - Error handling for unexpected errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock dependencies
vi.mock('../../../src/modules/approval/audit.js', () => ({
  getAuditTrailForMockup: vi.fn(),
}));

import { handler } from '../../../src/lambdas/approval-audit/handler.js';
import { getAuditTrailForMockup } from '../../../src/modules/approval/audit.js';

const mockGetAuditTrail = vi.mocked(getAuditTrailForMockup);

describe('approval-audit handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createEvent(
    overrides: Partial<APIGatewayProxyEvent> = {},
  ): APIGatewayProxyEvent {
    return {
      body: null,
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'GET',
      isBase64Encoded: false,
      path: '/api/mockups/mock-123/audit',
      pathParameters: { id: 'mock-123' },
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      stageVariables: null,
      resource: '',
      requestContext: {
        accountId: '123456789',
        apiId: 'api-id',
        authorizer: {
          adminId: 'admin-sub-001',
          adminEmail: 'admin@cronusfit.com',
        },
        protocol: 'HTTP/1.1',
        httpMethod: 'GET',
        identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
        path: '/api/mockups/mock-123/audit',
        stage: 'prod',
        requestId: 'req-001',
        requestTimeEpoch: Date.now(),
        resourceId: '',
        resourcePath: '',
      },
      ...overrides,
    } as APIGatewayProxyEvent;
  }

  // --- Success Path ---

  it('should return 200 with audit trail for a mockup', async () => {
    mockGetAuditTrail.mockResolvedValue([
      {
        mockupId: 'mock-123',
        action: 'approved',
        adminId: 'admin-sub-001',
        adminEmail: 'admin@cronusfit.com',
        timestamp: '2024-01-15T10:30:00.000Z',
      },
      {
        mockupId: 'mock-123',
        action: 'rejected',
        adminId: 'admin-sub-002',
        adminEmail: 'other@cronusfit.com',
        timestamp: '2024-01-14T08:00:00.000Z',
        rejectionReason: 'Colors incorrect',
      },
    ]);

    const event = createEvent();
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.mockupId).toBe('mock-123');
    expect(body.auditTrail).toHaveLength(2);
    expect(body.count).toBe(2);
    expect(body.auditTrail[0].action).toBe('approved');
    expect(body.auditTrail[1].action).toBe('rejected');
    expect(body.auditTrail[1].rejectionReason).toBe('Colors incorrect');
  });

  it('should return 200 with empty audit trail when no actions exist', async () => {
    mockGetAuditTrail.mockResolvedValue([]);

    const event = createEvent();
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body);
    expect(body.mockupId).toBe('mock-123');
    expect(body.auditTrail).toHaveLength(0);
    expect(body.count).toBe(0);
  });

  it('should call getAuditTrailForMockup with the correct mockup ID', async () => {
    mockGetAuditTrail.mockResolvedValue([]);

    const event = createEvent({ pathParameters: { id: 'mock-456' } });
    await handler(event, {} as Context, () => {});

    expect(mockGetAuditTrail).toHaveBeenCalledWith('mock-456');
  });

  // --- Validation Errors ---

  it('should return 400 when mockup ID is missing', async () => {
    const event = createEvent({ pathParameters: null });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Mockup ID is required in path parameters');
  });

  it('should return 400 for non-GET methods', async () => {
    const event = createEvent({ httpMethod: 'POST' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe('Only GET method is supported');
  });

  it('should return 400 for DELETE method', async () => {
    const event = createEvent({ httpMethod: 'DELETE' });
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(400);
  });

  // --- Error Handling ---

  it('should return 500 when getAuditTrailForMockup throws', async () => {
    mockGetAuditTrail.mockRejectedValue(new Error('DynamoDB query failed'));

    const event = createEvent();
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe('DynamoDB query failed');
  });

  it('should return 500 with generic message for non-Error throws', async () => {
    mockGetAuditTrail.mockRejectedValue('string error');

    const event = createEvent();
    const result = await handler(event, {} as Context, () => {});

    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error).toBe('Internal server error');
  });
});
