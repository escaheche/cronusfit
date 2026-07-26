/**
 * Cognito authentication and JWT validation module.
 *
 * Validates JWT tokens issued by AWS Cognito User Pool using JWKS (JSON Web Key Set).
 * Provides session management with configurable inactivity timeout.
 * Implements API Gateway Lambda Authorizer response generation.
 *
 * Environment variables:
 * - COGNITO_USER_POOL_ID: The Cognito User Pool ID (e.g., us-east-1_abc123)
 * - COGNITO_CLIENT_ID: The Cognito App Client ID
 * - COGNITO_REGION: AWS region (optional — extracted from pool ID if omitted)
 * - SESSION_TIMEOUT_MINUTES: Inactivity timeout in minutes (5–120, default 30)
 */

import { createRemoteJWKSet, jwtVerify, decodeJwt, type JWTPayload } from 'jose';

// ─── Cognito Password Policy (informational — enforced by Cognito service) ───

export const COGNITO_PASSWORD_POLICY = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSymbols: true,
} as const;

// ─── Session Configuration Constants ─────────────────────────────────────────

export const SESSION_TIMEOUT_MIN = 5;
export const SESSION_TIMEOUT_MAX = 120;
export const SESSION_TIMEOUT_DEFAULT = 30;

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Claims extracted from a validated Cognito JWT. */
export interface TokenClaims {
  /** Cognito user identifier (subject). */
  sub: string;
  /** Admin email address. */
  email: string;
  /** Cognito groups the user belongs to. */
  'cognito:groups'?: string[];
  /** Token expiration time (Unix epoch seconds). */
  exp: number;
  /** Token issued-at time (Unix epoch seconds). */
  iat: number;
}

/** Admin context derived from a validated JWT. */
export interface AdminContext {
  /** Admin's Cognito sub identifier. */
  adminId: string;
  /** Admin's email address. */
  adminEmail: string;
  /** ISO 8601 timestamp when the session will expire due to inactivity. */
  sessionExpiry: string;
}

/** IAM policy statement for API Gateway authorizer. */
export interface PolicyStatement {
  Action: string;
  Effect: 'Allow' | 'Deny';
  Resource: string;
}

/** API Gateway Lambda Authorizer response. */
export interface AuthorizerResponse {
  principalId: string;
  policyDocument: {
    Version: string;
    Statement: PolicyStatement[];
  };
  context: {
    adminId: string;
    adminEmail: string;
    sessionExpiry: string;
  };
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export class AuthenticationError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'AuthenticationError';
    this.code = code;
  }
}

// ─── Configuration ───────────────────────────────────────────────────────────

export interface CognitoAuthConfig {
  userPoolId: string;
  clientId: string;
  region: string;
}

/**
 * Resolves Cognito configuration from environment variables.
 * Extracts region from User Pool ID if COGNITO_REGION is not set.
 */
export function getCognitoConfig(): CognitoAuthConfig {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  if (!userPoolId) {
    throw new AuthenticationError(
      'COGNITO_USER_POOL_ID environment variable is not set',
      'CONFIG_ERROR'
    );
  }

  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!clientId) {
    throw new AuthenticationError(
      'COGNITO_CLIENT_ID environment variable is not set',
      'CONFIG_ERROR'
    );
  }

  // Region can be explicitly set or extracted from the pool ID (format: {region}_{id})
  const region = process.env.COGNITO_REGION ?? extractRegionFromPoolId(userPoolId);

  return { userPoolId, clientId, region };
}

/**
 * Extracts the AWS region from a Cognito User Pool ID.
 * Pool IDs follow the format: {region}_{poolId} (e.g., us-east-1_abc123).
 */
export function extractRegionFromPoolId(userPoolId: string): string {
  const underscoreIndex = userPoolId.indexOf('_');
  if (underscoreIndex === -1) {
    throw new AuthenticationError(
      `Invalid Cognito User Pool ID format: ${userPoolId}. Expected format: {region}_{id}`,
      'CONFIG_ERROR'
    );
  }
  return userPoolId.substring(0, underscoreIndex);
}

/**
 * Returns the configured session timeout in minutes.
 * Reads from SESSION_TIMEOUT_MINUTES env var, clamped to [5, 120], default 30.
 */
export function getSessionTimeoutMinutes(): number {
  const envValue = process.env.SESSION_TIMEOUT_MINUTES;
  if (!envValue) {
    return SESSION_TIMEOUT_DEFAULT;
  }

  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed)) {
    return SESSION_TIMEOUT_DEFAULT;
  }

  return Math.max(SESSION_TIMEOUT_MIN, Math.min(SESSION_TIMEOUT_MAX, parsed));
}

// ─── JWKS Cache ──────────────────────────────────────────────────────────────

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCachePoolId: string | null = null;

/**
 * Returns a cached JWKS fetcher for the configured Cognito User Pool.
 * JWKS is cached per pool ID for Lambda warm invocations.
 */
function getJWKS(config: CognitoAuthConfig): ReturnType<typeof createRemoteJWKSet> {
  if (jwksCache && jwksCachePoolId === config.userPoolId) {
    return jwksCache;
  }

  const jwksUrl = new URL(
    `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/jwks.json`
  );

  jwksCache = createRemoteJWKSet(jwksUrl);
  jwksCachePoolId = config.userPoolId;

  return jwksCache;
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Validates a JWT token against the Cognito User Pool JWKS endpoint.
 *
 * Verifies:
 * - Token signature against Cognito's public keys
 * - Token is not expired
 * - Token issuer matches the configured User Pool
 * - Token audience matches the configured Client ID (for id tokens)
 * - Token use is 'access' or 'id'
 *
 * @param token - The JWT token string to validate
 * @returns Validated token claims
 * @throws AuthenticationError on missing, expired, or invalid tokens
 */
export async function validateToken(token: string): Promise<TokenClaims> {
  if (!token || token.trim() === '') {
    throw new AuthenticationError('Token is missing or empty', 'MISSING_TOKEN');
  }

  const config = getCognitoConfig();
  const jwks = getJWKS(config);
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
    });

    // Validate token_use claim (Cognito tokens have this)
    const tokenUse = (payload as JWTPayload & { token_use?: string }).token_use;
    if (tokenUse !== 'access' && tokenUse !== 'id') {
      throw new AuthenticationError(
        'Invalid token use: expected "access" or "id"',
        'INVALID_TOKEN'
      );
    }

    // For id tokens, verify audience matches client ID
    if (tokenUse === 'id') {
      const aud = payload.aud;
      if (aud !== config.clientId) {
        throw new AuthenticationError(
          'Token audience does not match configured client ID',
          'INVALID_TOKEN'
        );
      }
    }

    // For access tokens, verify client_id claim
    if (tokenUse === 'access') {
      const clientId = (payload as JWTPayload & { client_id?: string }).client_id;
      if (clientId !== config.clientId) {
        throw new AuthenticationError(
          'Token client_id does not match configured client ID',
          'INVALID_TOKEN'
        );
      }
    }

    // Extract claims
    const claims: TokenClaims = {
      sub: payload.sub ?? '',
      email: (payload as JWTPayload & { email?: string }).email ?? '',
      'cognito:groups': (payload as JWTPayload & { 'cognito:groups'?: string[] })[
        'cognito:groups'
      ],
      exp: payload.exp ?? 0,
      iat: payload.iat ?? 0,
    };

    return claims;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }

    // Map jose errors to our error types
    const err = error as Error;
    const message = err.message || 'Token validation failed';

    if (message.includes('expired') || message.includes('"exp" claim')) {
      throw new AuthenticationError('Token has expired', 'EXPIRED_TOKEN');
    }

    if (message.includes('signature') || message.includes('JWS')) {
      throw new AuthenticationError('Token signature is invalid', 'INVALID_SIGNATURE');
    }

    if (message.includes('issuer') || message.includes('"iss" claim')) {
      throw new AuthenticationError('Token issuer is invalid', 'INVALID_ISSUER');
    }

    throw new AuthenticationError(`Token validation failed: ${message}`, 'INVALID_TOKEN');
  }
}

/**
 * Quick check to determine if a token has expired without full validation.
 * Decodes the token payload without verifying the signature.
 *
 * @param token - The JWT token string to check
 * @returns true if the token is expired, false otherwise
 */
export function isTokenExpired(token: string): boolean {
  if (!token || token.trim() === '') {
    return true;
  }

  try {
    const payload = decodeJwt(token);
    if (!payload.exp) {
      return true;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    return nowSeconds >= payload.exp;
  } catch {
    // If the token cannot be decoded, treat it as expired
    return true;
  }
}

/**
 * Extracts admin context from a validated JWT token.
 * Validates the token and returns the admin ID, email, and session expiry.
 *
 * @param token - The JWT token string
 * @returns Admin context with ID, email, and session expiry
 * @throws AuthenticationError if token is invalid
 */
export async function getAdminContext(token: string): Promise<AdminContext> {
  const claims = await validateToken(token);

  const timeoutMinutes = getSessionTimeoutMinutes();
  const sessionExpiry = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

  return {
    adminId: claims.sub,
    adminEmail: claims.email,
    sessionExpiry,
  };
}

/**
 * Checks whether a session has expired due to inactivity.
 *
 * @param lastActivity - ISO 8601 timestamp of the last user interaction
 * @param timeoutMinutes - Inactivity timeout in minutes (5–120, default from env/30)
 * @returns true if the session has expired (inactivity exceeds timeout)
 */
export function checkSessionTimeout(
  lastActivity: string,
  timeoutMinutes?: number
): boolean {
  const timeout = timeoutMinutes ?? getSessionTimeoutMinutes();

  // Clamp timeout to valid range
  const clampedTimeout = Math.max(
    SESSION_TIMEOUT_MIN,
    Math.min(SESSION_TIMEOUT_MAX, timeout)
  );

  const lastActivityTime = new Date(lastActivity).getTime();
  if (isNaN(lastActivityTime)) {
    // Invalid date → treat as expired for safety
    return true;
  }

  const elapsedMs = Date.now() - lastActivityTime;
  const timeoutMs = clampedTimeout * 60 * 1000;

  return elapsedMs >= timeoutMs;
}

// ─── Lambda Authorizer ───────────────────────────────────────────────────────

/**
 * Generates an API Gateway Lambda Authorizer response.
 * Used by the auth-validate Lambda handler to authorize API requests.
 *
 * @param effect - 'Allow' or 'Deny'
 * @param principalId - The Cognito sub (user ID)
 * @param resource - The API Gateway method ARN
 * @param context - Admin context to pass downstream
 * @returns API Gateway authorizer response
 */
export function buildAuthorizerResponse(
  effect: 'Allow' | 'Deny',
  principalId: string,
  resource: string,
  context?: { adminId: string; adminEmail: string; sessionExpiry: string }
): AuthorizerResponse {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: effect,
          Resource: resource,
        },
      ],
    },
    context: context ?? { adminId: '', adminEmail: '', sessionExpiry: '' },
  };
}

/**
 * Lambda Authorizer handler logic.
 * Extracts the token from the Authorization header, validates it,
 * and returns an Allow or Deny policy.
 *
 * @param authorizationToken - The Authorization header value (Bearer {token})
 * @param methodArn - The API Gateway method ARN being invoked
 * @returns Authorizer response with Allow or Deny policy
 */
export async function handleAuthorizerEvent(
  authorizationToken: string | undefined,
  methodArn: string
): Promise<AuthorizerResponse> {
  if (!authorizationToken) {
    return buildAuthorizerResponse('Deny', 'anonymous', methodArn);
  }

  // Extract token from "Bearer {token}" format
  const token = extractBearerToken(authorizationToken);
  if (!token) {
    return buildAuthorizerResponse('Deny', 'anonymous', methodArn);
  }

  try {
    const claims = await validateToken(token);
    const timeoutMinutes = getSessionTimeoutMinutes();
    const sessionExpiry = new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString();

    return buildAuthorizerResponse('Allow', claims.sub, methodArn, {
      adminId: claims.sub,
      adminEmail: claims.email,
      sessionExpiry,
    });
  } catch {
    return buildAuthorizerResponse('Deny', 'anonymous', methodArn);
  }
}

/**
 * Extracts the token from a Bearer authorization header.
 *
 * @param authHeader - The Authorization header value
 * @returns The extracted token or null if format is invalid
 */
export function extractBearerToken(authHeader: string): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  return token.length > 0 ? token : null;
}
