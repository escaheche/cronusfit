# Project Structure

```
cronusfit-web/
├── src/
│   ├── types/                    # Shared TypeScript interfaces
│   │   ├── garment.ts            # GarmentType, AgeGroup, Size types
│   │   ├── pattern.ts            # ParametricTemplate, ControlPoint, GradingIncrementTable
│   │   ├── mockup.ts             # MockupGenerateRequest/Response, PlacementZone
│   │   ├── quote.ts              # QuoteSubmitRequest/Response, QuoteStatus
│   │   ├── print.ts              # DTF/Sublimation request/response types
│   │   ├── whatsapp.ts           # WhatsApp send/receive/delivery types
│   │   └── security.ts           # AuditLogEntry, LoginAttempt, SessionConfig
│   │
│   ├── db/                       # DynamoDB data layer
│   │   ├── client.ts             # DynamoDB Document Client setup
│   │   ├── entities.ts           # Entity record interfaces (single-table)
│   │   └── operations.ts         # CRUD helpers (put, get, query, transact)
│   │
│   ├── storage/                  # S3 service layer
│   │   └── s3-client.ts          # Upload, download, presigned URLs
│   │
│   ├── validation/               # Input validation utilities
│   │   ├── measurements.ts       # Measurement range validation
│   │   ├── files.ts              # Format and size validation
│   │   ├── quote.ts              # Quote field validation
│   │   ├── print.ts              # Print dimension validation
│   │   └── common.ts             # Field-level error builder
│   │
│   ├── modules/                  # Business logic modules
│   │   ├── pattern/
│   │   │   ├── template-engine.ts
│   │   │   ├── custom-template.ts
│   │   │   ├── grading-engine.ts
│   │   │   └── serialization.ts
│   │   ├── mockup/
│   │   │   └── compositor.ts
│   │   ├── approval/
│   │   │   ├── workflow.ts
│   │   │   ├── queue.ts
│   │   │   └── audit.ts
│   │   ├── exhibition/
│   │   │   ├── site-builder.ts
│   │   │   ├── publish.ts
│   │   │   └── rebuild.ts
│   │   ├── quote/
│   │   │   ├── submit.ts
│   │   │   ├── pricing.ts
│   │   │   └── response.ts
│   │   ├── print/
│   │   │   ├── dtf-generator.ts
│   │   │   └── sublimation-generator.ts
│   │   ├── whatsapp/
│   │   │   ├── send-service.ts
│   │   │   ├── webhook-receiver.ts
│   │   │   └── delivery-log.ts
│   │   ├── social/
│   │   │   └── content-generator.ts
│   │   ├── monitoring/
│   │   │   └── usage-tracker.ts
│   │   └── security/
│   │       ├── cognito-auth.ts
│   │       ├── rate-limiter.ts
│   │       ├── public-rate-limiter.ts
│   │       ├── audit-log.ts
│   │       ├── captcha.ts
│   │       └── secrets.ts
│   │
│   └── lambdas/                  # Lambda handler entry points
│       ├── pattern-generate/
│       ├── pattern-grade/
│       ├── pattern-serialize/
│       ├── mockup-generate/
│       ├── approval-process/
│       ├── approval-audit/
│       ├── site-publish/
│       ├── site-rebuild/
│       ├── site-invalidate/
│       ├── quote-submit/
│       ├── quote-process/
│       ├── quote-notify/
│       ├── quote-status/
│       ├── print-dtf/
│       ├── print-sublimation/
│       ├── wa-send/
│       ├── wa-receive/
│       ├── wa-queue/
│       ├── social-generate/
│       ├── social-brand/
│       ├── monitor-usage/
│       ├── monitor-alert/
│       ├── auth-validate/
│       └── audit-write/
│
├── exhibition-site/              # Static exhibition website (Eleventy)
│   ├── index.html
│   ├── products/
│   ├── cotizacion/               # Quote request form
│   ├── estado/                   # Quote status lookup
│   ├── assets/
│   │   ├── css/
│   │   ├── js/
│   │   └── images/
│   ├── i18n/
│   │   ├── es.json
│   │   └── en.json
│   └── favicon.ico
│
├── templates/                    # Parametric pattern templates
│   └── parametric/
│       ├── children/             # Age-group: children (2T–16)
│       └── adult/                # Age-group: adult (XS–6XL)
│
├── tests/                        # Test files
│   ├── unit/
│   └── property/                 # Property-based tests (fast-check)
│
├── infrastructure/               # IaC (SAM/CloudFormation)
│   └── template.yaml
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .kiro/
    ├── specs/                    # Feature specs
    └── steering/                 # Steering documents (this folder)
```

## Architecture Patterns

- **Serverless**: All compute runs on AWS Lambda; no servers to manage
- **Single-table DynamoDB**: One table (`CronusFit`) with composite keys (PK/SK) and GSIs for all access patterns
- **Event-driven**: Publish events trigger site rebuilds and social content generation
- **Module → Lambda mapping**: Business logic lives in `src/modules/`, Lambda handlers in `src/lambdas/` are thin wrappers
- **Shared types**: All interfaces in `src/types/` — imported by both modules and handlers
- **Validation layer**: Centralized in `src/validation/` — reused across all endpoints

## Key Conventions

- Each Lambda handler directory contains a single `handler.ts` file
- Module files contain pure business logic, decoupled from Lambda event structure
- DynamoDB entity keys follow the pattern: `ENTITY#{id}` for PK, `METADATA` or `SUBENTITY#{id}` for SK
- S3 keys follow: `{module}/{entity-id}/{filename}`
- All public endpoints require hCaptcha + IP rate limiting
- All admin endpoints require Cognito JWT authorization
