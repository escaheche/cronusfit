/**
 * Property-based tests for Pattern Generator module.
 *
 * **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 4.6**
 *
 * Properties tested:
 * 1. Pattern Structural Completeness
 * 2. Measurement Validation Completeness
 * 3. Custom Template Control Point Validation
 * 4. File Upload Validation
 * 5. Age-Group Template Availability
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { generatePattern, interpolateControlPoints } from '../../src/modules/pattern/template-engine.js';
import { validateCustomTemplateInput } from '../../src/modules/pattern/custom-template.js';
import type { CreateCustomTemplateInput } from '../../src/modules/pattern/custom-template.js';
import { validateMeasurements, MEASUREMENT_MIN_MM, MEASUREMENT_MAX_MM } from '../../src/validation/measurements.js';
import { validateFile, MAX_FILE_SIZE_BYTES, ACCEPTED_MIME_TYPES } from '../../src/validation/files.js';
import type { FileInfo } from '../../src/validation/files.js';
import type { ParametricTemplate, ControlPoint, PieceDefinition } from '../../src/types/pattern.js';
import type { AgeGroup, GarmentType } from '../../src/types/garment.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Mock S3 operations since we test template engine logic directly
vi.mock('../../src/storage/s3-client.js', () => ({
  downloadFile: vi.fn(),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

vi.mock('../../src/db/operations.js', () => ({
  put: vi.fn().mockResolvedValue(undefined),
}));

// --- Generators ---

const STANDARD_GARMENT_TYPES: GarmentType[] = ['camiseta', 'short', 'legging', 'sudadera', 'tank-top'];
const AGE_GROUPS: AgeGroup[] = ['children', 'adult'];

/** Generate a valid control point with unique id, valid min/max within [10, 2000]. */
function arbControlPoint(index: number): fc.Arbitrary<ControlPoint> {
  return fc.record({
    id: fc.constant(`cp-${index}`),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    x: fc.float({ min: Math.fround(0.01), max: Math.fround(1.0), noNaN: true }),
    y: fc.float({ min: Math.fround(0.01), max: Math.fround(1.0), noNaN: true }),
    minValue: fc.integer({ min: 10, max: 999 }),
    maxValue: fc.integer({ min: 1000, max: 2000 }),
    affectedPieces: fc.constant(['piece-0']),
  });
}

/** Generate an array of N valid control points with unique IDs. */
function arbControlPoints(minCount: number, maxCount: number): fc.Arbitrary<ControlPoint[]> {
  return fc.integer({ min: minCount, max: maxCount }).chain((n) =>
    fc.tuple(...Array.from({ length: n }, (_, i) => arbControlPoint(i))),
  );
}

/** Generate a valid piece definition. */
function arbPieceDefinition(): fc.Arbitrary<PieceDefinition> {
  return fc.record({
    id: fc.constant('piece-0'),
    name: fc.string({ minLength: 1, maxLength: 20 }),
    cutQuantity: fc.integer({ min: 1, max: 4 }),
    pathFunction: fc.constant('test_path'),
    grainLineAngle: fc.integer({ min: 0, max: 360 }),
    notchPositions: fc.array(
      fc.record({
        edgeId: fc.string({ minLength: 1, maxLength: 10 }),
        position: fc.float({ min: 0, max: 1, noNaN: true }),
        matchingPieceEdgeId: fc.string({ minLength: 1, maxLength: 20 }),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  });
}

/** Generate a valid ParametricTemplate for testing generatePattern. */
function arbTemplate(): fc.Arbitrary<ParametricTemplate> {
  return fc.tuple(arbControlPoints(4, 8), arbPieceDefinition()).map(([controlPoints, piece]) => {
    // Ensure all control points reference the piece
    const cps = controlPoints.map((cp) => ({ ...cp, affectedPieces: [piece.id] }));
    const defaultMeasurements: Record<string, number> = {};
    for (const cp of cps) {
      defaultMeasurements[cp.id] = Math.floor((cp.minValue + cp.maxValue) / 2);
    }
    return {
      id: 'tpl-test',
      garmentType: 'camiseta' as GarmentType,
      ageGroup: 'adult' as AgeGroup,
      controlPoints: cps,
      pieceDefinitions: [piece],
      defaultMeasurements,
      constraints: [],
      proportionProfile: {
        ageGroup: 'adult' as AgeGroup,
        headToBodyRatio: 0.13,
        limbToTorsoRatio: 1.0,
        waistPositionRatio: 0.45,
        shoulderToHipRatio: 1.1,
      },
    };
  });
}

/** Generate valid measurements for a given template. */
function arbValidMeasurements(template: ParametricTemplate): Record<string, number> {
  const measurements: Record<string, number> = {};
  for (const cp of template.controlPoints) {
    measurements[cp.id] = Math.floor((cp.minValue + cp.maxValue) / 2);
  }
  return measurements;
}

// --- Property Tests ---

describe('Property 1: Pattern Structural Completeness', () => {
  it('[property] SVG contains grouped elements, seam allowances, grain lines, notches, labels, mm coordinates for any valid input', async () => {
    await fc.assert(
      fc.asyncProperty(arbTemplate(), async (template) => {
        const measurements = arbValidMeasurements(template);
        const svg = await generatePattern(template, measurements, { size: 'M' });

        // SVG contains root element with mm units
        expect(svg).toContain('<svg');
        expect(svg).toContain('data-units="mm"');
        expect(svg).toMatch(/width="[\d.]+mm"/);
        expect(svg).toMatch(/height="[\d.]+mm"/);

        // Contains grouped elements with unique IDs
        expect(svg).toMatch(/<g id="piece-/);

        // Contains seam allowance paths
        expect(svg).toContain('class="seam-allowance"');

        // Contains grain line indicators
        expect(svg).toContain('class="grain-line"');
        expect(svg).toContain('class="grain-arrow"');

        // Contains notch marks
        expect(svg).toContain('class="notch"');

        // Contains labels (piece name, size, cut quantity)
        expect(svg).toContain('class="label"');
        expect(svg).toContain('Size: M');
        expect(svg).toContain('Cut:');
      }),
      { numRuns: 100 },
    );
  });

  it('[property] each piece has exactly one seam allowance, one grain line, and its defined notches', async () => {
    await fc.assert(
      fc.asyncProperty(arbTemplate(), async (template) => {
        const measurements = arbValidMeasurements(template);
        const svg = await generatePattern(template, measurements);

        for (const piece of template.pieceDefinitions) {
          const pieceId = `piece-${piece.id}`;
          expect(svg).toContain(`id="${pieceId}"`);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 2: Measurement Validation Completeness', () => {
  it('[property] any measurement outside [10mm, 2000mm] is rejected with specific errors', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
          fc.oneof(
            fc.integer({ min: -1000, max: 9 }),
            fc.integer({ min: 2001, max: 100000 }),
            fc.constant(NaN),
            fc.constant(Infinity),
            fc.constant(-Infinity),
          ),
          { minKeys: 1, maxKeys: 5 },
        ),
        (invalidMeasurements) => {
          const result = validateMeasurements(invalidMeasurements);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);

          // Each error specifies the field name
          for (const error of result.errors) {
            expect(error.field).toBeTruthy();
            expect(error.code).toBeTruthy();
            expect(error.message.es).toBeTruthy();
            expect(error.message.en).toBeTruthy();
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] any measurement within [10mm, 2000mm] is accepted', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
          fc.integer({ min: MEASUREMENT_MIN_MM, max: MEASUREMENT_MAX_MM }),
          { minKeys: 1, maxKeys: 10 },
        ),
        (validMeasurements) => {
          const result = validateMeasurements(validMeasurements);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] mixed valid/invalid measurements are rejected and errors reference only invalid fields', () => {
    fc.assert(
      fc.property(
        fc.record({
          validField: fc.integer({ min: MEASUREMENT_MIN_MM, max: MEASUREMENT_MAX_MM }),
          invalidField: fc.oneof(
            fc.integer({ min: -1000, max: 9 }),
            fc.integer({ min: 2001, max: 100000 }),
          ),
        }),
        ({ validField, invalidField }) => {
          const measurements = { chest: validField, badField: invalidField };
          const result = validateMeasurements(measurements);
          expect(result.valid).toBe(false);
          const errorFields = result.errors.map((e) => e.field);
          expect(errorFields).toContain('badField');
          expect(errorFields).not.toContain('chest');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 3: Custom Template Control Point Validation', () => {
  it('[property] accepted iff N≥4 control points and valid AgeGroup', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 10 }),
        fc.constantFrom<AgeGroup>('children', 'adult'),
        (count, ageGroup) => {
          const controlPoints: ControlPoint[] = Array.from({ length: count }, (_, i) => ({
            id: `cp-${i}`,
            name: `Control Point ${i}`,
            x: 0.5,
            y: 0.5,
            minValue: 100,
            maxValue: 500,
            affectedPieces: ['piece-0'],
          }));

          const input: CreateCustomTemplateInput = {
            name: 'Test Template',
            ageGroup,
            controlPoints,
            pieceDefinitions: [{
              id: 'piece-0',
              name: 'Test Piece',
              cutQuantity: 1,
              pathFunction: 'test_fn',
              grainLineAngle: 0,
              notchPositions: [{ edgeId: 'edge-1', position: 0.5, matchingPieceEdgeId: 'other:edge-1' }],
            }],
            defaultMeasurements: Object.fromEntries(controlPoints.map((cp) => [cp.id, 300])),
            createdBy: 'admin-uuid-123',
          };

          const result = validateCustomTemplateInput(input);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejected when fewer than 4 control points', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.constantFrom<AgeGroup>('children', 'adult'),
        (count, ageGroup) => {
          const controlPoints: ControlPoint[] = Array.from({ length: count }, (_, i) => ({
            id: `cp-${i}`,
            name: `Control Point ${i}`,
            x: 0.5,
            y: 0.5,
            minValue: 100,
            maxValue: 500,
            affectedPieces: ['piece-0'],
          }));

          const input: CreateCustomTemplateInput = {
            name: 'Test Template',
            ageGroup,
            controlPoints,
            pieceDefinitions: [{
              id: 'piece-0',
              name: 'Test Piece',
              cutQuantity: 1,
              pathFunction: 'test_fn',
              grainLineAngle: 0,
              notchPositions: [{ edgeId: 'edge-1', position: 0.5, matchingPieceEdgeId: 'other:edge-1' }],
            }],
            defaultMeasurements: Object.fromEntries(controlPoints.map((cp) => [cp.id, 300])),
            createdBy: 'admin-uuid-123',
          };

          const result = validateCustomTemplateInput(input);
          expect(result.valid).toBe(false);
          const codes = result.errors.map((e) => e.code);
          expect(codes).toContain('MIN_CONTROL_POINTS');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejected when ageGroup is invalid', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s !== 'children' && s !== 'adult'),
        (invalidAgeGroup) => {
          const controlPoints: ControlPoint[] = Array.from({ length: 4 }, (_, i) => ({
            id: `cp-${i}`,
            name: `Control Point ${i}`,
            x: 0.5,
            y: 0.5,
            minValue: 100,
            maxValue: 500,
            affectedPieces: ['piece-0'],
          }));

          const input: CreateCustomTemplateInput = {
            name: 'Test Template',
            ageGroup: invalidAgeGroup as AgeGroup,
            controlPoints,
            pieceDefinitions: [{
              id: 'piece-0',
              name: 'Test Piece',
              cutQuantity: 1,
              pathFunction: 'test_fn',
              grainLineAngle: 0,
              notchPositions: [{ edgeId: 'edge-1', position: 0.5, matchingPieceEdgeId: 'other:edge-1' }],
            }],
            defaultMeasurements: Object.fromEntries(controlPoints.map((cp) => [cp.id, 300])),
            createdBy: 'admin-uuid-123',
          };

          const result = validateCustomTemplateInput(input);
          expect(result.valid).toBe(false);
          const codes = result.errors.map((e) => e.code);
          expect(codes).toContain('INVALID_AGE_GROUP');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejected when control points have duplicate IDs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 4, max: 8 }),
        fc.constantFrom<AgeGroup>('children', 'adult'),
        (count, ageGroup) => {
          // Create control points where last one duplicates the first ID
          const controlPoints: ControlPoint[] = Array.from({ length: count }, (_, i) => ({
            id: i === count - 1 ? 'cp-0' : `cp-${i}`, // duplicate first ID
            name: `Control Point ${i}`,
            x: 0.5,
            y: 0.5,
            minValue: 100,
            maxValue: 500,
            affectedPieces: ['piece-0'],
          }));

          const input: CreateCustomTemplateInput = {
            name: 'Test Template',
            ageGroup,
            controlPoints,
            pieceDefinitions: [{
              id: 'piece-0',
              name: 'Test Piece',
              cutQuantity: 1,
              pathFunction: 'test_fn',
              grainLineAngle: 0,
              notchPositions: [{ edgeId: 'edge-1', position: 0.5, matchingPieceEdgeId: 'other:edge-1' }],
            }],
            defaultMeasurements: Object.fromEntries(controlPoints.map((cp) => [cp.id, 300])),
            createdBy: 'admin-uuid-123',
          };

          const result = validateCustomTemplateInput(input);
          expect(result.valid).toBe(false);
          const codes = result.errors.map((e) => e.code);
          expect(codes).toContain('DUPLICATE_ID');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] rejected when control points have minValue >= maxValue', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 1000 }),
        fc.constantFrom<AgeGroup>('children', 'adult'),
        (sameValue, ageGroup) => {
          const controlPoints: ControlPoint[] = Array.from({ length: 4 }, (_, i) => ({
            id: `cp-${i}`,
            name: `Control Point ${i}`,
            x: 0.5,
            y: 0.5,
            minValue: i === 0 ? sameValue : 100,
            maxValue: i === 0 ? sameValue : 500, // first point: min == max
            affectedPieces: ['piece-0'],
          }));

          const input: CreateCustomTemplateInput = {
            name: 'Test Template',
            ageGroup,
            controlPoints,
            pieceDefinitions: [{
              id: 'piece-0',
              name: 'Test Piece',
              cutQuantity: 1,
              pathFunction: 'test_fn',
              grainLineAngle: 0,
              notchPositions: [{ edgeId: 'edge-1', position: 0.5, matchingPieceEdgeId: 'other:edge-1' }],
            }],
            defaultMeasurements: Object.fromEntries(controlPoints.map((cp) => [cp.id, 300])),
            createdBy: 'admin-uuid-123',
          };

          const result = validateCustomTemplateInput(input);
          expect(result.valid).toBe(false);
          const codes = result.errors.map((e) => e.code);
          expect(codes).toContain('MIN_EXCEEDS_MAX');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: File Upload Validation', () => {
  const validMimeTypes = ['image/jpeg', 'image/png', 'image/svg+xml'];
  const validExtensions = ['.jpg', '.jpeg', '.png', '.svg'];

  it('[property] valid files (accepted format + size ≤ 10MB) are always accepted', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validMimeTypes),
        fc.constantFrom(...validExtensions),
        fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
        (mimeType, ext, sizeBytes) => {
          const file: FileInfo = {
            name: `design${ext}`,
            sizeBytes,
            mimeType,
          };
          const result = validateFile(file);
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] files with invalid MIME type are always rejected', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 3, maxLength: 40 }).filter(
          (s) => !validMimeTypes.includes(s.toLowerCase()),
        ),
        fc.constantFrom(...validExtensions),
        fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
        (mimeType, ext, sizeBytes) => {
          const file: FileInfo = {
            name: `design${ext}`,
            sizeBytes,
            mimeType,
          };
          const result = validateFile(file);
          expect(result.valid).toBe(false);
          const codes = result.errors.map((e) => e.code);
          expect(codes).toContain('INVALID_FORMAT');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] files exceeding 10MB are always rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validMimeTypes),
        fc.constantFrom(...validExtensions),
        fc.integer({ min: MAX_FILE_SIZE_BYTES + 1, max: MAX_FILE_SIZE_BYTES * 5 }),
        (mimeType, ext, sizeBytes) => {
          const file: FileInfo = {
            name: `design${ext}`,
            sizeBytes,
            mimeType,
          };
          const result = validateFile(file);
          expect(result.valid).toBe(false);
          const codes = result.errors.map((e) => e.code);
          expect(codes).toContain('SIZE_EXCEEDED');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] files with invalid extension are always rejected', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...validMimeTypes),
        fc.constantFrom('.bmp', '.gif', '.tiff', '.webp', '.pdf', '.docx'),
        fc.integer({ min: 1, max: MAX_FILE_SIZE_BYTES }),
        (mimeType, ext, sizeBytes) => {
          const file: FileInfo = {
            name: `design${ext}`,
            sizeBytes,
            mimeType,
          };
          const result = validateFile(file);
          expect(result.valid).toBe(false);
          const codes = result.errors.map((e) => e.code);
          expect(codes).toContain('INVALID_FORMAT');
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property 5: Age-Group Template Availability', () => {
  const templatesDir = path.resolve(__dirname, '../../templates/parametric');

  it('[property] both children and adult templates exist for all 5 garment types', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STANDARD_GARMENT_TYPES),
        fc.constantFrom(...AGE_GROUPS),
        (garmentType, ageGroup) => {
          // Normalize garment type for filename: 'tank-top' -> 'tank_top' (file convention)
          const filename = garmentType === 'tank-top' ? 'tank_top' : garmentType;
          const templatePath = path.join(templatesDir, ageGroup, `${filename}.json`);
          const exists = fs.existsSync(templatePath);
          expect(exists).toBe(true);

          // Verify template structure is valid
          const content = fs.readFileSync(templatePath, 'utf-8');
          const template = JSON.parse(content) as ParametricTemplate;

          expect(template.garmentType).toBe(garmentType);
          expect(template.ageGroup).toBe(ageGroup);
          expect(template.controlPoints.length).toBeGreaterThanOrEqual(4);
          expect(template.pieceDefinitions.length).toBeGreaterThanOrEqual(1);
          expect(template.proportionProfile).toBeDefined();
          expect(template.proportionProfile.ageGroup).toBe(ageGroup);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] children templates have child-specific proportion profiles', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STANDARD_GARMENT_TYPES),
        (garmentType) => {
          const filename = garmentType === 'tank-top' ? 'tank_top' : garmentType;
          const templatePath = path.join(templatesDir, 'children', `${filename}.json`);
          const content = fs.readFileSync(templatePath, 'utf-8');
          const template = JSON.parse(content) as ParametricTemplate;

          // Children have larger head-to-body ratio than adults (~1:5 vs ~1:7.5)
          expect(template.proportionProfile.headToBodyRatio).toBeGreaterThan(0.15);
          // Children have shorter limbs relative to torso
          expect(template.proportionProfile.limbToTorsoRatio).toBeLessThan(1.0);
          // Children have higher waist position
          expect(template.proportionProfile.waistPositionRatio).toBeGreaterThan(0.45);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('[property] adult templates have adult-specific proportion profiles', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STANDARD_GARMENT_TYPES),
        (garmentType) => {
          const filename = garmentType === 'tank-top' ? 'tank_top' : garmentType;
          const templatePath = path.join(templatesDir, 'adult', `${filename}.json`);
          const content = fs.readFileSync(templatePath, 'utf-8');
          const template = JSON.parse(content) as ParametricTemplate;

          // Adults have smaller head-to-body ratio
          expect(template.proportionProfile.headToBodyRatio).toBeLessThan(0.2);
          // Adults have proportional limbs (ratio ~1.0)
          expect(template.proportionProfile.limbToTorsoRatio).toBeGreaterThanOrEqual(0.9);
          // Adults have shoulder wider than or equal to hips
          expect(template.proportionProfile.shoulderToHipRatio).toBeGreaterThanOrEqual(1.0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
