import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to declare mock functions available in vi.mock factories
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

// Mock SecretsManager
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = mockSend;
  },
  GetSecretValueCommand: class {
    readonly SecretId: string;
    constructor(input: { SecretId: string }) {
      this.SecretId = input.SecretId;
    }
  },
}));

import {
  getCredentials,
  refreshCredentials,
  getCredential,
  CredentialError,
  _clearCache,
  _setClient,
} from '../../../src/modules/security/secrets.js';

const VALID_SECRET = JSON.stringify({
  wahaApiKey: 'waha-key-123',
  wahaWebhookSecret: 'webhook-secret-456',
  n8nWebhookUrl: 'https://n8n.example.com/webhook',
  hcaptchaSecret: 'hcaptcha-0x-secret',
});

describe('secrets - credential management via Secrets Manager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    _clearCache();
    process.env = { ...originalEnv };
    // Remove fallback env vars by default
    delete process.env.WAHA_API_KEY;
    delete process.env.WAHA_WEBHOOK_SECRET;
    delete process.env.N8N_WEBHOOK_URL;
    delete process.env.HCAPTCHA_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('getCredentials', () => {
    it('loads credentials from Secrets Manager and returns all fields', async () => {
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });

      const creds = await getCredentials();

      expect(creds).toEqual({
        wahaApiKey: 'waha-key-123',
        wahaWebhookSecret: 'webhook-secret-456',
        n8nWebhookUrl: 'https://n8n.example.com/webhook',
        hcaptchaSecret: 'hcaptcha-0x-secret',
      });
    });

    it('caches credentials on subsequent calls (warm invocation)', async () => {
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });

      const first = await getCredentials();
      const second = await getCredentials();

      expect(first).toBe(second); // Same reference — served from cache
      expect(mockSend).toHaveBeenCalledTimes(1); // Only one Secrets Manager call
    });

    it('trims whitespace from credential values', async () => {
      mockSend.mockResolvedValue({
        SecretString: JSON.stringify({
          wahaApiKey: '  waha-key  ',
          wahaWebhookSecret: ' secret ',
          n8nWebhookUrl: ' https://n8n.test.com ',
          hcaptchaSecret: ' hcap ',
        }),
      });

      const creds = await getCredentials();

      expect(creds.wahaApiKey).toBe('waha-key');
      expect(creds.wahaWebhookSecret).toBe('secret');
      expect(creds.n8nWebhookUrl).toBe('https://n8n.test.com');
      expect(creds.hcaptchaSecret).toBe('hcap');
    });

    it('falls back to env vars when Secrets Manager fails', async () => {
      mockSend.mockRejectedValue(new Error('Access Denied'));

      process.env.WAHA_API_KEY = 'env-waha-key';
      process.env.WAHA_WEBHOOK_SECRET = 'env-webhook-secret';
      process.env.N8N_WEBHOOK_URL = 'https://env-n8n.example.com';
      process.env.HCAPTCHA_SECRET = 'env-hcaptcha';

      const creds = await getCredentials();

      expect(creds).toEqual({
        wahaApiKey: 'env-waha-key',
        wahaWebhookSecret: 'env-webhook-secret',
        n8nWebhookUrl: 'https://env-n8n.example.com',
        hcaptchaSecret: 'env-hcaptcha',
      });
    });

    it('throws CredentialError when both Secrets Manager and env vars fail', async () => {
      mockSend.mockRejectedValue(new Error('Network error'));

      await expect(getCredentials()).rejects.toThrow(CredentialError);
      await expect(getCredentials()).rejects.toMatchObject({
        code: 'LOAD_FAILED',
      });
    });

    it('throws CredentialError when secret has no SecretString', async () => {
      mockSend.mockResolvedValue({ SecretString: undefined });

      await expect(getCredentials()).rejects.toThrow(CredentialError);
    });

    it('throws CredentialError when secret contains invalid JSON', async () => {
      mockSend.mockResolvedValue({ SecretString: 'not-json{' });

      await expect(getCredentials()).rejects.toThrow(CredentialError);
    });

    it('throws CredentialError when secret is missing required fields', async () => {
      mockSend.mockResolvedValue({
        SecretString: JSON.stringify({
          wahaApiKey: 'key',
          // missing other fields
        }),
      });

      const error = await getCredentials().catch((e) => e);
      expect(error).toBeInstanceOf(CredentialError);
      expect(error.code).toBe('MISSING_FIELDS');
      expect(error.message).toContain('wahaWebhookSecret');
    });

    it('throws CredentialError when a field is an empty string', async () => {
      mockSend.mockResolvedValue({
        SecretString: JSON.stringify({
          wahaApiKey: 'key',
          wahaWebhookSecret: '',
          n8nWebhookUrl: 'url',
          hcaptchaSecret: 'secret',
        }),
      });

      await expect(getCredentials()).rejects.toThrow(CredentialError);
    });
  });

  describe('refreshCredentials', () => {
    it('bypasses cache and reloads from Secrets Manager', async () => {
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });
      await getCredentials(); // Populate cache

      const updatedSecret = JSON.stringify({
        wahaApiKey: 'rotated-key',
        wahaWebhookSecret: 'rotated-secret',
        n8nWebhookUrl: 'https://new-n8n.example.com',
        hcaptchaSecret: 'rotated-hcaptcha',
      });
      mockSend.mockResolvedValue({ SecretString: updatedSecret });

      const refreshed = await refreshCredentials();

      expect(refreshed.wahaApiKey).toBe('rotated-key');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('returns stale cached credentials when refresh fails but cache exists', async () => {
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });
      await getCredentials(); // Populate cache

      mockSend.mockRejectedValue(new Error('Temporary failure'));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await refreshCredentials();

      expect(result.wahaApiKey).toBe('waha-key-123'); // Stale but available
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('throws when refresh fails and no cache or env vars exist', async () => {
      mockSend.mockRejectedValue(new Error('Service unavailable'));

      await expect(refreshCredentials()).rejects.toThrow(CredentialError);
      await expect(refreshCredentials()).rejects.toMatchObject({
        code: 'REFRESH_FAILED',
      });
    });

    it('falls back to env vars when refresh fails and no cache exists', async () => {
      mockSend.mockRejectedValue(new Error('Service unavailable'));
      process.env.WAHA_API_KEY = 'env-key';
      process.env.WAHA_WEBHOOK_SECRET = 'env-secret';
      process.env.N8N_WEBHOOK_URL = 'https://env-n8n.test.com';
      process.env.HCAPTCHA_SECRET = 'env-hcap';

      const result = await refreshCredentials();

      expect(result.wahaApiKey).toBe('env-key');
    });
  });

  describe('getCredential', () => {
    it('returns a single credential field by key', async () => {
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });

      const apiKey = await getCredential('wahaApiKey');
      expect(apiKey).toBe('waha-key-123');

      const webhookUrl = await getCredential('n8nWebhookUrl');
      expect(webhookUrl).toBe('https://n8n.example.com/webhook');
    });

    it('uses cached credentials when available', async () => {
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });

      await getCredential('wahaApiKey');
      await getCredential('hcaptchaSecret');

      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('configuration', () => {
    it('uses SECRETS_NAME env var for the secret name', async () => {
      process.env.SECRETS_NAME = 'custom/secret-name';
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });

      await getCredentials();

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ SecretId: 'custom/secret-name' })
      );
    });

    it('defaults secret name to cronusfit/credentials when SECRETS_NAME not set', async () => {
      delete process.env.SECRETS_NAME;
      mockSend.mockResolvedValue({ SecretString: VALID_SECRET });

      await getCredentials();

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ SecretId: 'cronusfit/credentials' })
      );
    });
  });
});
