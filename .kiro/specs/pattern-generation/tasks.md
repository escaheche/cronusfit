# Implementation Plan: Pattern Generation

## Overview

Implementación del sistema de generación de patrones de corte paramétricos SVG para CronusFit. El sistema incluye un motor de plantillas paramétricas, motor de escalado (grading), serialización SVG, plantillas personalizadas, y almacenamiento/registro en S3+DynamoDB. Toda la lógica corre en AWS Lambda (Node.js 20.x) con TypeScript.

## Tasks

- [x] 1. Set up project structure, types, and core interfaces
  - [x] 1.1 Create shared type definitions
    - Create `src/types/garment.ts` with `GarmentType` (including standard + custom), `AgeGroup` ('children' | 'adult'), `ChildrenSize` (2T–16), `AdultSize` (XS–6XL), `Size` union, `MeasurementKey`
    - Create `src/types/pattern.ts` with `ParametricTemplate`, `PieceTemplate`, `ControlPoint`, `ScaledPattern`, `ScaledPiece`, `PatternMetadata`, `ProportionProfile`, `GradingIncrementTable`, `PathData`, `LineData`, `SvgGenerationResult`
    - _Requirements: 1.7, 1.8, 1.9, 2.1, 3.2_

  - [x] 1.2 Create validation module for measurements and inputs
    - Implement `src/validation/measurements.ts` with functions: `validateMeasurements` (range 10mm–2000mm per individual measurement), `validateGarmentType`, `validateSize`, `validateAgeGroup`, `validateControlPoints` (min 4, range 10mm–2000mm)
    - Return specific error messages indicating which measurements are invalid and their acceptable range
    - _Requirements: 1.10, 1.11, 2.3, 2.6, 3.8_

  - [x] 1.3 Set up DynamoDB operations for pattern entities
    - Extend `src/db/operations.ts` with pattern-specific CRUD: `putPattern`, `getPattern`, `queryPatterns` (GSI1 by date desc, filterable by garmentType and ageGroup), `putTemplate`, `getTemplate`, `putGradingTable`, `getGradingTable`
    - Define entity key patterns: `PATTERN#{id}` / `METADATA`, `TEMPLATE#{id}` / `METADATA`, `GRADINGTABLE#{ageGroup}#{garmentType}` / `METADATA`
    - _Requirements: 5.2, 5.3, 5.5, 2.4, 3.2_

  - [x] 1.4 Set up S3 operations for pattern storage
    - Extend `src/storage/s3-client.ts` with `uploadPatternSvg(patternId, svgContent)` storing to `patterns/{patternId}/pattern.svg`, and `getPatternDownloadUrl(patternId)` returning a presigned URL with 1-hour expiry
    - Ensure Block Public Access is maintained
    - _Requirements: 5.1, 5.4, 7.3_

- [x] 2. Implement template engine
  - [x] 2.1 Implement parametric template loader
    - Create `src/modules/pattern/template-engine.ts` with `loadTemplate(garmentType, ageGroup)` that loads JSON template definitions from `templates/parametric/{ageGroup}/` directory
    - Implement `applyMeasurements(template, measurements)` that scales control points based on provided measurements and the template's ProportionProfile
    - _Requirements: 1.1, 1.7, 1.8_

  - [x] 2.2 Create standard parametric template definitions
    - Create JSON template files in `templates/parametric/children/` and `templates/parametric/adult/` for each standard garment type: camiseta, short, legging, sudadera, tank-top
    - Each template must define: pieces with control points, seam allowance default (15mm), grain line angles, notch positions, and the ProportionProfile for the age group (headToBodyRatio, limbToTorsoRatio, waistPositionRatio, shoulderToHipRatio)
    - _Requirements: 1.7, 1.8, 3.3, 3.4_

  - [-] 2.3 Write unit tests for template engine
    - Test loading templates for all garment types and both age groups
    - Test measurement application produces correctly scaled control points
    - Test that children templates use different ProportionProfile than adult templates
    - _Requirements: 1.7, 1.8_

- [x] 3. Implement SVG serialization module
  - [x] 3.1 Implement SVG generation with SVG.js + svgdom
    - Create `src/modules/pattern/serialization.ts` with `generateSvg(pattern: ScaledPattern): SvgGenerationResult`
    - Each piece rendered as `<g>` with unique `id` attribute
    - Cut outline as `<path>` with continuous stroke
    - Seam allowance as `<path>` with dashed stroke at configured distance
    - Grain line as `<line>` element
    - Notches as `<line>` elements of 3mm perpendicular to outline
    - Labels as `<text>` with piece name, size, and cut quantity
    - ViewBox in mm for 1:1 scale output
    - _Requirements: 1.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [x] 3.2 Implement SVG parsing and round-trip validation
    - Implement `parseSvg(svgString)` and `serializeSvg(doc)` functions
    - Implement `validateRoundTrip(svgString)` that verifies parse → serialize → parse produces equivalent result
    - Geometries must match within 0.01mm tolerance
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 3.3 Implement JSON serialization for DynamoDB storage
    - Implement `serializePatternToJson(pattern)` producing a JSON representation preserving all geometries, control points, seam allowance, grain lines, notches, labels, and metadata
    - Implement `deserializePatternFromJson(json)` reconstructing SVG from stored JSON
    - Validate item size ≤ 400KB; if exceeded, split into multiple items or store in S3 with DynamoDB reference
    - Reject malformed JSON with specific error messages for invalid/missing fields
    - _Requirements: 4.1, 4.2, 4.5, 4.6_

  - [x] 3.4 Write property tests for serialization round-trip
    - Use fast-check to generate arbitrary ScaledPattern instances
    - Property: serialize → deserialize → re-serialize produces byte-equivalent JSON (after key normalization)
    - Property: serialize → deserialize → generateSvg produces geometries matching original within 0.01mm
    - _Requirements: 4.3, 4.4_

  - [x] 3.5 Write unit tests for SVG generation
    - Test that generated SVG passes SVG 1.1 structure validation
    - Test piece count matches input
    - Test all required elements present (path, line, text, g)
    - Test viewBox uses mm units
    - _Requirements: 6.1–6.8, 4.2_

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement grading engine
  - [x] 5.1 Implement grading increment table management
    - Create `src/modules/pattern/grading-engine.ts` with `loadGradingTable(ageGroup, garmentType)` from DynamoDB
    - Implement `validateGradingTable(table)` ensuring all increment values are positive between 1mm and 100mm per size step, with entries for all consecutive size transitions
    - Implement `saveGradingTable(ageGroup, garmentType, table)` to persist in DynamoDB
    - _Requirements: 3.2, 3.8_

  - [x] 5.2 Implement size grading logic
    - Implement `gradePattern(basePattern, ageGroup, targetSizes, gradingTable)` that applies increments to produce scaled patterns for each target size
    - For children: apply anatomical proportion adjustments (higher head-to-body ratio, shorter limbs relative to torso, higher waist position, narrower shoulders relative to hips)
    - For adults: scale proportionally maintaining width-to-length relationships
    - Preserve notch count, grain line, and labels at proportional positions in each graded size
    - _Requirements: 3.1, 3.3, 3.4, 3.5_

  - [x] 5.3 Implement grading output options
    - Support generating each size as a separate SVG file
    - Support generating all sizes as labeled layers within a single SVG
    - Output selection based on admin preference parameter
    - Complete all sizes within 30 seconds; on failure, produce no partial output and clean up
    - _Requirements: 3.6, 3.7, 7.2_

  - [x] 5.4 Write unit tests for grading engine
    - Test children grading applies anatomical proportions correctly
    - Test adult grading maintains proportional relationships
    - Test grading table validation rejects out-of-range increments
    - Test notch and label preservation across sizes
    - _Requirements: 3.1–3.8_

- [x] 6. Implement custom template creation
  - [x] 6.1 Implement custom template module
    - Create `src/modules/pattern/custom-template.ts` with `createCustomTemplate(name, ageGroup, controlPoints, pieces)`
    - Validate minimum 4 control points with min/max in range 10mm–2000mm
    - Apply ProportionProfile corresponding to selected age group
    - Store template in DynamoDB via Pattern_Registry
    - Return specific error messages if validation fails (fewer than 4 points, out-of-range values)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 6.2 Write unit tests for custom template creation
    - Test successful creation with valid inputs
    - Test rejection with fewer than 4 control points
    - Test rejection with out-of-range values
    - Test ProportionProfile application per age group
    - _Requirements: 2.1–2.6_

- [x] 7. Implement Lambda handlers and API integration
  - [x] 7.1 Implement pattern generation handler
    - Create `src/lambdas/pattern-generate/handler.ts` accepting `{ garmentType, ageGroup, size, measurements, seamAllowance?, referenceImageKey? }`
    - Validate inputs, load template, apply measurements, generate SVG, validate round-trip, store in S3, register metadata in DynamoDB
    - Return `{ patternId, downloadUrl, metadata }`
    - Enforce 15-second Lambda timeout; on timeout return error without storing partial results
    - Require Cognito JWT authentication
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.10, 1.11, 1.12, 5.1, 5.2, 7.1, 7.5, 7.6_

  - [x] 7.2 Implement pattern grading handler
    - Create `src/lambdas/pattern-grade/handler.ts` accepting `{ patternId, ageGroup, targetSizes, outputMode }`
    - Load base pattern, apply grading, generate SVGs, store all in S3, register metadata
    - Enforce 30-second timeout; on failure clean up partial outputs
    - Require Cognito JWT authentication
    - _Requirements: 3.1, 3.6, 3.7, 7.2, 7.5, 7.6_

  - [x] 7.3 Implement pattern serialization handler
    - Create `src/lambdas/pattern-serialize/handler.ts` for explicit serialize/deserialize operations
    - Endpoints: serialize pattern to JSON for storage, deserialize from JSON to SVG
    - Validate DynamoDB 400KB limit; split or use S3 overflow if needed
    - _Requirements: 4.1, 4.2, 4.5, 4.6_

  - [x] 7.4 Implement pattern list and download endpoints
    - In pattern-generate handler or separate handler: `GET /patterns` querying GSI1 by date desc with optional garmentType/ageGroup filters
    - `GET /patterns/:id/download` returning presigned URL from S3
    - Return 404 error if pattern ID not found
    - _Requirements: 5.3, 5.4, 5.5_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Integration wiring and final validation
  - [x] 9.1 Wire all modules together and add error handling
    - Ensure all Lambda handlers properly chain: validation → template loading → generation → serialization → storage → response
    - Implement consistent error response format across all handlers with specific error messages (invalid measurements, missing templates, timeout, etc.)
    - Preserve admin-entered measurements on generation failure
    - _Requirements: 1.10, 1.11, 1.12, 3.7, 7.6_

  - [x] 9.2 Write integration tests for end-to-end flows
    - Test full generation flow: request → validate → generate → store → retrieve
    - Test grading flow: base pattern → grade → multiple SVGs stored
    - Test custom template flow: create template → generate pattern from it
    - Test error scenarios: invalid measurements, missing template, oversized pattern
    - Mock AWS services with aws-sdk-client-mock
    - _Requirements: 1.1, 3.1, 2.1, 4.1, 5.1_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate round-trip serialization correctness (Req 4.3, 4.4)
- Unit tests validate specific examples and edge cases
- All measurements stored internally in millimeters; converted for display
- Use `aws-sdk-client-mock` for mocking DynamoDB and S3 in tests
- Use `fast-check` for property-based testing of serialization
- Use `vitest` as test runner (`npx vitest run`)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "3.3"] },
    { "id": 4, "tasks": ["2.3", "3.4", "3.5"] },
    { "id": 5, "tasks": ["5.1", "6.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.2"] },
    { "id": 7, "tasks": ["5.4"] },
    { "id": 8, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["9.2"] }
  ]
}
```
