# Implementation Plan: Exhibition Website

## Overview

This plan implements the CronusFit Exhibition Website — a static site built with Eleventy and TailwindCSS, hosted on S3/CloudFront with OAI, featuring bilingual support (ES/EN), public quote forms protected by hCaptcha and IP rate limiting, an admin publication pipeline, and Free Tier usage monitoring. All code is TypeScript (Node.js 20.x) with property-based tests using fast-check and vitest.

## Tasks

- [x] 1. Set up project structure, shared types, and DynamoDB data layer
  - [x] 1.1 Create shared TypeScript interfaces for the exhibition website
    - Create/extend `src/types/quote.ts` with `QuoteSubmitRequest`, `QuoteSubmitResponse`, `QuoteStatus`, `QuoteStatusResponse`
    - Create/extend `src/types/security.ts` with `RateLimitConfig`, `RateLimitResult`, `CaptchaVerifyRequest`, `CaptchaVerifyResult`
    - Create `src/types/exhibition.ts` with `SiteBuilderConfig`, `BuildResult`, `BuildError`, `PublishAction`, `PublishResult`, `RebuildRequest`, `RebuildQueueConfig`, `RebuildStatus`, `InvalidationRequest`, `InvalidationResult`, `UsageCheck`, `MonitorConfig`, `ServiceLimit`
    - _Requirements: 1.1, 5.1, 6.1, 7.1, 7.2, 8.1, 10.6_

  - [x] 1.2 Create DynamoDB entity interfaces and operations for exhibition entities
    - Add to `src/db/entities.ts`: `RateLimitRecord`, `UsedCaptchaRecord`, `RebuildQueueRecord`, `RebuildStatusRecord`, `PublishedProductRecord`, `QuoteRecord`, `UsageMetricRecord`
    - Add to `src/db/operations.ts`: CRUD helpers for rate limit counters (atomic increment), captcha token store, rebuild queue (enqueue/dequeue), quote records, usage metrics
    - _Requirements: 7.4, 8.6, 9.6, 10.6_

- [x] 2. Implement input validation module
  - [x] 2.1 Implement quote form validation functions
    - Create `src/validation/quote.ts` with validators for: client name (1-100 chars), email (RFC 5322), phone (E.164, 7-15 digits), quantity (1-10000), age group, sizes, customization notes (max 1000 chars)
    - Implement tracking number validation (alphanumeric, 1-36 chars, reject empty/whitespace)
    - Return localized field-level error messages
    - _Requirements: 5.1, 5.6, 6.1, 6.3_

  - [x] 2.2 Implement input sanitization function
    - Create sanitization utility that strips HTML tags and encodes special characters (`<`, `>`, `&`, `"`, `'`) as HTML entities
    - Apply sanitization to all quote form text fields before processing
    - _Requirements: 5.9_

  - [x] 2.3 Write property test for quote form validation (Property 9)
    - **Property 9: Quote form input validation**
    - Test that names outside 1-100 chars are rejected, invalid emails are rejected, phones not matching E.164 are rejected, quantities outside 1-10000 are rejected
    - Use fast-check generators for random strings of varying lengths and formats
    - **Validates: Requirements 5.1, 5.6**

  - [x] 2.4 Write property test for input sanitization (Property 10)
    - **Property 10: Input sanitization strips HTML and encodes specials**
    - Test that output contains zero HTML tags and all special chars are entity-encoded
    - Use fast-check arbitrary strings with injected HTML tags
    - **Validates: Requirements 5.9**

  - [x] 2.5 Write property test for tracking number validation (Property 11)
    - **Property 11: Tracking number validation**
    - Test that empty/whitespace/too-long/non-alphanumeric strings are rejected; valid alphanumeric 1-36 chars accepted
    - **Validates: Requirements 6.1, 6.3**

- [x] 3. Implement Rate Limiter module
  - [x] 3.1 Implement IP extraction from X-Forwarded-For header
    - Create `src/modules/security/public-rate-limiter.ts` with `extractClientIp` function
    - Return rightmost IP when single IP present; leftmost untrusted IP when multiple present
    - Return null for missing/empty header (triggers HTTP 400)
    - _Requirements: 7.5, 7.8_

  - [x] 3.2 Implement rate limit check with DynamoDB atomic counters
    - Implement `checkRateLimit(ip, config)` function using DynamoDB atomic increment on fixed 15-minute windows
    - Store counters with TTL matching window end timestamp
    - Return `RateLimitResult` with allowed/denied status, remaining requests, retry-after seconds
    - Configure: 5 req/15min for quote-submit, 10 req/15min for quote-status
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [x] 3.3 Implement rate limit violation logging
    - Log source IP, endpoint, ISO 8601 timestamp, and request count at time of violation
    - _Requirements: 7.7_

  - [x] 3.4 Write property test for rate limiting enforcement (Property 13)
    - **Property 13: Rate limiting enforcement**
    - For any IP, config (limit N, window W), and M requests: first N allowed, N+1..M denied with correct Retry-After
    - Use fast-check to generate request sequences and timestamps
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 6.9**

  - [x] 3.5 Write property test for IP extraction (Property 14)
    - **Property 14: IP extraction from X-Forwarded-For**
    - Test correct extraction for single IP, multiple IPs, and null for missing/empty header
    - **Validates: Requirements 7.5, 7.8**

  - [x] 3.6 Write property test for violation logging completeness (Property 15)
    - **Property 15: Rate limit violation logging completeness**
    - For any violation event, log entry SHALL contain: IP, endpoint, ISO timestamp, request count
    - **Validates: Requirements 7.7**

- [x] 4. Implement hCaptcha verification module
  - [x] 4.1 Implement server-side hCaptcha token verification
    - Create `src/modules/security/captcha.ts` with `verifyCaptcha(request)` function
    - Retrieve hCaptcha secret from AWS Secrets Manager (cached in Lambda warm start)
    - Call hCaptcha siteverify API with 5-second timeout
    - Return distinct error reasons: missing_token, invalid_token, expired_token, reused_token, service_unavailable
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

  - [x] 4.2 Implement one-time token use enforcement with DynamoDB TTL
    - Store verified token hash (SHA-256) in DynamoDB with 5-minute TTL
    - Check token hash exists before allowing verification
    - Reject previously used tokens with "reused_token" error
    - _Requirements: 8.6_

  - [x] 4.3 Write property test for hCaptcha token rejection reasons (Property 16)
    - **Property 16: hCaptcha token rejection with correct error reason**
    - Test missing → 403 "missing token"; malformed → "invalid token"; expired → "expired token"; reused → "reused token"
    - **Validates: Requirements 8.3, 8.6**

  - [x] 4.4 Write property test for token one-time use (Property 17)
    - **Property 17: hCaptcha token one-time use enforcement**
    - Any valid token verified once SHALL fail on subsequent attempts
    - **Validates: Requirements 8.6**

- [x] 5. Checkpoint - Core security modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement Quote Submit Lambda
  - [x] 6.1 Implement quote-submit Lambda handler
    - Create `src/lambdas/quote-submit/handler.ts`
    - Wire rate limiter check (5 req/15min) → hCaptcha verification → input validation → sanitization → DynamoDB quote record creation
    - Generate tracking number (UUID v4), store quote with status "pending"
    - Store tracking number index record (TRACK#{trackingNumber} → QUOTE) for fast lookup
    - Return 201 with tracking number on success
    - Return appropriate HTTP error codes: 429 (rate limit), 403 (captcha), 400 (validation), 503 (service unavailable)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 7.1, 8.1_

  - [x] 6.2 Write unit tests for quote-submit handler
    - Test successful submission flow with mocked DynamoDB, Secrets Manager, and hCaptcha API
    - Test rate limit exceeded returns 429 with Retry-After
    - Test invalid captcha returns 403
    - Test validation errors return 400 with field-level messages
    - Test Free Tier disabled returns 503
    - _Requirements: 5.4, 5.5, 5.6, 5.8, 7.3, 8.3_

- [x] 7. Implement Quote Status Lambda
  - [x] 7.1 Implement quote-status Lambda handler
    - Create `src/lambdas/quote-status/handler.ts`
    - Wire rate limiter check (10 req/15min) → hCaptcha verification → tracking number validation → DynamoDB lookup by tracking number
    - Return quote status (pending/quoted/accepted/rejected), submission date (ISO 8601), and product name
    - Return 404 if tracking number not found
    - Return appropriate HTTP error codes: 429, 403, 400, 503
    - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.2, 8.2_

  - [x] 7.2 Write unit tests for quote-status handler
    - Test successful status query with mocked DynamoDB
    - Test not-found tracking number returns 404
    - Test rate limit exceeded returns 429
    - Test invalid captcha returns 403
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

  - [x] 7.3 Write property test for date formatting per locale (Property 12)
    - **Property 12: Date formatting per locale**
    - For any valid ISO 8601 date: "es" → DD/MM/YYYY, "en" → MM/DD/YYYY
    - **Validates: Requirements 6.5**

- [x] 8. Implement Publish module and site-publish Lambda
  - [x] 8.1 Implement product publish/unpublish business logic
    - Create `src/modules/exhibition/publish.ts` with `publishProduct` and `unpublishProduct` functions
    - Validate mockup status is "approved" before allowing publish
    - Update product record `publishStatus` in DynamoDB
    - Enqueue rebuild request after successful state change
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.2 Implement site-publish Lambda handler
    - Create `src/lambdas/site-publish/handler.ts`
    - Accept JWT-protected POST from API Gateway (Cognito auth)
    - Call publish module and return result
    - _Requirements: 9.2, 9.3_

  - [x] 8.3 Write property test for publish requires approved mockup (Property 19)
    - **Property 19: Publish requires approved mockup status**
    - For any product with mockup status ≠ "approved", publish SHALL be rejected
    - **Validates: Requirements 9.5**

- [x] 9. Implement Rebuild Queue module and site-rebuild Lambda
  - [x] 9.1 Implement rebuild queue management
    - Create `src/modules/exhibition/rebuild.ts` with `enqueueRebuild` and `processNextRebuild` functions
    - Enforce max queue depth of 10 pending rebuilds
    - Implement 60-second debounce window for sequential processing
    - Store queue entries in DynamoDB with 1-hour TTL
    - _Requirements: 9.6_

  - [x] 9.2 Implement site-rebuild Lambda handler with Eleventy integration
    - Create `src/lambdas/site-rebuild/handler.ts`
    - Fetch all published products from DynamoDB (GSI1: PUBLISHED#true)
    - Invoke Eleventy programmatically to generate static site
    - Process images with sharp (WebP conversion, 80% quality, max 1200px longest side)
    - Upload changed files to S3 (differential sync)
    - Trigger cache invalidation Lambda for updated paths
    - Implement retry logic: retry once after 30s on failure; notify Admin via SES if retry fails
    - Enforce 60-second build timeout
    - _Requirements: 1.1, 1.2, 1.3, 9.7, 9.8_

  - [x] 9.3 Write property test for rebuild queue depth limit (Property 20)
    - **Property 20: Rebuild queue depth limit**
    - For any sequence of rebuild requests in a 60s window, queue accepts max 10; 11th+ rejected
    - **Validates: Requirements 9.6**

  - [x] 9.4 Write property test for image resize (Property 1)
    - **Property 1: Image resize never exceeds maximum dimension**
    - For any input width/height, output longest side ≤ 1200px, aspect ratio preserved ±1px
    - **Validates: Requirements 1.2**

- [x] 10. Implement Cache Invalidation Lambda
  - [x] 10.1 Implement cache invalidation logic with retry
    - Create `src/lambdas/site-invalidate/handler.ts`
    - If ≤15 changed paths: invalidate individual paths; if >15: use wildcard invalidation (/*)
    - Retry up to 3 times with 10-second intervals on failure
    - Notify Admin via SES if all retries fail (stale cache warning)
    - _Requirements: 2.4, 2.7, 9.9_

  - [x] 10.2 Write property test for cache invalidation strategy selection (Property 6)
    - **Property 6: Cache invalidation strategy selection**
    - For any list of changed paths: >15 → wildcard strategy; ≤15 → individual strategy
    - **Validates: Requirements 2.4**

- [x] 11. Checkpoint - Backend pipeline complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Site Builder module with Eleventy templates
  - [x] 12.1 Set up Eleventy project structure and TailwindCSS configuration
    - Configure `exhibition-site/` directory with Eleventy config (`.eleventy.js`)
    - Set up TailwindCSS with PurgeCSS for minified output containing only used classes
    - Configure output directory (`_site`), template formats, and data directory
    - Set up brand identity assets (hourglass logo, blue/gold color palette, favicon)
    - _Requirements: 1.1, 1.3, 4.1_

  - [x] 12.2 Implement home page template with product showcase
    - Create `exhibition-site/index.html` template
    - Display most recently published products ordered by publication date descending
    - Show max 12 products on home page with front mockup image, product name, available sizes
    - Implement empty state message when no products are published
    - Implement responsive grid layout (320px–2560px)
    - _Requirements: 1.4, 4.2, 4.3, 4.8_

  - [x] 12.3 Implement product listing page with client-side filtering
    - Create product listing page template with grid layout
    - Max 50 products per page with pagination controls
    - Implement client-side filtering by Garment_Type and Age_Group (independent or combined)
    - Update displayed products without page reload; show matching product count
    - Implement empty state message for no filter matches
    - Implement lazy loading for product images (viewport + 1 viewport height below)
    - _Requirements: 1.6, 4.2, 4.5, 4.6, 4.7, 4.8_

  - [x] 12.4 Implement product detail page template
    - Create `exhibition-site/products/{product-id}/index.html` template
    - Display front and back mockup images, product name, garment type, age group, available sizes
    - Include "Request Quote" CTA linking to /cotizacion/ pre-filled with product ID
    - Implement branded placeholder image on image load failure
    - _Requirements: 1.5, 4.4, 4.9_

  - [x] 12.5 Implement Site Builder orchestrator function
    - Create `src/modules/exhibition/site-builder.ts` with `buildSite(products)` function
    - Fetch published products from DynamoDB, invoke Eleventy programmatically
    - Process images with sharp (WebP, 80% quality, max 1200px)
    - Track changed paths for differential S3 sync
    - Abort build on malformed product data (preserve previous site)
    - Handle zero-published-products case (generate empty state site)
    - Enforce 60-second build timeout
    - _Requirements: 1.1, 1.2, 1.9, 1.10_

  - [x] 12.6 Write property test for product ordering and pagination (Property 2)
    - **Property 2: Product ordering and pagination**
    - For any set of products with distinct dates: ordered by date descending, max N per page, union of pages = full set
    - **Validates: Requirements 1.4, 4.2**

  - [x] 12.7 Write property test for product detail page completeness (Property 3)
    - **Property 3: Product detail page completeness**
    - For any valid product record, detail page output SHALL contain all required fields
    - **Validates: Requirements 1.5**

  - [x] 12.8 Write property test for client-side product filtering (Property 4)
    - **Property 4: Client-side product filtering correctness**
    - For any products and filter combos, filtered result = exactly matching products, count = length
    - **Validates: Requirements 1.6, 4.5, 4.6**

  - [x] 12.9 Write property test for build abort on malformed data (Property 5)
    - **Property 5: Build abort on malformed product data**
    - For any data set with at least one malformed record, build SHALL fail without output files
    - **Validates: Requirements 1.9**

  - [x] 12.10 Write property test for published-only output (Property 18)
    - **Property 18: Only published products appear in site output**
    - For any mixed-status product set, output SHALL contain only published products
    - **Validates: Requirements 9.1**

- [x] 13. Implement i18n System
  - [x] 13.1 Create translation files and i18n client-side module
    - Create `exhibition-site/i18n/es.json` with all Spanish translations (nav, forms, errors, filters, status)
    - Create `exhibition-site/i18n/en.json` with all English translations (matching every key in es.json)
    - Create `exhibition-site/assets/js/i18n.js` implementing `I18nSystem` interface
    - Default language: Spanish; persist selection in localStorage (key: `cronusfit-lang`)
    - Switch language without page reload (update all `data-i18n` elements within 1 second)
    - Implement `formatDate(iso)`: DD/MM/YYYY for "es", MM/DD/YYYY for "en"
    - Handle translation file load failure: fall back to Spanish, show non-blocking notification
    - Handle missing product translation fields: display Spanish version silently
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 13.2 Implement language switcher component
    - Add visible language switcher in site header/navigation on every page
    - Toggle between Spanish and English
    - Update all interface text, labels, navigation, form fields, buttons, errors, footer, and aria-labels
    - _Requirements: 3.5, 3.9_

  - [x] 13.3 Write property test for translation key parity (Property 7)
    - **Property 7: Translation key parity between languages**
    - For any key in es.json, corresponding key SHALL exist in en.json, and vice versa
    - **Validates: Requirements 3.1, 3.6**

  - [x] 13.4 Write property test for product field language fallback (Property 8)
    - **Property 8: Product field language fallback**
    - For any product with missing English translation, system SHALL return Spanish version without error
    - **Validates: Requirements 3.7**

  - [x] 13.5 Write property test for date formatting per locale (Property 12)
    - **Property 12: Date formatting per locale**
    - For any valid ISO 8601 date: "es" → DD/MM/YYYY, "en" → MM/DD/YYYY
    - **Validates: Requirements 6.5**

- [x] 14. Implement Quote Form and Status Page frontend
  - [x] 14.1 Implement Quote Form page at /cotizacion/
    - Create `exhibition-site/cotizacion/index.html` with all required fields (name, email, phone, product, quantity, age group, sizes, notes)
    - Integrate hCaptcha widget rendering
    - Implement client-side validation with localized field-level error messages
    - Implement form submission via HTTPS POST to Quote API with loading indicator
    - Display success message with tracking number on 201 response
    - Display error messages on failure (preserve form data, no re-entry required)
    - Handle hCaptcha service unavailable (disable submit button, show message)
    - Support product ID pre-fill via URL parameter
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.10, 8.7_

  - [x] 14.2 Implement Quote Status Page at /estado/
    - Create `exhibition-site/estado/index.html` with tracking number input (max 36 chars, alphanumeric)
    - Integrate hCaptcha widget rendering
    - Implement client-side validation (reject empty/whitespace-only input)
    - Display status result: Quote_Status, submission date (locale-formatted), product name
    - Display not-found message for invalid tracking numbers
    - Display error message on API failure (preserve tracking number input)
    - Display rate limit message with remaining seconds
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 8.7_

- [x] 15. Checkpoint - Frontend pages and i18n complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement Usage Monitor Lambda
  - [x] 16.1 Implement usage monitoring logic
    - Create `src/lambdas/monitor-usage/handler.ts` triggered by EventBridge every 5 minutes
    - Query CloudWatch metrics for S3, CloudFront, API Gateway, Lambda, DynamoDB usage
    - Compare current usage against Free Tier monthly limits
    - Store usage metrics in DynamoDB (USAGE#{service}, PERIOD#{YYYY-MM})
    - At 80% threshold: send email alert via SES with service name and percentage
    - At 100% threshold: disable Quote API endpoints, maintain static site access
    - On new billing month (1st of month 00:00 UTC): restore full functionality, reset counters
    - Handle monitoring Lambda failure: notify Admin via SES within 15 minutes of missed check
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10_

  - [x] 16.2 Write property test for usage threshold detection (Property 21)
    - **Property 21: Usage threshold detection and response**
    - For any usage value and limit: ≥80% → alert triggered; ≥100% → API disabled, static site remains
    - Percentage = (currentUsage / freeLimit) × 100, rounded to 2 decimal places
    - **Validates: Requirements 10.6, 10.7, 10.8**

  - [x] 16.3 Write unit tests for usage monitor
    - Test 80% threshold triggers SES notification
    - Test 100% threshold disables API endpoints
    - Test monthly reset restores functionality
    - Test monitoring failure notification
    - _Requirements: 10.7, 10.8, 10.9, 10.10_

- [x] 17. Infrastructure and wiring (SAM/CloudFormation)
  - [x] 17.1 Define S3 bucket and CloudFront distribution with OAI
    - Add to `infrastructure/template.yaml`: private S3 bucket, CloudFront distribution with OAI
    - Configure HTTPS-only (TLS 1.2+), HTTP→HTTPS redirect
    - Set cache TTL: 24h for static assets (CSS, JS, images, fonts, SVG), 1h for HTML
    - Configure custom error responses: 403→404 page, 404→404 page
    - Deny all direct public access to S3 bucket
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

  - [x] 17.2 Define API Gateway endpoints for public quote API
    - Add REST API resource: POST /quotes (quote-submit Lambda)
    - Add REST API resource: GET /quotes/{trackingNumber}/status (quote-status Lambda)
    - Add REST API resource: POST /products/{id}/publish (site-publish Lambda, Cognito authorizer)
    - Add REST API resource: POST /products/{id}/unpublish (site-publish Lambda, Cognito authorizer)
    - _Requirements: 5.4, 6.4, 9.2, 9.3_

  - [x] 17.3 Define Lambda functions and EventBridge rule
    - Add Lambda definitions: site-publish, site-rebuild, site-invalidate, quote-submit, quote-status, monitor-usage
    - Configure Node.js 20.x runtime, appropriate memory/timeout settings
    - Add EventBridge rule: invoke monitor-usage every 5 minutes
    - Configure sharp as Lambda Layer for site-rebuild
    - _Requirements: 1.1, 10.6_

  - [x] 17.4 Define DynamoDB table extensions and Secrets Manager
    - Ensure CronusFit single-table has TTL enabled (for rate limit, captcha, rebuild queue records)
    - Add Secrets Manager secret for hCaptcha site key
    - Configure SES for Admin email notifications
    - _Requirements: 7.4, 8.4, 8.6, 10.7_

- [x] 18. Integration testing and final wiring
  - [x] 18.1 Wire all components end-to-end
    - Ensure site-publish triggers site-rebuild which triggers site-invalidate
    - Ensure quote-submit and quote-status use rate limiter and captcha modules
    - Ensure monitor-usage reads correct metrics and writes to DynamoDB
    - Verify i18n system loads correct translation files from built site
    - _Requirements: 9.2, 9.3, 9.7, 5.4, 6.4, 10.6_

  - [x] 18.2 Write integration tests for complete flows
    - Test full quote submission flow: form → API → rate limit → captcha → DynamoDB (aws-sdk-client-mock)
    - Test full status query flow: tracking number → API → rate limit → captcha → DynamoDB
    - Test site rebuild pipeline: publish → build → S3 upload → CloudFront invalidation
    - Test rate limiter with multi-request sequences crossing window boundaries
    - Test cache invalidation retry behavior on simulated CloudFront failures
    - Test usage monitoring threshold breach → SES notification → API disable
    - _Requirements: 5.4, 6.4, 9.2, 9.7, 7.1, 2.4, 2.7, 10.7, 10.8_

- [x] 19. Final checkpoint - All modules integrated
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at natural break points
- Property tests validate universal correctness properties from the design document (21 properties total)
- Unit and integration tests validate specific examples and edge cases
- All code is TypeScript (strict mode) targeting Node.js 20.x
- Property-based tests use fast-check with minimum 100 iterations
- Test runner: vitest with aws-sdk-client-mock for AWS service mocking
- The i18n Property 12 (date formatting) appears in both task 7.3 and 13.5 — implement in one location, reference from both contexts

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2", "3.1", "12.1"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "3.2", "3.3", "12.2", "13.1"] },
    { "id": 3, "tasks": ["3.4", "3.5", "3.6", "4.1", "12.3", "12.4", "13.2"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "12.5", "13.3", "13.4", "13.5"] },
    { "id": 5, "tasks": ["6.1", "7.1", "8.1", "12.6", "12.7", "12.8", "12.9", "12.10"] },
    { "id": 6, "tasks": ["6.2", "7.2", "7.3", "8.2", "8.3", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4", "14.1", "14.2"] },
    { "id": 8, "tasks": ["10.1", "10.2", "16.1"] },
    { "id": 9, "tasks": ["16.2", "16.3", "17.1", "17.2", "17.3", "17.4"] },
    { "id": 10, "tasks": ["18.1"] },
    { "id": 11, "tasks": ["18.2"] }
  ]
}
```
