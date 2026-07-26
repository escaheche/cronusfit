import { describe, it, expect } from 'vitest';
import { sanitizeInput, sanitizeQuoteFields } from './sanitize.js';
import { QuoteSubmitRequest } from '../types/quote.js';

describe('sanitizeInput', () => {
  it('strips HTML tags from input', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe('alert(&quot;xss&quot;)');
  });

  it('strips self-closing HTML tags', () => {
    expect(sanitizeInput('hello<br/>world')).toBe('helloworld');
  });

  it('strips nested HTML tags', () => {
    expect(sanitizeInput('<div><p>text</p></div>')).toBe('text');
  });

  it('encodes ampersand', () => {
    expect(sanitizeInput('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('encodes less-than sign', () => {
    expect(sanitizeInput('a < b')).toBe('a &lt; b');
  });

  it('encodes greater-than sign', () => {
    expect(sanitizeInput('a > b')).toBe('a &gt; b');
  });

  it('encodes double quotes', () => {
    expect(sanitizeInput('say "hello"')).toBe('say &quot;hello&quot;');
  });

  it('encodes single quotes', () => {
    expect(sanitizeInput("it's fine")).toBe('it&#x27;s fine');
  });

  it('does not double-encode existing entities', () => {
    // If input has &amp; it should become &amp;amp; (encode the & in &amp;)
    expect(sanitizeInput('&amp;')).toBe('&amp;amp;');
  });

  it('handles empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('handles string with no special characters', () => {
    expect(sanitizeInput('hello world')).toBe('hello world');
  });

  it('handles complex mixed input', () => {
    const input = '<b>Bold & "quoted"</b> with <script>evil</script>';
    const expected = 'Bold &amp; &quot;quoted&quot; with evil';
    expect(sanitizeInput(input)).toBe(expected);
  });
});

describe('sanitizeQuoteFields', () => {
  const baseRequest = {
    clientName: 'John <Doe>',
    email: 'john@example.com',
    phone: '+1234567890',
    productId: 'prod-123',
    quantity: 10,
    ageGroup: 'adult',
    sizes: ['M', 'L & XL'],
    customizationNotes: 'Add "logo" here',
    captchaToken: 'token-abc',
  } as QuoteSubmitRequest;

  it('sanitizes clientName by stripping HTML-like tags', () => {
    const result = sanitizeQuoteFields(baseRequest);
    // '<Doe>' is stripped as an HTML tag, leaving 'John '
    expect(result.clientName).toBe('John ');
  });

  it('sanitizes email', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.email).toBe('john@example.com');
  });

  it('sanitizes phone', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.phone).toBe('+1234567890');
  });

  it('sanitizes productId', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.productId).toBe('prod-123');
  });

  it('sanitizes sizes array entries', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.sizes).toEqual(['M', 'L &amp; XL']);
  });

  it('sanitizes customizationNotes when present', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.customizationNotes).toBe('Add &quot;logo&quot; here');
  });

  it('handles undefined customizationNotes', () => {
    const request = { ...baseRequest, customizationNotes: undefined };
    const result = sanitizeQuoteFields(request);
    expect(result.customizationNotes).toBeUndefined();
  });

  it('preserves numeric quantity unchanged', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.quantity).toBe(10);
  });

  it('preserves ageGroup unchanged', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.ageGroup).toBe('adult');
  });

  it('preserves captchaToken unchanged', () => {
    const result = sanitizeQuoteFields(baseRequest);
    expect(result.captchaToken).toBe('token-abc');
  });
});
