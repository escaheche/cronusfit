/**
 * Unit tests for SVG generation from ScaledPattern.
 *
 * Validates: Requirements 1.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */

import { describe, it, expect } from 'vitest';
import { generateSvg } from './serialization.js';
import type { ScaledPattern, ScaledPiece } from '../../types/pattern.js';

// --- Test Fixtures ---

function createTestPiece(id: string, overrides?: Partial<ScaledPiece>): ScaledPiece {
  return {
    id: id,
    outline: 'M 0 0 L 200 0 L 200 300 L 0 300 Z',
    seamAllowance: 'M -15 -15 L 215 -15 L 215 315 L -15 315 Z',
    grainLine: { x1: 100, y1: 20, x2: 100, y2: 280 },
    notches: [
      { x1: -1.5, y1: 150, x2: 1.5, y2: 150 },
      { x1: 198.5, y1: 100, x2: 201.5, y2: 100 },
    ],
    label: 'Panel Frontal, M, Cortar 2x',
    ...overrides,
  };
}

function createTestPattern(overrides?: Partial<ScaledPattern>): ScaledPattern {
  return {
    garmentType: 'camiseta',
    ageGroup: 'adult',
    size: 'M',
    pieces: [
      createTestPiece('panel-frontal'),
      createTestPiece('panel-trasero', {
        id: 'panel-trasero',
        outline: 'M 250 0 L 450 0 L 450 300 L 250 300 Z',
        seamAllowance: 'M 235 -15 L 465 -15 L 465 315 L 235 315 Z',
        grainLine: { x1: 350, y1: 20, x2: 350, y2: 280 },
        notches: [{ x1: 248.5, y1: 150, x2: 251.5, y2: 150 }],
        label: 'Panel Trasero, M, Cortar 2x',
      }),
    ],
    ...overrides,
  };
}

describe('generateSvg', () => {
  it('should return valid SVG with correct piece count', () => {
    const pattern = createTestPattern();
    const result = generateSvg(pattern);

    expect(result.isValid).toBe(true);
    expect(result.pieceCount).toBe(2);
    expect(result.svg).toBeTruthy();
  });

  it('should return invalid result for empty pieces array', () => {
    const pattern = createTestPattern({ pieces: [] });
    const result = generateSvg(pattern);

    expect(result.isValid).toBe(false);
    expect(result.pieceCount).toBe(0);
    expect(result.svg).toBe('');
  });

  it('should return invalid result for null pattern', () => {
    const result = generateSvg(null as unknown as ScaledPattern);

    expect(result.isValid).toBe(false);
    expect(result.pieceCount).toBe(0);
  });

  describe('SVG structure (Req 6.1-6.8)', () => {
    it('should contain xmlns attribute (SVG 1.1)', () => {
      const result = generateSvg(createTestPattern());
      expect(result.svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('should have viewBox attribute in mm for 1:1 scale (Req 6.7)', () => {
      const result = generateSvg(createTestPattern());
      expect(result.svg).toMatch(/viewBox="[^"]+"/);
      // Should have width/height in mm
      expect(result.svg).toMatch(/width="[\d.]+mm"/);
      expect(result.svg).toMatch(/height="[\d.]+mm"/);
    });

    it('should render each piece as <g> with unique id (Req 6.1)', () => {
      const result = generateSvg(createTestPattern());
      expect(result.svg).toContain('id="panel-frontal"');
      expect(result.svg).toContain('id="panel-trasero"');
    });

    it('should render cut outline as <path> with continuous stroke (Req 6.2)', () => {
      const result = generateSvg(createTestPattern());
      // Should have a path with the outline data and no dasharray
      expect(result.svg).toContain('M 0 0 L 200 0 L 200 300 L 0 300 Z');
      expect(result.svg).toContain('data-role="outline"');
    });

    it('should render seam allowance as <path> with dashed stroke (Req 6.3)', () => {
      const result = generateSvg(createTestPattern());
      expect(result.svg).toContain('M -15 -15 L 215 -15 L 215 315 L -15 315 Z');
      expect(result.svg).toContain('data-role="seam-allowance"');
      expect(result.svg).toContain('stroke-dasharray');
    });

    it('should include grain line as <line> element (Req 6.4)', () => {
      const result = generateSvg(createTestPattern());
      expect(result.svg).toContain('data-role="grain-line"');
      // Should have line coordinates from the first piece's grain line
      expect(result.svg).toMatch(/<line[^>]*data-role="grain-line"/);
    });

    it('should include notches as <line> elements (Req 6.5)', () => {
      const pattern = createTestPattern();
      const result = generateSvg(pattern);
      expect(result.svg).toContain('data-role="notch"');
      // First piece has 2 notches, second has 1 = 3 total
      const notchMatches = result.svg.match(/data-role="notch"/g);
      expect(notchMatches?.length).toBe(3);
    });

    it('should include label as <text> element (Req 6.6)', () => {
      const result = generateSvg(createTestPattern());
      expect(result.svg).toContain('data-role="label"');
      expect(result.svg).toContain('Panel Frontal, M, Cortar 2x');
      expect(result.svg).toContain('Panel Trasero, M, Cortar 2x');
    });

    it('should use mm as coordinate units (Req 6.7)', () => {
      const result = generateSvg(createTestPattern());
      expect(result.svg).toContain('data-units="mm"');
    });
  });

  describe('single piece pattern', () => {
    it('should handle a pattern with one piece', () => {
      const pattern = createTestPattern({
        pieces: [createTestPiece('manga-izquierda')],
      });
      const result = generateSvg(pattern);

      expect(result.isValid).toBe(true);
      expect(result.pieceCount).toBe(1);
      expect(result.svg).toContain('id="manga-izquierda"');
    });
  });

  describe('piece with no notches', () => {
    it('should handle a piece with empty notches array', () => {
      const pattern = createTestPattern({
        pieces: [createTestPiece('cinturilla', { notches: [] })],
      });
      const result = generateSvg(pattern);

      expect(result.isValid).toBe(true);
      expect(result.pieceCount).toBe(1);
      // No notch elements
      expect(result.svg).not.toContain('data-role="notch"');
    });
  });
});
