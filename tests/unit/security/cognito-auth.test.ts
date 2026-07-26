import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractRegionFromPoolId,
  getCognitoConfig,
  getSessionTimeoutMinutes,
  isTokenExpired,
  checkSessionTimeout,
  extractBearerToken,
  buildAuthorizerResponse,
  handleAuthorizerEvent,
  validateToken,
  getAdminContext,
  AuthenticationError,
  COGNITO_PASSWORD_POLICY,
  SESSION_TIMEOUT_MIN,
  SESSION_TIMEOUT_MAX,
  SESSION_TIMEOUT_DEFAULT,
} from '../../../src/modules/security/cognito-auth.js';

// Mock jose module
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
  decodeJwt: vi.fn(),
}));

import { jwtVerify, decodeJwt } from 'jose';

const mockedJwtVerify = vi.mocked(jwtVerify);
const mockedDecodeJwt = vi.mocked(decodeJwt);

describe('Cognito Authentication Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T12:00:00.000Z'));
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.COGNITO_USER_POOL_ID = 'us-east-1_testPool123';
    process.env.COGNITO_CLIENT_ID = 'test-client-id-123';
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = originalEnv;
  });

  describe('COGNITO_PASSWORD_POLICY', () => {
    it('documents the correct password policy constants', () => {
      expect(COGNITO_PASSWORD_POLICY.minLength).toBe(8);
      expect(COGNITO_PASSWORD_POLICY.requireUppercase).toBe(true);
      expect(COGNITO_PASSWORD_POLICY.requireLowercase).toBe(true);
      expect(COGNITO_PASSWORD_POLICY.requireNumbers).toBe(true);
      expect(COGNITO_PASSWORD_POLICY.requireSymbols).toBe(true);
    });
  });

  describe('Session timeout constants', () => {
    it('has correct min, max, and default values', () => {
      expect(SESSION_TIMEOUT_MIN).toBe(5);
      expect(SESSION_TIMEOUT_MAX).toBe(120);
      expect(SESSION_TIMEOUT_DEFAULT).toBe(30);
    });
  });

  describe('extractRegionFromPoolId', () => {
    it('extracts region from a valid pool ID', () => {
      expect(extractRegionFromPoolId('us-east-1_abc123')).toBe('us-east-1');
    });

    it('extracts region with complex region names', () => {
      expect(extractRegionFromPoolId('ap-southeast-2_pool456')).toBe('ap-southeast-2');
    });

    it('throws AuthenticationError for invalid pool ID format', () => {
      expect(() => extractRegionFromPoolId('invalidformat')).toThrow(AuthenticationError);
      expect(() => extractRegionFromPoolId('invalidformat')).toThrow(
        /Invalid Cognito User Pool ID format/
      );
    });
  });

  describe('getCognitoConfig', () => {
    it('returns config from environment variables', () => {
      const config = getCognitoConfig();
      expect(config.userPoolId).toBe('us-east-1_testPool123');
      expect(config.clientId).toBe('test-client-id-123');
      expect(config.region).toBe('us-east-1');
    });

    it('uses COGNITO_REGION env var when set', () => {
      process.env.COGNITO_REGION = 'eu-west-1';
      const config = getCognitoConfig();
      expect(config.region).toBe('eu-west-1');
    });

    it('throws when COGNITO_USER_POOL_ID is missing', () => {
      delete process.env.COGNITO_USER_POOL_ID;
      expect(() => getCognitoConfig()).toThrow(AuthenticationError);
      expect(() => getCognitoConfig()).toThrow(/COGNITO_USER_POOL_ID/);
    });

    it('throws when COGNITO_CLIENT_ID is missing', () => {
      delete process.env.COGNITO_CLIENT_ID;
      expect(() => getCognitoConfig()).toThrow(AuthenticationError);
      expect(() => getCognitoConfig()).toThrow(/COGNITO_CLIENT_ID/);
    });
  });

  describe('getSessionTimeoutMinutes', () => {
    it('returns default 30 when env var is not set', () => {
      delete process.env.SESSION_TIMEOUT_MINUTES;
      expect(getSessionTimeoutMinutes()).toBe(30);
    });

    it('returns parsed value from env var', () => {
      process.env.SESSION_TIMEOUT_MINUTES = '60';
      expect(getSessionTimeoutMinutes()).toBe(60);
    });

    it('clamps value to minimum 5', () => {
      process.env.SESSION_TIMEOUT_MINUTES = '2';
      expect(getSessionTimeoutMinutes()).toBe(5);
    });

    it('clamps value to maximum 120', () => {
      process.env.SESSION_TIMEOUT_MINUTES = '200';
      expect(getSessionTimeoutMinutes()).toBe(120);
    });

    it('returns default for non-numeric values', () => {
      process.env.SESSION_TIMEOUT_MINUTES = 'abc';
      expect(getSessionTimeoutMinutes()).toBe(30);
    });
  });

  describe('extractBearerToken', () => {
    it('extracts token from valid Bearer header', () => {
      expect(extractBearerToken('Bearer eyJhbGciOiJSUzI1Ni')).toBe('eyJhbGciOiJSUzI1Ni');
    });

    it('returns null for empty string', () => {
      expect(extractBearerToken('')).toBeNull();
    });

    it('returns null for non-Bearer scheme', () => {
      expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    });

    it('returns null for "Bearer " with no token', () => {
      expect(extractBearerToken('Bearer ')).toBeNull();
    });

    it('returns null for "Bearer" without space', () => {
      expect(extractBearerToken('Bearertoken')).toBeNull();
    });

    it('trims whitespace from the token', () => {
      expect(extractBearerToken('Bearer   eyJhbG   ')).toBe('eyJhbG');
    });
  });

  describe('isTokenExpired', () => {
    it('returns true for empty token', () => {
      expect(isTokenExpired('')).toBe(true);
    });

    it('returns true for whitespace-only token', () => {
      expect(isTokenExpired('   ')).toBe(true);
    });

    it('returns true when token has no exp claim', () => {
      mockedDecodeJwt.mockReturnValue({ iss: 'test' } as any);
      expect(isTokenExpired('some.token.here')).toBe(true);
    });

    it('returns true when token is expired', () => {
      // Current time: 2024-06-15T12:00:00.000Z (epoch: 1718452800)
      mockedDecodeJwt.mockReturnValue({ exp: 1718452700 } as any); // 100s ago
      expect(isTokenExpired('some.token.here')).toBe(true);
    });

    it('returns false when token is still valid', () => {
      mockedDecodeJwt.mockReturnValue({ exp: 1718453000 } as any); // 200s in future
      expect(isTokenExpired('some.token.here')).toBe(false);
    });

    it('returns true when token cannot be decoded', () => {
      mockedDecodeJwt.mockImplementation(() => {
        throw new Error('Invalid token');
      });
      expect(isTokenExpired('invalid.token')).toBe(true);
    });
  });

  describe('checkSessionTimeout', () => {
    it('returns false when activity is recent (within timeout)', () => {
      // 10 minutes ago
      const tenMinutesAgo = new Date('2024-06-15T11:50:00.000Z').toISOString();
      expect(checkSessionTimeout(tenMinutesAgo)).toBe(false);
    });

    it('returns true when inactivity exceeds default 30 minutes', () => {
      // 31 minutes ago
      const thirtyOneMinutesAgo = new Date('2024-06-15T11:29:00.000Z').toISOString();
      expect(checkSessionTimeout(thirtyOneMinutesAgo)).toBe(true);
    });

    it('returns true when inactivity exactly equals timeout', () => {
      // Exactly 30 minutes ago
      const exactlyThirty = new Date('2024-06-15T11:30:00.000Z').toISOString();
      expect(checkSessionTimeout(exactlyThirty)).toBe(true);
    });

    it('uses custom timeout when provided', () => {
      // 8 minutes ago — within 10-minute timeout
      const eightMinutesAgo = new Date('2024-06-15T11:52:00.000Z').toISOString();
      expect(checkSessionTimeout(eightMinutesAgo, 10)).toBe(false);

      // 11 minutes ago — exceeds 10-minute timeout
      const elevenMinutesAgo = new Date('2024-06-15T11:49:00.000Z').toISOString();
      expect(checkSessionTimeout(elevenMinutesAgo, 10)).toBe(true);
    });

    it('clamps timeout to minimum 5 minutes', () => {
      // 4 minutes ago — within min 5 minute timeout even if passed 2
      const fourMinutesAgo = new Date('2024-06-15T11:56:00.000Z').toISOString();
      expect(checkSessionTimeout(fourMinutesAgo, 2)).toBe(false);
    });

    it('clamps timeout to maximum 120 minutes', () => {
      // 121 minutes ago — exceeds max 120 even if passed 200
      const oneHundredTwentyOneAgo = new Date('2024-06-15T09:59:00.000Z').toISOString();
      expect(checkSessionTimeout(oneHundredTwentyOneAgo, 200)).toBe(true);
    });

    it('returns true for invalid date string', () => {
      expect(checkSessionTimeout('not-a-date')).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(checkSessionTimeout('')).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('throws MISSING_TOKEN for empty token', async () => {
      await expect(validateToken('')).rejects.toThrow(AuthenticationError);
      await expect(validateToken('')).rejects.toMatchObject({ code: 'MISSING_TOKEN' });
    });

    it('throws MISSING_TOKEN for whitespace-only token', async () => {
      await expect(validateToken('   ')).rejects.toThrow(AuthenticationError);
    });

    it('returns claims for a valid access token', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-123',
          email: 'admin@cronusfit.com',
          'cognito:groups': ['admins'],
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'access',
          client_id: 'test-client-id-123',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      const claims = await validateToken('valid.access.token');
      expect(claims.sub).toBe('user-123');
      expect(claims.email).toBe('admin@cronusfit.com');
      expect(claims['cognito:groups']).toEqual(['admins']);
      expect(claims.exp).toBe(1718456400);
      expect(claims.iat).toBe(1718452800);
    });

    it('returns claims for a valid id token', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-456',
          email: 'admin2@cronusfit.com',
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'id',
          aud: 'test-client-id-123',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      const claims = await validateToken('valid.id.token');
      expect(claims.sub).toBe('user-456');
      expect(claims.email).toBe('admin2@cronusfit.com');
    });

    it('throws INVALID_TOKEN for invalid token_use', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-123',
          email: 'admin@cronusfit.com',
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'refresh',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      await expect(validateToken('refresh.token')).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });

    it('throws INVALID_TOKEN when id token audience does not match', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-123',
          email: 'admin@cronusfit.com',
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'id',
          aud: 'wrong-client-id',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      await expect(validateToken('mismatched.aud.token')).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });

    it('throws INVALID_TOKEN when access token client_id does not match', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'user-123',
          email: 'admin@cronusfit.com',
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'access',
          client_id: 'wrong-client-id',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      await expect(validateToken('mismatched.client.token')).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
    });

    it('throws EXPIRED_TOKEN when jose reports token expired', async () => {
      mockedJwtVerify.mockRejectedValue(new Error('"exp" claim timestamp check failed'));

      await expect(validateToken('expired.token')).rejects.toMatchObject({
        code: 'EXPIRED_TOKEN',
      });
    });

    it('throws INVALID_SIGNATURE when jose reports signature invalid', async () => {
      mockedJwtVerify.mockRejectedValue(new Error('signature verification failed'));

      await expect(validateToken('bad.signature.token')).rejects.toMatchObject({
        code: 'INVALID_SIGNATURE',
      });
    });

    it('throws INVALID_ISSUER when jose reports issuer mismatch', async () => {
      mockedJwtVerify.mockRejectedValue(
        new Error('unexpected "iss" claim value')
      );

      await expect(validateToken('wrong.issuer.token')).rejects.toMatchObject({
        code: 'INVALID_ISSUER',
      });
    });
  });

  describe('getAdminContext', () => {
    it('returns admin context from a valid token', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'admin-sub-123',
          email: 'admin@cronusfit.com',
          'cognito:groups': ['admins'],
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'access',
          client_id: 'test-client-id-123',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      const context = await getAdminContext('valid.token');
      expect(context.adminId).toBe('admin-sub-123');
      expect(context.adminEmail).toBe('admin@cronusfit.com');
      // Session expiry should be 30 minutes from now (default)
      expect(context.sessionExpiry).toBe('2024-06-15T12:30:00.000Z');
    });

    it('uses configured session timeout for expiry', async () => {
      process.env.SESSION_TIMEOUT_MINUTES = '60';

      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'admin-sub-456',
          email: 'admin2@cronusfit.com',
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'access',
          client_id: 'test-client-id-123',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      const context = await getAdminContext('valid.token');
      // Session expiry should be 60 minutes from now
      expect(context.sessionExpiry).toBe('2024-06-15T13:00:00.000Z');
    });
  });

  describe('buildAuthorizerResponse', () => {
    it('builds an Allow response with context', () => {
      const response = buildAuthorizerResponse(
        'Allow',
        'user-123',
        'arn:aws:execute-api:us-east-1:123:api/GET/resource',
        {
          adminId: 'user-123',
          adminEmail: 'admin@cronusfit.com',
          sessionExpiry: '2024-06-15T12:30:00.000Z',
        }
      );

      expect(response.principalId).toBe('user-123');
      expect(response.policyDocument.Version).toBe('2012-10-17');
      expect(response.policyDocument.Statement).toHaveLength(1);
      expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(response.policyDocument.Statement[0].Action).toBe('execute-api:Invoke');
      expect(response.policyDocument.Statement[0].Resource).toBe(
        'arn:aws:execute-api:us-east-1:123:api/GET/resource'
      );
      expect(response.context.adminId).toBe('user-123');
      expect(response.context.adminEmail).toBe('admin@cronusfit.com');
    });

    it('builds a Deny response with empty context when not provided', () => {
      const response = buildAuthorizerResponse(
        'Deny',
        'anonymous',
        'arn:aws:execute-api:us-east-1:123:api/GET/resource'
      );

      expect(response.principalId).toBe('anonymous');
      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(response.context.adminId).toBe('');
      expect(response.context.adminEmail).toBe('');
      expect(response.context.sessionExpiry).toBe('');
    });
  });

  describe('handleAuthorizerEvent', () => {
    const methodArn = 'arn:aws:execute-api:us-east-1:123456:apiid/stage/GET/resource';

    it('returns Deny for missing authorization token', async () => {
      const response = await handleAuthorizerEvent(undefined, methodArn);
      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(response.principalId).toBe('anonymous');
    });

    it('returns Deny for invalid Bearer format', async () => {
      const response = await handleAuthorizerEvent('Basic abc123', methodArn);
      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
    });

    it('returns Deny for empty Bearer token', async () => {
      const response = await handleAuthorizerEvent('Bearer ', methodArn);
      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
    });

    it('returns Allow with context for valid token', async () => {
      mockedJwtVerify.mockResolvedValue({
        payload: {
          sub: 'admin-sub-789',
          email: 'admin@cronusfit.com',
          'cognito:groups': ['admins'],
          exp: 1718456400,
          iat: 1718452800,
          token_use: 'access',
          client_id: 'test-client-id-123',
        },
        protectedHeader: { alg: 'RS256' },
      } as any);

      const response = await handleAuthorizerEvent(
        'Bearer valid.access.token',
        methodArn
      );

      expect(response.policyDocument.Statement[0].Effect).toBe('Allow');
      expect(response.principalId).toBe('admin-sub-789');
      expect(response.context.adminId).toBe('admin-sub-789');
      expect(response.context.adminEmail).toBe('admin@cronusfit.com');
      expect(response.context.sessionExpiry).toBe('2024-06-15T12:30:00.000Z');
    });

    it('returns Deny when token validation fails', async () => {
      mockedJwtVerify.mockRejectedValue(new Error('signature verification failed'));

      const response = await handleAuthorizerEvent(
        'Bearer invalid.signature.token',
        methodArn
      );

      expect(response.policyDocument.Statement[0].Effect).toBe('Deny');
      expect(response.principalId).toBe('anonymous');
    });
  });
});
