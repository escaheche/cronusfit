/**
 * Unit tests for the auth-validate Lambda Authorizer handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayTokenAuthorizerEvent, Context, Callback } from 'aws-lambda';

// Mock the cognito-auth module
vi.mock('../../../src/modules/security/cognito-auth.js', () => ({
  handleAuthorizerEvent: vi.fn(),
}));

import { handler } from '../../../src/lambdas/auth-validate/handler.js';
import { handleAuthorizerEvent } from '../../../src/modules/security/cognito-auth.js';

const mockHandleAuthorizerEvent = vi.mocked(handleAuthorizerEvent);

describe('auth-validate handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createEvent(
    authorizationToken?: string,
    methodArn = 'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource'
  ): APIGatewayTokenAuthorizerEvent {
    return {
      type: 'TOKEN',
      authorizationToken: authorizationToken ?? '',
      methodArn,
    };
  }

  it('should delegate to handleAuthorizerEvent with token and ARN', async () => {
    const mockResponse = {
      principalId: 'user-sub-123',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow' as const,
            Resource: 'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
          },
        ],
      },
      context: {
        adminId: 'user-sub-123',
        adminEmail: 'admin@cronusfit.com',
        sessionExpiry: '2024-01-01T01:00:00.000Z',
      },
    };

    mockHandleAuthorizerEvent.mockResolvedValue(mockResponse);

    const event = createEvent('Bearer valid-jwt-token');
    const result = await handler(event, {} as Context, (() => {}) as Callback);

    expect(mockHandleAuthorizerEvent).toHaveBeenCalledWith(
      'Bearer valid-jwt-token',
      'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource'
    );
    expect(result).toEqual(mockResponse);
  });

  it('should return Deny policy when token is missing', async () => {
    const denyResponse = {
      principalId: 'anonymous',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Deny' as const,
            Resource: 'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource',
          },
        ],
      },
      context: { adminId: '', adminEmail: '', sessionExpiry: '' },
    };

    mockHandleAuthorizerEvent.mockResolvedValue(denyResponse);

    const event = createEvent('');
    const result = await handler(event, {} as Context, (() => {}) as Callback);

    expect(mockHandleAuthorizerEvent).toHaveBeenCalledWith(
      '',
      'arn:aws:execute-api:us-east-1:123456789:api-id/stage/GET/resource'
    );
    expect(result).toEqual(denyResponse);
    expect(result!.policyDocument.Statement[0].Effect).toBe('Deny');
  });

  it('should pass the correct methodArn to the authorizer', async () => {
    const customArn = 'arn:aws:execute-api:eu-west-1:987654321:custom-api/prod/POST/admin/patterns';
    const mockResponse = {
      principalId: 'admin-456',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          { Action: 'execute-api:Invoke', Effect: 'Allow' as const, Resource: customArn },
        ],
      },
      context: {
        adminId: 'admin-456',
        adminEmail: 'other@cronusfit.com',
        sessionExpiry: '2024-06-15T10:30:00.000Z',
      },
    };

    mockHandleAuthorizerEvent.mockResolvedValue(mockResponse);

    const event = createEvent('Bearer another-token', customArn);
    await handler(event, {} as Context, (() => {}) as Callback);

    expect(mockHandleAuthorizerEvent).toHaveBeenCalledWith('Bearer another-token', customArn);
  });
});
