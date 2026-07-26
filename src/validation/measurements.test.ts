import { describe, it, expect } from 'vitest';
import {
  isValidMeasurement,
  validateMeasurements,
  validateGarmentType,
  validateSize,
  validateAgeGroup,
  validateControlPoints,
  MEASUREMENT_MIN_MM,
  MEASUREMENT_MAX_MM,
  MIN_CONTROL_POINTS,
} from './measurements.js';
import type { ControlPoint } from '../types/pattern.js';

// ─── isValidMeasurement ──────────────────────────────────────────────────────

describe('isValidMeasurement', () => {
  it('returns true for minimum valid value (10mm)', () => {
    expect(isValidMeasurement(10)).toBe(true);
  });

  it('returns true for maximum valid value (2000mm)', () => {
    expect(isValidMeasurement(2000)).toBe(true);
  });

  it('returns true for a mid-range value', () => {
    expect(isValidMeasurement(500)).toBe(true);
  });

  it('returns false for value below minimum', () => {
    expect(isValidMeasurement(9.99)).toBe(false);
  });

  it('returns false for value above maximum', () => {
    expect(isValidMeasurement(2001)).toBe(false);
  });

  it('returns false for zero', () => {
    expect(isValidMeasurement(0)).toBe(false);
  });

  it('returns false for negative values', () => {
    expect(isValidMeasurement(-100)).toBe(false);
  });

  it('returns false for NaN', () => {
    expect(isValidMeasurement(NaN)).toBe(false);
  });

  it('returns false for Infinity', () => {
    expect(isValidMeasurement(Infinity)).toBe(false);
  });
});

// ─── validateMeasurements ────────────────────────────────────────────────────

describe('validateMeasurements', () => {
  it('returns valid for an empty measurements record', () => {
    const result = validateMeasurements({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid when all measurements are within range', () => {
    const result = validateMeasurements({
      chest: 500,
      waist: 400,
      hip: 550,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns errors for measurements below minimum', () => {
    const result = validateMeasurements({
      chest: 5,
      waist: 400,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('chest');
    expect(result.errors[0].code).toBe('OUT_OF_RANGE');
    expect(result.errors[0].message.es).toContain('10mm');
    expect(result.errors[0].message.en).toContain('10mm');
  });

  it('returns errors for measurements above maximum', () => {
    const result = validateMeasurements({
      length: 2500,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('length');
    expect(result.errors[0].code).toBe('OUT_OF_RANGE');
  });

  it('returns errors for NaN values', () => {
    const result = validateMeasurements({
      sleeve: NaN,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('sleeve');
    expect(result.errors[0].code).toBe('INVALID_NUMBER');
  });

  it('returns multiple errors for multiple invalid measurements', () => {
    const result = validateMeasurements({
      chest: 5,
      waist: 3000,
      hip: NaN,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  it('reports errors with bilingual messages', () => {
    const result = validateMeasurements({ chest: 5 });
    expect(result.errors[0].message.es).toBeTruthy();
    expect(result.errors[0].message.en).toBeTruthy();
  });

  it('exports correct constants', () => {
    expect(MEASUREMENT_MIN_MM).toBe(10);
    expect(MEASUREMENT_MAX_MM).toBe(2000);
  });
});

// ─── validateGarmentType ─────────────────────────────────────────────────────

describe('validateGarmentType', () => {
  it('returns valid for "camiseta"', () => {
    expect(validateGarmentType('camiseta').valid).toBe(true);
  });

  it('returns valid for "short"', () => {
    expect(validateGarmentType('short').valid).toBe(true);
  });

  it('returns valid for "legging"', () => {
    expect(validateGarmentType('legging').valid).toBe(true);
  });

  it('returns valid for "sudadera"', () => {
    expect(validateGarmentType('sudadera').valid).toBe(true);
  });

  it('returns valid for "tank-top"', () => {
    expect(validateGarmentType('tank-top').valid).toBe(true);
  });

  it('returns valid for "custom"', () => {
    expect(validateGarmentType('custom').valid).toBe(true);
  });

  it('returns valid for legacy "tank_top"', () => {
    expect(validateGarmentType('tank_top').valid).toBe(true);
  });

  it('returns error for invalid garment type', () => {
    const result = validateGarmentType('vestido');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('garmentType');
    expect(result.errors[0].code).toBe('INVALID_GARMENT_TYPE');
    expect(result.errors[0].message.es).toContain('vestido');
    expect(result.errors[0].message.en).toContain('vestido');
  });

  it('returns error for empty string', () => {
    const result = validateGarmentType('');
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('INVALID_GARMENT_TYPE');
  });

  it('returns error message listing valid types', () => {
    const result = validateGarmentType('invalid');
    expect(result.errors[0].message.en).toContain('camiseta');
    expect(result.errors[0].message.en).toContain('tank-top');
    expect(result.errors[0].message.en).toContain('custom');
  });
});

// ─── validateSize ────────────────────────────────────────────────────────────

describe('validateSize', () => {
  it('returns valid for children sizes', () => {
    const childrenSizes = ['2T', '4T', '6', '8', '10', '12', '14', '16'];
    for (const size of childrenSizes) {
      expect(validateSize(size).valid).toBe(true);
    }
  });

  it('returns valid for adult sizes', () => {
    const adultSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];
    for (const size of adultSizes) {
      expect(validateSize(size).valid).toBe(true);
    }
  });

  it('returns error for invalid size', () => {
    const result = validateSize('XXXL');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('size');
    expect(result.errors[0].code).toBe('INVALID_SIZE');
    expect(result.errors[0].message.es).toContain('XXXL');
  });

  it('returns error for empty string', () => {
    const result = validateSize('');
    expect(result.valid).toBe(false);
  });

  it('returns error message listing valid sizes by age group', () => {
    const result = validateSize('7XL');
    expect(result.errors[0].message.en).toContain('Children');
    expect(result.errors[0].message.en).toContain('Adults');
    expect(result.errors[0].message.en).toContain('2T');
    expect(result.errors[0].message.en).toContain('6XL');
  });

  it('is case-sensitive (lowercase "xs" is invalid)', () => {
    const result = validateSize('xs');
    expect(result.valid).toBe(false);
  });
});

// ─── validateAgeGroup ────────────────────────────────────────────────────────

describe('validateAgeGroup', () => {
  it('returns valid for "children"', () => {
    expect(validateAgeGroup('children').valid).toBe(true);
  });

  it('returns valid for "adult"', () => {
    expect(validateAgeGroup('adult').valid).toBe(true);
  });

  it('returns error for "adults" (plural)', () => {
    const result = validateAgeGroup('adults');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('ageGroup');
    expect(result.errors[0].code).toBe('INVALID_AGE_GROUP');
  });

  it('returns error for empty string', () => {
    const result = validateAgeGroup('');
    expect(result.valid).toBe(false);
  });

  it('returns bilingual error messages', () => {
    const result = validateAgeGroup('teen');
    expect(result.errors[0].message.es).toContain('children');
    expect(result.errors[0].message.en).toContain('children');
  });
});

// ─── validateControlPoints ───────────────────────────────────────────────────

describe('validateControlPoints', () => {
  /** Helper to create a valid control point for testing. */
  function makeControlPoint(overrides: Partial<ControlPoint> = {}): ControlPoint {
    return {
      id: 'cp-1',
      name: 'Test Point',
      x: 100,
      y: 200,
      minValue: 50,
      maxValue: 500,
      affectedPieces: ['piece-1'],
      ...overrides,
    };
  }

  it('returns valid for 4 control points with valid ranges', () => {
    const points = Array.from({ length: 4 }, (_, i) =>
      makeControlPoint({ id: `cp-${i}`, name: `Point ${i}` }),
    );
    const result = validateControlPoints(points);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid for more than 4 control points', () => {
    const points = Array.from({ length: 10 }, (_, i) =>
      makeControlPoint({ id: `cp-${i}` }),
    );
    expect(validateControlPoints(points).valid).toBe(true);
  });

  it('returns error for fewer than 4 control points', () => {
    const points = [makeControlPoint(), makeControlPoint({ id: 'cp-2' }), makeControlPoint({ id: 'cp-3' })];
    const result = validateControlPoints(points);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INSUFFICIENT_CONTROL_POINTS')).toBe(true);
    expect(result.errors[0].message.es).toContain('4');
    expect(result.errors[0].message.en).toContain('3 provided');
  });

  it('returns error for empty array', () => {
    const result = validateControlPoints([]);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INSUFFICIENT_CONTROL_POINTS')).toBe(true);
  });

  it('returns error when minValue is below 10mm', () => {
    const points = Array.from({ length: 4 }, (_, i) =>
      makeControlPoint({
        id: `cp-${i}`,
        minValue: i === 0 ? 5 : 50,
      }),
    );
    const result = validateControlPoints(points);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'OUT_OF_RANGE' && e.field.includes('[0]'))).toBe(true);
  });

  it('returns error when maxValue exceeds 2000mm', () => {
    const points = Array.from({ length: 4 }, (_, i) =>
      makeControlPoint({
        id: `cp-${i}`,
        maxValue: i === 2 ? 2500 : 500,
      }),
    );
    const result = validateControlPoints(points);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'OUT_OF_RANGE' && e.field.includes('[2]'))).toBe(true);
  });

  it('returns error when minValue > maxValue', () => {
    const points = Array.from({ length: 4 }, (_, i) =>
      makeControlPoint({
        id: `cp-${i}`,
        minValue: i === 1 ? 600 : 50,
        maxValue: i === 1 ? 200 : 500,
      }),
    );
    const result = validateControlPoints(points);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_RANGE_ORDER')).toBe(true);
  });

  it('supports min/max alias fields', () => {
    const points = Array.from({ length: 4 }, (_, i) => ({
      id: `cp-${i}`,
      name: `Point ${i}`,
      x: 100,
      y: 200,
      minValue: undefined as unknown as number,
      maxValue: undefined as unknown as number,
      min: 50,
      max: 500,
      affectedPieces: ['piece-1'],
    })) as unknown as ControlPoint[];
    const result = validateControlPoints(points);
    expect(result.valid).toBe(true);
  });

  it('returns error when min/max values are NaN', () => {
    const points = Array.from({ length: 4 }, (_, i) =>
      makeControlPoint({
        id: `cp-${i}`,
        minValue: i === 0 ? NaN : 50,
      }),
    );
    const result = validateControlPoints(points);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_NUMBER')).toBe(true);
  });

  it('exports MIN_CONTROL_POINTS constant', () => {
    expect(MIN_CONTROL_POINTS).toBe(4);
  });

  it('returns specific error messages with control point name', () => {
    const points = Array.from({ length: 4 }, (_, i) =>
      makeControlPoint({
        id: `cp-${i}`,
        name: `Shoulder ${i}`,
        minValue: i === 0 ? 5 : 50,
      }),
    );
    const result = validateControlPoints(points);
    expect(result.errors[0].message.en).toContain('Shoulder 0');
    expect(result.errors[0].message.es).toContain('Shoulder 0');
  });
});
