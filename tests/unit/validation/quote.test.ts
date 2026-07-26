import { describe, it, expect } from 'vitest';
import {
  validateClientName,
  validateEmail,
  validatePhone,
  validateQuantity,
  validateAgeGroup,
  validateSizes,
  validateCustomizationNotes,
  validateTrackingNumber,
} from '../../../src/validation/quote.js';

describe('validateClientName', () => {
  it('rejects empty string', () => {
    const result = validateClientName('', 'es');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Este campo es obligatorio');
  });

  it('rejects null/undefined', () => {
    expect(validateClientName(null, 'en').valid).toBe(false);
    expect(validateClientName(undefined, 'en').valid).toBe(false);
  });

  it('rejects whitespace-only', () => {
    expect(validateClientName('   ', 'es').valid).toBe(false);
  });

  it('accepts valid name', () => {
    expect(validateClientName('Juan', 'es').valid).toBe(true);
  });

  it('accepts name at 100 characters', () => {
    const name = 'a'.repeat(100);
    expect(validateClientName(name, 'es').valid).toBe(true);
  });

  it('rejects name over 100 characters', () => {
    const name = 'a'.repeat(101);
    const result = validateClientName(name, 'en');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Name cannot exceed 100 characters');
  });

  it('returns Spanish error for required', () => {
    const result = validateClientName('', 'es');
    expect(result.error).toBe('Este campo es obligatorio');
  });

  it('returns English error for required', () => {
    const result = validateClientName('', 'en');
    expect(result.error).toBe('This field is required');
  });
});

describe('validateEmail', () => {
  it('rejects empty string', () => {
    expect(validateEmail('', 'es').valid).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(validateEmail(null, 'en').valid).toBe(false);
    expect(validateEmail(undefined, 'en').valid).toBe(false);
  });

  it('accepts valid email', () => {
    expect(validateEmail('user@example.com', 'es').valid).toBe(true);
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@sub.example.com', 'es').valid).toBe(true);
  });

  it('rejects email without @', () => {
    const result = validateEmail('userexample.com', 'en');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Enter a valid email address');
  });

  it('rejects email without domain', () => {
    expect(validateEmail('user@', 'es').valid).toBe(false);
  });

  it('rejects email without local part', () => {
    expect(validateEmail('@example.com', 'es').valid).toBe(false);
  });

  it('returns Spanish error for invalid email', () => {
    const result = validateEmail('bad', 'es');
    expect(result.error).toBe('Ingresa un correo electrónico válido');
  });
});

describe('validatePhone', () => {
  it('rejects empty string', () => {
    expect(validatePhone('', 'es').valid).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(validatePhone(null, 'en').valid).toBe(false);
    expect(validatePhone(undefined, 'en').valid).toBe(false);
  });

  it('accepts valid E.164 phone with 7 digits', () => {
    expect(validatePhone('+1234567', 'es').valid).toBe(true);
  });

  it('accepts valid E.164 phone with 15 digits', () => {
    expect(validatePhone('+123456789012345', 'es').valid).toBe(true);
  });

  it('accepts typical international phone', () => {
    expect(validatePhone('+573001234567', 'es').valid).toBe(true);
  });

  it('rejects phone without + prefix', () => {
    const result = validatePhone('573001234567', 'en');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Enter a valid phone with country code');
  });

  it('rejects phone with fewer than 7 digits', () => {
    expect(validatePhone('+123456', 'es').valid).toBe(false);
  });

  it('rejects phone with more than 15 digits', () => {
    expect(validatePhone('+1234567890123456', 'es').valid).toBe(false);
  });

  it('rejects phone with non-digit characters', () => {
    expect(validatePhone('+123-456-7890', 'es').valid).toBe(false);
  });

  it('returns Spanish error for invalid phone', () => {
    const result = validatePhone('bad', 'es');
    expect(result.error).toBe('Ingresa un teléfono válido con código de país');
  });
});

describe('validateQuantity', () => {
  it('rejects null/undefined', () => {
    expect(validateQuantity(null, 'es').valid).toBe(false);
    expect(validateQuantity(undefined, 'es').valid).toBe(false);
  });

  it('accepts 1', () => {
    expect(validateQuantity(1, 'es').valid).toBe(true);
  });

  it('accepts 10000', () => {
    expect(validateQuantity(10000, 'es').valid).toBe(true);
  });

  it('accepts typical quantity', () => {
    expect(validateQuantity(50, 'es').valid).toBe(true);
  });

  it('rejects 0', () => {
    expect(validateQuantity(0, 'en').valid).toBe(false);
  });

  it('rejects negative numbers', () => {
    expect(validateQuantity(-1, 'es').valid).toBe(false);
  });

  it('rejects numbers over 10000', () => {
    expect(validateQuantity(10001, 'es').valid).toBe(false);
  });

  it('rejects non-integer values', () => {
    expect(validateQuantity(5.5, 'es').valid).toBe(false);
  });

  it('returns English error for invalid quantity', () => {
    const result = validateQuantity(0, 'en');
    expect(result.error).toBe('Quantity must be an integer between 1 and 10000');
  });
});

describe('validateAgeGroup', () => {
  it('rejects empty string', () => {
    expect(validateAgeGroup('', 'es').valid).toBe(false);
  });

  it('rejects null/undefined', () => {
    expect(validateAgeGroup(null, 'en').valid).toBe(false);
    expect(validateAgeGroup(undefined, 'en').valid).toBe(false);
  });

  it('accepts "children"', () => {
    expect(validateAgeGroup('children', 'es').valid).toBe(true);
  });

  it('accepts "adult"', () => {
    expect(validateAgeGroup('adult', 'es').valid).toBe(true);
  });

  it('rejects invalid values', () => {
    const result = validateAgeGroup('teen', 'en');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Age group must be "children" or "adult"');
  });
});

describe('validateSizes', () => {
  it('rejects null/undefined', () => {
    expect(validateSizes(null, 'children', 'es').valid).toBe(false);
    expect(validateSizes(undefined, 'adult', 'es').valid).toBe(false);
  });

  it('rejects empty array', () => {
    expect(validateSizes([], 'children', 'es').valid).toBe(false);
  });

  it('accepts valid children sizes', () => {
    expect(validateSizes(['2T', '4T', '8'], 'children', 'es').valid).toBe(true);
  });

  it('accepts valid adult sizes', () => {
    expect(validateSizes(['S', 'M', 'L', 'XL'], 'adult', 'es').valid).toBe(true);
  });

  it('rejects adult sizes for children age group', () => {
    const result = validateSizes(['XL', '2XL'], 'children', 'en');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Select at least one valid size for the age group');
  });

  it('rejects children sizes for adult age group', () => {
    expect(validateSizes(['2T', '3T'], 'adult', 'es').valid).toBe(false);
  });

  it('rejects mixed valid and invalid sizes', () => {
    expect(validateSizes(['M', 'XXXL'], 'adult', 'es').valid).toBe(false);
  });
});

describe('validateCustomizationNotes', () => {
  it('accepts undefined (optional field)', () => {
    expect(validateCustomizationNotes(undefined, 'es').valid).toBe(true);
  });

  it('accepts null (optional field)', () => {
    expect(validateCustomizationNotes(null, 'es').valid).toBe(true);
  });

  it('accepts empty string', () => {
    expect(validateCustomizationNotes('', 'es').valid).toBe(true);
  });

  it('accepts notes under 1000 chars', () => {
    expect(validateCustomizationNotes('Color azul', 'es').valid).toBe(true);
  });

  it('accepts notes at exactly 1000 chars', () => {
    const notes = 'a'.repeat(1000);
    expect(validateCustomizationNotes(notes, 'es').valid).toBe(true);
  });

  it('rejects notes over 1000 chars', () => {
    const notes = 'a'.repeat(1001);
    const result = validateCustomizationNotes(notes, 'en');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Notes cannot exceed 1000 characters');
  });
});

describe('validateTrackingNumber', () => {
  it('rejects empty string', () => {
    const result = validateTrackingNumber('', 'es');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Este campo es obligatorio');
  });

  it('rejects null/undefined', () => {
    expect(validateTrackingNumber(null, 'en').valid).toBe(false);
    expect(validateTrackingNumber(undefined, 'en').valid).toBe(false);
  });

  it('rejects whitespace-only', () => {
    expect(validateTrackingNumber('   ', 'es').valid).toBe(false);
  });

  it('accepts valid alphanumeric tracking number', () => {
    expect(validateTrackingNumber('ABC123', 'es').valid).toBe(true);
  });

  it('accepts single character', () => {
    expect(validateTrackingNumber('A', 'es').valid).toBe(true);
  });

  it('accepts 36 character tracking number', () => {
    const tracking = 'a'.repeat(36);
    expect(validateTrackingNumber(tracking, 'es').valid).toBe(true);
  });

  it('rejects tracking number over 36 chars', () => {
    const tracking = 'a'.repeat(37);
    const result = validateTrackingNumber(tracking, 'en');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Tracking number must be alphanumeric, 1 to 36 characters');
  });

  it('rejects tracking number with special characters', () => {
    expect(validateTrackingNumber('ABC-123', 'es').valid).toBe(false);
  });

  it('rejects tracking number with spaces', () => {
    expect(validateTrackingNumber('ABC 123', 'es').valid).toBe(false);
  });
});
