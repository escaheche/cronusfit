/**
 * Unit tests for SVG generation from ScaledPattern.
 *
 * Validates: Requirements 6.1–6.8, 4.2
 */

import { describe, it, expect } from 'vitest';
import { generateSvg } from '../../src/modules/pattern/serialization.js';
import type { ScaledPattern, ScaledPiece, LineData } from '../../src/types/pattern.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Create a simple rectangular piece for testing.
 * Outline is a 100x200mm rectangle starting at (offsetX, offsetY).
 */
function createTestPiece(id: string, offsetX = 0, offsetY = 0): ScaledPiece {
  const x = offsetX;
  const y = offsetY;
  const w = 100;
  const h = 200;

  const outline = `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  // Seam allowance 15mm outside the outline
  const sa = 15;
  const seamAllowance = `M ${x - sa} ${y - sa} L ${x + w + sa} ${y - sa} L ${x + w + sa} ${y + h + sa} L ${x - sa} ${y + h + sa} Z`;

  const grainLine: LineData = {
    x1: x + w / 2,
    y1: y + 20,
    x2: x + w / 2,
    y2: y + h - 20,
  };

  const notches: LineData[] = [
    { x1: x + w / 2 - 1.5, y1: y, x2: x + w / 2 + 1.5, y2: y },
    { x1: x + w - 1.5, y1: y + h / 2, x2: x + w + 1.5, y2: y + h / 2 },
  ];

  return {
    id,
    outline,
    seamAllowance,
    grainLine,
    notches,
    label: `${id} - M - Cut 2x`,
  };
}

/**
 * Build a valid ScaledPattern with the given number of pieces.
 */
function createTestPattern(pieceCount = 2): ScaledPattern {
  const pieces: ScaledPiece[] = [];
  for (let i = 0; i < pieceCount; i++) {
    pieces.push(createTestPiece(`piece-${i + 1}`, i * 150, 0));
  }

  return {
    garmentType: 'camiseta',
    ageGroup: 'adult',
    size: 'M',
    pieces,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SVG Generation - generateSvg', () => {
  describe('SVG structure validation', () => {
    it('should contain valid SVG root element with xmlns', () => {
      const pattern = createTestPattern(1);
      const result = generateSvg(pattern);

      expect(result.svg).toContain('<svg');
      expect(result.svg).toContain('xmlns');
      expect(result.svg).toContain('viewBox');
    });

    it('should have isValid=true for valid input', () => {
      const pattern = createTestPattern(1);
      const result = generateSvg(pattern);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Piece count', () => {
    it('should match input piece count for single piece', () => {
      const pattern = createTestPattern(1);
      const result = generateSvg(pattern);

      expect(result.pieceCount).toBe(1);
    });

    it('should match input piece count for multiple pieces', () => {
      const pattern = createTestPattern(4);
      const result = generateSvg(pattern);

      expect(result.pieceCount).toBe(4);
    });

    it('pieceCount in result matches input pieces.length', () => {
      const pattern = createTestPattern(3);
      const result = generateSvg(pattern);

      expect(result.pieceCount).toBe(pattern.pieces.length);
    });
  });

  describe('Piece groups with unique IDs', () => {
    it('should render each piece as a <g> with unique id attribute', () => {
      const pattern = createTestPattern(3);
      const result = generateSvg(pattern);

      for (const piece of pattern.pieces) {
        const idAttr = `id="${piece.id}"`;
        expect(result.svg).toContain(idAttr);
      }

      // Ensure all IDs are unique (each appears exactly once as id="...")
      const idMatches = result.svg.match(/id="piece-\d+"/g) ?? [];
      const uniqueIds = new Set(idMatches);
      expect(uniqueIds.size).toBe(pattern.pieces.length);
    });
  });

  describe('Required elements per piece', () => {
    it('should contain <path> with data-role="outline" for each piece', () => {
      const pattern = createTestPattern(2);
      const result = generateSvg(pattern);

      const outlineMatches = result.svg.match(/data-role="outline"/g) ?? [];
      expect(outlineMatches.length).toBe(2);
    });

    it('should contain <path> with data-role="seam-allowance" for each piece', () => {
      const pattern = createTestPattern(2);
      const result = generateSvg(pattern);

      const seamMatches = result.svg.match(/data-role="seam-allowance"/g) ?? [];
      expect(seamMatches.length).toBe(2);
    });

    it('should contain <line> with data-role="grain-line" for each piece', () => {
      const pattern = createTestPattern(2);
      const result = generateSvg(pattern);

      const grainMatches = result.svg.match(/data-role="grain-line"/g) ?? [];
      expect(grainMatches.length).toBe(2);
    });

    it('should contain <line> elements with data-role="notch" for each piece', () => {
      const pattern = createTestPattern(1);
      const result = generateSvg(pattern);

      // Each test piece has 2 notches
      const notchMatches = result.svg.match(/data-role="notch"/g) ?? [];
      expect(notchMatches.length).toBe(2);
    });

    it('should contain <text> with data-role="label" for each piece', () => {
      const pattern = createTestPattern(2);
      const result = generateSvg(pattern);

      const labelMatches = result.svg.match(/data-role="label"/g) ?? [];
      expect(labelMatches.length).toBe(2);
    });
  });

  describe('ViewBox and mm units', () => {
    it('should have width attribute ending with "mm"', () => {
      const pattern = createTestPattern(1);
      const result = generateSvg(pattern);

      const widthMatch = result.svg.match(/width="([^"]*)"/);
      expect(widthMatch).not.toBeNull();
      expect(widthMatch![1]).toMatch(/mm$/);
    });

    it('should have height attribute ending with "mm"', () => {
      const pattern = createTestPattern(1);
      const result = generateSvg(pattern);

      const heightMatch = result.svg.match(/height="([^"]*)"/);
      expect(heightMatch).not.toBeNull();
      expect(heightMatch![1]).toMatch(/mm$/);
    });

    it('should have data-units="mm" on root SVG element', () => {
      const pattern = createTestPattern(1);
      const result = generateSvg(pattern);

      expect(result.svg).toContain('data-units="mm"');
    });
  });

  describe('Invalid and edge-case inputs', () => {
    it('should return isValid=false for null pattern', () => {
      const result = generateSvg(null as unknown as ScaledPattern);

      expect(result.isValid).toBe(false);
      expect(result.pieceCount).toBe(0);
      expect(result.svg).toBe('');
    });

    it('should return isValid=false for pattern with empty pieces array', () => {
      const pattern: ScaledPattern = {
        garmentType: 'camiseta',
        ageGroup: 'adult',
        size: 'M',
        pieces: [],
      };
      const result = generateSvg(pattern);

      expect(result.isValid).toBe(false);
      expect(result.pieceCount).toBe(0);
      expect(result.svg).toBe('');
    });

    it('should return isValid=false for undefined pattern', () => {
      const result = generateSvg(undefined as unknown as ScaledPattern);

      expect(result.isValid).toBe(false);
      expect(result.pieceCount).toBe(0);
    });
  });
});
