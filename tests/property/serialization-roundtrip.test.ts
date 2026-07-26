/**
 * Property-based tests for serialization round-trip (Task 3.4).
 *
 * **Validates: Requirements 4.3, 4.4**
 *
 * Properties tested:
 * 1. serialize → deserialize → re-serialize produces byte-equivalent JSON
 * 2. serialize → deserialize → generateSvg produces geometries matching original within 0.01mm
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  serializePatternToJson,
  deserializePatternFromJson,
  generateSvg,
  parseSvg,
} from '../../src/modules/pattern/serialization.js';
import type { ScaledPattern, ScaledPiece, LineData } from '../../src/types/pattern.js';
import type { GarmentType, AgeGroup, Size, ChildrenSize, AdultSize } from '../../src/types/garment.js';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const GARMENT_TYPES: GarmentType[] = ['camiseta', 'short', 'legging', 'sudadera', 'tank-top', 'tank_top', 'custom'];
const AGE_GROUPS: AgeGroup[] = ['children', 'adult'];
const CHILDREN_SIZES: ChildrenSize[] = ['2T', '4T', '6', '8', '10', '12', '14', '16'];
const ADULT_SIZES: AdultSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];

/** Generate a valid garment type. */
const arbGarmentType: fc.Arbitrary<GarmentType> = fc.constantFrom(...GARMENT_TYPES);

/** Generate a valid age group. */
const arbAgeGroup: fc.Arbitrary<AgeGroup> = fc.constantFrom(...AGE_GROUPS);

/** Generate a valid size based on age group. */
function arbSize(ageGroup: AgeGroup): fc.Arbitrary<Size> {
  if (ageGroup === 'children') {
    return fc.constantFrom(...CHILDREN_SIZES);
  }
  return fc.constantFrom(...ADULT_SIZES);
}

/** Generate a coordinate value in reasonable mm range for pattern geometry. */
const arbCoord: fc.Arbitrary<number> = fc.double({
  min: 10,
  max: 2000,
  noNaN: true,
  noDefaultInfinity: true,
}).map((v) => Math.round(v * 100) / 100); // Round to 0.01mm

/** Generate a valid LineData with coordinates in reasonable range. */
const arbLineData: fc.Arbitrary<LineData> = fc.record({
  x1: arbCoord,
  y1: arbCoord,
  x2: arbCoord,
  y2: arbCoord,
});

/**
 * Generate a valid SVG path data string representing a simple closed polygon.
 * Generates rectangles or polygons with 3-6 vertices in reasonable mm coordinates.
 */
const arbPathData: fc.Arbitrary<string> = fc.integer({ min: 3, max: 6 }).chain((vertexCount) =>
  fc.array(
    fc.tuple(arbCoord, arbCoord),
    { minLength: vertexCount, maxLength: vertexCount },
  ).map((vertices) => {
    const commands = vertices.map(([x, y], i) => {
      const cmd = i === 0 ? 'M' : 'L';
      return `${cmd} ${x} ${y}`;
    });
    return commands.join(' ') + ' Z';
  }),
);

/** Generate an alphanumeric piece ID. */
const arbPieceId: fc.Arbitrary<string> = fc.stringMatching(/^[a-z][a-z0-9-]{2,14}$/);

/** Generate a non-empty label string. */
const arbLabel: fc.Arbitrary<string> = fc.string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim().length > 0)
  .map((s) => s.trim());

/** Generate a valid ScaledPiece. */
const arbScaledPiece: fc.Arbitrary<ScaledPiece> = fc.record({
  id: arbPieceId,
  outline: arbPathData,
  seamAllowance: arbPathData,
  grainLine: arbLineData,
  notches: fc.array(arbLineData, { minLength: 0, maxLength: 5 }),
  label: arbLabel,
});

/** Generate a valid ScaledPattern with 1-5 pieces. */
const arbScaledPattern: fc.Arbitrary<ScaledPattern> = arbAgeGroup.chain((ageGroup) =>
  fc.record({
    garmentType: arbGarmentType,
    ageGroup: fc.constant(ageGroup),
    size: arbSize(ageGroup),
    pieces: fc.array(arbScaledPiece, { minLength: 1, maxLength: 5 }).map((pieces) =>
      // Ensure unique piece IDs
      pieces.map((piece, i) => ({ ...piece, id: `${piece.id}-${i}` })),
    ),
  }),
);

// ---------------------------------------------------------------------------
// Geometry Comparison Helpers
// ---------------------------------------------------------------------------

/** Geometry tolerance: 0.01mm */
const TOLERANCE = 0.01;

/** Check if two numbers are within tolerance. */
function withinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

/**
 * Extract all coordinate numbers from a path data string.
 */
function extractPathNumbers(pathData: string): number[] {
  if (!pathData) return [];
  const matches = pathData.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  if (!matches) return [];
  return matches.map(parseFloat).filter(isFinite);
}

/**
 * Compare two SVG documents geometrically by extracting and comparing
 * piece coordinates within tolerance.
 */
function svgGeometriesMatch(svg1: string, svg2: string): boolean {
  try {
    const doc1 = parseSvg(svg1);
    const doc2 = parseSvg(svg2);

    if (doc1.pieces.length !== doc2.pieces.length) return false;

    for (let i = 0; i < doc1.pieces.length; i++) {
      const p1 = doc1.pieces[i];
      const p2 = doc2.pieces[i];

      // Compare outline coordinates
      const outlineNums1 = extractPathNumbers(p1.outline);
      const outlineNums2 = extractPathNumbers(p2.outline);
      if (outlineNums1.length !== outlineNums2.length) return false;
      for (let j = 0; j < outlineNums1.length; j++) {
        if (!withinTolerance(outlineNums1[j], outlineNums2[j])) return false;
      }

      // Compare seam allowance coordinates
      const seamNums1 = extractPathNumbers(p1.seamAllowance);
      const seamNums2 = extractPathNumbers(p2.seamAllowance);
      if (seamNums1.length !== seamNums2.length) return false;
      for (let j = 0; j < seamNums1.length; j++) {
        if (!withinTolerance(seamNums1[j], seamNums2[j])) return false;
      }

      // Compare grain line coordinates
      if (!withinTolerance(p1.grainLine.x1, p2.grainLine.x1)) return false;
      if (!withinTolerance(p1.grainLine.y1, p2.grainLine.y1)) return false;
      if (!withinTolerance(p1.grainLine.x2, p2.grainLine.x2)) return false;
      if (!withinTolerance(p1.grainLine.y2, p2.grainLine.y2)) return false;

      // Compare notch coordinates
      if (p1.notches.length !== p2.notches.length) return false;
      for (let j = 0; j < p1.notches.length; j++) {
        if (!withinTolerance(p1.notches[j].x1, p2.notches[j].x1)) return false;
        if (!withinTolerance(p1.notches[j].y1, p2.notches[j].y1)) return false;
        if (!withinTolerance(p1.notches[j].x2, p2.notches[j].x2)) return false;
        if (!withinTolerance(p1.notches[j].y2, p2.notches[j].y2)) return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property: Serialization Round-Trip (Requirements 4.3, 4.4)', () => {
  it('[property] serialize → deserialize → re-serialize produces byte-equivalent JSON', () => {
    /**
     * **Validates: Requirements 4.3**
     *
     * For any valid ScaledPattern, serializing to JSON, deserializing back,
     * and re-serializing must produce the exact same JSON string.
     * This guarantees idempotent persistence in DynamoDB.
     */
    fc.assert(
      fc.property(arbScaledPattern, (pattern) => {
        // First serialization
        const result1 = serializePatternToJson(pattern);
        expect(result1.json).toBeTruthy();

        // Deserialize
        const deserialized = deserializePatternFromJson(result1.json);

        // Re-serialize
        const result2 = serializePatternToJson(deserialized);

        // JSON strings must be byte-equivalent
        expect(result2.json).toBe(result1.json);
      }),
      { numRuns: 100 },
    );
  });

  it('[property] serialize → deserialize → generateSvg produces geometries matching original within 0.01mm', () => {
    /**
     * **Validates: Requirements 4.4**
     *
     * For any valid ScaledPattern, the SVG generated from the deserialized
     * pattern must have coordinates matching the SVG generated from the
     * original pattern within 0.01mm tolerance.
     */
    fc.assert(
      fc.property(arbScaledPattern, (pattern) => {
        // Generate SVG from original pattern
        const originalSvg = generateSvg(pattern);
        expect(originalSvg.isValid).toBe(true);

        // Serialize → deserialize round-trip
        const serialized = serializePatternToJson(pattern);
        const deserialized = deserializePatternFromJson(serialized.json);

        // Generate SVG from deserialized pattern
        const roundTripSvg = generateSvg(deserialized);
        expect(roundTripSvg.isValid).toBe(true);

        // Both SVGs must have matching geometries within 0.01mm
        expect(svgGeometriesMatch(originalSvg.svg, roundTripSvg.svg)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
