/**
 * Auth Validate Lambda Authorizer
 *
 * API Gateway TOKEN-type Lambda Authorizer that validates Cognito JWT tokens.
 * Receives the authorization token and method ARN from API Gateway,
 * delegates validation to the cognito-auth module, and returns an
 * Allow/Deny IAM policy with admin context.
 *
 * API Gateway throttling: 100 req/s per endpoint
 * Configured in infrastructure/template.yaml (task 16.3)
 * Method-level: throttling.rateLimit = 100, throttling.burstLimit = 200
 *
 * @module lambdas/auth-validate
 * @requirements 13.1, 13.2, 11.9
 */

import type { APIGatewayTokenAuthorizerEvent, APIGatewayAuthorizerResult } from 'aws-lambda';
import { handleAuthorizerEvent } from '../../modules/security/cognito-auth.js';

/**
 * Lambda Authorizer handler for API Gateway (TOKEN type).
 *
 * Extracts the authorization token and method ARN from the event,
 * delegates to the cognito-auth module for JWT validation, and
 * returns the IAM policy response to API Gateway.
 */
export const handler = async (
  event: APIGatewayTokenAuthorizerEvent
): Promise<APIGatewayAuthorizerResult> => {
  const { authorizationToken, methodArn } = event;

  const result = await handleAuthorizerEvent(authorizationToken, methodArn);

  return result;
};
