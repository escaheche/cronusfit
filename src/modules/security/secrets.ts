/**
 * Centralized credential management via AWS Secrets Manager.
 *
 * Loads platform credentials (WAHA API key, webhook secret, n8n URL, hCaptcha secret)
 * from a single JSON secret stored in AWS Secrets Manager. Credentials are cached
 * in a module-level variable for Lambda warm invocations and support rotation
 * without redeployment via forced refresh.
 *
 * Environment variables:
 * - SECRETS_NAME: Name of the secret in Secrets Manager (default: 'cronusfit/credentials')
 * - AWS_REGION or SECRETS_REGION: AWS region for Secrets Manager client
 *
 * Local development fallback env vars (used when Secrets Manager is unavailable):
 * - WAHA_API_KEY
 * - WAHA_WEBHOOK_SECRET
 * - N8N_WEBHOOK_URL
 * - HCAPTCHA_SECRET
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// ─── Interfaces ──────────────────────────────────────────────────────────────

/** Platform credentials stored as a JSON blob in Secrets Manager. */
export interface PlatformCredentials {
  wahaApiKey: string;
  wahaWebhookSecret: string;
  n8nWebhookUrl: string;
  hcaptchaSecret: string;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export class CredentialError extends Error {
  public readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CredentialError';
    this.code = code;
  }
}

// ─── Configuration ───────────────────────────────────────────────────────────

function getSecretsName(): string {
  return process.env.SECRETS_NAME ?? 'cronusfit/credentials';
}

function getSecretsRegion(): string | undefined {
  return process.env.SECRETS_REGION ?? process.env.AWS_REGION ?? undefined;
}

// ─── Secrets Manager Client (lazy initialization) ────────────────────────────

let smClient: SecretsManagerClient | null = null;

function getSecretsManagerClient(): SecretsManagerClient {
  if (!smClient) {
    const region = getSecretsRegion();
    smClient = new SecretsManagerClient(region ? { region } : {});
  }
  return smClient;
}

// ─── Module-level Credential Cache ───────────────────────────────────────────

let cachedCredentials: PlatformCredentials | null = null;

// ─── Validation ──────────────────────────────────────────────────────────────

const REQUIRED_KEYS: (keyof PlatformCredentials)[] = [
  'wahaApiKey',
  'wahaWebhookSecret',
  'n8nWebhookUrl',
  'hcaptchaSecret',
];

/**
 * Validates that a parsed object contains all required credential fields
 * with non-empty string values.
 */
function validateCredentials(obj: unknown): PlatformCredentials {
  if (!obj || typeof obj !== 'object') {
    throw new CredentialError(
      'Secret value is not a valid JSON object',
      'INVALID_FORMAT'
    );
  }

  const record = obj as Record<string, unknown>;
  const missing: string[] = [];

  for (const key of REQUIRED_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new CredentialError(
      `Missing or empty credential fields: ${missing.join(', ')}`,
      'MISSING_FIELDS'
    );
  }

  return {
    wahaApiKey: (record.wahaApiKey as string).trim(),
    wahaWebhookSecret: (record.wahaWebhookSecret as string).trim(),
    n8nWebhookUrl: (record.n8nWebhookUrl as string).trim(),
    hcaptchaSecret: (record.hcaptchaSecret as string).trim(),
  };
}

// ─── Local Env Var Fallback ──────────────────────────────────────────────────

/**
 * Attempts to load credentials from environment variables.
 * Used as a fallback for local development when Secrets Manager is unavailable.
 *
 * @returns PlatformCredentials if all env vars are set, null otherwise
 */
function loadFromEnvVars(): PlatformCredentials | null {
  const wahaApiKey = process.env.WAHA_API_KEY;
  const wahaWebhookSecret = process.env.WAHA_WEBHOOK_SECRET;
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
  const hcaptchaSecret = process.env.HCAPTCHA_SECRET;

  if (wahaApiKey && wahaWebhookSecret && n8nWebhookUrl && hcaptchaSecret) {
    return {
      wahaApiKey: wahaApiKey.trim(),
      wahaWebhookSecret: wahaWebhookSecret.trim(),
      n8nWebhookUrl: n8nWebhookUrl.trim(),
      hcaptchaSecret: hcaptchaSecret.trim(),
    };
  }

  return null;
}

// ─── Core: Load from Secrets Manager ─────────────────────────────────────────

/**
 * Fetches credentials from AWS Secrets Manager and validates the result.
 *
 * @returns Validated PlatformCredentials
 * @throws CredentialError if the secret cannot be retrieved or is malformed
 */
async function loadFromSecretsManager(): Promise<PlatformCredentials> {
  const client = getSecretsManagerClient();
  const secretName = getSecretsName();

  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretName })
  );

  if (!response.SecretString) {
    throw new CredentialError(
      `Secret '${secretName}' has no string value`,
      'EMPTY_SECRET'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.SecretString);
  } catch {
    throw new CredentialError(
      `Secret '${secretName}' contains invalid JSON`,
      'INVALID_JSON'
    );
  }

  return validateCredentials(parsed);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns cached platform credentials or loads them fresh.
 *
 * Load order:
 * 1. Return cached credentials if available (Lambda warm invocation).
 * 2. Attempt to load from AWS Secrets Manager.
 * 3. Fall back to environment variables (local development).
 * 4. Throw CredentialError if all sources fail.
 *
 * @returns Promise resolving to PlatformCredentials
 * @throws CredentialError if credentials cannot be loaded from any source
 */
export async function getCredentials(): Promise<PlatformCredentials> {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  // Try Secrets Manager first
  try {
    cachedCredentials = await loadFromSecretsManager();
    return cachedCredentials;
  } catch (smError) {
    // If the secret was retrieved but content is invalid, propagate directly
    // (no point falling back to env vars for a validation error)
    if (
      smError instanceof CredentialError &&
      (smError.code === 'MISSING_FIELDS' ||
        smError.code === 'INVALID_FORMAT' ||
        smError.code === 'INVALID_JSON')
    ) {
      throw smError;
    }

    // Fall back to env vars for local development (connectivity/auth errors)
    const envCreds = loadFromEnvVars();
    if (envCreds) {
      cachedCredentials = envCreds;
      return cachedCredentials;
    }

    // Both sources failed
    throw new CredentialError(
      `Failed to load credentials from Secrets Manager (${(smError as Error).message}) ` +
        'and no fallback environment variables are set. ' +
        'Set WAHA_API_KEY, WAHA_WEBHOOK_SECRET, N8N_WEBHOOK_URL, and HCAPTCHA_SECRET ' +
        'for local development, or ensure Secrets Manager is accessible.',
      'LOAD_FAILED'
    );
  }
}

/**
 * Forces a reload of credentials from Secrets Manager, bypassing the cache.
 * Supports secret rotation without Lambda redeployment.
 *
 * If the refresh fails and cached credentials exist, returns the stale cached
 * values and logs a warning. If no cached credentials exist (cold start failure),
 * throws the error.
 *
 * @returns Promise resolving to freshly loaded PlatformCredentials
 * @throws CredentialError if refresh fails and no cached credentials are available
 */
export async function refreshCredentials(): Promise<PlatformCredentials> {
  try {
    const fresh = await loadFromSecretsManager();
    cachedCredentials = fresh;
    return fresh;
  } catch (error) {
    // If we have cached credentials, return stale and log warning
    if (cachedCredentials) {
      console.warn(
        JSON.stringify({
          type: 'CREDENTIAL_REFRESH_FAILED',
          secretName: getSecretsName(),
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
          fallback: 'using_cached',
        })
      );
      return cachedCredentials;
    }

    // No cache — try env var fallback
    const envCreds = loadFromEnvVars();
    if (envCreds) {
      cachedCredentials = envCreds;
      return cachedCredentials;
    }

    // Nothing available — propagate the error
    throw new CredentialError(
      `Credential refresh failed: ${(error as Error).message}. No cached or fallback credentials available.`,
      'REFRESH_FAILED'
    );
  }
}

/**
 * Retrieves a single credential by key name.
 * Uses the cached credentials or loads them if not yet cached.
 *
 * @param key - The credential field name to retrieve
 * @returns Promise resolving to the credential value
 * @throws CredentialError if credentials cannot be loaded
 */
export async function getCredential(
  key: keyof PlatformCredentials
): Promise<string> {
  const creds = await getCredentials();
  return creds[key];
}

// ─── Test Helpers (for unit test setup/teardown) ─────────────────────────────

/**
 * Clears the cached credentials. Used in tests to reset state between runs.
 * @internal
 */
export function _clearCache(): void {
  cachedCredentials = null;
}

/**
 * Overrides the Secrets Manager client for testing.
 * @internal
 */
export function _setClient(client: SecretsManagerClient): void {
  smClient = client;
}
