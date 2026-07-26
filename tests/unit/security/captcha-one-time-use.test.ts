import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to declare mock functions that need to be available in vi.mock factories
const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// Mock DynamoDB operations for token reuse check and storage
vi.mock('../../../src/db/operations.js', () => ({
  isTokenUsed: vi.fn(),
  storeUsedToken: vi.fn(),
}));

// Mock global fetch for hCaptcha siteverify API calls
vi.stubGlobal('fetch', mockFetch);

import { verifyCaptcha } from '../../../src/modules/security/captcha.js';
import { isTokenUsed, storeUsedToken } from '../../../src/db/operations.js';

const mockedIsTokenUsed = vi.mocked(isTokenUsed);
const mockedStoreUsedToken = vi.mocked(storeUsedToken);

describe('captcha one-time token use enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set HCAPTCHA_SECRET env var
    process.env.HCAPTCHA_SECRET = 'test-hcaptcha-secret';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HCAPTCHA_SECRET;
  });

  it('rejects a token that has already been used with "reused_token" error', async () => {
    mockedIsTokenUsed.mockResolvedValue(true);

    const result = await verifyCaptcha('previously-used-token', '192.168.1.1');

    expect(result.valid).toBe(false);
    expect(result.error).toBe('reused_token');
    // Should not call hCaptcha API or store the token again
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockedStoreUsedToken).not.toHaveBeenCalled();
  });

  it('stores the token hash after successful hCaptcha verification', async () => {
    mockedIsTokenUsed.mockResolvedValue(false);
    mockedStoreUsedToken.mockResolvedValue(undefined);

    // Mock successful hCaptcha API response
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    const result = await verifyCaptcha('fresh-valid-token', '192.168.1.1');

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    // Token hash should be stored after successful verification
    expect(mockedStoreUsedToken).toHaveBeenCalledTimes(1);
    // The argument should be a SHA-256 hex hash (64 characters)
    const storedHash = mockedStoreUsedToken.mock.calls[0][0];
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('passes a SHA-256 hash (not the raw token) to isTokenUsed', async () => {
    mockedIsTokenUsed.mockResolvedValue(true);

    await verifyCaptcha('some-token-value', '10.0.0.1');

    // The argument to isTokenUsed should be a SHA-256 hex string, not the raw token
    const checkedHash = mockedIsTokenUsed.mock.calls[0][0];
    expect(checkedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(checkedHash).not.toBe('some-token-value');
  });

  it('uses the same hash for checking and storing', async () => {
    mockedIsTokenUsed.mockResolvedValue(false);
    mockedStoreUsedToken.mockResolvedValue(undefined);
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await verifyCaptcha('consistent-hash-token', '10.0.0.1');

    const checkedHash = mockedIsTokenUsed.mock.calls[0][0];
    const storedHash = mockedStoreUsedToken.mock.calls[0][0];
    expect(checkedHash).toBe(storedHash);
  });
});
