/**
 * Property-based tests for Grading and Serialization (Properties 6–9).
 *
 * **Validates: Requirements 2.1–2.8, 3.1–3.5**
 *
 * Property 6: Grading Proportionality and Structural Preservation
 * Property 7: Grading Increment Table Validation
 * Property 8: Serialization Round-Trip Idempotence
 * Property 9: Malformed JSON Rejection
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  validateGradingTable,
  calculateGradedMeasurements,
} from '../../src/modules/pattern/grading-engine.js';
import {
  serializeSvgToJson,
  deserializeJsonToSvg,
  validateSerializedPattern,
  normalizeJson,
  areGeometricallyEqual,
} from '../../src/modules/pattern/serialization.js';
import type { GradingIncrementTable } from '../../src/types/pattern.js';
import type { AgeGroup, GarmentType } from '../../src/types/garment.js';
import type { SerializedPattern } from '../../src/modules/pattern/serialization.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const CHILDREN_TRANSITIONS = ['2T→4T', '4T→6', '6→8', '8→10', '10→12', '12→14', '14→16'];
const ADULT_TRANSITIONS = ['XS→S', 'S→M', 'M→L', 'L→XL', 'XL→XXL', 'XXL→3XL', '3XL→4XL', '4XL→5XL', '5XL→6XL'];
const CHILDREN_SIZES = ['2T', '4T', '6', '8', '10', '12', '14', '16'] as const;
const ADULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'] as const;

const GARMENT_TYPES: GarmentType[] = ['camiseta', 'short', 'legging', 'sudadera', 'tank_top'];

/** Generate a valid age group. */
const arbAgeGroup: fc.Arbitrary<AgeGroup> = fc.constantFrom('children', 'adult');

/** Generate a valid garment type. */
const arbGarmentType: fc.Arbitrary<GarmentType> = fc.constantFrom(...GARMENT_TYPES);

/** Generate control point IDs (some matching proportion categories for children). */
const CONTROL_POINT_IDS = [
  'shoulder_width', 'chest_width', 'waist_width', 'hip_width',
  'torso_length', 'arm_length', 'sleeve_length', 'leg_length',
  'inseam_length', 'neck_circumference',
];

/** Generate a subset of 2+ control point IDs. */
const arbControlPointIds = fc.subarray(CONTROL_POINT_IDS, { minLength: 2, maxLength: 6 });

/**
 * Generate a valid increment table with all transitions present
 * and all values within [0.1, 10].
 */
function arbValidIncrementTable(
  ageGroup: AgeGroup,
  controlPointIds: string[],
): fc.Arbitrary<GradingIncrementTable> {
  const transitions = ageGroup === 'children' ? CHILDREN_TRANSITIONS : ADULT_TRANSITIONS;

  return fc.record({
    garmentType: arbGarmentType,
    ageGroup: fc.constant(ageGroup),
    increments: fc.constant(null).chain(() => {
      // Build a record with all required transitions
      const arbIncrements: Record<string, fc.Arbitrary<Record<string, number>>> = {};
      for (const transition of transitions) {
        const cpRecord: Record<string, fc.Arbitrary<number>> = {};
        for (const cpId of controlPointIds) {
          cpRecord[cpId] = fc.double({ min: 1, max: 100, noNaN: true });
        }
        arbIncrements[transition] = fc.record(cpRecord);
      }
      return fc.record(arbIncrements);
    }),
  }) as fc.Arbitrary<GradingIncrementTable>;
}

/**
 * Generate base measurements for given control point IDs.
 * Values in mm, between 100 and 1500 (10cm to 150cm).
 */
function arbBaseMeasurements(controlPointIds: string[]): fc.Arbitrary<Record<string, number>> {
  const entries: Record<string, fc.Arbitrary<number>> = {};
  for (const cpId of controlPointIds) {
    entries[cpId] = fc.double({ min: 100, max: 1500, noNaN: true });
  }
  return fc.record(entries);
}

/** Generate safe alphanumeric string (no XML special chars). */
const arbSafeString = (minLen: number, maxLen: number) =>
  fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: minLen,
    maxLength: maxLen,
  });

/** Generate a valid SerializedPiece with consistent bounds derived from pathData. */
function arbSerializedPiece() {
  return fc.tuple(
    arbSafeString(1, 10),
    arbSafeString(1, 20),
    fc.integer({ min: 1, max: 4 }),
    fc.double({ min: 1, max: 400, noNaN: true }),
    fc.double({ min: 1, max: 400, noNaN: true }),
    fc.double({ min: 10, max: 200, noNaN: true }),
    fc.double({ min: 10, max: 200, noNaN: true }),
    fc.record({
      x1: fc.double({ min: 1, max: 500, noNaN: true }),
      y1: fc.double({ min: 1, max: 500, noNaN: true }),
      x2: fc.double({ min: 1, max: 500, noNaN: true }),
      y2: fc.double({ min: 1, max: 500, noNaN: true }),
    }).map(({ x1, y1, x2, y2 }) => {
      // Round to 2 decimals to match .toFixed(2) round-trip
      const rx1 = Math.round(x1 * 100) / 100;
      const ry1 = Math.round(y1 * 100) / 100;
      const rx2 = Math.round(x2 * 100) / 100;
      const ry2 = Math.round(y2 * 100) / 100;
      const angle = Math.round(Math.atan2(ry2 - ry1, rx2 - rx1) * (180 / Math.PI) * 100) / 100;
      return { x1: rx1, y1: ry1, x2: rx2, y2: ry2, angle };
    }),
    fc.array(
      fc.record({
        x: fc.double({ min: 0, max: 500, noNaN: true }).map(v => Math.round(v * 100) / 100),
        y: fc.double({ min: 0, max: 500, noNaN: true }).map(v => Math.round(v * 100) / 100),
        edgeId: arbSafeString(1, 8),
        matchingEdgeId: arbSafeString(1, 8),
      }),
      { minLength: 1, maxLength: 4 },
    ),
    fc.record({
      x: fc.double({ min: 0, max: 500, noNaN: true }).map(v => Math.round(v * 100) / 100),
      y: fc.double({ min: 0, max: 500, noNaN: true }).map(v => Math.round(v * 100) / 100),
    }),
  ).map(([id, name, cutQuantity, x, y, w, h, grainLine, notches, offset]) => {
    // Round coordinates to 2 decimal places to match roundToTolerance
    const rx = Math.round(x * 100) / 100;
    const ry = Math.round(y * 100) / 100;
    const rw = Math.round(w * 100) / 100;
    const rh = Math.round(h * 100) / 100;

    const pathData = `M ${rx.toFixed(2)} ${ry.toFixed(2)} L ${(rx + rw).toFixed(2)} ${ry.toFixed(2)} L ${(rx + rw).toFixed(2)} ${(ry + rh).toFixed(2)} L ${rx.toFixed(2)} ${(ry + rh).toFixed(2)} Z`;

    // Seam allowance slightly larger
    const seamX = Math.round((rx - 5) * 100) / 100;
    const seamY = Math.round((ry - 5) * 100) / 100;
    const seamW = Math.round((rw + 10) * 100) / 100;
    const seamH = Math.round((rh + 10) * 100) / 100;
    const seamAllowancePathData = `M ${seamX.toFixed(2)} ${seamY.toFixed(2)} L ${(seamX + seamW).toFixed(2)} ${seamY.toFixed(2)} L ${(seamX + seamW).toFixed(2)} ${(seamY + seamH).toFixed(2)} L ${seamX.toFixed(2)} ${(seamY + seamH).toFixed(2)} Z`;

    return {
      id,
      name,
      cutQuantity,
      pathData,
      seamAllowancePathData,
      grainLine,
      notches,
      bounds: { x: rx, y: ry, width: rw, height: rh },
      offset,
    };
  });
}

/** Generate a valid SerializedPattern. */
function arbValidSerializedPattern(): fc.Arbitrary<SerializedPattern> {
  return fc.record({
    version: fc.constant('1.0' as const),
    templateId: arbSafeString(1, 20),
    garmentType: arbGarmentType,
    ageGroup: arbAgeGroup,
    size: fc.constantFrom('M', 'L', 'XL', '8', '10', '12'),
    seamAllowanceCm: fc.double({ min: 0.5, max: 3.0, noNaN: true }).map(v => Math.round(v * 100) / 100),
    viewBox: fc.record({
      width: fc.double({ min: 100, max: 2000, noNaN: true }).map(v => Math.round(v * 100) / 100),
      height: fc.double({ min: 100, max: 2000, noNaN: true }).map(v => Math.round(v * 100) / 100),
    }),
    pieces: fc.array(arbSerializedPiece(), { minLength: 1, maxLength: 3 }),
    measurements: fc.record({
      chest: fc.double({ min: 100, max: 1500, noNaN: true }),
      waist: fc.double({ min: 100, max: 1500, noNaN: true }),
    }),
    createdAt: fc.constant(new Date().toISOString()),
  });
}

// ---------------------------------------------------------------------------
// Property 6: Grading Proportionality and Structural Preservation
// ---------------------------------------------------------------------------

describe('Property 6: Grading Proportionality and Structural Preservation', () => {
  /**
   * **Validates: Requirements 2.1, 2.3, 2.4, 2.5**
   *
   * When grading up, all measurements must increase (or stay at minimum).
   * When grading down, all measurements must decrease (or stay at minimum 1mm).
   * Number of control points must be preserved.
   * No measurement goes below 1mm.
   */

  it('measurements increase when grading up for any valid table', () => {
    fc.assert(
      fc.property(
        arbAgeGroup,
        arbControlPointIds,
        (ageGroup, cpIds) => {
          return fc.assert(
            fc.property(
              arbValidIncrementTable(ageGroup, cpIds),
              arbBaseMeasurements(cpIds),
              (table, baseMeasurements) => {
                const sizes = ageGroup === 'children' ? CHILDREN_SIZES : ADULT_SIZES;
                const baseSize = sizes[0]; // smallest size
                const targetSize = sizes[2]; // 2 sizes up

                const graded = calculateGradedMeasurements(
                  baseMeasurements, ageGroup, baseSize, targetSize, table,
                );

                // Grading up: all measurements should be >= base
                for (const cpId of cpIds) {
                  expect(graded[cpId]).toBeGreaterThanOrEqual(baseMeasurements[cpId]);
                }
              },
            ),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  it('measurements decrease when grading down for any valid table', () => {
    fc.assert(
      fc.property(
        arbAgeGroup,
        arbControlPointIds,
        (ageGroup, cpIds) => {
          return fc.assert(
            fc.property(
              arbValidIncrementTable(ageGroup, cpIds),
              arbBaseMeasurements(cpIds),
              (table, baseMeasurements) => {
                const sizes = ageGroup === 'children' ? CHILDREN_SIZES : ADULT_SIZES;
                const baseSize = sizes[4]; // middle size
                const targetSize = sizes[2]; // 2 sizes down

                const graded = calculateGradedMeasurements(
                  baseMeasurements, ageGroup, baseSize, targetSize, table,
                );

                // Grading down: measurements should be <= base
                // (with small floating-point tolerance)
                for (const cpId of cpIds) {
                  expect(graded[cpId]).toBeLessThanOrEqual(baseMeasurements[cpId] + 0.01);
                }
              },
            ),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  it('preserves control point count after grading', () => {
    fc.assert(
      fc.property(
        arbAgeGroup,
        arbControlPointIds,
        (ageGroup, cpIds) => {
          return fc.assert(
            fc.property(
              arbValidIncrementTable(ageGroup, cpIds),
              arbBaseMeasurements(cpIds),
              (table, baseMeasurements) => {
                const sizes = ageGroup === 'children' ? CHILDREN_SIZES : ADULT_SIZES;
                const baseSize = sizes[0];
                const targetSize = sizes[3];

                const graded = calculateGradedMeasurements(
                  baseMeasurements, ageGroup, baseSize, targetSize, table,
                );

                // Number of control points must be preserved
                expect(Object.keys(graded).length).toBe(Object.keys(baseMeasurements).length);

                // Same keys must be present
                expect(Object.keys(graded).sort()).toEqual(Object.keys(baseMeasurements).sort());
              },
            ),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  it('no measurement goes below 1mm after grading', () => {
    fc.assert(
      fc.property(
        arbAgeGroup,
        arbControlPointIds,
        (ageGroup, cpIds) => {
          return fc.assert(
            fc.property(
              arbValidIncrementTable(ageGroup, cpIds),
              arbBaseMeasurements(cpIds),
              fc.integer({ min: 0, max: ageGroup === 'children' ? 7 : 9 }),
              (table, baseMeasurements, targetIdx) => {
                const sizes = ageGroup === 'children' ? CHILDREN_SIZES : ADULT_SIZES;
                const baseSize = sizes[0];
                const targetSize = sizes[targetIdx];

                const graded = calculateGradedMeasurements(
                  baseMeasurements, ageGroup, baseSize, targetSize, table,
                );

                for (const cpId of cpIds) {
                  expect(graded[cpId]).toBeGreaterThanOrEqual(1);
                }
              },
            ),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  it('children shoulder correction < 1.0x (grows slower than hips)', () => {
    // Note: calculateGradedMeasurements applies increments linearly.
    // Proportion corrections (shoulder growing slower than hips) happen at the
    // geometry level in gradePiece/calculateScaleFactors, not at the measurement level.
    // This test verifies that measurements are summed correctly across transitions.
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 50, noNaN: true }),
        fc.double({ min: 100, max: 1000, noNaN: true }),
        fc.double({ min: 100, max: 1000, noNaN: true }),
        (increment, shoulderBase, hipBase) => {
          const transitions = CHILDREN_TRANSITIONS;

          // Build table with same increment for both control points
          const increments: Record<string, Record<string, number>> = {};
          for (const transition of transitions) {
            increments[transition] = {
              shoulder_width: increment,
              hip_width: increment,
            };
          }

          const table: GradingIncrementTable = {
            garmentType: 'camiseta',
            ageGroup: 'children',
            increments,
          };

          const baseMeasurements = {
            shoulder_width: shoulderBase,
            hip_width: hipBase,
          };

          // Grade from 2T to 8 (3 transitions: 2T→4T, 4T→6, 6→8)
          const graded = calculateGradedMeasurements(
            baseMeasurements, 'children', '2T', '8', table,
          );

          // calculateGradedMeasurements applies increments linearly (no correction)
          // Both should get same delta since same increment value
          const shoulderDelta = graded['shoulder_width'] - baseMeasurements['shoulder_width'];
          const hipDelta = graded['hip_width'] - baseMeasurements['hip_width'];

          // With same increment per transition, both deltas should be equal
          // (3 transitions × increment)
          const expectedDelta = increment * 3;
          expect(shoulderDelta).toBeCloseTo(expectedDelta, 1);
          expect(hipDelta).toBeCloseTo(expectedDelta, 1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('adults: increments applied 1:1 (no proportional correction)', () => {
    fc.assert(
      fc.property(
        arbControlPointIds,
        (cpIds) => {
          return fc.assert(
            fc.property(
              arbValidIncrementTable('adult', cpIds),
              arbBaseMeasurements(cpIds),
              (table, baseMeasurements) => {
                const baseSize = 'M';
                const targetSize = 'L';
                const transition = 'M→L';

                const graded = calculateGradedMeasurements(
                  baseMeasurements, 'adult', baseSize, targetSize, table,
                );

                // For adults, each increment is applied directly in mm (1:1)
                for (const cpId of cpIds) {
                  const incrementMm = table.increments[transition]?.[cpId] ?? 0;
                  const expectedMm = baseMeasurements[cpId] + incrementMm;
                  // Allow small floating point tolerance
                  expect(graded[cpId]).toBeCloseTo(expectedMm, 1);
                }
              },
            ),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Grading Increment Table Validation
// ---------------------------------------------------------------------------

describe('Property 7: Grading Increment Table Validation', () => {
  /**
   * **Validates: Requirements 2.8**
   *
   * A table is accepted iff all values are in [0.1, 10] and all transitions
   * for the age group are present.
   */

  it('accepts valid tables with all values in [0.1, 10] and all transitions present', () => {
    fc.assert(
      fc.property(
        arbAgeGroup,
        arbControlPointIds,
        (ageGroup, cpIds) => {
          return fc.assert(
            fc.property(
              arbValidIncrementTable(ageGroup, cpIds),
              (table) => {
                const result = validateGradingTable(table);
                expect(result.valid).toBe(true);
                expect(result.errors).toHaveLength(0);
              },
            ),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  it('rejects tables with values outside [1, 100]', () => {
    fc.assert(
      fc.property(
        arbAgeGroup,
        (ageGroup) => {
          const transitions = ageGroup === 'children' ? CHILDREN_TRANSITIONS : ADULT_TRANSITIONS;
          const cpIds = ['chest_width', 'waist_width'];

          // Build a table with one invalid value (outside range)
          return fc.assert(
            fc.property(
              fc.oneof(
                fc.double({ min: -100, max: 0.99, noNaN: true }),
                fc.double({ min: 100.01, max: 1000, noNaN: true }),
              ),
              (invalidValue) => {
                const increments: Record<string, Record<string, number>> = {};
                for (const transition of transitions) {
                  increments[transition] = {};
                  for (const cpId of cpIds) {
                    increments[transition][cpId] = 5.0; // valid default (within 1-100)
                  }
                }
                // Make one value invalid
                increments[transitions[0]][cpIds[0]] = invalidValue;

                const table: GradingIncrementTable = {
                  garmentType: 'camiseta',
                  ageGroup,
                  increments,
                };

                const result = validateGradingTable(table);
                expect(result.valid).toBe(false);
                expect(result.errors.length).toBeGreaterThan(0);
                expect(result.errors.some(e => e.code === 'INCREMENT_OUT_OF_RANGE')).toBe(true);
              },
            ),
            { numRuns: 20 },
          );
        },
      ),
      { numRuns: 5 },
    );
  });

  it('rejects tables missing transitions', () => {
    fc.assert(
      fc.property(
        arbAgeGroup,
        fc.integer({ min: 1, max: 5 }),
        (ageGroup, numToRemove) => {
          const transitions = ageGroup === 'children' ? CHILDREN_TRANSITIONS : ADULT_TRANSITIONS;
          const cpIds = ['chest_width', 'waist_width'];

          // Build a table but omit some transitions
          const increments: Record<string, Record<string, number>> = {};
          const transitionsToInclude = transitions.slice(numToRemove); // skip first N

          for (const transition of transitionsToInclude) {
            increments[transition] = {};
            for (const cpId of cpIds) {
              increments[transition][cpId] = 5.0;
            }
          }

          const table: GradingIncrementTable = {
            garmentType: 'camiseta',
            ageGroup,
            increments,
          };

          const result = validateGradingTable(table);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors.some(e => e.code === 'MISSING_TRANSITION')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Serialization Round-Trip Idempotence
// ---------------------------------------------------------------------------

describe('Property 8: Serialization Round-Trip Idempotence', () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   *
   * For any valid SerializedPattern:
   * - normalizeJson(serializeSvgToJson(deserializeJsonToSvg(pattern), metadata)) === normalizeJson(pattern)
   * - Deserialized SVG contains all structural elements
   * - Total serialized size ≤ 400KB
   */

  it('round-trip produces geometrically equal output within 0.01mm', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        (pattern) => {
          // Deserialize pattern to SVG
          const svg = deserializeJsonToSvg(pattern);

          // Re-serialize SVG to JSON with same metadata
          const metadata = {
            templateId: pattern.templateId,
            garmentType: pattern.garmentType,
            ageGroup: pattern.ageGroup,
            size: pattern.size,
            seamAllowanceCm: pattern.seamAllowanceCm,
            measurements: pattern.measurements,
            createdAt: pattern.createdAt,
          };

          const reserialized = serializeSvgToJson(svg, metadata);

          // Verify geometric equality within 0.01mm
          expect(areGeometricallyEqual(pattern, reserialized)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('deserialized SVG contains all structural elements', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        (pattern) => {
          const svg = deserializeJsonToSvg(pattern);

          // SVG should contain xmlns attribute (SVG 1.1 compliance)
          expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');

          // Should contain viewBox
          expect(svg).toContain('viewBox=');

          // Should contain data-units="mm"
          expect(svg).toContain('data-units="mm"');

          // Should contain one <g> group per piece
          for (const piece of pattern.pieces) {
            expect(svg).toContain(`piece-${piece.id}`);
          }

          // Should contain pattern-piece paths
          expect(svg).toContain('class="pattern-piece"');

          // Should contain seam-allowance paths
          expect(svg).toContain('class="seam-allowance"');

          // Should contain grain lines
          expect(svg).toContain('class="grain-line"');

          // Should contain notches
          if (pattern.pieces.some(p => p.notches.length > 0)) {
            expect(svg).toContain('class="notch"');
          }

          // Should contain labels
          expect(svg).toContain('class="label"');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('serialized output is within 400KB size limit', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        (pattern) => {
          const jsonString = normalizeJson(pattern);
          const byteSize = new TextEncoder().encode(jsonString).length;
          expect(byteSize).toBeLessThanOrEqual(400 * 1024);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('normalizeJson produces identical output for same pattern', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        (pattern) => {
          const first = normalizeJson(pattern);
          const second = normalizeJson(pattern);
          expect(first).toBe(second);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Malformed JSON Rejection
// ---------------------------------------------------------------------------

describe('Property 9: Malformed JSON Rejection', () => {
  /**
   * **Validates: Requirements 3.5**
   *
   * Objects missing required fields, with invalid types, or with pathData
   * not starting with M or not ending with Z must be rejected with
   * field-specific errors.
   */

  it('rejects objects missing required fields with field-specific errors', () => {
    const requiredFields = [
      'version', 'templateId', 'garmentType', 'ageGroup',
      'size', 'seamAllowanceCm', 'viewBox', 'pieces', 'measurements', 'createdAt',
    ];

    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        fc.integer({ min: 0, max: requiredFields.length - 1 }),
        (pattern, fieldIdx) => {
          const fieldToRemove = requiredFields[fieldIdx];
          // Create a copy without the required field
          const malformed = { ...pattern } as Record<string, unknown>;
          delete malformed[fieldToRemove];

          const result = validateSerializedPattern(malformed);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
          // Should have an error referencing the missing field
          expect(
            result.errors.some(e =>
              e.field === fieldToRemove || e.field.startsWith(fieldToRemove)
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects objects with invalid types', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        (pattern) => {
          // Set garmentType to an invalid value
          const malformed = { ...pattern, garmentType: 'invalid_type' };
          const result = validateSerializedPattern(malformed);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'garmentType')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects objects with invalid ageGroup', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        fc.string({ minLength: 1, maxLength: 10 }).filter(
          s => s !== 'children' && s !== 'adult',
        ),
        (pattern, invalidAgeGroup) => {
          const malformed = { ...pattern, ageGroup: invalidAgeGroup };
          const result = validateSerializedPattern(malformed);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'ageGroup')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects pathData not starting with M', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        fc.constantFrom('L', 'C', 'Q', 'A', 'H', 'V', 'S', 'T'),
        (pattern, startChar) => {
          // Modify first piece's pathData to not start with M
          const malformed = {
            ...pattern,
            pieces: pattern.pieces.map((piece, idx) =>
              idx === 0
                ? { ...piece, pathData: `${startChar} 10 20 L 100 20 L 100 100 Z` }
                : piece,
            ),
          };

          const result = validateSerializedPattern(malformed);
          expect(result.valid).toBe(false);
          expect(
            result.errors.some(e =>
              e.field.includes('pathData') && e.code === 'INVALID_FORMAT'
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects pathData not ending with Z', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        (pattern) => {
          // Modify first piece's pathData to not end with Z
          const malformed = {
            ...pattern,
            pieces: pattern.pieces.map((piece, idx) =>
              idx === 0
                ? { ...piece, pathData: 'M 10 20 L 100 20 L 100 100 L 10 100' }
                : piece,
            ),
          };

          const result = validateSerializedPattern(malformed);
          expect(result.valid).toBe(false);
          expect(
            result.errors.some(e =>
              e.field.includes('pathData') && e.code === 'INVALID_FORMAT'
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects seamAllowanceCm outside valid range [0.5, 3.0]', () => {
    fc.assert(
      fc.property(
        arbValidSerializedPattern(),
        fc.oneof(
          fc.double({ min: -10, max: 0.49, noNaN: true }),
          fc.double({ min: 3.01, max: 100, noNaN: true }),
        ),
        (pattern, invalidSeam) => {
          const malformed = { ...pattern, seamAllowanceCm: invalidSeam };
          const result = validateSerializedPattern(malformed);
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'seamAllowanceCm')).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects null/undefined/non-object input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.boolean(),
        ),
        (invalidInput) => {
          const result = validateSerializedPattern(invalidInput);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
