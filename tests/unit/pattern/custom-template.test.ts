/**
 * Unit tests for custom template creation module.
 * Tests validation logic and createCustomTemplate flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateCustomTemplateInput,
  createCustomTemplate,
  type CreateCustomTemplateInput,
} from '../../../src/modules/pattern/custom-template.js';
import type { ControlPoint, PieceDefinition } from '../../../src/types/pattern.js';

// Mock external dependencies
vi.mock('../../../src/db/operations.js', () => ({
  put: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/storage/s3-client.js', () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  BUCKETS: { assets: 'cronusfit-assets', website: 'cronusfit-website' },
}));

// --- Test Helpers ---

function makeControlPoint(overrides: Partial<ControlPoint> = {}, index = 0): ControlPoint {
  return {
    id: overrides.id ?? `cp-${index}`,
    name: overrides.name ?? `Control Point ${index}`,
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    minValue: overrides.minValue ?? 50,
    maxValue: overrides.maxValue ?? 500,
    affectedPieces: overrides.affectedPieces ?? ['piece-0'],
    ...overrides,
  };
}

function makePieceDefinition(overrides: Partial<PieceDefinition> = {}, index = 0): PieceDefinition {
  return {
    id: overrides.id ?? `piece-${index}`,
    name: overrides.name ?? `Piece ${index}`,
    cutQuantity: overrides.cutQuantity ?? 2,
    pathFunction: overrides.pathFunction ?? 'linear',
    grainLineAngle: overrides.grainLineAngle ?? 0,
    notchPositions: overrides.notchPositions ?? [],
    ...overrides,
  };
}

function makeValidInput(overrides: Partial<CreateCustomTemplateInput> = {}): CreateCustomTemplateInput {
  const controlPoints = overrides.controlPoints ?? [
    makeControlPoint({}, 0),
    makeControlPoint({}, 1),
    makeControlPoint({}, 2),
    makeControlPoint({}, 3),
  ];

  const pieceDefinitions = overrides.pieceDefinitions ?? [makePieceDefinition({}, 0)];

  const defaultMeasurements = overrides.defaultMeasurements ?? {
    'cp-0': 200,
    'cp-1': 200,
    'cp-2': 200,
    'cp-3': 200,
  };

  return {
    name: overrides.name ?? 'Custom Jersey',
    ageGroup: overrides.ageGroup ?? 'adult',
    controlPoints,
    pieceDefinitions,
    defaultMeasurements,
    constraints: overrides.constraints ?? [],
    createdBy: overrides.createdBy ?? 'admin-cognito-sub-123',
  };
}

// --- Tests ---

describe('validateCustomTemplateInput', () => {
  it('should pass validation for a valid input', () => {
    const input = makeValidInput();
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail if name is empty', () => {
    const input = makeValidInput({ name: '' });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('should fail if ageGroup is invalid', () => {
    const input = makeValidInput({ ageGroup: 'teen' as any });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'ageGroup')).toBe(true);
  });

  it('should accept children ageGroup', () => {
    const input = makeValidInput({ ageGroup: 'children' });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(true);
  });

  it('should fail if fewer than 4 control points', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({}, 0),
        makeControlPoint({}, 1),
        makeControlPoint({}, 2),
      ],
      defaultMeasurements: { 'cp-0': 200, 'cp-1': 200, 'cp-2': 200 },
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'controlPoints' && e.code === 'MIN_CONTROL_POINTS')).toBe(true);
  });

  it('should include the count provided in the error message when fewer than 4 control points', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({}, 0),
        makeControlPoint({}, 1),
      ],
      defaultMeasurements: { 'cp-0': 200, 'cp-1': 200 },
    });
    const result = validateCustomTemplateInput(input);
    const error = result.errors.find((e) => e.code === 'MIN_CONTROL_POINTS');
    expect(error).toBeDefined();
    expect(error!.message.en).toContain('2 provided');
  });

  it('should fail if control point IDs are duplicated', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({ id: 'dup' }, 0),
        makeControlPoint({ id: 'dup' }, 1),
        makeControlPoint({}, 2),
        makeControlPoint({}, 3),
      ],
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'DUPLICATE_ID')).toBe(true);
  });

  it('should fail if control point minValue < 10mm', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({ minValue: 5 }, 0),
        makeControlPoint({}, 1),
        makeControlPoint({}, 2),
        makeControlPoint({}, 3),
      ],
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('minValue') && e.code === 'OUT_OF_RANGE')).toBe(true);
  });

  it('should fail if control point maxValue > 2000mm', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({ maxValue: 2500 }, 0),
        makeControlPoint({}, 1),
        makeControlPoint({}, 2),
        makeControlPoint({}, 3),
      ],
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes('maxValue') && e.code === 'OUT_OF_RANGE')).toBe(true);
  });

  it('should accept control points at exactly 10mm min boundary', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({ minValue: 10, maxValue: 100 }, 0),
        makeControlPoint({}, 1),
        makeControlPoint({}, 2),
        makeControlPoint({}, 3),
      ],
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(true);
  });

  it('should accept control points at exactly 2000mm max boundary', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({ minValue: 50, maxValue: 2000 }, 0),
        makeControlPoint({}, 1),
        makeControlPoint({}, 2),
        makeControlPoint({}, 3),
      ],
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(true);
  });

  it('should fail if minValue >= maxValue', () => {
    const input = makeValidInput({
      controlPoints: [
        makeControlPoint({ minValue: 500, maxValue: 500 }, 0),
        makeControlPoint({}, 1),
        makeControlPoint({}, 2),
        makeControlPoint({}, 3),
      ],
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MIN_EXCEEDS_MAX')).toBe(true);
  });

  it('should fail if a piece is not referenced by any control point', () => {
    const input = makeValidInput({
      pieceDefinitions: [
        makePieceDefinition({ id: 'orphan-piece' }, 0),
      ],
      controlPoints: [
        makeControlPoint({ affectedPieces: ['other-piece'] }, 0),
        makeControlPoint({ affectedPieces: ['other-piece'] }, 1),
        makeControlPoint({ affectedPieces: ['other-piece'] }, 2),
        makeControlPoint({ affectedPieces: ['other-piece'] }, 3),
      ],
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'UNREFERENCED_PIECE')).toBe(true);
  });

  it('should fail if defaultMeasurements is missing a control point', () => {
    const input = makeValidInput({
      defaultMeasurements: {
        'cp-0': 200,
        'cp-1': 200,
        'cp-2': 200,
        // missing cp-3
      },
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === 'MISSING_DEFAULT')).toBe(true);
  });

  it('should fail if createdBy is empty', () => {
    const input = makeValidInput({ createdBy: '' });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'createdBy')).toBe(true);
  });

  it('should collect multiple errors', () => {
    const input = makeValidInput({
      name: '',
      ageGroup: 'invalid' as any,
      controlPoints: [],
      createdBy: '',
    });
    const result = validateCustomTemplateInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });
});

describe('createCustomTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return a valid ParametricTemplate on success', async () => {
    const input = makeValidInput();
    const template = await createCustomTemplate(input);

    expect(template.id).toMatch(/^custom-custom-jersey-[a-f0-9]{8}$/);
    expect(template.garmentType).toBe('custom');
    expect(template.ageGroup).toBe('adult');
    expect(template.controlPoints).toHaveLength(4);
    expect(template.pieceDefinitions).toHaveLength(1);
    expect(template.defaultMeasurements).toEqual(input.defaultMeasurements);
    expect(template.proportionProfile.ageGroup).toBe('adult');
  });

  it('should use children proportion profile for children ageGroup', async () => {
    const input = makeValidInput({ ageGroup: 'children' });
    const template = await createCustomTemplate(input);

    expect(template.proportionProfile.ageGroup).toBe('children');
    expect(template.proportionProfile.headToBodyRatio).toBe(0.2);
    expect(template.proportionProfile.limbToTorsoRatio).toBe(0.9);
    expect(template.proportionProfile.waistPositionRatio).toBe(0.47);
    expect(template.proportionProfile.shoulderToHipRatio).toBe(0.95);
  });

  it('should use adult proportion profile for adult ageGroup', async () => {
    const input = makeValidInput({ ageGroup: 'adult' });
    const template = await createCustomTemplate(input);

    expect(template.proportionProfile.ageGroup).toBe('adult');
    expect(template.proportionProfile.headToBodyRatio).toBe(0.133);
    expect(template.proportionProfile.limbToTorsoRatio).toBe(1.2);
    expect(template.proportionProfile.waistPositionRatio).toBe(0.42);
    expect(template.proportionProfile.shoulderToHipRatio).toBe(1.1);
  });

  it('should call uploadFile with correct S3 key', async () => {
    const { uploadFile } = await import('../../../src/storage/s3-client.js');
    const input = makeValidInput();
    const template = await createCustomTemplate(input);

    expect(uploadFile).toHaveBeenCalledWith(
      'cronusfit-assets',
      `templates/parametric/custom/${template.id}.json`,
      expect.any(String),
      'application/json',
    );
  });

  it('should call put with correct DynamoDB record', async () => {
    const { put } = await import('../../../src/db/operations.js');
    const input = makeValidInput();
    await createCustomTemplate(input);

    expect(put).toHaveBeenCalledWith(
      expect.objectContaining({
        PK: 'TEMPLATE#custom#adult',
        SK: 'VERSION#1',
        GSI1PK: 'AGEGROUP#adult',
        GSI1SK: 'GARMENT#custom',
        garmentType: 'custom',
        ageGroup: 'adult',
        version: '1',
        controlPointCount: 4,
        createdBy: 'admin-cognito-sub-123',
      }),
    );
  });

  it('should throw if validation fails', async () => {
    const input = makeValidInput({ name: '', controlPoints: [] });
    await expect(createCustomTemplate(input)).rejects.toThrow('Custom template validation failed');
  });

  it('should generate unique IDs for different calls', async () => {
    const input = makeValidInput();
    const template1 = await createCustomTemplate(input);
    const template2 = await createCustomTemplate(input);

    expect(template1.id).not.toBe(template2.id);
  });
});
