/**
 * Unit tests for the approval-process Lambda handler.
 *
 * Tests:
 * - POST /api/mockups/{id}/approve — success and error paths
 * - POST /api/mockups/{id}/reject — success, validation, and error paths
 * - GET /api/mockups?status=pending_approval — pending queue listing
 * - HTTP status code mapping for workflow errors
 * - Admin context extraction from authorizer
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

// Mock dependencies
vi.mock('../../../src/modules/approval/workflow.js', () => ({
  approveMockup: vi.fn(),
  rejectMockup: vi.fn(),
}));

vi.mock('../../../src/modules/approval/queue.js', () => ({
  getPendingMockups: vi.fn(),
}));

vi.mock('../../../src/modules/approval/audit.js', () => ({
  recordApprovalAction: vi.fn(),
}));

import { handler } from '../../../src/lambdas/approval-process/handler.js';
import { approveMockup, rejectMockup } from '../../../src/modules/approval/workflow.js';
import { getPendingMockups } from '../../../src/modules/approval/queue.js';
import { recordApprovalAction } from '../../../src/modules/approval/audit.js';

const mockApproveMockup = vi.mocked(approveMockup);
const mockRejectMockup = vi.mocked(rejectMockup);
const mockGetPendingMockups = vi.mocked(getPendingMockups);
const mockRecordApprovalAction = vi.mocked(recordApprovalAction);

describe('approval-process handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordApprovalAction.mockResolvedValue(undefined);
  });

  function createEvent(
    overrides: Partial<APIGatewayProxyEvent> = {},
  ): APIGatewayProxyEvent {
    return {
      body: null,
      headers: {},
      multiValueHeaders: {},
      httpMethod: 'POST',
      isBase64Encoded: false,
      path: '/api/mockups/mock-123/approve',
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
        httpMethod: 'POST',
        identity: {} as APIGatewayProxyEvent['requestContext']['identity'],
        path: '/api/mockups/mock-123/approve',
        stage: 'prod',
        requestId: 'req-001',
        requestTimeEpoch: Date.now(),
        resourceId: '',
        resourcePath: '',
      },
      ...overrides,
    } as APIGatewayProxyEvent;
  }

  // --- POST /approve Tests ---

  describe('POST /approve', () => {
    it('should return 200 with approval data on success', async () => {
      mockApproveMockup.mockResolvedValue({
        success: true,
        mockupId: 'mock-123',
        newStatus: 'approved',
        approvalTimestamp: '2024-01-15T10:30:00.000Z',
      });

      const event = createEvent();
      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.mockupId).toBe('mock-123');
      expect(body.status).toBe('approved');
      expect(body.approvalTimestamp).toBe('2024-01-15T10:30:00.000Z');
    });

    it('should call approveMockup with correct parameters', async () => {
      mockApproveMockup.mockResolvedValue({
        success: true,
        mockupId: 'mock-123',
        newStatus: 'approved',
        approvalTimestamp: '2024-01-15T10:30:00.000Z',
      });

      const event = createEvent();
      await handler(event, {} as Context, () => {});

      expect(mockApproveMockup).toHaveBeenCalledWith(
        'mock-123',
        'admin-sub-001',
        'admin@cronusfit.com',
      );
    });

    it('should record approval action in audit trail on success', async () => {
      mockApproveMockup.mockResolvedValue({
        success: true,
        mockupId: 'mock-123',
        newStatus: 'approved',
        approvalTimestamp: '2024-01-15T10:30:00.000Z',
      });

      const event = createEvent();
      await handler(event, {} as Context, () => {});

      expect(mockRecordApprovalAction).toHaveBeenCalledWith(
        expect.objectContaining({
          mockupId: 'mock-123',
          action: 'approved',
          adminId: 'admin-sub-001',
          adminEmail: 'admin@cronusfit.com',
          timestamp: '2024-01-15T10:30:00.000Z',
        }),
      );
    });

    it('should return 400 when mockup ID is missing', async () => {
      const event = createEvent({
        pathParameters: null,
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Mockup ID is required in path parameters');
    });

    it('should return 404 when mockup is not found', async () => {
      mockApproveMockup.mockResolvedValue({
        success: false,
        error: "Mockup 'mock-999' not found",
        code: 'MOCKUP_NOT_FOUND',
      });

      const event = createEvent({
        pathParameters: { id: 'mock-999' },
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body).error).toContain('not found');
    });

    it('should return 409 when mockup is not in pending_approval state', async () => {
      mockApproveMockup.mockResolvedValue({
        success: false,
        error: "Cannot approve mockup: current status is 'approved'",
        code: 'INVALID_STATE_TRANSITION',
      });

      const event = createEvent();
      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(409);
    });

    it('should return 409 on concurrent state change (condition check failed)', async () => {
      mockApproveMockup.mockResolvedValue({
        success: false,
        error: 'Conditional check failed: mockup status was changed concurrently',
        code: 'CONDITION_CHECK_FAILED',
      });

      const event = createEvent();
      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(409);
    });

    it('should record invalid_attempt in audit trail on workflow error', async () => {
      mockApproveMockup.mockResolvedValue({
        success: false,
        error: "Cannot approve: current status is 'rejected'",
        code: 'INVALID_STATE_TRANSITION',
      });

      const event = createEvent();
      await handler(event, {} as Context, () => {});

      expect(mockRecordApprovalAction).toHaveBeenCalledWith(
        expect.objectContaining({
          mockupId: 'mock-123',
          action: 'invalid_attempt',
          adminId: 'admin-sub-001',
          adminEmail: 'admin@cronusfit.com',
        }),
      );
    });
  });

  // --- POST /reject Tests ---

  describe('POST /reject', () => {
    it('should return 200 with rejection data on success', async () => {
      mockRejectMockup.mockResolvedValue({
        success: true,
        mockupId: 'mock-123',
        newStatus: 'rejected',
        rejectionReason: 'Design quality insufficient',
      });

      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: JSON.stringify({ rejectionReason: 'Design quality insufficient' }),
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.mockupId).toBe('mock-123');
      expect(body.status).toBe('rejected');
      expect(body.rejectionReason).toBe('Design quality insufficient');
    });

    it('should call rejectMockup with correct parameters', async () => {
      mockRejectMockup.mockResolvedValue({
        success: true,
        mockupId: 'mock-123',
        newStatus: 'rejected',
        rejectionReason: 'Colors are off',
      });

      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: JSON.stringify({ rejectionReason: 'Colors are off' }),
      });

      await handler(event, {} as Context, () => {});

      expect(mockRejectMockup).toHaveBeenCalledWith(
        'mock-123',
        'admin-sub-001',
        'admin@cronusfit.com',
        'Colors are off',
      );
    });

    it('should return 400 when body is missing', async () => {
      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: null,
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Request body is required with rejectionReason');
    });

    it('should return 400 when body is invalid JSON', async () => {
      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: 'not-json{',
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Invalid JSON in request body');
    });

    it('should return 400 when rejectionReason is missing', async () => {
      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: JSON.stringify({}),
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('rejectionReason is required and must be a string');
    });

    it('should return 400 when rejectionReason is not a string', async () => {
      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: JSON.stringify({ rejectionReason: 123 }),
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('rejectionReason is required and must be a string');
    });

    it('should return 400 when rejection reason validation fails in workflow', async () => {
      mockRejectMockup.mockResolvedValue({
        success: false,
        error: 'Rejection reason must be between 1 and 500 characters (got 0)',
        code: 'INVALID_REJECTION_REASON',
      });

      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: JSON.stringify({ rejectionReason: '   ' }),
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
    });

    it('should return 500 when audit trail recording fails (strict)', async () => {
      mockRejectMockup.mockResolvedValue({
        success: false,
        error: 'Rejection prevented: audit trail recording failed — DynamoDB error',
        code: 'AUDIT_WRITE_FAILED',
      });

      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: JSON.stringify({ rejectionReason: 'Bad design' }),
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toContain('audit trail recording failed');
    });

    it('should record rejection in approval audit trail on success', async () => {
      mockRejectMockup.mockResolvedValue({
        success: true,
        mockupId: 'mock-123',
        newStatus: 'rejected',
        rejectionReason: 'Wrong colors',
      });

      const event = createEvent({
        path: '/api/mockups/mock-123/reject',
        httpMethod: 'POST',
        body: JSON.stringify({ rejectionReason: 'Wrong colors' }),
      });

      await handler(event, {} as Context, () => {});

      expect(mockRecordApprovalAction).toHaveBeenCalledWith(
        expect.objectContaining({
          mockupId: 'mock-123',
          action: 'rejected',
          adminId: 'admin-sub-001',
          adminEmail: 'admin@cronusfit.com',
          rejectionReason: 'Wrong colors',
        }),
      );
    });
  });

  // --- GET /api/mockups?status=pending_approval Tests ---

  describe('GET /api/mockups?status=pending_approval', () => {
    it('should return 200 with pending mockups list', async () => {
      mockGetPendingMockups.mockResolvedValue({
        items: [
          {
            id: 'mock-001',
            patternId: 'pattern-abc',
            garmentType: 'camiseta',
            designS3Key: 'designs/logo.png',
            frontImageS3Key: 'mockups/mock-001/front.png',
            backImageS3Key: 'mockups/mock-001/back.png',
            placementZone: 'chest',
            status: 'pending_approval',
            createdAt: '2024-01-10T08:00:00.000Z',
            createdBy: 'admin-sub-001',
          },
        ],
        count: 1,
        nextKey: undefined,
      });

      const event = createEvent({
        httpMethod: 'GET',
        path: '/api/mockups',
        queryStringParameters: { status: 'pending_approval' },
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].id).toBe('mock-001');
      expect(body.count).toBe(1);
    });

    it('should pass limit and startKey to getPendingMockups', async () => {
      mockGetPendingMockups.mockResolvedValue({
        items: [],
        count: 0,
      });

      const event = createEvent({
        httpMethod: 'GET',
        path: '/api/mockups',
        queryStringParameters: { status: 'pending_approval', limit: '5', startKey: 'abc123' },
      });

      await handler(event, {} as Context, () => {});

      expect(mockGetPendingMockups).toHaveBeenCalledWith({
        limit: 5,
        startKey: 'abc123',
      });
    });

    it('should return 400 when status is not pending_approval', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        path: '/api/mockups',
        queryStringParameters: { status: 'approved' },
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toBe('Query parameter "status" must be "pending_approval"');
    });

    it('should return 400 when status query parameter is missing', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        path: '/api/mockups',
        queryStringParameters: null,
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
    });
  });

  // --- Unsupported Route ---

  describe('Unsupported routes', () => {
    it('should return 400 for unsupported actions', async () => {
      const event = createEvent({
        httpMethod: 'DELETE',
        path: '/api/mockups/mock-123',
      });

      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body).error).toContain('Unsupported action');
    });
  });

  // --- Error Handling ---

  describe('Error handling', () => {
    it('should return 500 for unexpected errors', async () => {
      mockApproveMockup.mockRejectedValue(new Error('DynamoDB service unavailable'));

      const event = createEvent();
      const result = await handler(event, {} as Context, () => {});

      const response = result as { statusCode: number; body: string };
      expect(response.statusCode).toBe(500);
      expect(JSON.parse(response.body).error).toBe('DynamoDB service unavailable');
    });
  });
});
