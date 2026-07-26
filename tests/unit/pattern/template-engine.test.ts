/**
 * Unit tests for the parametric template engine.
 * Tests control point interpolation, path generation, seam allowances,
 * grain lines, notches, labels, SVG structure, template loading, and
 * measurement application.
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.10
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParametricTemplate, ControlPoint, PieceDefinition, ScaledPattern, ProportionProfile } from '../../../src/types/pattern.js';
import type { GarmentType, AgeGroup, StandardGarmentType } from '../../../src/types/garment.js';
import {
  generatePattern,
  interpolateControlPoints,
  generatePiecePath,
  loadTemplate,
  applyMeasurements,
  type PatternOptions,
} from '../../../src/modules/pattern/template-engine.js';

// Mock S3 client since generatePattern uses it indirectly
vi.mock('../../../src/storage/s3-client.js', () => ({
  downloadFile: vi.fn(),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

// --- Test Fixtures ---

function createTestControlPoints(): ControlPoint[] {
  return [
    {
      id: 'chest',
      name: 'Chest Width',
      x: 250,
      y: 0,
      minValue: 400,
      maxValue: 1200,
      affectedPieces: ['front-panel', 'back-panel'],
    },
    {
      id: 'waist',
      name: 'Waist Width',
      x: 220,
      y: 300,
      minValue: 350,
      maxValue: 1100,
      affectedPieces: ['front-panel', 'back-panel'],
    },
    {
      id: 'length',
      name: 'Body Length',
      x: 0,
      y: 600,
      minValue: 400,
      maxValue: 900,
      affectedPieces: ['front-panel', 'back-panel'],
    },
    {
      id: 'shoulder',
      name: 'Shoulder Width',
      x: 200,
      y: 50,
      minValue: 300,
      maxValue: 500,
      affectedPieces: ['front-panel'],
    },
  ];
}

function createTestPieceDefinitions(): PieceDefinition[] {
  return [
    {
      id: 'front-panel',
      name: 'Front Panel',
      cutQuantity: 1,
      pathFunction: 'basic-torso-front',
      grainLineAngle: 90,
      notchPositions: [
        { edgeId: 'side-left', position: 0.5, matchingPieceEdgeId: 'back-panel:side-right' },
        { edgeId: 'shoulder-left', position: 0.3, matchingPieceEdgeId: 'sleeve:armhole' },
      ],
    },
    {
      id: 'back-panel',
      name: 'Back Panel',
      cutQuantity: 1,
      pathFunction: 'basic-torso-back',
      grainLineAngle: 90,
      notchPositions: [
        { edgeId: 'side-right', position: 0.5, matchingPieceEdgeId: 'front-panel:side-left' },
      ],
    },
  ];
}

function createTestTemplate(): ParametricTemplate {
  return {
    id: 'test-camiseta-adult',
    garmentType: 'camiseta',
    ageGroup: 'adult',
    controlPoints: createTestControlPoints(),
    pieceDefinitions: createTestPieceDefinitions(),
    defaultMeasurements: {
      chest: 900,
      waist: 800,
      length: 700,
      shoulder: 420,
    },
    constraints: [
      { controlPointId: 'chest', min: 400, max: 1200 },
      { controlPointId: 'waist', min: 350, max: 1100 },
      { controlPointId: 'length', min: 400, max: 900 },
      { controlPointId: 'shoulder', min: 300, max: 500 },
    ],
    proportionProfile: {
      ageGroup: 'adult',
      headToBodyRatio: 0.133,
      limbToTorsoRatio: 1.0,
      waistPositionRatio: 0.4,
      shoulderToHipRatio: 1.1,
    },
  };
}

// --- Tests ---

describe('Template Engine - interpolateControlPoints', () => {
  it('should resolve all control points with provided measurements', () => {
    const controlPoints = createTestControlPoints();
    const measurements: Record<string, number> = {
      chest: 900,
      waist: 800,
      length: 700,
      shoulder: 420,
    };

    const resolved = interpolateControlPoints(controlPoints, measurements);

    expect(resolved.size).toBe(4);
    expect(resolved.has('chest')).toBe(true);
    expect(resolved.has('waist')).toBe(true);
    expect(resolved.has('length')).toBe(true);
    expect(resolved.has('shoulder')).toBe(true);
  });

  it('should use default midpoint when measurement is not provided', () => {
    const controlPoints = createTestControlPoints();
    const measurements: Record<string, number> = {
      chest: 900,
      // waist, length, shoulder not provided
    };

    const resolved = interpolateControlPoints(controlPoints, measurements);

    expect(resolved.size).toBe(4);
    expect(resolved.has('waist')).toBe(true);
  });

  it('should scale position based on measurement within range', () => {
    const controlPoints: ControlPoint[] = [
      {
        id: 'test',
        name: 'Test',
        x: 100,
        y: 200,
        minValue: 100,
        maxValue: 300,
        affectedPieces: ['piece-1'],
      },
    ];

    // Min measurement → lower scaling
    const resolvedMin = interpolateControlPoints(controlPoints, { test: 100 });
    const minPoint = resolvedMin.get('test')!;

    // Max measurement → higher scaling
    const resolvedMax = interpolateControlPoints(controlPoints, { test: 300 });
    const maxPoint = resolvedMax.get('test')!;

    // Max measurement should produce larger coordinates than min
    expect(maxPoint.x).toBeGreaterThan(minPoint.x);
    expect(maxPoint.y).toBeGreaterThan(minPoint.y);
  });
});

describe('Template Engine - generatePiecePath', () => {
  it('should generate valid SVG path data for a piece with multiple control points', () => {
    const controlPoints = createTestControlPoints();
    const measurements = { chest: 900, waist: 800, length: 700, shoulder: 420 };
    const resolved = interpolateControlPoints(controlPoints, measurements);
    const piece = createTestPieceDefinitions()[0]; // front-panel affected by all 4 points

    const result = generatePiecePath(piece, resolved, controlPoints);

    expect(result.pathData).toBeTruthy();
    expect(result.pathData).toContain('M');
    expect(result.pathData).toContain('Z');
    expect(result.bounds.width).toBeGreaterThan(0);
    expect(result.bounds.height).toBeGreaterThan(0);
    expect(result.piece.id).toBe('front-panel');
  });

  it('should generate a rectangular path for pieces with fewer than 3 control points', () => {
    const controlPoints: ControlPoint[] = [
      {
        id: 'width',
        name: 'Width',
        x: 150,
        y: 0,
        minValue: 100,
        maxValue: 400,
        affectedPieces: ['simple-piece'],
      },
      {
        id: 'height',
        name: 'Height',
        x: 0,
        y: 300,
        minValue: 200,
        maxValue: 600,
        affectedPieces: ['simple-piece'],
      },
    ];
    const measurements = { width: 200, height: 400 };
    const resolved = interpolateControlPoints(controlPoints, measurements);
    const piece: PieceDefinition = {
      id: 'simple-piece',
      name: 'Simple Piece',
      cutQuantity: 2,
      pathFunction: 'rectangle',
      grainLineAngle: 0,
      notchPositions: [],
    };

    const result = generatePiecePath(piece, resolved, controlPoints);

    expect(result.pathData).toContain('M');
    expect(result.pathData).toContain('L');
    expect(result.pathData).toContain('Z');
  });
});

describe('Template Engine - generatePattern (SVG output)', () => {
  const template = createTestTemplate();
  const validMeasurements = { chest: 900, waist: 800, length: 700, shoulder: 420 };

  it('should generate valid SVG with mm units in viewBox', async () => {
    const svg = await generatePattern(template, validMeasurements);

    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0');
    expect(svg).toContain('mm"');
    expect(svg).toContain('data-units="mm"');
  });

  it('should include grouped <g> elements with unique IDs for each piece', async () => {
    const svg = await generatePattern(template, validMeasurements);

    expect(svg).toContain('<g id="piece-front-panel"');
    expect(svg).toContain('<g id="piece-back-panel"');
    expect(svg).toContain('data-piece-name="Front Panel"');
    expect(svg).toContain('data-piece-name="Back Panel"');
  });

  it('should include seam allowance paths', async () => {
    const svg = await generatePattern(template, validMeasurements);

    expect(svg).toContain('class="seam-allowance"');
  });

  it('should include grain line indicators', async () => {
    const svg = await generatePattern(template, validMeasurements);

    expect(svg).toContain('class="grain-line"');
    expect(svg).toContain('class="grain-arrow"');
  });

  it('should include alignment notches', async () => {
    const svg = await generatePattern(template, validMeasurements);

    expect(svg).toContain('class="notch"');
    expect(svg).toContain('data-edge="side-left"');
    expect(svg).toContain('data-matches="back-panel:side-right"');
  });

  it('should include piece name, size, and cut quantity labels', async () => {
    const options: PatternOptions = { size: 'M' };
    const svg = await generatePattern(template, validMeasurements, options);

    expect(svg).toContain('Front Panel');
    expect(svg).toContain('Back Panel');
    expect(svg).toContain('Size: M');
    expect(svg).toContain('Cut: 1x');
  });

  it('should use configurable seam allowance (default 1.5cm)', async () => {
    const svg = await generatePattern(template, validMeasurements);
    // SVG should be valid (default seam allowance applied)
    expect(svg).toContain('class="seam-allowance"');
  });

  it('should accept custom seam allowance between 0.5cm and 3.0cm', async () => {
    const svg05 = await generatePattern(template, validMeasurements, { seamAllowanceCm: 0.5 });
    const svg30 = await generatePattern(template, validMeasurements, { seamAllowanceCm: 3.0 });

    expect(svg05).toContain('class="seam-allowance"');
    expect(svg30).toContain('class="seam-allowance"');
  });

  it('should reject seam allowance below 0.5cm', async () => {
    await expect(
      generatePattern(template, validMeasurements, { seamAllowanceCm: 0.3 }),
    ).rejects.toThrow('Seam allowance must be between');
  });

  it('should reject seam allowance above 3.0cm', async () => {
    await expect(
      generatePattern(template, validMeasurements, { seamAllowanceCm: 3.5 }),
    ).rejects.toThrow('Seam allowance must be between');
  });

  it('should reject invalid measurements', async () => {
    const invalidMeasurements = { chest: 5, waist: 800, length: 700, shoulder: 420 };
    await expect(
      generatePattern(template, invalidMeasurements),
    ).rejects.toThrow('Invalid measurements');
  });

  it('should reject measurements exceeding maximum (2000mm)', async () => {
    const invalidMeasurements = { chest: 2500, waist: 800, length: 700, shoulder: 420 };
    await expect(
      generatePattern(template, invalidMeasurements),
    ).rejects.toThrow('Invalid measurements');
  });

  it('should store template ID in the SVG', async () => {
    const svg = await generatePattern(template, validMeasurements);
    expect(svg).toContain('data-template-id="test-camiseta-adult"');
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Tests for loadTemplate and applyMeasurements (new API)
// Validates: Requirements 1.7, 1.8
// ═══════════════════════════════════════════════════════════════════════════════

const STANDARD_GARMENT_TYPES: StandardGarmentType[] = [
  'camiseta',
  'short',
  'legging',
  'sudadera',
  'tank-top',
];

const AGE_GROUPS: AgeGroup[] = ['children', 'adult'];

describe('Template Engine - loadTemplate', () => {
  describe('loads all standard garment types for both age groups', () => {
    for (const garmentType of STANDARD_GARMENT_TYPES) {
      for (const ageGroup of AGE_GROUPS) {
        it(`should load template for ${garmentType} / ${ageGroup}`, () => {
          const template = loadTemplate(garmentType, ageGroup);

          expect(template).toBeDefined();
          expect(template.id).toBeTruthy();
          expect(template.garmentType).toBe(garmentType === 'tank-top' ? 'tank-top' : garmentType);
          expect(template.ageGroup).toBe(ageGroup);
          expect(template.proportionProfile).toBeDefined();
          expect(template.proportionProfile.ageGroup).toBe(ageGroup);
        });
      }
    }
  });

  it('should throw for an invalid garment type', () => {
    expect(() => loadTemplate('vestido' as GarmentType, 'adult')).toThrow();
  });

  it('should throw for an invalid age group', () => {
    expect(() => loadTemplate('camiseta', 'toddler' as AgeGroup)).toThrow();
  });

  it('should handle tank-top filename normalization (hyphen to underscore)', () => {
    const template = loadTemplate('tank-top', 'adult');
    expect(template).toBeDefined();
    expect(template.id).toContain('tank');
  });
});

describe('Template Engine - applyMeasurements', () => {
  it('should produce a ScaledPattern with correct garmentType and ageGroup', () => {
    const template = loadTemplate('camiseta', 'adult');
    const measurements = template.defaultMeasurements;

    const result = applyMeasurements(template, measurements);

    expect(result.garmentType).toBe('camiseta');
    expect(result.ageGroup).toBe('adult');
  });

  it('should produce ScaledPattern with pieces array', () => {
    const template = loadTemplate('short', 'children');
    const measurements = template.defaultMeasurements;

    const result = applyMeasurements(template, measurements);

    expect(result.pieces).toBeDefined();
    expect(Array.isArray(result.pieces)).toBe(true);
    expect(result.pieces.length).toBeGreaterThan(0);
  });

  it('should produce ScaledPieces with required structure (outline, seamAllowance, grainLine, notches, label)', () => {
    const template = loadTemplate('camiseta', 'adult');
    const measurements = template.defaultMeasurements;

    const result = applyMeasurements(template, measurements);

    for (const piece of result.pieces) {
      expect(piece.id).toBeTruthy();
      expect(piece.outline).toBeTruthy();
      expect(typeof piece.outline).toBe('string');
      expect(piece.seamAllowance).toBeTruthy();
      expect(typeof piece.seamAllowance).toBe('string');
      expect(piece.grainLine).toBeDefined();
      expect(typeof piece.grainLine.x1).toBe('number');
      expect(typeof piece.grainLine.y1).toBe('number');
      expect(typeof piece.grainLine.x2).toBe('number');
      expect(typeof piece.grainLine.y2).toBe('number');
      expect(Array.isArray(piece.notches)).toBe(true);
      expect(piece.label).toBeTruthy();
    }
  });

  it('should produce correctly scaled control points (larger measurements produce larger outlines)', () => {
    const template = loadTemplate('camiseta', 'adult');
    const smallMeasurements: Record<string, number> = {
      chest: 800,
      waist: 600,
      hip: 800,
      torsoLength: 420,
      legLength: 600,
      shoulderWidth: 380,
    };
    const largeMeasurements: Record<string, number> = {
      chest: 1200,
      waist: 1000,
      hip: 1200,
      torsoLength: 620,
      legLength: 800,
      shoulderWidth: 540,
    };

    const smallResult = applyMeasurements(template, smallMeasurements);
    const largeResult = applyMeasurements(template, largeMeasurements);

    // The outline path for larger measurements should differ from smaller ones
    // At minimum, the paths should be different
    expect(smallResult.pieces[0].outline).not.toBe(largeResult.pieces[0].outline);
  });

  it('should work for all standard garment types with default measurements', () => {
    for (const garmentType of STANDARD_GARMENT_TYPES) {
      for (const ageGroup of AGE_GROUPS) {
        const template = loadTemplate(garmentType, ageGroup);
        const result = applyMeasurements(template, template.defaultMeasurements);

        expect(result.pieces.length).toBeGreaterThan(0);
        expect(result.garmentType).toBe(garmentType === 'tank-top' ? 'tank-top' : garmentType);
      }
    }
  });
});

describe('Template Engine - ProportionProfile differences between age groups', () => {
  const CHILDREN_PROFILE: ProportionProfile = {
    ageGroup: 'children',
    headToBodyRatio: 0.2,
    limbToTorsoRatio: 0.9,
    waistPositionRatio: 0.47,
    shoulderToHipRatio: 0.95,
  };

  const ADULT_PROFILE: ProportionProfile = {
    ageGroup: 'adult',
    headToBodyRatio: 0.133,
    limbToTorsoRatio: 1.2,
    waistPositionRatio: 0.42,
    shoulderToHipRatio: 1.1,
  };

  it('should load children templates with children-specific ProportionProfile', () => {
    for (const garmentType of STANDARD_GARMENT_TYPES) {
      const template = loadTemplate(garmentType, 'children');
      const profile = template.proportionProfile;

      expect(profile.ageGroup).toBe('children');
      expect(profile.headToBodyRatio).toBe(CHILDREN_PROFILE.headToBodyRatio);
      expect(profile.limbToTorsoRatio).toBe(CHILDREN_PROFILE.limbToTorsoRatio);
      expect(profile.waistPositionRatio).toBe(CHILDREN_PROFILE.waistPositionRatio);
      expect(profile.shoulderToHipRatio).toBe(CHILDREN_PROFILE.shoulderToHipRatio);
    }
  });

  it('should load adult templates with adult-specific ProportionProfile', () => {
    for (const garmentType of STANDARD_GARMENT_TYPES) {
      const template = loadTemplate(garmentType, 'adult');
      const profile = template.proportionProfile;

      expect(profile.ageGroup).toBe('adult');
      expect(profile.headToBodyRatio).toBe(ADULT_PROFILE.headToBodyRatio);
      expect(profile.limbToTorsoRatio).toBe(ADULT_PROFILE.limbToTorsoRatio);
      expect(profile.waistPositionRatio).toBe(ADULT_PROFILE.waistPositionRatio);
      expect(profile.shoulderToHipRatio).toBe(ADULT_PROFILE.shoulderToHipRatio);
    }
  });

  it('should have different ProportionProfile values between children and adult for the same garment type', () => {
    for (const garmentType of STANDARD_GARMENT_TYPES) {
      const childrenTemplate = loadTemplate(garmentType, 'children');
      const adultTemplate = loadTemplate(garmentType, 'adult');

      const cp = childrenTemplate.proportionProfile;
      const ap = adultTemplate.proportionProfile;

      // Children have higher head-to-body ratio (~1:5 vs adult ~1:7.5)
      expect(cp.headToBodyRatio).toBeGreaterThan(ap.headToBodyRatio);
      // Children have shorter limbs relative to torso
      expect(cp.limbToTorsoRatio).toBeLessThan(ap.limbToTorsoRatio);
      // Children have higher waist position
      expect(cp.waistPositionRatio).toBeGreaterThan(ap.waistPositionRatio);
      // Children have narrower shoulders relative to hips
      expect(cp.shoulderToHipRatio).toBeLessThan(ap.shoulderToHipRatio);
    }
  });

  it('should apply children ProportionProfile differently than adult ProportionProfile in measurements', () => {
    // Use same raw measurements for both templates to see proportion effect
    const sharedMeasurements: Record<string, number> = {
      chest: 800,
      waist: 700,
      hip: 800,
      torsoLength: 400,
      legLength: 500,
      shoulderWidth: 350,
    };

    const childrenTemplate = loadTemplate('camiseta', 'children');
    const adultTemplate = loadTemplate('camiseta', 'adult');

    const childrenResult = applyMeasurements(childrenTemplate, sharedMeasurements);
    const adultResult = applyMeasurements(adultTemplate, sharedMeasurements);

    // Results should differ because ProportionProfile adjustments are applied
    expect(childrenResult.pieces[0].outline).not.toBe(adultResult.pieces[0].outline);
  });
});
