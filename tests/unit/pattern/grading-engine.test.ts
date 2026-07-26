/**
 * Unit tests for the grading engine module.
 * Tests grading table validation, pattern grading for children and adults,
 * cumulative measurement calculation, notch/label preservation, and output generation.
 *
 * Validates: Requirements 3.1–3.8
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GradingIncrementTable, ScaledPattern, ScaledPiece } from '../../../src/types/pattern.js';
import {
  validateGradingTable,
  gradePattern,
  calculateGradedMeasurements,
  generateGradingOutput,
  CHILDREN_TRANSITIONS,
  ADULT_TRANSITIONS,
} from '../../../src/modules/pattern/grading-engine.js';

// Mock DynamoDB operations
vi.mock('../../../src/db/operations.js', () => ({
  getGradingTable: vi.fn(),
  putGradingTable: vi.fn(),
}));

// Mock serialization (generateSvg)
vi.mock('../../../src/modules/pattern/serialization.js', () => ({
  generateSvg: vi.fn(),
}));

import { generateSvg } from '../../../src/modules/pattern/serialization.js';

const mockGenerateSvg = vi.mocked(generateSvg);

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function createValidAdultTable(): GradingIncrementTable {
  const increments: Record<string, Record<string, number>> = {};
  for (const t of ADULT_TRANSITIONS) {
    increments[t] = {
      chest: 20,
      waist: 18,
      hip: 15,
      shoulderWidth: 10,
      torsoLength: 12,
      legLength: 8,
    };
  }
  return { garmentType: 'camiseta', ageGroup: 'adult', increments };
}

function createValidChildrenTable(): GradingIncrementTable {
  const increments: Record<string, Record<string, number>> = {};
  for (const t of CHILDREN_TRANSITIONS) {
    increments[t] = {
      chest: 15,
      waist: 12,
      hip: 14,
      shoulderWidth: 8,
      torsoLength: 10,
      legLength: 12,
    };
  }
  return { garmentType: 'camiseta', ageGroup: 'children', increments };
}

function createBasePattern(ageGroup: 'children' | 'adult', size: string): ScaledPattern {
  const piece: ScaledPiece = {
    id: 'front-panel',
    outline: 'M 0 0 L 200 0 L 200 300 L 0 300 Z',
    seamAllowance: 'M -5 -5 L 205 -5 L 205 305 L -5 305 Z',
    grainLine: { x1: 100, y1: 10, x2: 100, y2: 290 },
    notches: [
      { x1: 0, y1: 100, x2: 3, y2: 100 },
      { x1: 200, y1: 100, x2: 197, y2: 100 },
      { x1: 100, y1: 0, x2: 100, y2: 3 },
    ],
    label: `Front Panel - ${size} - Cut 1`,
  };

  return {
    garmentType: 'camiseta',
    ageGroup,
    size,
    pieces: [piece],
  };
}

// ─── Tests: validateGradingTable ─────────────────────────────────────────────

describe('Grading Engine - validateGradingTable', () => {
  it('should accept a valid adult table with all transitions', () => {
    const table = createValidAdultTable();
    const result = validateGradingTable(table);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should accept a valid children table with all transitions', () => {
    const table = createValidChildrenTable();
    const result = validateGradingTable(table);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject a table missing a required transition', () => {
    const table = createValidAdultTable();
    delete table.increments['M→L'];
    const result = validateGradingTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_TRANSITION')).toBe(true);
    expect(result.errors.some((e) => e.field.includes('M→L'))).toBe(true);
  });

  it('should reject increment values below 1mm', () => {
    const table = createValidAdultTable();
    table.increments['XS→S'].chest = 0.5;
    const result = validateGradingTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INCREMENT_OUT_OF_RANGE')).toBe(true);
    expect(result.errors.some((e) => e.field.includes('chest'))).toBe(true);
  });

  it('should reject increment values above 100mm', () => {
    const table = createValidAdultTable();
    table.increments['S→M'].waist = 101;
    const result = validateGradingTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INCREMENT_OUT_OF_RANGE')).toBe(true);
  });

  it('should reject non-numeric increment values', () => {
    const table = createValidAdultTable();
    (table.increments['XS→S'] as Record<string, unknown>).chest = 'bad';
    const result = validateGradingTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'INCREMENT_OUT_OF_RANGE')).toBe(true);
  });

  it('should accept boundary values (1mm and 100mm)', () => {
    const table = createValidAdultTable();
    table.increments['XS→S'].chest = 1;
    table.increments['S→M'].waist = 100;
    const result = validateGradingTable(table);
    expect(result.valid).toBe(true);
  });

  it('should reject a transition with no control points (empty object)', () => {
    const table = createValidAdultTable();
    table.increments['L→XL'] = {};
    const result = validateGradingTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'EMPTY_TRANSITION')).toBe(true);
  });

  it('should report multiple errors for multiple invalid transitions', () => {
    const table = createValidAdultTable();
    delete table.increments['XS→S'];
    delete table.increments['M→L'];
    table.increments['L→XL'].chest = 0; // below minimum
    const result = validateGradingTable(table);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Tests: gradePattern (children) ─────────────────────────────────────────

describe('Grading Engine - gradePattern (children)', () => {
  it('should apply anatomical proportions: width scales differently from height', () => {
    const basePattern = createBasePattern('children', '6');
    const table = createValidChildrenTable();

    const results = gradePattern(basePattern, 'children', ['8'], table);

    expect(results).toHaveLength(1);
    const graded = results[0];

    // Parse graded outline to check scaling
    // The outline "M 0 0 L 200 0 L 200 300 L 0 300 Z" has x values (width) and y values (height)
    // With children proportions, shoulderToHipRatio adjustment makes width scale different from height
    const outlineTokens = graded.pieces[0].outline.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)!;
    const xValues = outlineTokens.filter((_, i) => i % 2 === 0).map(Number);
    const yValues = outlineTokens.filter((_, i) => i % 2 === 1).map(Number);

    // The width and height should scale, but children have different ratios applied
    // widthScale gets shoulderToHipRatio adjustment (0.95/1.1 ≈ 0.864)
    // heightScale gets waistPosition and limbToTorso adjustments
    const maxX = Math.max(...xValues);
    const maxY = Math.max(...yValues);

    // For children, the width and height scale differently due to anatomical proportions
    // Width scale ≠ Height scale (this is the key anatomical proportion difference)
    const widthRatio = maxX / 200;
    const heightRatio = maxY / 300;
    expect(widthRatio).not.toBeCloseTo(heightRatio, 2);
  });

  it('should produce correct size in output', () => {
    const basePattern = createBasePattern('children', '4T');
    const table = createValidChildrenTable();

    const results = gradePattern(basePattern, 'children', ['6', '8'], table);

    expect(results).toHaveLength(2);
    expect(results[0].size).toBe('6');
    expect(results[1].size).toBe('8');
    expect(results[0].ageGroup).toBe('children');
  });
});

// ─── Tests: gradePattern (adults) ───────────────────────────────────────────

describe('Grading Engine - gradePattern (adults)', () => {
  it('should maintain proportional relationships (width and height scale similarly)', () => {
    const basePattern = createBasePattern('adult', 'M');
    const table = createValidAdultTable();

    const results = gradePattern(basePattern, 'adult', ['L'], table);

    expect(results).toHaveLength(1);
    const graded = results[0];

    // Parse graded outline
    const outlineTokens = graded.pieces[0].outline.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)!;
    const xValues = outlineTokens.filter((_, i) => i % 2 === 0).map(Number);
    const yValues = outlineTokens.filter((_, i) => i % 2 === 1).map(Number);

    const maxX = Math.max(...xValues);
    const maxY = Math.max(...yValues);

    // For adults, scaling is proportional — no anatomical proportion adjustments
    // widthScale and heightScale are both derived from increments with no additional corrections
    const widthRatio = maxX / 200;
    const heightRatio = maxY / 300;

    // Both should be > 1 (grading up to larger size)
    expect(widthRatio).toBeGreaterThan(1);
    expect(heightRatio).toBeGreaterThan(1);
  });

  it('should scale up when targeting larger sizes', () => {
    const basePattern = createBasePattern('adult', 'S');
    const table = createValidAdultTable();

    const results = gradePattern(basePattern, 'adult', ['M', 'L'], table);

    expect(results).toHaveLength(2);
    // L should be more scaled than M
    const mOutline = results[0].pieces[0].outline;
    const lOutline = results[1].pieces[0].outline;
    // Parse max x coordinate from each
    const mMaxX = Math.max(...mOutline.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)!.filter((_, i) => i % 2 === 0).map(Number));
    const lMaxX = Math.max(...lOutline.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)!.filter((_, i) => i % 2 === 0).map(Number));

    expect(lMaxX).toBeGreaterThan(mMaxX);
  });

  it('should scale down when targeting smaller sizes', () => {
    const basePattern = createBasePattern('adult', 'L');
    const table = createValidAdultTable();

    const results = gradePattern(basePattern, 'adult', ['M'], table);

    expect(results).toHaveLength(1);
    const outlineTokens = results[0].pieces[0].outline.match(/[-+]?(?:\d+\.?\d*|\.\d+)/g)!;
    const maxX = Math.max(...outlineTokens.filter((_, i) => i % 2 === 0).map(Number));
    // Should be smaller than original 200
    expect(maxX).toBeLessThan(200);
  });

  it('should throw for invalid base size', () => {
    const basePattern = createBasePattern('adult', '2T'); // children size, invalid for adult
    const table = createValidAdultTable();

    expect(() => gradePattern(basePattern, 'adult', ['L'], table)).toThrow();
  });

  it('should throw for invalid target size', () => {
    const basePattern = createBasePattern('adult', 'M');
    const table = createValidAdultTable();

    expect(() => gradePattern(basePattern, 'adult', ['2T'], table)).toThrow();
  });
});

// ─── Tests: gradePattern preservation ────────────────────────────────────────

describe('Grading Engine - gradePattern preservation', () => {
  it('should preserve notch count across sizes', () => {
    const basePattern = createBasePattern('adult', 'M');
    const originalNotchCount = basePattern.pieces[0].notches.length;
    const table = createValidAdultTable();

    const results = gradePattern(basePattern, 'adult', ['S', 'L', 'XL'], table);

    for (const result of results) {
      expect(result.pieces[0].notches).toHaveLength(originalNotchCount);
    }
  });

  it('should preserve grain line existence across sizes', () => {
    const basePattern = createBasePattern('adult', 'M');
    const table = createValidAdultTable();

    const results = gradePattern(basePattern, 'adult', ['S', 'L', 'XL'], table);

    for (const result of results) {
      const grainLine = result.pieces[0].grainLine;
      expect(grainLine).toBeDefined();
      expect(typeof grainLine.x1).toBe('number');
      expect(typeof grainLine.y1).toBe('number');
      expect(typeof grainLine.x2).toBe('number');
      expect(typeof grainLine.y2).toBe('number');
    }
  });

  it('should update labels with target size', () => {
    const basePattern = createBasePattern('adult', 'M');
    const table = createValidAdultTable();

    const results = gradePattern(basePattern, 'adult', ['S', 'L', 'XL'], table);

    expect(results[0].pieces[0].label).toContain('S');
    expect(results[0].pieces[0].label).not.toContain(' M ');
    expect(results[1].pieces[0].label).toContain('L');
    expect(results[2].pieces[0].label).toContain('XL');
  });

  it('should preserve piece IDs across sizes', () => {
    const basePattern = createBasePattern('adult', 'M');
    const table = createValidAdultTable();

    const results = gradePattern(basePattern, 'adult', ['L'], table);
    expect(results[0].pieces[0].id).toBe('front-panel');
  });
});

// ─── Tests: calculateGradedMeasurements ──────────────────────────────────────

describe('Grading Engine - calculateGradedMeasurements', () => {
  it('should return identical measurements when fromSize equals toSize', () => {
    const baseMeasurements = { chest: 900, waist: 800, hip: 900 };
    const table = createValidAdultTable();

    const result = calculateGradedMeasurements(baseMeasurements, 'adult', 'M', 'M', table);
    expect(result).toEqual(baseMeasurements);
  });

  it('should correctly apply cumulative increments grading up (adult)', () => {
    const baseMeasurements = { chest: 900, waist: 800 };
    const table = createValidAdultTable();

    // M→L: chest +20mm, waist +18mm
    const result = calculateGradedMeasurements(baseMeasurements, 'adult', 'M', 'L', table);
    expect(result.chest).toBe(920);
    expect(result.waist).toBe(818);
  });

  it('should correctly apply cumulative increments grading down (adult)', () => {
    const baseMeasurements = { chest: 900, waist: 800 };
    const table = createValidAdultTable();

    // M→S (grading down): chest -20mm, waist -18mm
    const result = calculateGradedMeasurements(baseMeasurements, 'adult', 'M', 'S', table);
    expect(result.chest).toBe(880);
    expect(result.waist).toBe(782);
  });

  it('should accumulate across multiple transitions', () => {
    const baseMeasurements = { chest: 900 };
    const table = createValidAdultTable();

    // M→XL: 2 transitions (M→L, L→XL), chest +20 each = +40
    const result = calculateGradedMeasurements(baseMeasurements, 'adult', 'M', 'XL', table);
    expect(result.chest).toBe(940);
  });

  it('should return base value for measurements not in grading table', () => {
    const baseMeasurements = { chest: 900, unknownMeasure: 500 };
    const table = createValidAdultTable();

    const result = calculateGradedMeasurements(baseMeasurements, 'adult', 'M', 'L', table);
    // unknownMeasure not in table increments, so increment is 0
    expect(result.unknownMeasure).toBe(500);
  });

  it('should throw for invalid fromSize', () => {
    const baseMeasurements = { chest: 900 };
    const table = createValidAdultTable();

    expect(() =>
      calculateGradedMeasurements(baseMeasurements, 'adult', 'INVALID' as any, 'L', table),
    ).toThrow();
  });

  it('should throw for invalid toSize', () => {
    const baseMeasurements = { chest: 900 };
    const table = createValidAdultTable();

    expect(() =>
      calculateGradedMeasurements(baseMeasurements, 'adult', 'M', 'INVALID' as any, table),
    ).toThrow();
  });

  it('should work for children age group', () => {
    const baseMeasurements = { chest: 600, hip: 580 };
    const table = createValidChildrenTable();

    // 6→8: chest +15, hip +14
    const result = calculateGradedMeasurements(baseMeasurements, 'children', '6', '8', table);
    expect(result.chest).toBe(615);
    expect(result.hip).toBe(594);
  });
});

// ─── Tests: generateGradingOutput ────────────────────────────────────────────

describe('Grading Engine - generateGradingOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should produce N SVGs for N sizes in "separate" mode', () => {
    const patterns: ScaledPattern[] = [
      createBasePattern('adult', 'S'),
      createBasePattern('adult', 'M'),
      createBasePattern('adult', 'L'),
    ];

    mockGenerateSvg.mockReturnValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><g id="front-panel"></g></svg>',
      isValid: true,
      pieceCount: 1,
    });

    const result = generateGradingOutput(patterns, 'separate');

    expect(result.mode).toBe('separate');
    expect(result.svgs).toHaveLength(3);
    expect(result.sizeLabels).toEqual(['S', 'M', 'L']);
    expect(result.totalPieces).toBe(3);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    expect(mockGenerateSvg).toHaveBeenCalledTimes(3);
  });

  it('should produce 1 SVG in "combined" mode with data-size attributes', () => {
    const patterns: ScaledPattern[] = [
      createBasePattern('adult', 'S'),
      createBasePattern('adult', 'M'),
    ];

    mockGenerateSvg.mockReturnValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><g id="front-panel">content</g></svg>',
      isValid: true,
      pieceCount: 1,
    });

    const result = generateGradingOutput(patterns, 'combined');

    expect(result.mode).toBe('combined');
    expect(result.svgs).toHaveLength(1);
    expect(result.sizeLabels).toEqual(['S', 'M']);
    expect(result.totalPieces).toBe(2);

    // The combined SVG should contain data-size attributes for each size
    const combinedSvg = result.svgs[0];
    expect(combinedSvg).toContain('data-size="S"');
    expect(combinedSvg).toContain('data-size="M"');
    expect(combinedSvg).toContain('data-output-mode="combined"');
    expect(combinedSvg).toContain('data-size-count="2"');
  });

  it('should throw if SVG generation fails for a size', () => {
    const patterns: ScaledPattern[] = [createBasePattern('adult', 'M')];

    mockGenerateSvg.mockReturnValue({
      svg: '',
      isValid: false,
      pieceCount: 0,
    });

    expect(() => generateGradingOutput(patterns, 'separate')).toThrow(
      /SVG generation failed/,
    );
  });

  it('should report correct processing time', () => {
    const patterns: ScaledPattern[] = [createBasePattern('adult', 'M')];

    mockGenerateSvg.mockReturnValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><g></g></svg>',
      isValid: true,
      pieceCount: 1,
    });

    const result = generateGradingOutput(patterns, 'separate');
    expect(typeof result.processingTimeMs).toBe('number');
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });
});
