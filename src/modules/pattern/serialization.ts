/**
 * SVG Pattern Serialization and Deserialization Module.
 *
 * Provides:
 * 1. SVG generation from ScaledPattern using SVG.js + svgdom (server-side)
 * 2. Reliable conversion between SVG pattern files and JSON representation
 *    for storage in DynamoDB (≤ 400KB item limit)
 * 3. Round-trip idempotence within 0.01mm geometry tolerance
 *
 * Validates: Requirements 1.9, 3.1, 3.2, 3.3, 3.4, 3.5, 6.1–6.8
 */

import { createSVGWindow } from 'svgdom';
import { SVG, registerWindow } from '@svgdotjs/svg.js';
import type { AgeGroup, GarmentType } from '../../types/garment.js';
import type { LineData, ScaledPattern, ScaledPiece, SvgGenerationResult } from '../../types/pattern.js';
import {
  type StructuredValidationResult,
  type ValidationError,
  structuredValid,
  structuredInvalid,
  buildCustomError,
} from '../../validation/common.js';

// --- Public Interfaces ---

/** Result of JSON serialization for DynamoDB storage. */
export interface SerializedPatternResult {
  /** The serialized JSON string. */
  json: string;
  /** Size of the JSON in bytes. */
  sizeBytes: number;
  /** True if the JSON exceeds the 400KB DynamoDB item limit. */
  exceedsLimit: boolean;
  /** If exceeded, split into chunks (each < 400KB) for S3 storage. */
  chunks?: string[];
}

/** JSON serialization format for DynamoDB pattern storage. */
export interface PatternJsonFormat {
  version: '1.0';
  garmentType: string;
  ageGroup: string;
  size: string;
  pieces: PatternJsonPiece[];
}

/** A single piece in the JSON serialization format. */
export interface PatternJsonPiece {
  id: string;
  outline: string;
  seamAllowance: string;
  grainLine: { x1: number; y1: number; x2: number; y2: number };
  notches: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  label: string;
}

/** Serialized representation of a complete SVG pattern. */
export interface SerializedPattern {
  version: '1.0';
  templateId: string;
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  size: string;
  seamAllowanceCm: number;
  viewBox: { width: number; height: number };
  pieces: SerializedPiece[];
  measurements: Record<string, number>;
  createdAt: string;
}

/** Serialized representation of a single pattern piece. */
export interface SerializedPiece {
  id: string;
  name: string;
  cutQuantity: number;
  pathData: string;
  seamAllowancePathData: string;
  grainLine: { x1: number; y1: number; x2: number; y2: number; angle: number };
  notches: Array<{ x: number; y: number; edgeId: string; matchingEdgeId: string }>;
  bounds: { x: number; y: number; width: number; height: number };
  offset: { x: number; y: number };
}

/** Metadata required for serialization (provided alongside the SVG). */
export interface SerializationMetadata {
  templateId: string;
  garmentType: GarmentType;
  ageGroup: AgeGroup;
  size: string;
  seamAllowanceCm: number;
  measurements: Record<string, number>;
  createdAt?: string;
}

// --- Constants ---

/** Maximum serialized JSON size (DynamoDB 400KB item limit). */
const MAX_SERIALIZED_SIZE_BYTES = 400 * 1024;

/** Geometry tolerance in mm for round-trip comparison. */
const GEOMETRY_TOLERANCE_MM = 0.01;

/** Valid garment types. */
const VALID_GARMENT_TYPES: GarmentType[] = [
  'camiseta', 'short', 'legging', 'sudadera', 'tank_top', 'custom',
];

/** Valid age groups. */
const VALID_AGE_GROUPS: AgeGroup[] = ['children', 'adult'];

// --- SVG Generation (Task 3.1) ---

/**
 * Padding (in mm) around the bounding box of all pieces when computing the viewBox.
 */
const VIEWBOX_PADDING_MM = 10;

/**
 * Generate an SVG document from a ScaledPattern using SVG.js + svgdom.
 *
 * Produces a valid SVG 1.1 document with:
 * - Each piece as a `<g>` group with unique `id`
 * - Cut outline as `<path>` with continuous stroke
 * - Seam allowance as `<path>` with dashed stroke
 * - Grain line as `<line>` element with arrow marker
 * - Notches as `<line>` elements (3mm perpendicular to outline)
 * - Labels as `<text>` with piece name, size, and cut quantity
 * - ViewBox in mm for 1:1 scale output
 *
 * @param pattern - The scaled pattern with all pieces resolved
 * @returns SvgGenerationResult with the SVG string, validity, and piece count
 *
 * Validates: Requirements 1.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
 */
export function generateSvg(pattern: ScaledPattern): SvgGenerationResult {
  if (!pattern || !pattern.pieces || pattern.pieces.length === 0) {
    return { svg: '', isValid: false, pieceCount: 0 };
  }

  // Set up svgdom virtual window for server-side SVG generation
  const window = createSVGWindow();
  const document = window.document;
  registerWindow(window, document);

  // Create root SVG canvas
  const canvas = SVG(document.documentElement) as any;

  // Calculate bounding box of all pieces for viewBox
  const bbox = calculatePatternBoundingBox(pattern.pieces);
  const viewBoxWidth = bbox.maxX - bbox.minX + VIEWBOX_PADDING_MM * 2;
  const viewBoxHeight = bbox.maxY - bbox.minY + VIEWBOX_PADDING_MM * 2;
  const viewBoxMinX = bbox.minX - VIEWBOX_PADDING_MM;
  const viewBoxMinY = bbox.minY - VIEWBOX_PADDING_MM;

  // Configure SVG root attributes (xmlns is set automatically by svgdom)
  canvas.viewbox(viewBoxMinX, viewBoxMinY, viewBoxWidth, viewBoxHeight);
  canvas.width(`${viewBoxWidth.toFixed(2)}mm`);
  canvas.height(`${viewBoxHeight.toFixed(2)}mm`);
  canvas.attr('data-units', 'mm');

  // Render each piece as a <g> group
  for (const piece of pattern.pieces) {
    const group = canvas.group().attr('id', piece.id);

    // Cut outline - continuous stroke (Req 6.2)
    group.path(piece.outline)
      .fill('none')
      .stroke({ color: '#000000', width: 0.5 })
      .attr('data-role', 'outline');

    // Seam allowance - dashed stroke (Req 6.3)
    group.path(piece.seamAllowance)
      .fill('none')
      .stroke({ color: '#888888', width: 0.3, dasharray: '5,3' })
      .attr('data-role', 'seam-allowance');

    // Grain line (Req 6.4)
    group.line(
      piece.grainLine.x1,
      piece.grainLine.y1,
      piece.grainLine.x2,
      piece.grainLine.y2,
    )
      .stroke({ color: '#333333', width: 0.4, dasharray: '8,3' })
      .attr('data-role', 'grain-line');

    // Notches - 3mm perpendicular marks (Req 6.5)
    for (const notch of piece.notches) {
      group.line(notch.x1, notch.y1, notch.x2, notch.y2)
        .stroke({ color: '#000000', width: 0.4 })
        .attr('data-role', 'notch');
    }

    // Label - piece name, size, cut quantity (Req 6.6)
    const labelBbox = estimateLabelPosition(piece);
    group.text(piece.label)
      .move(labelBbox.x, labelBbox.y)
      .font({ family: 'Arial, sans-serif', size: 8 })
      .fill('#000000')
      .attr('data-role', 'label');
  }

  // Export the SVG string
  const svgString = canvas.svg();

  return {
    svg: svgString,
    isValid: true,
    pieceCount: pattern.pieces.length,
  };
}

/**
 * Calculate the overall bounding box of all pieces by parsing their outlines.
 */
function calculatePatternBoundingBox(pieces: ScaledPiece[]): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const piece of pieces) {
    // Parse coordinates from the outline AND seam allowance paths
    const pathsToConsider = [piece.outline, piece.seamAllowance];
    for (const pathData of pathsToConsider) {
      const coords = extractCoordsFromPath(pathData);
      for (const [x, y] of coords) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    // Also consider grain line and notch endpoints
    const points = [
      [piece.grainLine.x1, piece.grainLine.y1],
      [piece.grainLine.x2, piece.grainLine.y2],
      ...piece.notches.map(n => [n.x1, n.y1]),
      ...piece.notches.map(n => [n.x2, n.y2]),
    ];
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  // Fallback if no valid coordinates found
  if (!isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Extract coordinate pairs from an SVG path `d` attribute string.
 * Handles M, L, C, Q, S, H, V commands.
 */
function extractCoordsFromPath(pathData: string): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  if (!pathData) return coords;

  // Match all numeric values following path commands
  const numRegex = /[MLCQSTHVAZ]\s*([\d.eE+-]+(?:[\s,]+[\d.eE+-]+)*)/gi;
  let currentX = 0;
  let currentY = 0;
  let match: RegExpExecArray | null;

  while ((match = numRegex.exec(pathData)) !== null) {
    const cmd = match[0][0].toUpperCase();
    const values = match[1].trim().split(/[\s,]+/).map(parseFloat);

    switch (cmd) {
      case 'M':
      case 'L':
        for (let i = 0; i < values.length - 1; i += 2) {
          currentX = values[i];
          currentY = values[i + 1];
          if (isFinite(currentX) && isFinite(currentY)) {
            coords.push([currentX, currentY]);
          }
        }
        break;
      case 'H':
        for (const v of values) {
          currentX = v;
          if (isFinite(currentX) && isFinite(currentY)) {
            coords.push([currentX, currentY]);
          }
        }
        break;
      case 'V':
        for (const v of values) {
          currentY = v;
          if (isFinite(currentX) && isFinite(currentY)) {
            coords.push([currentX, currentY]);
          }
        }
        break;
      case 'C':
        // Cubic bezier: x1,y1 x2,y2 x,y
        for (let i = 0; i < values.length - 1; i += 2) {
          if (isFinite(values[i]) && isFinite(values[i + 1])) {
            coords.push([values[i], values[i + 1]]);
          }
        }
        if (values.length >= 6) {
          currentX = values[values.length - 2];
          currentY = values[values.length - 1];
        }
        break;
      case 'Q':
      case 'S':
        for (let i = 0; i < values.length - 1; i += 2) {
          if (isFinite(values[i]) && isFinite(values[i + 1])) {
            coords.push([values[i], values[i + 1]]);
          }
        }
        if (values.length >= 4) {
          currentX = values[values.length - 2];
          currentY = values[values.length - 1];
        }
        break;
      case 'T':
        for (let i = 0; i < values.length - 1; i += 2) {
          currentX = values[i];
          currentY = values[i + 1];
          if (isFinite(currentX) && isFinite(currentY)) {
            coords.push([currentX, currentY]);
          }
        }
        break;
      case 'A':
        // Arc: rx,ry,x-rotation,large-arc,sweep,x,y
        if (values.length >= 7) {
          currentX = values[5];
          currentY = values[6];
          if (isFinite(currentX) && isFinite(currentY)) {
            coords.push([currentX, currentY]);
          }
        }
        break;
    }
  }

  return coords;
}

/**
 * Estimate a good label position within a piece (centered in the bounding box of the outline).
 */
function estimateLabelPosition(piece: ScaledPiece): { x: number; y: number } {
  const coords = extractCoordsFromPath(piece.outline);
  if (coords.length === 0) {
    return { x: 0, y: 0 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

// --- SVG Parsing Helpers ---

/**
 * Extract attribute value from an SVG element string.
 */
function extractAttr(element: string, attr: string): string | null {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = element.match(regex);
  return match ? match[1] : null;
}

/**
 * Parse the viewBox attribute into width and height.
 */
function parseViewBox(svg: string): { width: number; height: number } {
  const match = svg.match(/viewBox="([^"]*)"/i);
  if (!match) {
    return { width: 0, height: 0 };
  }
  const parts = match[1].trim().split(/\s+/);
  if (parts.length !== 4) {
    return { width: 0, height: 0 };
  }
  return {
    width: parseFloat(parts[2]),
    height: parseFloat(parts[3]),
  };
}

/**
 * Extract all piece groups from the SVG.
 * Each piece is a <g> element with an id starting with "piece-".
 */
function extractPieceGroups(svg: string): string[] {
  const groups: string[] = [];
  const regex = /<g\s[^>]*id="piece-[^"]*"[^>]*>[\s\S]*?<\/g>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(svg)) !== null) {
    groups.push(match[0]);
  }
  return groups;
}

/**
 * Parse a <g> element's transform="translate(x, y)" to get offset.
 */
function parseTranslateOffset(group: string): { x: number; y: number } {
  const match = group.match(/transform="translate\(\s*([\d.eE+-]+)\s*,\s*([\d.eE+-]+)\s*\)"/i);
  if (!match) {
    return { x: 0, y: 0 };
  }
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
}

/**
 * Extract piece path data (the first path with class "pattern-piece").
 */
function extractPiecePath(group: string): string {
  const match = group.match(/<path\s[^>]*class="pattern-piece"[^>]*d="([^"]*)"[^>]*\/?>/i);
  if (!match) {
    // Try reversed attribute order
    const alt = group.match(/<path\s[^>]*d="([^"]*)"[^>]*class="pattern-piece"[^>]*\/?>/i);
    return alt ? alt[1] : '';
  }
  return match[1];
}

/**
 * Extract seam allowance path data.
 */
function extractSeamAllowancePath(group: string): string {
  const match = group.match(/<path\s[^>]*class="seam-allowance"[^>]*d="([^"]*)"[^>]*\/?>/i);
  if (!match) {
    const alt = group.match(/<path\s[^>]*d="([^"]*)"[^>]*class="seam-allowance"[^>]*\/?>/i);
    return alt ? alt[1] : '';
  }
  return match[1];
}

/**
 * Extract grain line coordinates and angle from the group.
 * Grain lines are <line> elements with class "grain-line".
 */
function extractGrainLine(group: string): { x1: number; y1: number; x2: number; y2: number; angle: number } {
  const match = group.match(/<line\s[^>]*class="grain-line"[^>]*\/?>/i);
  if (!match) {
    return { x1: 0, y1: 0, x2: 0, y2: 0, angle: 0 };
  }
  const lineEl = match[0];
  const x1 = parseFloat(extractAttr(lineEl, 'x1') ?? '0');
  const y1 = parseFloat(extractAttr(lineEl, 'y1') ?? '0');
  const x2 = parseFloat(extractAttr(lineEl, 'x2') ?? '0');
  const y2 = parseFloat(extractAttr(lineEl, 'y2') ?? '0');
  const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  return { x1, y1, x2, y2, angle: roundToTolerance(angle) };
}

/**
 * Extract notch positions from the group.
 * Notches are <circle> elements with class "notch".
 */
function extractNotches(group: string): Array<{ x: number; y: number; edgeId: string; matchingEdgeId: string }> {
  const notches: Array<{ x: number; y: number; edgeId: string; matchingEdgeId: string }> = [];
  const regex = /<circle\s[^>]*class="notch"[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(group)) !== null) {
    const el = match[0];
    const cx = parseFloat(extractAttr(el, 'cx') ?? '0');
    const cy = parseFloat(extractAttr(el, 'cy') ?? '0');
    const edgeId = extractAttr(el, 'data-edge-id') ?? '';
    const matchingEdgeId = extractAttr(el, 'data-matching-edge-id') ?? '';
    notches.push({ x: cx, y: cy, edgeId, matchingEdgeId });
  }
  return notches;
}

/**
 * Calculate bounds from path data. Parses M, L, C, Q, S commands.
 */
function calculateBoundsFromPath(pathData: string): { x: number; y: number; width: number; height: number } {
  const nums: number[] = [];
  const coordRegex = /[MLCQSTHVAZ]\s*([\d.eE+-]+[\s,]+[\d.eE+-]+(?:[\s,]+[\d.eE+-]+)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = coordRegex.exec(pathData)) !== null) {
    const values = m[1].trim().split(/[\s,]+/).map(parseFloat);
    for (let i = 0; i < values.length; i += 2) {
      if (i + 1 < values.length && isFinite(values[i]) && isFinite(values[i + 1])) {
        nums.push(values[i], values[i + 1]);
      }
    }
  }

  if (nums.length < 2) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < nums.length; i += 2) {
    minX = Math.min(minX, nums[i]);
    maxX = Math.max(maxX, nums[i]);
    minY = Math.min(minY, nums[i + 1]);
    maxY = Math.max(maxY, nums[i + 1]);
  }

  return {
    x: roundToTolerance(minX),
    y: roundToTolerance(minY),
    width: roundToTolerance(maxX - minX),
    height: roundToTolerance(maxY - minY),
  };
}

/**
 * Round a number to GEOMETRY_TOLERANCE_MM precision (0.01mm = 2 decimal places).
 */
function roundToTolerance(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Extract piece ID from the group element's id attribute.
 * The id is "piece-{id}", we return just the "{id}" part.
 */
function extractPieceId(group: string): string {
  const match = group.match(/id="piece-([^"]*)"/i);
  return match ? match[1] : '';
}

/**
 * Extract piece name from data-piece-name attribute.
 */
function extractPieceName(group: string): string {
  const match = group.match(/data-piece-name="([^"]*)"/i);
  return match ? match[1] : '';
}

/**
 * Extract cut quantity from data-cut-qty attribute.
 */
function extractCutQuantity(group: string): number {
  const match = group.match(/data-cut-qty="(\d+)"/i);
  return match ? parseInt(match[1], 10) : 1;
}

// --- Public Functions ---

/**
 * Serialize an SVG pattern string to a JSON representation.
 *
 * Parses the SVG and extracts all geometry, control points, and metadata,
 * producing a SerializedPattern object suitable for DynamoDB storage.
 *
 * @param svg - The SVG pattern string to serialize
 * @param metadata - Additional metadata required for serialization
 * @returns SerializedPattern object
 * @throws Error if SVG cannot be parsed or serialized size exceeds 400KB
 */
export function serializeSvgToJson(svg: string, metadata: SerializationMetadata): SerializedPattern {
  const viewBox = parseViewBox(svg);
  const groups = extractPieceGroups(svg);

  const pieces: SerializedPiece[] = groups.map((group) => {
    const id = extractPieceId(group);
    const name = extractPieceName(group);
    const cutQuantity = extractCutQuantity(group);
    const pathData = extractPiecePath(group);
    const seamAllowancePathData = extractSeamAllowancePath(group);
    const grainLine = extractGrainLine(group);
    const notches = extractNotches(group);
    const offset = parseTranslateOffset(group);
    const bounds = calculateBoundsFromPath(pathData);

    return {
      id,
      name,
      cutQuantity,
      pathData,
      seamAllowancePathData,
      grainLine,
      notches,
      bounds,
      offset,
    };
  });

  const serialized: SerializedPattern = {
    version: '1.0',
    templateId: metadata.templateId,
    garmentType: metadata.garmentType,
    ageGroup: metadata.ageGroup,
    size: metadata.size,
    seamAllowanceCm: metadata.seamAllowanceCm,
    viewBox,
    pieces,
    measurements: metadata.measurements,
    createdAt: metadata.createdAt ?? new Date().toISOString(),
  };

  // Check size constraint
  const jsonString = normalizeJson(serialized);
  const byteSize = new TextEncoder().encode(jsonString).length;
  if (byteSize > MAX_SERIALIZED_SIZE_BYTES) {
    throw new Error(
      `Serialized pattern exceeds 400KB DynamoDB limit: ${byteSize} bytes`,
    );
  }

  return serialized;
}

/**
 * Deserialize a SerializedPattern JSON object back to an SVG string.
 *
 * Reconstructs a valid SVG 1.1 document from the JSON representation,
 * producing output that passes SVG 1.1 schema validation.
 *
 * @param pattern - The SerializedPattern object to deserialize
 * @returns SVG string
 * @throws Error if the pattern fails validation
 */
export function deserializeJsonToSvg(pattern: SerializedPattern): string {
  // Validate input first
  const validation = validateSerializedPattern(pattern);
  if (!validation.valid) {
    const details = validation.errors
      .map((e) => `${e.field}: ${e.message.en}`)
      .join('; ');
    throw new Error(`Invalid pattern JSON: ${details}`);
  }

  const { viewBox, pieces, seamAllowanceCm } = pattern;
  const templateId = pattern.templateId;

  const groups: string[] = [];

  for (const piece of pieces) {
    const elements: string[] = [];

    // Piece outline path
    elements.push(
      `    <path class="pattern-piece" d="${escapeXml(piece.pathData)}" />`,
    );

    // Seam allowance path
    elements.push(
      `    <path class="seam-allowance" d="${escapeXml(piece.seamAllowancePathData)}" />`,
    );

    // Grain line
    elements.push(
      `    <line class="grain-line" x1="${piece.grainLine.x1.toFixed(2)}" y1="${piece.grainLine.y1.toFixed(2)}" x2="${piece.grainLine.x2.toFixed(2)}" y2="${piece.grainLine.y2.toFixed(2)}" />`,
    );

    // Notches
    for (const notch of piece.notches) {
      elements.push(
        `    <circle class="notch" cx="${notch.x.toFixed(2)}" cy="${notch.y.toFixed(2)}" r="1.5" data-edge-id="${escapeXml(notch.edgeId)}" data-matching-edge-id="${escapeXml(notch.matchingEdgeId)}" />`,
      );
    }

    // Labels
    const labelX = piece.bounds.x + piece.bounds.width / 2;
    const labelY = piece.bounds.y + piece.bounds.height / 2;
    elements.push(
      `    <text class="label" x="${labelX.toFixed(2)}" y="${(labelY - 5).toFixed(2)}" text-anchor="middle">${escapeXml(piece.name)}</text>`,
    );
    if (pattern.size) {
      elements.push(
        `    <text class="label-size" x="${labelX.toFixed(2)}" y="${(labelY + 5).toFixed(2)}" text-anchor="middle">Size: ${escapeXml(pattern.size)}</text>`,
      );
    }
    elements.push(
      `    <text class="label-size" x="${labelX.toFixed(2)}" y="${(labelY + 13).toFixed(2)}" text-anchor="middle">Cut: ${piece.cutQuantity}x</text>`,
    );

    const content = elements.join('\n');
    const pieceId = `piece-${piece.id}`;

    groups.push(
      `<g id="${escapeXml(pieceId)}" transform="translate(${piece.offset.x.toFixed(2)}, ${piece.offset.y.toFixed(2)})" data-piece-name="${escapeXml(piece.name)}" data-cut-qty="${piece.cutQuantity}">
${content}
  </g>`,
    );
  }

  const svgContent = groups.join('\n    ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 ${viewBox.width.toFixed(2)} ${viewBox.height.toFixed(2)}"
     width="${viewBox.width.toFixed(2)}mm"
     height="${viewBox.height.toFixed(2)}mm"
     data-template-id="${escapeXml(templateId)}"
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
    ${svgContent}
</svg>`;

  return svg;
}

/**
 * Validate a serialized pattern JSON object.
 *
 * Checks all required fields, value ranges, path data format,
 * geometry value finiteness, and total size constraint.
 *
 * @param data - Unknown input to validate as SerializedPattern
 * @returns StructuredValidationResult with field-level errors
 */
export function validateSerializedPattern(data: unknown): StructuredValidationResult {
  const errors: ValidationError[] = [];

  if (data === null || data === undefined || typeof data !== 'object') {
    errors.push(buildCustomError('root', 'INVALID_TYPE', {
      es: 'Los datos deben ser un objeto válido',
      en: 'Data must be a valid object',
    }));
    return structuredInvalid(errors);
  }

  const obj = data as Record<string, unknown>;

  // version
  if (obj.version !== '1.0') {
    errors.push(buildCustomError('version', 'INVALID_VERSION', {
      es: 'La versión debe ser "1.0"',
      en: 'Version must be "1.0"',
    }));
  }

  // templateId
  if (typeof obj.templateId !== 'string' || obj.templateId.length === 0) {
    errors.push(buildCustomError('templateId', 'REQUIRED', {
      es: 'El ID de plantilla es obligatorio',
      en: 'Template ID is required',
    }));
  }

  // garmentType
  if (!VALID_GARMENT_TYPES.includes(obj.garmentType as GarmentType)) {
    errors.push(buildCustomError('garmentType', 'INVALID_VALUE', {
      es: 'Tipo de prenda inválido',
      en: 'Invalid garment type',
    }));
  }

  // ageGroup
  if (!VALID_AGE_GROUPS.includes(obj.ageGroup as AgeGroup)) {
    errors.push(buildCustomError('ageGroup', 'INVALID_VALUE', {
      es: 'Grupo etario inválido',
      en: 'Invalid age group',
    }));
  }

  // size
  if (typeof obj.size !== 'string') {
    errors.push(buildCustomError('size', 'REQUIRED', {
      es: 'La talla es obligatoria',
      en: 'Size is required',
    }));
  }

  // seamAllowanceCm
  if (typeof obj.seamAllowanceCm !== 'number' ||
      !isFinite(obj.seamAllowanceCm) ||
      obj.seamAllowanceCm < 0.5 ||
      obj.seamAllowanceCm > 3.0) {
    errors.push(buildCustomError('seamAllowanceCm', 'OUT_OF_RANGE', {
      es: 'El margen de costura debe estar entre 0.5 y 3.0 cm',
      en: 'Seam allowance must be between 0.5 and 3.0 cm',
    }));
  }

  // viewBox
  if (!obj.viewBox || typeof obj.viewBox !== 'object') {
    errors.push(buildCustomError('viewBox', 'REQUIRED', {
      es: 'El viewBox es obligatorio',
      en: 'viewBox is required',
    }));
  } else {
    const vb = obj.viewBox as Record<string, unknown>;
    if (typeof vb.width !== 'number' || !isFinite(vb.width) || vb.width <= 0) {
      errors.push(buildCustomError('viewBox.width', 'INVALID_VALUE', {
        es: 'El ancho del viewBox debe ser un número positivo',
        en: 'viewBox width must be a positive number',
      }));
    }
    if (typeof vb.height !== 'number' || !isFinite(vb.height) || vb.height <= 0) {
      errors.push(buildCustomError('viewBox.height', 'INVALID_VALUE', {
        es: 'El alto del viewBox debe ser un número positivo',
        en: 'viewBox height must be a positive number',
      }));
    }
  }

  // pieces
  if (!Array.isArray(obj.pieces) || obj.pieces.length === 0) {
    errors.push(buildCustomError('pieces', 'REQUIRED', {
      es: 'Se requiere al menos una pieza de patrón',
      en: 'At least one pattern piece is required',
    }));
  } else {
    for (let i = 0; i < (obj.pieces as unknown[]).length; i++) {
      const pieceErrors = validatePiece((obj.pieces as unknown[])[i], i);
      errors.push(...pieceErrors);
    }
  }

  // measurements
  if (!obj.measurements || typeof obj.measurements !== 'object' || Array.isArray(obj.measurements)) {
    errors.push(buildCustomError('measurements', 'REQUIRED', {
      es: 'Las medidas son obligatorias',
      en: 'Measurements are required',
    }));
  } else {
    const meas = obj.measurements as Record<string, unknown>;
    for (const [key, val] of Object.entries(meas)) {
      if (typeof val !== 'number' || !isFinite(val)) {
        errors.push(buildCustomError(`measurements.${key}`, 'INVALID_VALUE', {
          es: `La medida "${key}" debe ser un número finito`,
          en: `Measurement "${key}" must be a finite number`,
        }));
      }
    }
  }

  // createdAt
  if (typeof obj.createdAt !== 'string' || obj.createdAt.length === 0) {
    errors.push(buildCustomError('createdAt', 'REQUIRED', {
      es: 'La fecha de creación es obligatoria',
      en: 'Created date is required',
    }));
  }

  // Check total size constraint
  if (errors.length === 0) {
    const jsonString = normalizeJson(data as SerializedPattern);
    const byteSize = new TextEncoder().encode(jsonString).length;
    if (byteSize > MAX_SERIALIZED_SIZE_BYTES) {
      errors.push(buildCustomError('_size', 'SIZE_EXCEEDED', {
        es: `El tamaño serializado (${byteSize} bytes) excede el límite de 400KB de DynamoDB`,
        en: `Serialized size (${byteSize} bytes) exceeds DynamoDB 400KB limit`,
      }));
    }
  }

  return errors.length === 0 ? structuredValid() : structuredInvalid(errors);
}

/**
 * Validate a single piece within the pieces array.
 */
function validatePiece(piece: unknown, index: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `pieces[${index}]`;

  if (!piece || typeof piece !== 'object') {
    errors.push(buildCustomError(prefix, 'INVALID_TYPE', {
      es: `La pieza ${index} debe ser un objeto`,
      en: `Piece ${index} must be an object`,
    }));
    return errors;
  }

  const p = piece as Record<string, unknown>;

  // id
  if (typeof p.id !== 'string' || p.id.length === 0) {
    errors.push(buildCustomError(`${prefix}.id`, 'REQUIRED', {
      es: 'El ID de pieza es obligatorio',
      en: 'Piece ID is required',
    }));
  }

  // name
  if (typeof p.name !== 'string' || p.name.length === 0) {
    errors.push(buildCustomError(`${prefix}.name`, 'REQUIRED', {
      es: 'El nombre de pieza es obligatorio',
      en: 'Piece name is required',
    }));
  }

  // cutQuantity
  if (typeof p.cutQuantity !== 'number' || !Number.isInteger(p.cutQuantity) || p.cutQuantity < 1) {
    errors.push(buildCustomError(`${prefix}.cutQuantity`, 'INVALID_VALUE', {
      es: 'La cantidad de corte debe ser un entero positivo',
      en: 'Cut quantity must be a positive integer',
    }));
  }

  // pathData
  if (typeof p.pathData !== 'string' || p.pathData.length === 0) {
    errors.push(buildCustomError(`${prefix}.pathData`, 'REQUIRED', {
      es: 'Los datos de ruta son obligatorios',
      en: 'Path data is required',
    }));
  } else if (!p.pathData.trimStart().startsWith('M')) {
    errors.push(buildCustomError(`${prefix}.pathData`, 'INVALID_FORMAT', {
      es: 'Los datos de ruta deben comenzar con "M"',
      en: 'Path data must start with "M"',
    }));
  } else if (!p.pathData.trimEnd().endsWith('Z')) {
    errors.push(buildCustomError(`${prefix}.pathData`, 'INVALID_FORMAT', {
      es: 'Los datos de ruta deben terminar con "Z"',
      en: 'Path data must end with "Z"',
    }));
  }

  // seamAllowancePathData
  if (typeof p.seamAllowancePathData !== 'string' || p.seamAllowancePathData.length === 0) {
    errors.push(buildCustomError(`${prefix}.seamAllowancePathData`, 'REQUIRED', {
      es: 'Los datos de ruta de margen de costura son obligatorios',
      en: 'Seam allowance path data is required',
    }));
  }

  // grainLine
  if (!p.grainLine || typeof p.grainLine !== 'object') {
    errors.push(buildCustomError(`${prefix}.grainLine`, 'REQUIRED', {
      es: 'La línea de hilo es obligatoria',
      en: 'Grain line is required',
    }));
  } else {
    const gl = p.grainLine as Record<string, unknown>;
    for (const coord of ['x1', 'y1', 'x2', 'y2', 'angle']) {
      if (typeof gl[coord] !== 'number' || !isFinite(gl[coord] as number)) {
        errors.push(buildCustomError(`${prefix}.grainLine.${coord}`, 'INVALID_VALUE', {
          es: `El valor de ${coord} debe ser un número finito`,
          en: `${coord} value must be a finite number`,
        }));
      }
    }
  }

  // notches
  if (!Array.isArray(p.notches)) {
    errors.push(buildCustomError(`${prefix}.notches`, 'INVALID_TYPE', {
      es: 'Las piquetas deben ser un array',
      en: 'Notches must be an array',
    }));
  } else {
    for (let j = 0; j < (p.notches as unknown[]).length; j++) {
      const notch = (p.notches as unknown[])[j] as Record<string, unknown> | null;
      if (!notch || typeof notch !== 'object') {
        errors.push(buildCustomError(`${prefix}.notches[${j}]`, 'INVALID_TYPE', {
          es: `La piqueta ${j} debe ser un objeto`,
          en: `Notch ${j} must be an object`,
        }));
        continue;
      }
      if (typeof notch.x !== 'number' || !isFinite(notch.x)) {
        errors.push(buildCustomError(`${prefix}.notches[${j}].x`, 'INVALID_VALUE', {
          es: 'La coordenada x debe ser un número finito',
          en: 'x coordinate must be a finite number',
        }));
      }
      if (typeof notch.y !== 'number' || !isFinite(notch.y)) {
        errors.push(buildCustomError(`${prefix}.notches[${j}].y`, 'INVALID_VALUE', {
          es: 'La coordenada y debe ser un número finito',
          en: 'y coordinate must be a finite number',
        }));
      }
      if (typeof notch.edgeId !== 'string') {
        errors.push(buildCustomError(`${prefix}.notches[${j}].edgeId`, 'REQUIRED', {
          es: 'El ID de borde es obligatorio',
          en: 'Edge ID is required',
        }));
      }
      if (typeof notch.matchingEdgeId !== 'string') {
        errors.push(buildCustomError(`${prefix}.notches[${j}].matchingEdgeId`, 'REQUIRED', {
          es: 'El ID de borde coincidente es obligatorio',
          en: 'Matching edge ID is required',
        }));
      }
    }
  }

  // bounds
  if (!p.bounds || typeof p.bounds !== 'object') {
    errors.push(buildCustomError(`${prefix}.bounds`, 'REQUIRED', {
      es: 'Los límites son obligatorios',
      en: 'Bounds are required',
    }));
  } else {
    const b = p.bounds as Record<string, unknown>;
    if (typeof b.x !== 'number' || !isFinite(b.x)) {
      errors.push(buildCustomError(`${prefix}.bounds.x`, 'INVALID_VALUE', {
        es: 'La coordenada x de límites debe ser un número finito',
        en: 'Bounds x must be a finite number',
      }));
    }
    if (typeof b.y !== 'number' || !isFinite(b.y)) {
      errors.push(buildCustomError(`${prefix}.bounds.y`, 'INVALID_VALUE', {
        es: 'La coordenada y de límites debe ser un número finito',
        en: 'Bounds y must be a finite number',
      }));
    }
    if (typeof b.width !== 'number' || !isFinite(b.width) || (b.width as number) <= 0) {
      errors.push(buildCustomError(`${prefix}.bounds.width`, 'INVALID_VALUE', {
        es: 'El ancho de límites debe ser un número positivo',
        en: 'Bounds width must be a positive number',
      }));
    }
    if (typeof b.height !== 'number' || !isFinite(b.height) || (b.height as number) <= 0) {
      errors.push(buildCustomError(`${prefix}.bounds.height`, 'INVALID_VALUE', {
        es: 'El alto de límites debe ser un número positivo',
        en: 'Bounds height must be a positive number',
      }));
    }
  }

  // offset
  if (!p.offset || typeof p.offset !== 'object') {
    errors.push(buildCustomError(`${prefix}.offset`, 'REQUIRED', {
      es: 'El offset es obligatorio',
      en: 'Offset is required',
    }));
  } else {
    const o = p.offset as Record<string, unknown>;
    if (typeof o.x !== 'number' || !isFinite(o.x)) {
      errors.push(buildCustomError(`${prefix}.offset.x`, 'INVALID_VALUE', {
        es: 'La coordenada x de offset debe ser un número finito',
        en: 'Offset x must be a finite number',
      }));
    }
    if (typeof o.y !== 'number' || !isFinite(o.y)) {
      errors.push(buildCustomError(`${prefix}.offset.y`, 'INVALID_VALUE', {
        es: 'La coordenada y de offset debe ser un número finito',
        en: 'Offset y must be a finite number',
      }));
    }
  }

  return errors;
}

/**
 * Produce a deterministic JSON string from a SerializedPattern.
 *
 * Keys are sorted recursively at all levels to guarantee byte-equivalent
 * output regardless of original insertion order. This enables reliable
 * round-trip comparison.
 *
 * @param json - The SerializedPattern to normalize
 * @returns Deterministic JSON string with sorted keys
 */
export function normalizeJson(json: SerializedPattern): string {
  return JSON.stringify(sortKeysDeep(json));
}

/**
 * Recursively sort all object keys in a value.
 */
function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Escape XML special characters in strings for SVG output.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Compare two SerializedPattern objects for geometric equivalence
 * within GEOMETRY_TOLERANCE_MM (0.01mm).
 *
 * Used internally to verify round-trip idempotence.
 */
export function areGeometricallyEqual(a: SerializedPattern, b: SerializedPattern): boolean {
  // Compare normalized JSON - if byte-identical after normalization, they're equal
  const normalizedA = normalizeJson(a);
  const normalizedB = normalizeJson(b);

  if (normalizedA === normalizedB) {
    return true;
  }

  // If not byte-identical, check within tolerance
  return compareWithTolerance(a, b);
}

/**
 * Deep comparison of two serialized patterns with numeric tolerance.
 */
function compareWithTolerance(a: SerializedPattern, b: SerializedPattern): boolean {
  // Non-geometric fields must be exactly equal
  if (a.version !== b.version) return false;
  if (a.templateId !== b.templateId) return false;
  if (a.garmentType !== b.garmentType) return false;
  if (a.ageGroup !== b.ageGroup) return false;
  if (a.size !== b.size) return false;
  if (a.createdAt !== b.createdAt) return false;
  if (a.pieces.length !== b.pieces.length) return false;

  // Numeric fields within tolerance
  if (!withinTolerance(a.seamAllowanceCm, b.seamAllowanceCm)) return false;
  if (!withinTolerance(a.viewBox.width, b.viewBox.width)) return false;
  if (!withinTolerance(a.viewBox.height, b.viewBox.height)) return false;

  // Measurements
  const aKeys = Object.keys(a.measurements).sort();
  const bKeys = Object.keys(b.measurements).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (!withinTolerance(a.measurements[aKeys[i]], b.measurements[bKeys[i]])) return false;
  }

  // Compare pieces
  for (let i = 0; i < a.pieces.length; i++) {
    if (!comparePiecesWithTolerance(a.pieces[i], b.pieces[i])) return false;
  }

  return true;
}

/**
 * Compare two pieces with geometric tolerance.
 */
function comparePiecesWithTolerance(a: SerializedPiece, b: SerializedPiece): boolean {
  if (a.id !== b.id) return false;
  if (a.name !== b.name) return false;
  if (a.cutQuantity !== b.cutQuantity) return false;
  if (a.pathData !== b.pathData) return false;
  if (a.seamAllowancePathData !== b.seamAllowancePathData) return false;

  // Grain line
  if (!withinTolerance(a.grainLine.x1, b.grainLine.x1)) return false;
  if (!withinTolerance(a.grainLine.y1, b.grainLine.y1)) return false;
  if (!withinTolerance(a.grainLine.x2, b.grainLine.x2)) return false;
  if (!withinTolerance(a.grainLine.y2, b.grainLine.y2)) return false;
  if (!withinTolerance(a.grainLine.angle, b.grainLine.angle)) return false;

  // Notches
  if (a.notches.length !== b.notches.length) return false;
  for (let i = 0; i < a.notches.length; i++) {
    if (!withinTolerance(a.notches[i].x, b.notches[i].x)) return false;
    if (!withinTolerance(a.notches[i].y, b.notches[i].y)) return false;
    if (a.notches[i].edgeId !== b.notches[i].edgeId) return false;
    if (a.notches[i].matchingEdgeId !== b.notches[i].matchingEdgeId) return false;
  }

  // Bounds
  if (!withinTolerance(a.bounds.x, b.bounds.x)) return false;
  if (!withinTolerance(a.bounds.y, b.bounds.y)) return false;
  if (!withinTolerance(a.bounds.width, b.bounds.width)) return false;
  if (!withinTolerance(a.bounds.height, b.bounds.height)) return false;

  // Offset
  if (!withinTolerance(a.offset.x, b.offset.x)) return false;
  if (!withinTolerance(a.offset.y, b.offset.y)) return false;

  return true;
}

/**
 * Check if two numbers are equal within GEOMETRY_TOLERANCE_MM.
 */
function withinTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= GEOMETRY_TOLERANCE_MM;
}

// --- SVG Parsing and Round-Trip Validation (Task 3.2) ---

/**
 * Structured representation of a parsed SVG pattern document.
 * Produced by `parseSvg` and consumed by `serializeSvg`.
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 */
export interface ParsedSvgDocument {
  viewBox: { minX: number; minY: number; width: number; height: number };
  width: string;
  height: string;
  pieces: ParsedPiece[];
}

/**
 * A single parsed pattern piece extracted from the SVG.
 */
export interface ParsedPiece {
  id: string;
  outline: string;       // path d attribute
  seamAllowance: string; // path d attribute
  grainLine: LineData;
  notches: LineData[];
  label: string;
}

// Re-use LineData from types (imported at top of file)

/**
 * Parse an SVG string into a structured ParsedSvgDocument.
 *
 * Handles SVG produced by both `generateSvg` (SVG.js format with data-role attributes)
 * and `serializeSvg` (hand-built format). Falls back to positional matching when
 * data-role attributes are not present.
 *
 * @param svgString - Complete SVG document string
 * @returns ParsedSvgDocument with all pieces and their geometries
 * @throws Error if SVG cannot be parsed or has no piece groups
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 */
export function parseSvg(svgString: string): ParsedSvgDocument {
  if (!svgString || typeof svgString !== 'string') {
    throw new Error('Invalid SVG input: must be a non-empty string');
  }

  // Parse viewBox
  const viewBox = parseViewBoxFull(svgString);

  // Parse width and height attributes
  const width = extractSvgRootAttr(svgString, 'width') ?? `${viewBox.width.toFixed(2)}mm`;
  const height = extractSvgRootAttr(svgString, 'height') ?? `${viewBox.height.toFixed(2)}mm`;

  // Extract all <g> elements (piece groups)
  const pieces = extractAndParsePieceGroups(svgString);

  if (pieces.length === 0) {
    throw new Error('No pattern piece groups found in SVG');
  }

  return { viewBox, width, height, pieces };
}

/**
 * Serialize a ParsedSvgDocument back to a valid SVG string.
 *
 * Produces SVG with the same structure as `generateSvg`: `data-role` attributes
 * on each element for reliable re-parsing.
 *
 * @param doc - ParsedSvgDocument to serialize
 * @returns Complete SVG document string
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 */
export function serializeSvg(doc: ParsedSvgDocument): string {
  if (!doc || !doc.pieces || doc.pieces.length === 0) {
    throw new Error('Cannot serialize: document has no pieces');
  }

  const { viewBox, width, height, pieces } = doc;
  const vbStr = `${viewBox.minX.toFixed(2)} ${viewBox.minY.toFixed(2)} ${viewBox.width.toFixed(2)} ${viewBox.height.toFixed(2)}`;

  const pieceElements: string[] = [];

  for (const piece of pieces) {
    const lines: string[] = [];

    // Cut outline
    lines.push(`    <path data-role="outline" d="${escapeXml(piece.outline)}" fill="none" stroke="#000000" stroke-width="0.5"/>`);

    // Seam allowance
    lines.push(`    <path data-role="seam-allowance" d="${escapeXml(piece.seamAllowance)}" fill="none" stroke="#888888" stroke-width="0.3" stroke-dasharray="5,3"/>`);

    // Grain line
    lines.push(`    <line data-role="grain-line" x1="${piece.grainLine.x1.toFixed(2)}" y1="${piece.grainLine.y1.toFixed(2)}" x2="${piece.grainLine.x2.toFixed(2)}" y2="${piece.grainLine.y2.toFixed(2)}" stroke="#333333" stroke-width="0.4" stroke-dasharray="8,3"/>`);

    // Notches
    for (const notch of piece.notches) {
      lines.push(`    <line data-role="notch" x1="${notch.x1.toFixed(2)}" y1="${notch.y1.toFixed(2)}" x2="${notch.x2.toFixed(2)}" y2="${notch.y2.toFixed(2)}" stroke="#000000" stroke-width="0.4"/>`);
    }

    // Label
    lines.push(`    <text data-role="label" font-family="Arial, sans-serif" font-size="8" fill="#000000">${escapeXml(piece.label)}</text>`);

    const content = lines.join('\n');
    pieceElements.push(`  <g id="${escapeXml(piece.id)}">\n${content}\n  </g>`);
  }

  const svgContent = pieceElements.join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbStr}" width="${escapeXml(width)}" height="${escapeXml(height)}" data-units="mm">\n${svgContent}\n</svg>`;
}

/**
 * Validate that an SVG string survives a parse → serialize → parse round-trip
 * with all geometries matching within 0.01mm tolerance.
 *
 * @param svgString - The SVG string to validate
 * @returns true if round-trip produces equivalent geometries, false otherwise
 *
 * Validates: Requirements 4.2, 4.3, 4.4
 */
export function validateRoundTrip(svgString: string): boolean {
  try {
    // First parse
    const doc1 = parseSvg(svgString);

    // Serialize back
    const serialized = serializeSvg(doc1);

    // Second parse
    const doc2 = parseSvg(serialized);

    // Compare the two parsed documents within tolerance
    return compareParsedDocuments(doc1, doc2);
  } catch {
    return false;
  }
}

// --- Internal helpers for parseSvg / serializeSvg ---

/**
 * Parse the full viewBox (minX, minY, width, height) from the SVG root.
 */
function parseViewBoxFull(svg: string): { minX: number; minY: number; width: number; height: number } {
  const match = svg.match(/viewBox="([^"]*)"/i);
  if (!match) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }
  const parts = match[1].trim().split(/[\s,]+/);
  if (parts.length !== 4) {
    return { minX: 0, minY: 0, width: 0, height: 0 };
  }
  return {
    minX: parseFloat(parts[0]),
    minY: parseFloat(parts[1]),
    width: parseFloat(parts[2]),
    height: parseFloat(parts[3]),
  };
}

/**
 * Extract an attribute from the root <svg> element.
 */
function extractSvgRootAttr(svg: string, attr: string): string | null {
  // Match the <svg ...> opening tag (up to the first >)
  const svgTagMatch = svg.match(/<svg\s[^>]*>/i);
  if (!svgTagMatch) return null;

  const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
  const attrMatch = svgTagMatch[0].match(regex);
  return attrMatch ? attrMatch[1] : null;
}

/**
 * Extract and parse all piece groups from the SVG.
 * Handles both nested `<g>` groups and flat `<g>` groups.
 */
function extractAndParsePieceGroups(svg: string): ParsedPiece[] {
  const pieces: ParsedPiece[] = [];

  // Match <g> elements with an id attribute (these are pattern pieces)
  // Use a non-greedy approach that handles nested content
  const groupRegex = /<g\s[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/g>/gi;
  let match: RegExpExecArray | null;

  while ((match = groupRegex.exec(svg)) !== null) {
    const id = match[1];
    const content = match[2];

    // Skip groups that don't look like piece groups (e.g. defs, etc.)
    if (!content.includes('<path') && !content.includes('<line')) {
      continue;
    }

    const piece = parsePieceContent(id, content);
    if (piece) {
      pieces.push(piece);
    }
  }

  return pieces;
}

/**
 * Parse the content of a single piece <g> element into a ParsedPiece.
 */
function parsePieceContent(id: string, content: string): ParsedPiece | null {
  // Extract outline path (data-role="outline" or first path without dashed stroke)
  const outline = extractPathByRole(content, 'outline')
    ?? extractFirstSolidPath(content);

  // Extract seam allowance path (data-role="seam-allowance" or path with dash)
  const seamAllowance = extractPathByRole(content, 'seam-allowance')
    ?? extractDashedPath(content);

  if (!outline) {
    return null;  // Not a valid piece without an outline
  }

  // Extract grain line (data-role="grain-line" or first line with dash pattern)
  const grainLine = extractGrainLineFromContent(content);

  // Extract notches (data-role="notch" or lines without dash)
  const notches = extractNotchesFromContent(content);

  // Extract label (data-role="label" or <text> content)
  const label = extractLabelFromContent(content);

  return {
    id,
    outline,
    seamAllowance: seamAllowance ?? '',
    grainLine,
    notches,
    label,
  };
}

/**
 * Extract a path's `d` attribute by its `data-role` attribute.
 */
function extractPathByRole(content: string, role: string): string | null {
  // Match path with data-role before d
  const regex1 = new RegExp(`<path[^>]*data-role="${role}"[^>]*d="([^"]*)"[^>]*/?>`, 'i');
  const match1 = content.match(regex1);
  if (match1) return match1[1];

  // Match path with d before data-role
  const regex2 = new RegExp(`<path[^>]*d="([^"]*)"[^>]*data-role="${role}"[^>]*/?>`, 'i');
  const match2 = content.match(regex2);
  if (match2) return match2[1];

  return null;
}

/**
 * Extract the first solid-stroke path (no dasharray) as the outline.
 * Used as fallback when data-role attributes are not present.
 */
function extractFirstSolidPath(content: string): string | null {
  const pathRegex = /<path[^>]*d="([^"]*)"[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(content)) !== null) {
    const full = match[0];
    // A solid path has no stroke-dasharray or dasharray attribute
    if (!full.includes('dasharray')) {
      return match[1];
    }
  }
  // If all paths have dasharray, return the first one
  const firstPath = content.match(/<path[^>]*d="([^"]*)"[^>]*\/?>/i);
  return firstPath ? firstPath[1] : null;
}

/**
 * Extract a dashed-stroke path as the seam allowance.
 * Used as fallback when data-role attributes are not present.
 */
function extractDashedPath(content: string): string | null {
  const pathRegex = /<path[^>]*d="([^"]*)"[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = pathRegex.exec(content)) !== null) {
    const full = match[0];
    if (full.includes('dasharray')) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extract grain line data from piece content.
 * Looks for data-role="grain-line" first, then falls back to the first <line> with dasharray.
 */
function extractGrainLineFromContent(content: string): LineData {
  const defaultLine: LineData = { x1: 0, y1: 0, x2: 0, y2: 0 };

  // Try data-role="grain-line"
  const roleRegex = /<line[^>]*data-role="grain-line"[^>]*\/?>/i;
  const roleMatch = content.match(roleRegex);
  if (roleMatch) {
    return parseLineElement(roleMatch[0]);
  }

  // Fallback: first <line> with dasharray (grain lines have dash patterns)
  const lineRegex = /<line[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(content)) !== null) {
    if (match[0].includes('dasharray')) {
      return parseLineElement(match[0]);
    }
  }

  return defaultLine;
}

/**
 * Extract notch lines from piece content.
 * Looks for data-role="notch" first, then falls back to lines without dasharray
 * (excluding the grain line which has dasharray).
 */
function extractNotchesFromContent(content: string): LineData[] {
  const notches: LineData[] = [];

  // Try data-role="notch"
  const roleRegex = /<line[^>]*data-role="notch"[^>]*\/?>/gi;
  let match: RegExpExecArray | null;
  let foundByRole = false;

  while ((match = roleRegex.exec(content)) !== null) {
    foundByRole = true;
    notches.push(parseLineElement(match[0]));
  }

  if (foundByRole) return notches;

  // Fallback: lines without dasharray (these are notches; grain line has dasharray)
  const lineRegex = /<line[^>]*\/?>/gi;
  while ((match = lineRegex.exec(content)) !== null) {
    const el = match[0];
    if (!el.includes('dasharray') && !el.includes('data-role="grain-line"')) {
      notches.push(parseLineElement(el));
    }
  }

  return notches;
}

/**
 * Parse a <line> element string into a LineData object.
 */
function parseLineElement(lineEl: string): LineData {
  const x1 = parseFloat(extractAttr(lineEl, 'x1') ?? '0');
  const y1 = parseFloat(extractAttr(lineEl, 'y1') ?? '0');
  const x2 = parseFloat(extractAttr(lineEl, 'x2') ?? '0');
  const y2 = parseFloat(extractAttr(lineEl, 'y2') ?? '0');
  return { x1, y1, x2, y2 };
}

/**
 * Extract label text from piece content.
 * Looks for data-role="label" first, then any <text> element.
 * Handles SVG.js tspan wrapping by stripping inner tags.
 */
function extractLabelFromContent(content: string): string {
  // Try data-role="label"
  const roleRegex = /<text[^>]*data-role="label"[^>]*>([\s\S]*?)<\/text>/i;
  const roleMatch = content.match(roleRegex);
  if (roleMatch) return stripInnerTags(roleMatch[1].trim());

  // Fallback: first <text> element
  const textRegex = /<text[^>]*>([\s\S]*?)<\/text>/i;
  const textMatch = content.match(textRegex);
  if (textMatch) return stripInnerTags(textMatch[1].trim());

  return '';
}

/**
 * Strip inner XML/HTML tags (like <tspan>) and return only text content.
 */
function stripInnerTags(html: string): string {
  // Remove all tags, keeping only text content between them
  const text = html.replace(/<[^>]*>/g, '').trim();
  return unescapeXml(text);
}

/**
 * Unescape XML entities back to plain text.
 */
function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Compare two ParsedSvgDocuments for geometric equivalence within tolerance.
 *
 * - viewBox dimensions must match within GEOMETRY_TOLERANCE_MM
 * - Same number of pieces
 * - Each piece: same id, same label, same outline/seamAllowance paths (coordinate comparison),
 *   same grain line and notch coordinates within tolerance
 */
function compareParsedDocuments(a: ParsedSvgDocument, b: ParsedSvgDocument): boolean {
  // ViewBox comparison
  if (!withinTolerance(a.viewBox.minX, b.viewBox.minX)) return false;
  if (!withinTolerance(a.viewBox.minY, b.viewBox.minY)) return false;
  if (!withinTolerance(a.viewBox.width, b.viewBox.width)) return false;
  if (!withinTolerance(a.viewBox.height, b.viewBox.height)) return false;

  // Piece count
  if (a.pieces.length !== b.pieces.length) return false;

  // Compare each piece
  for (let i = 0; i < a.pieces.length; i++) {
    if (!compareParsedPieces(a.pieces[i], b.pieces[i])) return false;
  }

  return true;
}

/**
 * Compare two ParsedPieces for geometric equivalence within tolerance.
 */
function compareParsedPieces(a: ParsedPiece, b: ParsedPiece): boolean {
  // IDs must match
  if (a.id !== b.id) return false;

  // Labels must match
  if (a.label !== b.label) return false;

  // Compare path coordinates within tolerance
  if (!comparePathCoordinates(a.outline, b.outline)) return false;
  if (!comparePathCoordinates(a.seamAllowance, b.seamAllowance)) return false;

  // Grain line
  if (!withinTolerance(a.grainLine.x1, b.grainLine.x1)) return false;
  if (!withinTolerance(a.grainLine.y1, b.grainLine.y1)) return false;
  if (!withinTolerance(a.grainLine.x2, b.grainLine.x2)) return false;
  if (!withinTolerance(a.grainLine.y2, b.grainLine.y2)) return false;

  // Notches
  if (a.notches.length !== b.notches.length) return false;
  for (let i = 0; i < a.notches.length; i++) {
    if (!withinTolerance(a.notches[i].x1, b.notches[i].x1)) return false;
    if (!withinTolerance(a.notches[i].y1, b.notches[i].y1)) return false;
    if (!withinTolerance(a.notches[i].x2, b.notches[i].x2)) return false;
    if (!withinTolerance(a.notches[i].y2, b.notches[i].y2)) return false;
  }

  return true;
}

/**
 * Compare two path `d` strings by extracting all numeric coordinates
 * and checking that they match within the geometry tolerance.
 */
function comparePathCoordinates(pathA: string, pathB: string): boolean {
  const coordsA = extractAllNumbers(pathA);
  const coordsB = extractAllNumbers(pathB);

  if (coordsA.length !== coordsB.length) return false;

  for (let i = 0; i < coordsA.length; i++) {
    if (!withinTolerance(coordsA[i], coordsB[i])) return false;
  }

  return true;
}

/**
 * Extract all numeric values from a path `d` attribute string.
 * Matches decimal numbers (potentially with sign and exponent).
 */
function extractAllNumbers(pathData: string): number[] {
  if (!pathData) return [];
  const matches = pathData.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  if (!matches) return [];
  return matches.map(parseFloat).filter(isFinite);
}


// --- JSON Serialization for DynamoDB (Task 3.3) ---

/** Maximum chunk size for S3 storage (slightly below 400KB to account for DynamoDB overhead). */
const MAX_CHUNK_SIZE_BYTES = 390 * 1024;

/**
 * Serialize a ScaledPattern to JSON for DynamoDB storage.
 *
 * Produces a JSON representation preserving all geometries, control points,
 * seam allowance, grain lines, notches, labels, and metadata.
 *
 * If the serialized JSON exceeds 400KB, it splits the data into chunks
 * suitable for S3 storage with a DynamoDB reference.
 *
 * @param pattern - The ScaledPattern to serialize
 * @returns SerializedPatternResult with JSON string, size info, and optional chunks
 *
 * Validates: Requirements 4.1, 4.2, 4.5, 4.6
 */
export function serializePatternToJson(pattern: ScaledPattern): SerializedPatternResult {
  if (!pattern) {
    throw new Error('Pattern is required for serialization');
  }

  if (!pattern.pieces || !Array.isArray(pattern.pieces) || pattern.pieces.length === 0) {
    throw new Error('Pattern must contain at least one piece');
  }

  if (!pattern.garmentType) {
    throw new Error('Pattern garmentType is required');
  }

  if (!pattern.ageGroup) {
    throw new Error('Pattern ageGroup is required');
  }

  if (!pattern.size) {
    throw new Error('Pattern size is required');
  }

  const jsonFormat: PatternJsonFormat = {
    version: '1.0',
    garmentType: pattern.garmentType,
    ageGroup: pattern.ageGroup,
    size: pattern.size,
    pieces: pattern.pieces.map((piece) => ({
      id: piece.id,
      outline: piece.outline,
      seamAllowance: piece.seamAllowance,
      grainLine: {
        x1: piece.grainLine.x1,
        y1: piece.grainLine.y1,
        x2: piece.grainLine.x2,
        y2: piece.grainLine.y2,
      },
      notches: piece.notches.map((notch) => ({
        x1: notch.x1,
        y1: notch.y1,
        x2: notch.x2,
        y2: notch.y2,
      })),
      label: piece.label,
    })),
  };

  const json = JSON.stringify(jsonFormat);
  const sizeBytes = new TextEncoder().encode(json).length;
  const exceedsLimit = sizeBytes > MAX_SERIALIZED_SIZE_BYTES;

  const result: SerializedPatternResult = {
    json,
    sizeBytes,
    exceedsLimit,
  };

  if (exceedsLimit) {
    result.chunks = splitIntoChunks(json, MAX_CHUNK_SIZE_BYTES);
  }

  return result;
}

/**
 * Deserialize a JSON string back to a ScaledPattern.
 *
 * Validates all required fields and rejects malformed JSON with specific
 * error messages indicating which fields are invalid or missing.
 *
 * @param json - The JSON string to deserialize
 * @returns A valid ScaledPattern that can be passed to generateSvg
 * @throws Error with specific message listing invalid/missing fields
 *
 * Validates: Requirements 4.1, 4.2, 4.5
 */
export function deserializePatternFromJson(json: string): ScaledPattern {
  if (!json || typeof json !== 'string' || json.trim().length === 0) {
    throw new Error('JSON input is required and must be a non-empty string');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON: unable to parse input');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON: root must be an object');
  }

  const obj = parsed as Record<string, unknown>;
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  // Validate top-level required fields
  if (!obj.garmentType || typeof obj.garmentType !== 'string') {
    missingFields.push('garmentType');
  }

  if (!obj.ageGroup || typeof obj.ageGroup !== 'string') {
    missingFields.push('ageGroup');
  }

  if (!obj.size || typeof obj.size !== 'string') {
    missingFields.push('size');
  }

  if (!Array.isArray(obj.pieces)) {
    missingFields.push('pieces');
  }

  // If top-level required fields are missing, throw immediately
  if (missingFields.length > 0) {
    throw new Error(
      `Missing required fields: ${missingFields.join(', ')}`,
    );
  }

  const pieces = obj.pieces as unknown[];
  if (pieces.length === 0) {
    throw new Error('Invalid field "pieces": must contain at least one piece');
  }

  // Validate each piece
  const scaledPieces: import('../../types/pattern.js').ScaledPiece[] = [];

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    if (!piece || typeof piece !== 'object' || Array.isArray(piece)) {
      invalidFields.push(`pieces[${i}]: must be an object`);
      continue;
    }

    const p = piece as Record<string, unknown>;
    const pieceErrors: string[] = [];

    // Validate piece required fields
    if (!p.id || typeof p.id !== 'string') {
      pieceErrors.push('id');
    }

    if (!p.outline || typeof p.outline !== 'string') {
      pieceErrors.push('outline');
    }

    if (!p.seamAllowance || typeof p.seamAllowance !== 'string') {
      pieceErrors.push('seamAllowance');
    }

    if (!p.label || typeof p.label !== 'string') {
      pieceErrors.push('label');
    }

    // Validate grainLine
    if (!p.grainLine || typeof p.grainLine !== 'object' || Array.isArray(p.grainLine)) {
      pieceErrors.push('grainLine');
    } else {
      const gl = p.grainLine as Record<string, unknown>;
      const grainLineCoords = ['x1', 'y1', 'x2', 'y2'];
      const missingCoords: string[] = [];
      for (const coord of grainLineCoords) {
        if (typeof gl[coord] !== 'number' || !isFinite(gl[coord] as number)) {
          missingCoords.push(coord);
        }
      }
      if (missingCoords.length > 0) {
        pieceErrors.push(`grainLine (invalid/missing: ${missingCoords.join(', ')})`);
      }
    }

    // Validate notches
    if (!Array.isArray(p.notches)) {
      pieceErrors.push('notches');
    } else {
      const notches = p.notches as unknown[];
      for (let j = 0; j < notches.length; j++) {
        const notch = notches[j];
        if (!notch || typeof notch !== 'object' || Array.isArray(notch)) {
          pieceErrors.push(`notches[${j}]: must be an object`);
          continue;
        }
        const n = notch as Record<string, unknown>;
        const notchCoords = ['x1', 'y1', 'x2', 'y2'];
        const missingNotchCoords: string[] = [];
        for (const coord of notchCoords) {
          if (typeof n[coord] !== 'number' || !isFinite(n[coord] as number)) {
            missingNotchCoords.push(coord);
          }
        }
        if (missingNotchCoords.length > 0) {
          pieceErrors.push(`notches[${j}] (invalid/missing: ${missingNotchCoords.join(', ')})`);
        }
      }
    }

    if (pieceErrors.length > 0) {
      invalidFields.push(`pieces[${i}]: missing/invalid fields [${pieceErrors.join(', ')}]`);
      continue;
    }

    // Build the ScaledPiece
    const gl = p.grainLine as Record<string, number>;
    const notches = (p.notches as Array<Record<string, number>>).map((n) => ({
      x1: n.x1,
      y1: n.y1,
      x2: n.x2,
      y2: n.y2,
    }));

    scaledPieces.push({
      id: p.id as string,
      outline: p.outline as string,
      seamAllowance: p.seamAllowance as string,
      grainLine: { x1: gl.x1, y1: gl.y1, x2: gl.x2, y2: gl.y2 },
      notches,
      label: p.label as string,
    });
  }

  if (invalidFields.length > 0) {
    throw new Error(
      `Invalid fields: ${invalidFields.join('; ')}`,
    );
  }

  return {
    garmentType: obj.garmentType as GarmentType,
    ageGroup: obj.ageGroup as AgeGroup,
    size: obj.size as import('../../types/garment.js').Size,
    pieces: scaledPieces,
  };
}

/**
 * Split a JSON string into chunks, each smaller than the specified max size in bytes.
 *
 * @param json - The full JSON string to split
 * @param maxBytes - Maximum bytes per chunk
 * @returns Array of JSON string chunks
 */
function splitIntoChunks(json: string, maxBytes: number): string[] {
  const encoder = new TextEncoder();
  const fullBytes = encoder.encode(json);
  const chunks: string[] = [];

  let offset = 0;
  while (offset < fullBytes.length) {
    const end = Math.min(offset + maxBytes, fullBytes.length);
    const chunkBytes = fullBytes.slice(offset, end);
    const decoder = new TextDecoder();
    chunks.push(decoder.decode(chunkBytes));
    offset = end;
  }

  return chunks;
}
