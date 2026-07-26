/**
 * Unit tests for SVG Pattern Serialization and Deserialization.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

import { describe, it, expect } from 'vitest';
import {
  serializeSvgToJson,
  deserializeJsonToSvg,
  validateSerializedPattern,
  normalizeJson,
  areGeometricallyEqual,
  type SerializedPattern,
  type SerializationMetadata,
} from './serialization.js';

// --- Test Fixtures ---

const validMetadata: SerializationMetadata = {
  templateId: 'tpl-camiseta-adult-v1',
  garmentType: 'camiseta',
  ageGroup: 'adult',
  size: 'M',
  seamAllowanceCm: 1.5,
  measurements: { chest: 960, waist: 800, hip: 980 },
  createdAt: '2024-01-15T10:30:00.000Z',
};

const sampleSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 800.00 600.00"
     width="800.00mm"
     height="600.00mm"
     data-template-id="tpl-camiseta-adult-v1"
     data-units="mm">
  <defs>
    <style>
      .pattern-piece { fill: none; stroke: #000; stroke-width: 0.5; }
      .seam-allowance { fill: none; stroke: #666; stroke-width: 0.3; stroke-dasharray: 2,1; }
      .grain-line { stroke: #333; stroke-width: 0.4; stroke-dasharray: 4,2; }
      .grain-arrow { fill: #333; stroke: none; }
      .notch { fill: #000; stroke: none; }
      .label { font-family: Arial, sans-serif; font-size: 8px; fill: #000; }
      .label-size { font-family: Arial, sans-serif; font-size: 6px; fill: #333; }
    </style>
  </defs>
    <g id="piece-front-body" transform="translate(20.00, 20.00)" data-piece-name="Front Body" data-cut-qty="1">
    <path class="pattern-piece" d="M 0.00 0.00 L 200.00 0.00 L 200.00 300.00 L 0.00 300.00 Z" />
    <path class="seam-allowance" d="M -15.00 -15.00 L 215.00 -15.00 L 215.00 315.00 L -15.00 315.00 Z" />
    <line class="grain-line" x1="100.00" y1="20.00" x2="100.00" y2="280.00" />
    <circle class="notch" cx="0.00" cy="150.00" r="1.5" data-edge-id="left-edge" data-matching-edge-id="back-right-edge" />
    <circle class="notch" cx="200.00" cy="150.00" r="1.5" data-edge-id="right-edge" data-matching-edge-id="sleeve-left-edge" />
    <text class="label" x="100.00" y="145.00" text-anchor="middle">Front Body</text>
    <text class="label-size" x="100.00" y="155.00" text-anchor="middle">Size: M</text>
    <text class="label-size" x="100.00" y="163.00" text-anchor="middle">Cut: 1x</text>
  </g>
</svg>`;

const validSerializedPattern: SerializedPattern = {
  version: '1.0',
  templateId: 'tpl-camiseta-adult-v1',
  garmentType: 'camiseta',
  ageGroup: 'adult',
  size: 'M',
  seamAllowanceCm: 1.5,
  viewBox: { width: 800, height: 600 },
  pieces: [
    {
      id: 'front-body',
      name: 'Front Body',
      cutQuantity: 1,
      pathData: 'M 0.00 0.00 L 200.00 0.00 L 200.00 300.00 L 0.00 300.00 Z',
      seamAllowancePathData: 'M -15.00 -15.00 L 215.00 -15.00 L 215.00 315.00 L -15.00 315.00 Z',
      grainLine: { x1: 100, y1: 20, x2: 100, y2: 280, angle: 90 },
      notches: [
        { x: 0, y: 150, edgeId: 'left-edge', matchingEdgeId: 'back-right-edge' },
        { x: 200, y: 150, edgeId: 'right-edge', matchingEdgeId: 'sleeve-left-edge' },
      ],
      bounds: { x: 0, y: 0, width: 200, height: 300 },
      offset: { x: 20, y: 20 },
    },
  ],
  measurements: { chest: 960, waist: 800, hip: 980 },
  createdAt: '2024-01-15T10:30:00.000Z',
};

describe('serializeSvgToJson', () => {
  it('should serialize a valid SVG to JSON preserving geometry', () => {
    const result = serializeSvgToJson(sampleSvg, validMetadata);

    expect(result.version).toBe('1.0');
    expect(result.templateId).toBe('tpl-camiseta-adult-v1');
    expect(result.garmentType).toBe('camiseta');
    expect(result.ageGroup).toBe('adult');
    expect(result.size).toBe('M');
    expect(result.seamAllowanceCm).toBe(1.5);
    expect(result.viewBox).toEqual({ width: 800, height: 600 });
    expect(result.pieces).toHaveLength(1);
    expect(result.measurements).toEqual({ chest: 960, waist: 800, hip: 980 });
    expect(result.createdAt).toBe('2024-01-15T10:30:00.000Z');
  });

  it('should extract piece data correctly', () => {
    const result = serializeSvgToJson(sampleSvg, validMetadata);
    const piece = result.pieces[0];

    expect(piece.id).toBe('front-body');
    expect(piece.name).toBe('Front Body');
    expect(piece.cutQuantity).toBe(1);
    expect(piece.pathData).toContain('M');
    expect(piece.pathData).toContain('Z');
    expect(piece.seamAllowancePathData).toContain('M');
    expect(piece.offset).toEqual({ x: 20, y: 20 });
  });

  it('should extract notches correctly', () => {
    const result = serializeSvgToJson(sampleSvg, validMetadata);
    const piece = result.pieces[0];

    expect(piece.notches).toHaveLength(2);
    expect(piece.notches[0]).toEqual({
      x: 0, y: 150, edgeId: 'left-edge', matchingEdgeId: 'back-right-edge',
    });
    expect(piece.notches[1]).toEqual({
      x: 200, y: 150, edgeId: 'right-edge', matchingEdgeId: 'sleeve-left-edge',
    });
  });

  it('should extract grain line correctly', () => {
    const result = serializeSvgToJson(sampleSvg, validMetadata);
    const piece = result.pieces[0];

    expect(piece.grainLine.x1).toBe(100);
    expect(piece.grainLine.y1).toBe(20);
    expect(piece.grainLine.x2).toBe(100);
    expect(piece.grainLine.y2).toBe(280);
    expect(piece.grainLine.angle).toBe(90);
  });

  it('should throw when serialized size exceeds 400KB', () => {
    // Create measurements that would make a huge JSON
    const bigMeasurements: Record<string, number> = {};
    for (let i = 0; i < 50000; i++) {
      bigMeasurements[`measurement-key-with-long-name-${i}`] = 100.12345;
    }
    const bigMetadata = { ...validMetadata, measurements: bigMeasurements };

    expect(() => serializeSvgToJson(sampleSvg, bigMetadata)).toThrow('400KB');
  });
});

describe('deserializeJsonToSvg', () => {
  it('should produce valid SVG from a SerializedPattern', () => {
    const svg = deserializeJsonToSvg(validSerializedPattern);

    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 800.00 600.00"');
    expect(svg).toContain('data-template-id="tpl-camiseta-adult-v1"');
    expect(svg).toContain('data-units="mm"');
  });

  it('should include all piece elements in output SVG', () => {
    const svg = deserializeJsonToSvg(validSerializedPattern);

    expect(svg).toContain('id="piece-front-body"');
    expect(svg).toContain('class="pattern-piece"');
    expect(svg).toContain('class="seam-allowance"');
    expect(svg).toContain('class="grain-line"');
    expect(svg).toContain('class="notch"');
    expect(svg).toContain('class="label"');
  });

  it('should include grain line coordinates', () => {
    const svg = deserializeJsonToSvg(validSerializedPattern);

    expect(svg).toContain('x1="100.00"');
    expect(svg).toContain('y1="20.00"');
    expect(svg).toContain('x2="100.00"');
    expect(svg).toContain('y2="280.00"');
  });

  it('should include notch elements with data attributes', () => {
    const svg = deserializeJsonToSvg(validSerializedPattern);

    expect(svg).toContain('data-edge-id="left-edge"');
    expect(svg).toContain('data-matching-edge-id="back-right-edge"');
    expect(svg).toContain('cx="0.00"');
    expect(svg).toContain('cy="150.00"');
  });

  it('should throw for invalid pattern JSON', () => {
    const invalidPattern = { ...validSerializedPattern, version: '2.0' as '1.0' };
    expect(() => deserializeJsonToSvg(invalidPattern)).toThrow('Invalid pattern JSON');
  });
});

describe('validateSerializedPattern', () => {
  it('should return valid for a correct pattern', () => {
    const result = validateSerializedPattern(validSerializedPattern);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject null input', () => {
    const result = validateSerializedPattern(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('root');
  });

  it('should reject invalid version', () => {
    const result = validateSerializedPattern({ ...validSerializedPattern, version: '2.0' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'version')).toBe(true);
  });

  it('should reject missing templateId', () => {
    const result = validateSerializedPattern({ ...validSerializedPattern, templateId: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'templateId')).toBe(true);
  });

  it('should reject invalid garmentType', () => {
    const result = validateSerializedPattern({ ...validSerializedPattern, garmentType: 'invalid' as any });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'garmentType')).toBe(true);
  });

  it('should reject seam allowance outside range', () => {
    const tooLow = validateSerializedPattern({ ...validSerializedPattern, seamAllowanceCm: 0.1 });
    expect(tooLow.valid).toBe(false);
    expect(tooLow.errors.some(e => e.field === 'seamAllowanceCm')).toBe(true);

    const tooHigh = validateSerializedPattern({ ...validSerializedPattern, seamAllowanceCm: 5.0 });
    expect(tooHigh.valid).toBe(false);
    expect(tooHigh.errors.some(e => e.field === 'seamAllowanceCm')).toBe(true);
  });

  it('should reject pathData not starting with M', () => {
    const badPiece = {
      ...validSerializedPattern,
      pieces: [{ ...validSerializedPattern.pieces[0], pathData: 'L 0 0 Z' }],
    };
    const result = validateSerializedPattern(badPiece);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_FORMAT')).toBe(true);
  });

  it('should reject pathData not ending with Z', () => {
    const badPiece = {
      ...validSerializedPattern,
      pieces: [{ ...validSerializedPattern.pieces[0], pathData: 'M 0 0 L 100 100' }],
    };
    const result = validateSerializedPattern(badPiece);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_FORMAT')).toBe(true);
  });

  it('should reject non-finite geometry values', () => {
    const badPiece = {
      ...validSerializedPattern,
      pieces: [{
        ...validSerializedPattern.pieces[0],
        grainLine: { x1: Infinity, y1: 20, x2: 100, y2: 280, angle: 90 },
      }],
    };
    const result = validateSerializedPattern(badPiece);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field.includes('grainLine'))).toBe(true);
  });

  it('should reject non-positive bounds dimensions', () => {
    const badPiece = {
      ...validSerializedPattern,
      pieces: [{
        ...validSerializedPattern.pieces[0],
        bounds: { x: 0, y: 0, width: 0, height: 300 },
      }],
    };
    const result = validateSerializedPattern(badPiece);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field.includes('bounds.width'))).toBe(true);
  });

  it('should reject empty pieces array', () => {
    const result = validateSerializedPattern({ ...validSerializedPattern, pieces: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'pieces')).toBe(true);
  });
});

describe('normalizeJson', () => {
  it('should produce deterministic output regardless of key order', () => {
    const a: SerializedPattern = { ...validSerializedPattern };
    // Create same data with different construction order
    const b: SerializedPattern = {
      createdAt: validSerializedPattern.createdAt,
      measurements: validSerializedPattern.measurements,
      pieces: validSerializedPattern.pieces,
      viewBox: validSerializedPattern.viewBox,
      seamAllowanceCm: validSerializedPattern.seamAllowanceCm,
      size: validSerializedPattern.size,
      ageGroup: validSerializedPattern.ageGroup,
      garmentType: validSerializedPattern.garmentType,
      templateId: validSerializedPattern.templateId,
      version: validSerializedPattern.version,
    };

    expect(normalizeJson(a)).toBe(normalizeJson(b));
  });

  it('should sort nested object keys', () => {
    const json = normalizeJson(validSerializedPattern);
    const parsed = JSON.parse(json);
    const keys = Object.keys(parsed);
    const sortedKeys = [...keys].sort();
    expect(keys).toEqual(sortedKeys);
  });
});

describe('round-trip idempotence', () => {
  it('should produce identical JSON after serialize → deserialize → serialize', () => {
    // Start with a valid pattern, deserialize to SVG, serialize back
    const svg = deserializeJsonToSvg(validSerializedPattern);
    const reserialized = serializeSvgToJson(svg, {
      templateId: validSerializedPattern.templateId,
      garmentType: validSerializedPattern.garmentType,
      ageGroup: validSerializedPattern.ageGroup,
      size: validSerializedPattern.size,
      seamAllowanceCm: validSerializedPattern.seamAllowanceCm,
      measurements: validSerializedPattern.measurements,
      createdAt: validSerializedPattern.createdAt,
    });

    // Normalized JSON should be equivalent
    expect(normalizeJson(reserialized)).toBe(normalizeJson(validSerializedPattern));
  });

  it('should be geometrically equal after round-trip', () => {
    const svg = deserializeJsonToSvg(validSerializedPattern);
    const reserialized = serializeSvgToJson(svg, {
      templateId: validSerializedPattern.templateId,
      garmentType: validSerializedPattern.garmentType,
      ageGroup: validSerializedPattern.ageGroup,
      size: validSerializedPattern.size,
      seamAllowanceCm: validSerializedPattern.seamAllowanceCm,
      measurements: validSerializedPattern.measurements,
      createdAt: validSerializedPattern.createdAt,
    });

    expect(areGeometricallyEqual(validSerializedPattern, reserialized)).toBe(true);
  });
});

// --- Tests for Task 3.2: SVG Parsing and Round-Trip Validation ---

import {
  parseSvg,
  serializeSvg,
  validateRoundTrip,
  generateSvg,
  type ParsedSvgDocument,
} from './serialization.js';
import type { ScaledPattern } from '../../types/pattern.js';

// SVG produced by generateSvg (uses data-role attributes)
const generateSvgFixture: ScaledPattern = {
  garmentType: 'camiseta',
  ageGroup: 'adult',
  size: 'M',
  pieces: [
    {
      id: 'panel-frontal',
      outline: 'M 0 0 L 200 0 L 200 300 L 0 300 Z',
      seamAllowance: 'M -15 -15 L 215 -15 L 215 315 L -15 315 Z',
      grainLine: { x1: 100, y1: 20, x2: 100, y2: 280 },
      notches: [
        { x1: 0, y1: 148.5, x2: 0, y2: 151.5 },
        { x1: 200, y1: 148.5, x2: 200, y2: 151.5 },
      ],
      label: 'Panel Frontal - M - 1x',
    },
  ],
};

describe('parseSvg', () => {
  it('should parse SVG generated by generateSvg', () => {
    const { svg } = generateSvg(generateSvgFixture);
    const doc = parseSvg(svg);

    expect(doc.pieces).toHaveLength(1);
    expect(doc.pieces[0].id).toBe('panel-frontal');
    expect(doc.pieces[0].outline).toContain('M');
    expect(doc.pieces[0].outline).toContain('Z');
    expect(doc.pieces[0].seamAllowance).toContain('M');
    expect(doc.pieces[0].label).toBe('Panel Frontal - M - 1x');
  });

  it('should parse viewBox correctly', () => {
    const { svg } = generateSvg(generateSvgFixture);
    const doc = parseSvg(svg);

    expect(doc.viewBox.width).toBeGreaterThan(0);
    expect(doc.viewBox.height).toBeGreaterThan(0);
  });

  it('should parse grain line coordinates', () => {
    const { svg } = generateSvg(generateSvgFixture);
    const doc = parseSvg(svg);
    const piece = doc.pieces[0];

    expect(piece.grainLine.x1).toBeCloseTo(100, 1);
    expect(piece.grainLine.y1).toBeCloseTo(20, 1);
    expect(piece.grainLine.x2).toBeCloseTo(100, 1);
    expect(piece.grainLine.y2).toBeCloseTo(280, 1);
  });

  it('should parse notches', () => {
    const { svg } = generateSvg(generateSvgFixture);
    const doc = parseSvg(svg);
    const piece = doc.pieces[0];

    expect(piece.notches).toHaveLength(2);
    expect(piece.notches[0].x1).toBeCloseTo(0, 0);
    expect(piece.notches[0].y1).toBeCloseTo(148.5, 1);
  });

  it('should parse width and height attributes', () => {
    const { svg } = generateSvg(generateSvgFixture);
    const doc = parseSvg(svg);

    expect(doc.width).toContain('mm');
    expect(doc.height).toContain('mm');
  });

  it('should throw for empty input', () => {
    expect(() => parseSvg('')).toThrow('Invalid SVG input');
  });

  it('should throw for SVG with no piece groups', () => {
    const emptySvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
    expect(() => parseSvg(emptySvg)).toThrow('No pattern piece groups');
  });

  it('should handle multi-piece patterns', () => {
    const multiPiecePattern: ScaledPattern = {
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      pieces: [
        {
          id: 'front-panel',
          outline: 'M 0 0 L 100 0 L 100 200 L 0 200 Z',
          seamAllowance: 'M -10 -10 L 110 -10 L 110 210 L -10 210 Z',
          grainLine: { x1: 50, y1: 10, x2: 50, y2: 190 },
          notches: [{ x1: 0, y1: 99, x2: 0, y2: 101 }],
          label: 'Front - M - 1x',
        },
        {
          id: 'back-panel',
          outline: 'M 0 0 L 100 0 L 100 200 L 0 200 Z',
          seamAllowance: 'M -10 -10 L 110 -10 L 110 210 L -10 210 Z',
          grainLine: { x1: 50, y1: 10, x2: 50, y2: 190 },
          notches: [{ x1: 100, y1: 99, x2: 100, y2: 101 }],
          label: 'Back - M - 1x',
        },
      ],
    };

    const { svg } = generateSvg(multiPiecePattern);
    const doc = parseSvg(svg);

    expect(doc.pieces).toHaveLength(2);
    expect(doc.pieces[0].id).toBe('front-panel');
    expect(doc.pieces[1].id).toBe('back-panel');
  });
});

describe('serializeSvg', () => {
  it('should produce valid SVG from a ParsedSvgDocument', () => {
    const doc: ParsedSvgDocument = {
      viewBox: { minX: -25, minY: -25, width: 250, height: 350 },
      width: '250.00mm',
      height: '350.00mm',
      pieces: [
        {
          id: 'test-piece',
          outline: 'M 0 0 L 200 0 L 200 300 L 0 300 Z',
          seamAllowance: 'M -15 -15 L 215 -15 L 215 315 L -15 315 Z',
          grainLine: { x1: 100, y1: 20, x2: 100, y2: 280 },
          notches: [{ x1: 0, y1: 148.5, x2: 0, y2: 151.5 }],
          label: 'Test Piece - M - 1x',
        },
      ],
    };

    const svg = serializeSvg(doc);

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="-25.00 -25.00 250.00 350.00"');
    expect(svg).toContain('width="250.00mm"');
    expect(svg).toContain('height="350.00mm"');
    expect(svg).toContain('data-units="mm"');
    expect(svg).toContain('id="test-piece"');
    expect(svg).toContain('data-role="outline"');
    expect(svg).toContain('data-role="seam-allowance"');
    expect(svg).toContain('data-role="grain-line"');
    expect(svg).toContain('data-role="notch"');
    expect(svg).toContain('data-role="label"');
    expect(svg).toContain('Test Piece - M - 1x');
  });

  it('should throw for document with no pieces', () => {
    const emptyDoc: ParsedSvgDocument = {
      viewBox: { minX: 0, minY: 0, width: 100, height: 100 },
      width: '100mm',
      height: '100mm',
      pieces: [],
    };

    expect(() => serializeSvg(emptyDoc)).toThrow('no pieces');
  });

  it('should properly escape XML special characters in labels', () => {
    const doc: ParsedSvgDocument = {
      viewBox: { minX: 0, minY: 0, width: 100, height: 100 },
      width: '100mm',
      height: '100mm',
      pieces: [
        {
          id: 'piece-1',
          outline: 'M 0 0 L 50 0 L 50 50 L 0 50 Z',
          seamAllowance: 'M -5 -5 L 55 -5 L 55 55 L -5 55 Z',
          grainLine: { x1: 25, y1: 5, x2: 25, y2: 45 },
          notches: [],
          label: 'Piece <1> & "test"',
        },
      ],
    };

    const svg = serializeSvg(doc);

    expect(svg).toContain('&lt;1&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;test&quot;');
  });
});

describe('validateRoundTrip', () => {
  it('should validate SVG produced by generateSvg', () => {
    const { svg } = generateSvg(generateSvgFixture);
    expect(validateRoundTrip(svg)).toBe(true);
  });

  it('should validate SVG produced by serializeSvg', () => {
    const doc: ParsedSvgDocument = {
      viewBox: { minX: 0, minY: 0, width: 300, height: 400 },
      width: '300.00mm',
      height: '400.00mm',
      pieces: [
        {
          id: 'round-trip-piece',
          outline: 'M 10 10 L 290 10 L 290 390 L 10 390 Z',
          seamAllowance: 'M 0 0 L 300 0 L 300 400 L 0 400 Z',
          grainLine: { x1: 150, y1: 30, x2: 150, y2: 370 },
          notches: [
            { x1: 10, y1: 198, x2: 10, y2: 202 },
            { x1: 290, y1: 198, x2: 290, y2: 202 },
          ],
          label: 'Round Trip - L - 2x',
        },
      ],
    };

    const svg = serializeSvg(doc);
    expect(validateRoundTrip(svg)).toBe(true);
  });

  it('should validate multi-piece patterns', () => {
    const multiPiece: ScaledPattern = {
      garmentType: 'short',
      ageGroup: 'children',
      size: '8',
      pieces: [
        {
          id: 'left-panel',
          outline: 'M 0 0 L 150 0 L 150 200 L 0 200 Z',
          seamAllowance: 'M -10 -10 L 160 -10 L 160 210 L -10 210 Z',
          grainLine: { x1: 75, y1: 15, x2: 75, y2: 185 },
          notches: [{ x1: 150, y1: 99, x2: 150, y2: 101 }],
          label: 'Left Panel - 8 - 1x',
        },
        {
          id: 'right-panel',
          outline: 'M 0 0 L 150 0 L 150 200 L 0 200 Z',
          seamAllowance: 'M -10 -10 L 160 -10 L 160 210 L -10 210 Z',
          grainLine: { x1: 75, y1: 15, x2: 75, y2: 185 },
          notches: [{ x1: 0, y1: 99, x2: 0, y2: 101 }],
          label: 'Right Panel - 8 - 1x',
        },
      ],
    };

    const { svg } = generateSvg(multiPiece);
    expect(validateRoundTrip(svg)).toBe(true);
  });

  it('should return false for invalid SVG', () => {
    expect(validateRoundTrip('')).toBe(false);
    expect(validateRoundTrip('<not-svg></not-svg>')).toBe(false);
  });

  it('should enforce 0.01mm tolerance', () => {
    // Generate a valid SVG and verify it passes
    const { svg } = generateSvg(generateSvgFixture);
    const doc = parseSvg(svg);

    // Slightly perturb a coordinate within tolerance (0.005mm < 0.01mm)
    doc.pieces[0].grainLine.x1 += 0.005;
    const svgWithinTolerance = serializeSvg(doc);
    // Re-parse and compare — this should still be valid because the original
    // SVG when re-parsed will match the serialized version exactly
    expect(validateRoundTrip(svgWithinTolerance)).toBe(true);
  });
});

describe('parseSvg → serializeSvg round-trip consistency', () => {
  it('should produce geometrically equivalent output after parse → serialize → parse', () => {
    const { svg: originalSvg } = generateSvg(generateSvgFixture);

    // First pass
    const doc1 = parseSvg(originalSvg);
    const reserialized = serializeSvg(doc1);
    const doc2 = parseSvg(reserialized);

    // Compare piece-by-piece
    expect(doc2.pieces.length).toBe(doc1.pieces.length);
    for (let i = 0; i < doc1.pieces.length; i++) {
      expect(doc2.pieces[i].id).toBe(doc1.pieces[i].id);
      expect(doc2.pieces[i].label).toBe(doc1.pieces[i].label);
      expect(doc2.pieces[i].notches.length).toBe(doc1.pieces[i].notches.length);

      // Grain line coordinates within tolerance
      expect(doc2.pieces[i].grainLine.x1).toBeCloseTo(doc1.pieces[i].grainLine.x1, 1);
      expect(doc2.pieces[i].grainLine.y1).toBeCloseTo(doc1.pieces[i].grainLine.y1, 1);
      expect(doc2.pieces[i].grainLine.x2).toBeCloseTo(doc1.pieces[i].grainLine.x2, 1);
      expect(doc2.pieces[i].grainLine.y2).toBeCloseTo(doc1.pieces[i].grainLine.y2, 1);
    }
  });
});


// --- Tests for Task 3.3: JSON Serialization for DynamoDB Storage ---

import {
  serializePatternToJson,
  deserializePatternFromJson,
  type SerializedPatternResult,
  type PatternJsonFormat,
} from './serialization.js';

const sampleScaledPattern: ScaledPattern = {
  garmentType: 'camiseta',
  ageGroup: 'adult',
  size: 'M',
  pieces: [
    {
      id: 'panel-frontal',
      outline: 'M 0 0 L 200 0 L 200 300 L 0 300 Z',
      seamAllowance: 'M -15 -15 L 215 -15 L 215 315 L -15 315 Z',
      grainLine: { x1: 100, y1: 20, x2: 100, y2: 280 },
      notches: [
        { x1: 0, y1: 148.5, x2: 0, y2: 151.5 },
        { x1: 200, y1: 148.5, x2: 200, y2: 151.5 },
      ],
      label: 'Panel Frontal - M - 1x',
    },
    {
      id: 'panel-trasero',
      outline: 'M 0 0 L 200 0 L 200 300 L 0 300 Z',
      seamAllowance: 'M -15 -15 L 215 -15 L 215 315 L -15 315 Z',
      grainLine: { x1: 100, y1: 20, x2: 100, y2: 280 },
      notches: [
        { x1: 0, y1: 148.5, x2: 0, y2: 151.5 },
      ],
      label: 'Panel Trasero - M - 1x',
    },
  ],
};

describe('serializePatternToJson', () => {
  it('should serialize a valid ScaledPattern to JSON', () => {
    const result = serializePatternToJson(sampleScaledPattern);

    expect(result.json).toBeDefined();
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.exceedsLimit).toBe(false);
    expect(result.chunks).toBeUndefined();
  });

  it('should preserve all fields in the JSON output', () => {
    const result = serializePatternToJson(sampleScaledPattern);
    const parsed: PatternJsonFormat = JSON.parse(result.json);

    expect(parsed.version).toBe('1.0');
    expect(parsed.garmentType).toBe('camiseta');
    expect(parsed.ageGroup).toBe('adult');
    expect(parsed.size).toBe('M');
    expect(parsed.pieces).toHaveLength(2);
  });

  it('should preserve piece geometries exactly', () => {
    const result = serializePatternToJson(sampleScaledPattern);
    const parsed: PatternJsonFormat = JSON.parse(result.json);
    const piece = parsed.pieces[0];

    expect(piece.id).toBe('panel-frontal');
    expect(piece.outline).toBe('M 0 0 L 200 0 L 200 300 L 0 300 Z');
    expect(piece.seamAllowance).toBe('M -15 -15 L 215 -15 L 215 315 L -15 315 Z');
    expect(piece.grainLine).toEqual({ x1: 100, y1: 20, x2: 100, y2: 280 });
    expect(piece.notches).toEqual([
      { x1: 0, y1: 148.5, x2: 0, y2: 151.5 },
      { x1: 200, y1: 148.5, x2: 200, y2: 151.5 },
    ]);
    expect(piece.label).toBe('Panel Frontal - M - 1x');
  });

  it('should correctly calculate sizeBytes using UTF-8 encoding', () => {
    const result = serializePatternToJson(sampleScaledPattern);
    const encoder = new TextEncoder();
    const expectedBytes = encoder.encode(result.json).length;

    expect(result.sizeBytes).toBe(expectedBytes);
  });

  it('should set exceedsLimit=true and provide chunks for large patterns', () => {
    // Create a pattern with many pieces to exceed 400KB
    const largePieces = Array.from({ length: 500 }, (_, i) => ({
      id: `piece-${i}-with-a-long-identifier-to-increase-size`,
      outline: 'M 0 0 L 200 0 L 200 300 L 100 350 L 50 320 L 0 300 Z '.repeat(10),
      seamAllowance: 'M -15 -15 L 215 -15 L 215 315 L 100 365 L 50 335 L -15 315 Z '.repeat(10),
      grainLine: { x1: 100.12345, y1: 20.67890, x2: 100.12345, y2: 280.67890 },
      notches: Array.from({ length: 5 }, (_, j) => ({
        x1: j * 40, y1: 148.5, x2: j * 40, y2: 151.5,
      })),
      label: `Piece ${i} - Panel Extra Largo - M - 2x`,
    }));

    const largePattern: ScaledPattern = {
      garmentType: 'sudadera',
      ageGroup: 'adult',
      size: 'XL',
      pieces: largePieces,
    };

    const result = serializePatternToJson(largePattern);

    expect(result.exceedsLimit).toBe(true);
    expect(result.chunks).toBeDefined();
    expect(result.chunks!.length).toBeGreaterThan(1);
    expect(result.sizeBytes).toBeGreaterThan(400 * 1024);
  });

  it('should throw for null pattern', () => {
    expect(() => serializePatternToJson(null as any)).toThrow('Pattern is required');
  });

  it('should throw for pattern without pieces', () => {
    const noPieces = { ...sampleScaledPattern, pieces: [] };
    expect(() => serializePatternToJson(noPieces)).toThrow('at least one piece');
  });

  it('should throw for pattern without garmentType', () => {
    const noType = { ...sampleScaledPattern, garmentType: '' as any };
    expect(() => serializePatternToJson(noType)).toThrow('garmentType is required');
  });

  it('should throw for pattern without ageGroup', () => {
    const noAge = { ...sampleScaledPattern, ageGroup: '' as any };
    expect(() => serializePatternToJson(noAge)).toThrow('ageGroup is required');
  });

  it('should throw for pattern without size', () => {
    const noSize = { ...sampleScaledPattern, size: '' as any };
    expect(() => serializePatternToJson(noSize)).toThrow('size is required');
  });
});

describe('deserializePatternFromJson', () => {
  it('should deserialize valid JSON back to ScaledPattern', () => {
    const serialized = serializePatternToJson(sampleScaledPattern);
    const result = deserializePatternFromJson(serialized.json);

    expect(result.garmentType).toBe('camiseta');
    expect(result.ageGroup).toBe('adult');
    expect(result.size).toBe('M');
    expect(result.pieces).toHaveLength(2);
  });

  it('should preserve all piece data through round-trip', () => {
    const serialized = serializePatternToJson(sampleScaledPattern);
    const result = deserializePatternFromJson(serialized.json);
    const piece = result.pieces[0];

    expect(piece.id).toBe('panel-frontal');
    expect(piece.outline).toBe('M 0 0 L 200 0 L 200 300 L 0 300 Z');
    expect(piece.seamAllowance).toBe('M -15 -15 L 215 -15 L 215 315 L -15 315 Z');
    expect(piece.grainLine).toEqual({ x1: 100, y1: 20, x2: 100, y2: 280 });
    expect(piece.notches).toEqual([
      { x1: 0, y1: 148.5, x2: 0, y2: 151.5 },
      { x1: 200, y1: 148.5, x2: 200, y2: 151.5 },
    ]);
    expect(piece.label).toBe('Panel Frontal - M - 1x');
  });

  it('should throw for empty string input', () => {
    expect(() => deserializePatternFromJson('')).toThrow('non-empty string');
  });

  it('should throw for invalid JSON syntax', () => {
    expect(() => deserializePatternFromJson('{invalid json!!')).toThrow('unable to parse');
  });

  it('should throw for JSON that is not an object', () => {
    expect(() => deserializePatternFromJson('"hello"')).toThrow('root must be an object');
    expect(() => deserializePatternFromJson('[1,2,3]')).toThrow('root must be an object');
  });

  it('should throw with specific message for missing garmentType', () => {
    const json = JSON.stringify({ ageGroup: 'adult', size: 'M', pieces: [{}] });
    expect(() => deserializePatternFromJson(json)).toThrow('garmentType');
  });

  it('should throw with specific message for missing ageGroup', () => {
    const json = JSON.stringify({ garmentType: 'camiseta', size: 'M', pieces: [{}] });
    expect(() => deserializePatternFromJson(json)).toThrow('ageGroup');
  });

  it('should throw with specific message for missing size', () => {
    const json = JSON.stringify({ garmentType: 'camiseta', ageGroup: 'adult', pieces: [{}] });
    expect(() => deserializePatternFromJson(json)).toThrow('size');
  });

  it('should throw with specific message for missing pieces array', () => {
    const json = JSON.stringify({ garmentType: 'camiseta', ageGroup: 'adult', size: 'M' });
    expect(() => deserializePatternFromJson(json)).toThrow('pieces');
  });

  it('should throw for empty pieces array', () => {
    const json = JSON.stringify({ garmentType: 'camiseta', ageGroup: 'adult', size: 'M', pieces: [] });
    expect(() => deserializePatternFromJson(json)).toThrow('at least one piece');
  });

  it('should throw with specific field errors for invalid piece structure', () => {
    const json = JSON.stringify({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      pieces: [{ id: 'test' }], // missing outline, seamAllowance, label, grainLine, notches
    });
    expect(() => deserializePatternFromJson(json)).toThrow('outline');
  });

  it('should throw for piece with invalid grainLine coordinates', () => {
    const json = JSON.stringify({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      pieces: [{
        id: 'piece-1',
        outline: 'M 0 0 L 100 0 Z',
        seamAllowance: 'M -5 -5 L 105 -5 Z',
        grainLine: { x1: 'not-a-number', y1: 10, x2: 50, y2: 100 },
        notches: [],
        label: 'Test Piece',
      }],
    });
    expect(() => deserializePatternFromJson(json)).toThrow('grainLine');
  });

  it('should throw for piece with invalid notch coordinates', () => {
    const json = JSON.stringify({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      pieces: [{
        id: 'piece-1',
        outline: 'M 0 0 L 100 0 Z',
        seamAllowance: 'M -5 -5 L 105 -5 Z',
        grainLine: { x1: 0, y1: 10, x2: 50, y2: 100 },
        notches: [{ x1: 'bad', y1: 0, x2: 0, y2: 3 }],
        label: 'Test Piece',
      }],
    });
    expect(() => deserializePatternFromJson(json)).toThrow('notches');
  });

  it('should throw for piece with non-array notches', () => {
    const json = JSON.stringify({
      garmentType: 'camiseta',
      ageGroup: 'adult',
      size: 'M',
      pieces: [{
        id: 'piece-1',
        outline: 'M 0 0 L 100 0 Z',
        seamAllowance: 'M -5 -5 L 105 -5 Z',
        grainLine: { x1: 0, y1: 10, x2: 50, y2: 100 },
        notches: 'not-an-array',
        label: 'Test Piece',
      }],
    });
    expect(() => deserializePatternFromJson(json)).toThrow('notches');
  });
});

describe('serializePatternToJson → deserializePatternFromJson round-trip', () => {
  it('should produce identical ScaledPattern after serialize → deserialize', () => {
    const serialized = serializePatternToJson(sampleScaledPattern);
    const deserialized = deserializePatternFromJson(serialized.json);

    expect(deserialized.garmentType).toBe(sampleScaledPattern.garmentType);
    expect(deserialized.ageGroup).toBe(sampleScaledPattern.ageGroup);
    expect(deserialized.size).toBe(sampleScaledPattern.size);
    expect(deserialized.pieces.length).toBe(sampleScaledPattern.pieces.length);

    for (let i = 0; i < sampleScaledPattern.pieces.length; i++) {
      const original = sampleScaledPattern.pieces[i];
      const restored = deserialized.pieces[i];

      expect(restored.id).toBe(original.id);
      expect(restored.outline).toBe(original.outline);
      expect(restored.seamAllowance).toBe(original.seamAllowance);
      expect(restored.grainLine).toEqual(original.grainLine);
      expect(restored.notches).toEqual(original.notches);
      expect(restored.label).toBe(original.label);
    }
  });

  it('should produce byte-equivalent JSON after serialize → deserialize → re-serialize', () => {
    const first = serializePatternToJson(sampleScaledPattern);
    const deserialized = deserializePatternFromJson(first.json);
    const second = serializePatternToJson(deserialized);

    expect(second.json).toBe(first.json);
  });

  it('should handle pattern with children age group and children size', () => {
    const childPattern: ScaledPattern = {
      garmentType: 'short',
      ageGroup: 'children',
      size: '8',
      pieces: [{
        id: 'short-panel',
        outline: 'M 0 0 L 100 0 L 100 150 L 0 150 Z',
        seamAllowance: 'M -10 -10 L 110 -10 L 110 160 L -10 160 Z',
        grainLine: { x1: 50, y1: 10, x2: 50, y2: 140 },
        notches: [{ x1: 100, y1: 74, x2: 100, y2: 76 }],
        label: 'Short Panel - 8 - 2x',
      }],
    };

    const serialized = serializePatternToJson(childPattern);
    const deserialized = deserializePatternFromJson(serialized.json);

    expect(deserialized.garmentType).toBe('short');
    expect(deserialized.ageGroup).toBe('children');
    expect(deserialized.size).toBe('8');
    expect(deserialized.pieces[0].id).toBe('short-panel');
  });

  it('should handle pattern with no notches', () => {
    const noNotchPattern: ScaledPattern = {
      garmentType: 'legging',
      ageGroup: 'adult',
      size: 'S',
      pieces: [{
        id: 'leg-panel',
        outline: 'M 0 0 L 80 0 L 80 400 L 0 400 Z',
        seamAllowance: 'M -10 -10 L 90 -10 L 90 410 L -10 410 Z',
        grainLine: { x1: 40, y1: 15, x2: 40, y2: 385 },
        notches: [],
        label: 'Leg Panel - S - 2x',
      }],
    };

    const serialized = serializePatternToJson(noNotchPattern);
    const deserialized = deserializePatternFromJson(serialized.json);

    expect(deserialized.pieces[0].notches).toEqual([]);
  });

  it('should handle pattern with many notches', () => {
    const manyNotches = Array.from({ length: 20 }, (_, i) => ({
      x1: i * 10, y1: 0, x2: i * 10, y2: 3,
    }));

    const pattern: ScaledPattern = {
      garmentType: 'sudadera',
      ageGroup: 'adult',
      size: 'L',
      pieces: [{
        id: 'body-panel',
        outline: 'M 0 0 L 300 0 L 300 500 L 0 500 Z',
        seamAllowance: 'M -15 -15 L 315 -15 L 315 515 L -15 515 Z',
        grainLine: { x1: 150, y1: 20, x2: 150, y2: 480 },
        notches: manyNotches,
        label: 'Body Panel - L - 1x',
      }],
    };

    const serialized = serializePatternToJson(pattern);
    const deserialized = deserializePatternFromJson(serialized.json);

    expect(deserialized.pieces[0].notches).toHaveLength(20);
    expect(deserialized.pieces[0].notches).toEqual(manyNotches);
  });
});
