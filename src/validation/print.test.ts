import { describe, it, expect } from 'vitest';
import {
  validateDTFDimensions,
  validateSublimationDimensions,
  DTF_MIN_MM,
  DTF_MAX_MM,
  SUBLIMATION_MIN_MM,
  SUBLIMATION_MAX_MM,
} from './print.js';

describe('validateDTFDimensions', () => {
  it('returns valid for minimum dimensions (10mm x 10mm)', () => {
    const result = validateDTFDimensions({ widthMm: 10, heightMm: 10 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for maximum dimensions (500mm x 500mm)', () => {
    const result = validateDTFDimensions({ widthMm: 500, heightMm: 500 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for mid-range dimensions', () => {
    const result = validateDTFDimensions({ widthMm: 250, heightMm: 300 });
    expect(result.valid).toBe(true);
  });

  it('returns error for width below minimum', () => {
    const result = validateDTFDimensions({ widthMm: 9, heightMm: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('widthMm');
    expect(result.errors[0].code).toBe('OUT_OF_RANGE');
  });

  it('returns error for height above maximum', () => {
    const result = validateDTFDimensions({ widthMm: 100, heightMm: 501 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('heightMm');
  });

  it('returns errors for both dimensions invalid', () => {
    const result = validateDTFDimensions({ widthMm: 5, heightMm: 600 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('returns error for NaN width', () => {
    const result = validateDTFDimensions({ widthMm: NaN, heightMm: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('widthMm');
  });

  it('errors include bilingual messages', () => {
    const result = validateDTFDimensions({ widthMm: 0, heightMm: 100 });
    expect(result.errors[0].message.es).toContain('10mm');
    expect(result.errors[0].message.en).toContain('10mm');
  });

  it('exports correct constants', () => {
    expect(DTF_MIN_MM).toBe(10);
    expect(DTF_MAX_MM).toBe(500);
  });
});

describe('validateSublimationDimensions', () => {
  it('returns valid for minimum dimensions (10mm x 10mm)', () => {
    const result = validateSublimationDimensions({ widthMm: 10, heightMm: 10 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for maximum dimensions (1500mm x 1500mm)', () => {
    const result = validateSublimationDimensions({ widthMm: 1500, heightMm: 1500 });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for mid-range dimensions (750mm)', () => {
    const result = validateSublimationDimensions({ widthMm: 750, heightMm: 750 });
    expect(result.valid).toBe(true);
  });

  it('returns error for width below minimum', () => {
    const result = validateSublimationDimensions({ widthMm: 9, heightMm: 100 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('widthMm');
    expect(result.errors[0].code).toBe('OUT_OF_RANGE');
  });

  it('returns error for height above maximum', () => {
    const result = validateSublimationDimensions({ widthMm: 100, heightMm: 1501 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('heightMm');
  });

  it('returns errors for both dimensions invalid', () => {
    const result = validateSublimationDimensions({ widthMm: 5, heightMm: 2000 });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('returns error for NaN height', () => {
    const result = validateSublimationDimensions({ widthMm: 100, heightMm: NaN });
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('heightMm');
  });

  it('errors include bilingual messages', () => {
    const result = validateSublimationDimensions({ widthMm: 0, heightMm: 100 });
    expect(result.errors[0].message.es).toContain('sublimación');
    expect(result.errors[0].message.en).toContain('Sublimation');
  });

  it('exports correct constants', () => {
    expect(SUBLIMATION_MIN_MM).toBe(10);
    expect(SUBLIMATION_MAX_MM).toBe(1500);
  });
});
