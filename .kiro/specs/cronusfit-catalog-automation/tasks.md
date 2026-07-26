# Implementation Plan: Cronus Fit Catalog Automation

## Overview

This plan implements the Cronus Fit serverless catalog automation platform using AWS Lambda (Node.js 20.x), DynamoDB (single-table), S3, CloudFront, API Gateway, Cognito, SES, Sharp, SVG.js, Eleventy, and WAHA/n8n for WhatsApp integration. Tasks are organized to build foundational infrastructure first, then core modules incrementally, wiring everything together at the end.

## Tasks

- [x] 1. Set up project structure, shared types, and infrastructure
  - [x] 1.1 Initialize Node.js 20.x project with TypeScript, configure ESLint, Prettier, Vitest, and fast-check
    - Create `package.json` with dependencies: `@aws-sdk/client-s3`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `sharp`, `svgjs`, `@11ty/eleventy`, `fast-check`, `vitest`, `aws-sdk-client-mock`
    - Configure `tsconfig.json` for ES2022 target, strict mode
    - Set up Vitest config with property test support
    - _Requirements: 11.1, 11.3_

  - [x] 1.2 Define shared TypeScript interfaces and types
    - Create `src/types/garment.ts` with `GarmentType`, `AgeGroup`, `ChildrenSize`, `AdultSize`, `Size`
    - Create `src/types/pattern.ts` with `ParametricTemplate`, `ControlPoint`, `PieceDefinition`, `ProportionProfile`, `GradingIncrementTable`
    - Create `src/types/mockup.ts` with `MockupGenerateRequest`, `MockupGenerateResponse`, `PlacementZone`
    - Create `src/types/quote.ts` with `QuoteSubmitRequest`, `QuoteSubmitResponse`, `QuoteStatus`
    - Create `src/types/print.ts` with `DTFGenerateRequest`, `SublimationGenerateRequest` and responses
    - Create `src/types/whatsapp.ts` with `WhatsAppSendRequest`, `WhatsAppResponseWebhook`, `DeliveryLogEntry`
    - Create `src/types/security.ts` with `AuditLogEntry`, `LoginAttemptRecord`, `CaptchaVerifyRequest`, `SessionConfig`
    - _Requirements: 1.1–1.12, 2.1–2.8, 4.1–4.7, 7.1–7.11, 8.1–8.7, 9.1–9.7, 12.1–12.12, 13.1–13.9_

  - [x] 1.3 Implement DynamoDB single-table data layer
    - Create `src/db/client.ts` with DynamoDB Document Client setup
    - Create `src/db/entities.ts` with all entity record interfaces (`PatternRecord`, `MockupRecord`, `QuoteRecord`, `DeliveryLogRecord`, `AuditLogEntry`, `LoginAttemptRecord`)
    - Create `src/db/operations.ts` with CRUD helpers (put, get, query by GSI, transact write)
    - Define table schema constants (PK/SK patterns, GSI definitions)
    - _Requirements: 11.4, 13.5_

  - [x] 1.4 Implement S3 service layer and bucket configuration
    - Create `src/storage/s3-client.ts` with S3 client, presigned URL generation, upload/download helpers
    - Define bucket structure constants matching design (cronusfit-assets, cronusfit-website)
    - Implement file validation utility (format check, size check ≤ 10MB)
    - _Requirements: 11.2, 13.9_

  - [x] 1.5 Implement shared validation utilities
    - Create `src/validation/measurements.ts` — validate measurement ranges [1cm, 200cm]
    - Create `src/validation/files.ts` — validate file formats (JPEG, PNG, SVG) and size (≤ 10MB)
    - Create `src/validation/quote.ts` — validate quote fields (name 1-100, email, phone 7-15 digits, quantity 1-10000, sizes)
    - Create `src/validation/print.ts` — validate DTF dimensions (10-500mm) and sublimation dimensions (1-150cm)
    - Create `src/validation/common.ts` — field-level error message builder (bilingual es/en)
    - _Requirements: 1.11, 4.6, 7.3, 7.6, 8.5, 9.5_

- [x] 2. Implement Pattern Generator module
  - [x] 2.1 Implement parametric template engine with SVG.js
    - Create `src/modules/pattern/template-engine.ts`
    - Load parametric templates from S3 (`templates/parametric/{ageGroup}/{garmentType}.json`)
    - Implement control point interpolation and path generation
    - Generate SVG with grouped `<g>` elements, unique IDs, mm coordinates
    - Include seam allowances (configurable 0.5–3.0cm), grain lines, notches, labels (name, size, cut quantity)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.10_

  - [x] 2.2 Create age-group-aware parametric templates (children + adult)
    - Create template JSON files for all 5 standard garment types × 2 age groups (10 templates)
    - Each template defines `ProportionProfile` with age-group-specific ratios (head-to-body, limb-to-torso, waist position, shoulder-to-hip)
    - Define control points with min/max ranges per age group
    - _Requirements: 1.8, 2.2, 2.3, 2.4_

  - [x] 2.3 Implement custom template creation
    - Create `src/modules/pattern/custom-template.ts`
    - Validate minimum 4 control points and required Age_Group specification
    - Store custom templates in DynamoDB and S3
    - _Requirements: 1.9_

  - [x] 2.4 Implement size grading engine
    - Create `src/modules/pattern/grading-engine.ts`
    - Load age-group-specific `GradingIncrementTable` from DynamoDB
    - Apply increments per control point for each size transition
    - Children: apply proportional corrections (not linear adult scaling)
    - Adults: scale maintaining relative width/length proportions
    - Preserve notch count, grain lines, and labels at proportional positions
    - Output separate SVG files or layered single SVG per Admin preference
    - Validate increment table values (0.1–10cm per step, all transitions present)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 2.5 Implement SVG serialization and deserialization
    - Create `src/modules/pattern/serialization.ts`
    - Serialize SVG to JSON preserving all geometry, control points, metadata (≤ 400KB)
    - Deserialize JSON back to SVG with SVG 1.1 schema validation
    - Guarantee round-trip idempotence (byte-equivalent after key-order normalization)
    - Geometry tolerance: 0.01mm
    - Reject malformed/incomplete JSON with specific field-level errors
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 2.6 Implement Pattern Generator Lambda handler
    - Create `src/lambdas/pattern-generate/handler.ts`
    - Wire template engine + validation + S3 storage + DynamoDB metadata
    - Create `src/lambdas/pattern-grade/handler.ts` for grading endpoint
    - Create `src/lambdas/pattern-serialize/handler.ts` for serialize/deserialize
    - Handle errors: preserve measurements, display cause, allow retry
    - Record audit log entry on successful generation
    - _Requirements: 1.1, 1.2, 1.11, 1.12, 13.5_

  - [x] 2.7 Write property tests for Pattern Generator (Properties 1–5)
    - **Property 1: Pattern Structural Completeness** — verify SVG contains grouped elements, seam allowances, grain lines, notches, labels, mm coordinates for any valid input
    - **Property 2: Measurement Validation Completeness** — verify rejection of any invalid measurement set with specific errors
    - **Property 3: Custom Template Control Point Validation** — verify acceptance iff N≥4 and valid AgeGroup
    - **Property 4: File Upload Validation** — verify format/size acceptance rules
    - **Property 5: Age-Group Template Availability** — verify both children and adult templates exist for all 5 garment types
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 1.9, 1.10, 1.11, 4.6**

  - [x] 2.8 Write property tests for Grading and Serialization (Properties 6–9)
    - **Property 6: Grading Proportionality and Structural Preservation** — verify correct age-group-specific scaling, notch/label preservation
    - **Property 7: Grading Increment Table Validation** — verify acceptance iff all values in [0.1, 10] and all transitions present
    - **Property 8: Serialization Round-Trip Idempotence** — verify JSON round-trip produces identical output within 0.01mm, passes SVG 1.1, ≤400KB
    - **Property 9: Malformed JSON Rejection** — verify rejection of invalid JSON with field-specific errors
    - **Validates: Requirements 2.1–2.8, 3.1–3.5**

- [x] 3. Checkpoint — Pattern Generator
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement Mockup Generator module
  - [x] 4.1 Implement mockup compositing engine with Sharp
    - Create `src/modules/mockup/compositor.ts`
    - Load garment base template (front/back views) from S3
    - Load design graphic, validate format (PNG, JPEG, SVG) and size (≤ 10MB)
    - Calculate placement area boundaries for selected zone (chest, full-front, full-back, left-sleeve, right-sleeve)
    - Scale design proportionally if exceeds zone boundaries, record scaling percentage
    - Composite design onto garment template using Sharp
    - Output 1200×1600 PNG with transparent background
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.7_

  - [x] 4.2 Implement Mockup Generator Lambda handler with atomic storage
    - Create `src/lambdas/mockup-generate/handler.ts`
    - Store mockup images to S3, create DynamoDB record with `pending_approval` status atomically
    - If storage fails, rollback (no partial state), notify Admin
    - Record audit log entry
    - _Requirements: 4.4, 4.6, 13.5_

  - [x] 4.3 Write property tests for Mockup Generator (Properties 10–11)
    - **Property 10: Mockup Output Specification** — verify two PNGs at ≥1200×1600, transparent background, design within placement zone
    - **Property 11: Design Scaling Correctness** — verify proportional scaling when design exceeds zone, no scaling notification when it fits
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.7**

- [x] 5. Implement Approval Workflow module
  - [x] 5.1 Implement approval state machine
    - Create `src/modules/approval/workflow.ts`
    - Enforce state transitions: only `pending_approval` → `approved` or `rejected`
    - Approval: record timestamp
    - Rejection: validate reason (1–500 chars), store reason
    - Reject invalid state transitions with error + audit log entry
    - Block publication of non-approved mockups
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

  - [x] 5.2 Implement approval queue and audit trail
    - Create `src/modules/approval/queue.ts`
    - Query mockups by `pending_approval` status ordered by generation date (oldest first)
    - Create `src/modules/approval/audit.ts`
    - Record all actions (approve, reject, invalid attempts) with admin identity, timestamp, mockup ID
    - Audit write is best-effort with retry queue (doesn't block primary operation)
    - _Requirements: 5.5, 5.6, 13.5_

  - [x] 5.3 Implement Approval Workflow Lambda handlers
    - Create `src/lambdas/approval-process/handler.ts` — POST /api/mockups/{id}/approve|reject
    - Create `src/lambdas/approval-audit/handler.ts` — audit trail query endpoint
    - Wire with DynamoDB conditional writes for state integrity
    - _Requirements: 5.1–5.7, 13.5_

  - [x] 5.4 Write property tests for Approval Workflow (Properties 12–13)
    - **Property 12: Approval State Machine Integrity** — verify state transitions, rejection reason validation, audit recording
    - **Property 13: Approval Queue Ordering** — verify oldest-first ordering of pending mockups
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**

- [x] 6. Implement Security module (Authentication, Rate Limiting, Audit)
  - [x] 6.1 Implement Cognito authentication and JWT validation
    - Create `src/modules/security/cognito-auth.ts`
    - Configure Cognito User Pool client (password policy: 8+ chars, upper, lower, numbers, symbols)
    - Implement Lambda Authorizer for API Gateway JWT validation
    - Return 401 for missing/expired/invalid tokens
    - Session management: track inactivity, configurable timeout (5–120 min, default 30)
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 6.2 Implement login rate limiting
    - Create `src/modules/security/rate-limiter.ts`
    - Track failed login attempts per IP in DynamoDB with TTL
    - Block after 5 failures within 15 minutes for 15 minutes
    - Log lockout events
    - _Requirements: 13.4_

  - [x] 6.3 Implement audit log service
    - Create `src/modules/security/audit-log.ts`
    - Write audit entries: admin identity (Cognito sub), timestamp (UTC ISO 8601), action type, resource ID
    - Best-effort with retry queue (5 retries, exponential backoff)
    - Don't block primary operation on audit failure
    - _Requirements: 13.5_

  - [x] 6.4 Implement CAPTCHA verification and public endpoint rate limiting
    - Create `src/modules/security/captcha.ts` — verify hCaptcha token via API
    - Create `src/modules/security/public-rate-limiter.ts` — enforce 10 quote submissions per IP per hour
    - _Requirements: 13.7_

  - [x] 6.5 Implement credential management via Secrets Manager
    - Create `src/modules/security/secrets.ts`
    - Load WAHA API key, webhook secret, n8n URL, hCaptcha secret at Lambda cold start
    - Cache for warm invocations, support rotation without redeployment
    - _Requirements: 13.8_

  - [x] 6.6 Implement Security Lambda handlers
    - Create `src/lambdas/auth-validate/handler.ts` — Lambda Authorizer
    - Create `src/lambdas/audit-write/handler.ts` — audit log writer with retry
    - Wire API Gateway authorizer to Cognito validation
    - Configure API Gateway throttling (100 req/s per endpoint)
    - _Requirements: 13.1, 13.2, 11.9, 13.5_

  - [x] 6.7 Write property tests for Security module (Properties 28–32)
    - **Property 28: JWT Authentication Enforcement** — verify 401 for missing/expired/invalid JWT on protected endpoints
    - **Property 29: Session Inactivity Timeout** — verify session invalidation when inactivity exceeds configured timeout
    - **Property 30: Login Rate Limiting** — verify lockout after 5 failures in 15 min, no lockout below threshold
    - **Property 31: Audit Log Completeness** — verify all admin actions recorded with required fields within 5s
    - **Property 32: Quote Submission CAPTCHA and Rate Limiting** — verify CAPTCHA required and 10/IP/hour limit enforced
    - **Validates: Requirements 13.1–13.7**

- [x] 7. Checkpoint — Core modules (Pattern, Mockup, Approval, Security)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement Quote Manager module
  - [x] 8.1 Implement quote submission and validation
    - Create `src/modules/quote/submit.ts`
    - Validate all fields: name (1-100), email, phone (7-15 digits), quantity (1-10000), ageGroup, sizes within age group, customization notes (≤1000 chars)
    - Require CAPTCHA verification before processing
    - Enforce rate limit (10 submissions/IP/hour)
    - Store quote with status `pending`, generate tracking number
    - Send confirmation email via SES within 60s (accept quote even if email delayed)
    - Notify Admin via email
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.11, 13.7_

  - [x] 8.2 Implement quote pricing, status management, and client response
    - Create `src/modules/quote/pricing.ts` — Admin sets price, status → `quoted`, send email + WhatsApp
    - Create `src/modules/quote/response.ts` — Client accept/reject via unique link
    - Status transitions: pending → quoted → accepted/rejected
    - On accept/reject: update status only after Admin notification succeeds (retry with exponential backoff)
    - _Requirements: 7.7, 7.8, 7.9, 7.10_

  - [x] 8.3 Implement Quote Manager Lambda handlers
    - Create `src/lambdas/quote-submit/handler.ts` — POST /api/quotes (public, CAPTCHA + rate limit)
    - Create `src/lambdas/quote-process/handler.ts` — POST /api/quotes/{id}/price (JWT required)
    - Create `src/lambdas/quote-notify/handler.ts` — notification handling (SES + WhatsApp)
    - Create `src/lambdas/quote-status/handler.ts` — GET /api/quotes/{trackingNumber}/status (public)
    - _Requirements: 7.1–7.11, 13.6_

  - [x] 8.4 Write property tests for Quote Manager (Properties 16–18)
    - **Property 16: Quote Request Validation** — verify acceptance/rejection rules for all field combinations
    - **Property 17: Quote Status Filtering** — verify filtered queries return exactly matching quotes
    - **Property 18: Quote Tracking Number Uniqueness** — verify unique tracking numbers and correct lookup
    - **Validates: Requirements 7.2, 7.3, 7.6, 7.10, 7.11**

- [x] 9. Implement Print File Generator module
  - [x] 9.1 Implement DTF print file generation
    - Create `src/modules/print/dtf-generator.ts`
    - Generate main PNG at 300+ DPI, CMYK color space, transparent background
    - Generate separate white ink underbase PNG at same DPI/dimensions
    - Validate dimensions (10–500mm per side)
    - Size output to exact mm dimensions specified
    - Error handling: reject if source < 300 DPI at target size
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [x] 9.2 Implement Sublimation print file generation
    - Create `src/modules/print/sublimation-generator.ts`
    - Generate PNG at 300 DPI with 3mm bleed on all edges
    - Apply horizontal mirroring for transfer
    - Increase color saturation by 15% for sublimation ink loss compensation
    - Validate dimensions (1–150cm per side)
    - Size output to exact dimensions (excluding bleed)
    - Error handling: reject if source < 300 DPI at target size
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 9.3 Implement Print Generator Lambda handlers
    - Create `src/lambdas/print-dtf/handler.ts` — POST /api/print/dtf (JWT required)
    - Create `src/lambdas/print-sublimation/handler.ts` — POST /api/print/sublimation (JWT required)
    - Generate presigned download URLs for successful files
    - Record audit log entries
    - _Requirements: 8.1–8.7, 9.1–9.7, 13.5_

  - [x] 9.4 Write property tests for Print Generator (Properties 19–20)
    - **Property 19: DTF Output Specification** — verify main PNG (300+ DPI, CMYK, transparent, correct mm dimensions) + underbase PNG at same specs
    - **Property 20: Sublimation Output Specification** — verify PNG (300 DPI, 3mm bleed, mirrored, +15% saturation, correct cm dimensions)
    - **Validates: Requirements 8.1–8.5, 9.1–9.5**

- [x] 10. Checkpoint — Quote and Print modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Exhibition Website module
  - [ ] 11.1 Implement static site generator with Eleventy
    - Create `src/modules/exhibition/site-builder.ts`
    - Configure Eleventy to generate static HTML from published product data
    - Implement responsive product grid (320px–2560px viewport)
    - Create individual product pages with front/back mockups, name, Age_Group, available sizes
    - Implement bilingual support (Spanish default + English), language toggle with localStorage persistence (30+ days)
    - Include Cronus Fit brand identity (hourglass logo, blue/gold) in header and favicon
    - Add quote request form with hCaptcha integration
    - Add quote status lookup page
    - _Requirements: 6.1, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_

  - [x] 11.2 Implement publication workflow and site rebuild pipeline
    - Create `src/modules/exhibition/publish.ts` — mark approved mockup as published/unpublished
    - Validate only approved mockups can be published (no auto-publish on approval)
    - Create `src/modules/exhibition/rebuild.ts` — trigger rebuild, queue if rebuild in progress
    - Upload generated HTML to S3 website bucket
    - Invalidate CloudFront cache after upload
    - Rebuild completes within 5 minutes of publish/unpublish action
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 11.3 Implement Exhibition Lambda handlers
    - Create `src/lambdas/site-publish/handler.ts` — POST /api/products/{mockupId}/publish (JWT required)
    - Create `src/lambdas/site-rebuild/handler.ts` — static site rebuild orchestrator
    - Create `src/lambdas/site-invalidate/handler.ts` — CloudFront cache invalidation
    - _Requirements: 6.1–6.11, 13.5_

  - [x] 11.4 Write property tests for Exhibition Website (Properties 14–15)
    - **Property 14: Publication Filter Invariant** — verify site contains exactly and only products marked "published", only approved mockups can be published
    - **Property 15: Product Page Content Completeness** — verify each published product page has front/back images, name, Age_Group, sizes in both languages
    - **Validates: Requirements 6.1, 6.4, 6.5, 6.9, 6.10**

- [x] 12. Implement WhatsApp Bridge module
  - [ ] 12.1 Implement WhatsApp send service (Lambda → n8n → WAHA)
    - Create `src/modules/whatsapp/send-service.ts`
    - Send mockup images with or without interactive buttons based on approval purpose
    - Send quote details with "Aceptar Cotización" / "Rechazar Cotización" buttons
    - Implement retry logic: 3 attempts with exponential backoff (30s, 60s, 120s)
    - On all retries failed: queue message, notify Admin, fall back to email-only
    - Load WAHA credentials from Secrets Manager
    - _Requirements: 12.1, 12.2, 12.3, 12.6, 12.10_

  - [ ] 12.2 Implement WhatsApp webhook receiver (WAHA → n8n → API Gateway)
    - Create `src/modules/whatsapp/webhook-receiver.ts`
    - Authenticate incoming webhooks with shared secret token
    - Process "Aprobar ✓" — update mockup status to approved
    - Process "Rechazar ✗" — send follow-up for reason, then update to rejected with reason
    - Process "Aceptar Cotización" — update quote status to accepted, notify Admin
    - Process "Rechazar Cotización" — update quote status to rejected, notify Admin
    - _Requirements: 12.4, 12.5, 12.7, 12.8, 12.9_

  - [x] 12.3 Implement delivery logging and Lambda handlers
    - Create `src/modules/whatsapp/delivery-log.ts` — log message type, recipient, timestamp, status, response
    - Create `src/lambdas/wa-send/handler.ts` — POST /api/mockups/{id}/share-whatsapp (JWT required)
    - Create `src/lambdas/wa-receive/handler.ts` — POST /webhooks/whatsapp-response (shared secret auth)
    - Create `src/lambdas/wa-queue/handler.ts` — process queued failed messages
    - _Requirements: 12.11, 12.12, 13.5_

  - [x] 12.4 Write property tests for WhatsApp Bridge (Properties 23–27)
    - **Property 23: WhatsApp Message Button Logic** — verify buttons present only for approval shares, not info-only
    - **Property 24: WhatsApp Quote Message Completeness** — verify message contains product name, price, quantity, AgeGroup, sizes, buttons
    - **Property 25: WhatsApp Webhook Authentication** — verify acceptance only with valid shared secret
    - **Property 26: WhatsApp Retry with Exponential Backoff** — verify 3 retries at 30s/60s/120s, then queue + email fallback
    - **Property 27: WhatsApp Delivery Log Completeness** — verify log entry for every message with all required fields
    - **Validates: Requirements 12.3, 12.6, 12.9, 12.10, 12.11**

- [x] 13. Implement Social Content Generator module
  - [x] 13.1 Implement social media image and caption generation
    - Create `src/modules/social/content-generator.ts`
    - Generate Instagram image: 1080×1080 PNG, 72 DPI, brand overlay (hourglass logo, blue/gold)
    - Generate Facebook image: 1200×630 PNG, 72 DPI, brand overlay
    - Generate Spanish caption: ≤2200 chars, 5–15 hashtags
    - Store all three content types atomically (all-or-nothing) in Admin review queue
    - Trigger automatically on product publish
    - Do NOT auto-post to social media (Admin copies/posts manually)
    - Handle failures: log, notify Admin, allow manual retry, no queue entry on failure
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [ ] 13.2 Implement Social Content Lambda handlers
    - Create `src/lambdas/social-generate/handler.ts` — triggered by publish event
    - Create `src/lambdas/social-brand/handler.ts` — brand overlay application
    - Store generated content in S3 and DynamoDB with `pending_review` status
    - _Requirements: 10.1–10.7, 13.5_

  - [ ] 13.3 Write property test for Social Content Generator (Property 21)
    - **Property 21: Social Content Format Specification** — verify Instagram 1080×1080 72DPI PNG, Facebook 1200×630 72DPI PNG, Spanish caption ≤2200 chars with 5–15 hashtags, brand overlay
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.6**

- [x] 14. Implement Monitoring module (Free Tier tracking)
  - [ ] 14.1 Implement usage monitoring and alerting
    - Create `src/modules/monitoring/usage-tracker.ts`
    - Check S3, Lambda, DynamoDB, API Gateway, CloudFront, SES usage every 6 hours (EventBridge scheduled)
    - Alert Admin at 80% threshold within 10 minutes of detection
    - Disable non-essential operations (social content, new mockups) at 100%
    - Confirm non-essential disabled before maintaining read-only access
    - Maintain read-only Exhibition Website access at 100%
    - _Requirements: 11.8, 11.9, 11.10_

  - [x] 14.2 Implement Monitoring Lambda handlers
    - Create `src/lambdas/monitor-usage/handler.ts` — scheduled usage check
    - Create `src/lambdas/monitor-alert/handler.ts` — alert and degradation handler
    - _Requirements: 11.1–11.10_

  - [x] 14.3 Write property test for Monitoring module (Property 22)
    - **Property 22: Free Tier Threshold Alerting** — verify alert at >80%, disable non-essential at 100% while maintaining read-only access
    - **Validates: Requirements 11.8, 11.10**

- [x] 15. Checkpoint — Exhibition, WhatsApp, Social, Monitoring modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Integration wiring and API Gateway configuration
  - [x] 16.1 Configure API Gateway routes and authorizers
    - Define all REST API routes with appropriate auth (JWT vs public)
    - Protected routes: patterns, mockups, approvals, publish, quotes admin, print, social
    - Public routes: exhibition website, quote submission (CAPTCHA + rate limit), quote status lookup
    - Configure Lambda Authorizer referencing Cognito User Pool
    - Set throttling: 100 req/s per endpoint
    - Configure S3 website bucket with CloudFront OAI (Block Public Access + OAI policy)
    - _Requirements: 11.5, 11.9, 13.1, 13.2, 13.6, 13.9_

  - [x] 16.2 Wire event-driven triggers and cross-module communication
    - Connect product publish event → social content generation Lambda
    - Connect product publish/unpublish → site rebuild pipeline
    - Connect EventBridge schedule (every 6h) → monitoring Lambda
    - Connect WhatsApp webhook → approval/quote status updates
    - Wire SES email notifications across all modules (quote confirm, admin notify, alerts)
    - _Requirements: 6.2, 6.3, 10.4, 11.8, 12.4, 12.12_

  - [x] 16.3 Create infrastructure-as-code (IaC) deployment configuration
    - Define DynamoDB table with PK/SK, GSI-1, GSI-2 in CloudFormation/SAM template
    - Define S3 buckets (assets + website) with policies
    - Define CloudFront distribution with OAI
    - Define Lambda functions with Sharp layer, environment variables
    - Define API Gateway with routes, authorizer, throttling
    - Define Cognito User Pool with password policy
    - Define EventBridge rule for monitoring schedule
    - Define Secrets Manager entries for WAHA/n8n/hCaptcha credentials
    - _Requirements: 11.1–11.10, 13.8, 13.9_

  - [x] 16.4 Write integration tests for end-to-end flows
    - Test pattern → mockup → approval → publish pipeline
    - Test quote submission → pricing → client response flow
    - Test WhatsApp mockup sharing and approval via webhook
    - Test site rebuild triggered by publish/unpublish (with queue)
    - Test Cognito login → JWT → API Gateway → Lambda auth flow
    - _Requirements: All_

- [x] 17. Final checkpoint — Full system integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major module
- Property tests validate universal correctness properties from the design document using fast-check (100+ iterations)
- Unit tests validate specific examples and edge cases
- The tech stack is TypeScript/Node.js 20.x throughout — no language selection needed as the design specifies it
- All Lambda functions share the Sharp layer for image processing
- DynamoDB uses single-table design with composite keys and GSIs for efficient access patterns
- S3 buckets use Block Public Access with CloudFront OAI for the website bucket

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["2.1", "2.2", "6.1", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.5", "6.6"] },
    { "id": 4, "tasks": ["2.6", "2.7", "2.8"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2", "4.3"] },
    { "id": 7, "tasks": ["5.1", "5.2"] },
    { "id": 8, "tasks": ["5.3", "5.4", "6.7"] },
    { "id": 9, "tasks": ["8.1", "9.1", "9.2"] },
    { "id": 10, "tasks": ["8.2", "8.3", "9.3", "8.4", "9.4"] },
    { "id": 11, "tasks": ["11.1", "12.1", "12.2"] },
    { "id": 12, "tasks": ["11.2", "11.3", "12.3", "12.4"] },
    { "id": 13, "tasks": ["11.4", "13.1"] },
    { "id": 14, "tasks": ["13.2", "13.3", "14.1"] },
    { "id": 15, "tasks": ["14.2", "14.3"] },
    { "id": 16, "tasks": ["16.1", "16.2"] },
    { "id": 17, "tasks": ["16.3", "16.4"] }
  ]
}
```
