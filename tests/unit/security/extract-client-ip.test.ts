import { describe, it, expect } from 'vitest';
import { extractClientIp } from '../../../src/modules/security/public-rate-limiter.js';

describe('extractClientIp', () => {
  it('returns null for undefined header', () => {
    expect(extractClientIp(undefined)).toBeNull();
  });

  it('returns null for empty string header', () => {
    expect(extractClientIp('')).toBeNull();
  });

  it('returns null for whitespace-only header', () => {
    expect(extractClientIp('   ')).toBeNull();
  });

  it('returns null for header with only commas and spaces', () => {
    expect(extractClientIp(', , ')).toBeNull();
  });

  it('returns the single IP when only one IP present', () => {
    expect(extractClientIp('203.0.113.50')).toBe('203.0.113.50');
  });

  it('trims whitespace from single IP', () => {
    expect(extractClientIp('  203.0.113.50  ')).toBe('203.0.113.50');
  });

  it('returns second-from-right IP when two IPs present', () => {
    // Client: 10.0.0.1, CloudFront appended: 203.0.113.50
    expect(extractClientIp('10.0.0.1, 203.0.113.50')).toBe('10.0.0.1');
  });

  it('returns second-from-right IP when three IPs present', () => {
    // Proxy chain: 10.0.0.1, 192.168.1.1, 203.0.113.50 (CloudFront)
    expect(extractClientIp('10.0.0.1, 192.168.1.1, 203.0.113.50')).toBe('192.168.1.1');
  });

  it('trims whitespace from individual IPs in chain', () => {
    expect(extractClientIp(' 10.0.0.1 , 192.168.1.1 , 203.0.113.50 ')).toBe('192.168.1.1');
  });

  it('handles IPv6 addresses', () => {
    expect(extractClientIp('::1')).toBe('::1');
  });

  it('handles mixed IPv4 and IPv6 addresses', () => {
    expect(extractClientIp('2001:db8::1, 203.0.113.50')).toBe('2001:db8::1');
  });
});
