/**
 * Print file generation type definitions for CronusFit.
 * Covers DTF (Direct-to-Film) and sublimation print methods.
 * All dimensions in millimeters internally unless noted.
 */

/** Request payload for generating a DTF print file. */
export interface DTFGenerateRequest {
  /** S3 key or ID of the approved design. */
  designId: string;
  /** Print width in millimeters (10-500mm). */
  widthMm: number;
  /** Print height in millimeters (10-500mm). */
  heightMm: number;
}

/** Response returned after successful DTF file generation. */
export interface DTFGenerateResponse {
  /** S3 presigned URL for the main CMYK PNG file at 300+ DPI. */
  mainFileUrl: string;
  /** S3 presigned URL for the white ink underbase layer PNG. */
  underbaseFileUrl: string;
  /** Output dimensions and resolution details. */
  dimensions: {
    /** Width in millimeters. */
    widthMm: number;
    /** Height in millimeters. */
    heightMm: number;
    /** Resolution in dots per inch. */
    dpi: number;
  };
}

/** Request payload for generating a sublimation print file. */
export interface SublimationGenerateRequest {
  /** S3 key or ID of the approved design. */
  designId: string;
  /** Print width in centimeters (1-150cm). */
  widthCm: number;
  /** Print height in centimeters (1-150cm). */
  heightCm: number;
}

/** Response returned after successful sublimation file generation. */
export interface SublimationGenerateResponse {
  /** S3 presigned URL for the PNG (300 DPI, mirrored, +15% saturation, 3mm bleed). */
  fileUrl: string;
  /** Output dimensions and resolution details. */
  dimensions: {
    /** Width in centimeters (excluding bleed). */
    widthCm: number;
    /** Height in centimeters (excluding bleed). */
    heightCm: number;
    /** Bleed added on all edges in millimeters. */
    bleedMm: number;
    /** Resolution in dots per inch. */
    dpi: number;
  };
}
