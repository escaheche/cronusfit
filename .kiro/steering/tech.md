# Technology Stack

## Runtime & Language

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 20.x (AWS Lambda)
- **Target**: ES2022

## AWS Services (Free Tier only)

| Service | Purpose |
|---------|---------|
| Lambda | All compute (Node.js 20.x) |
| DynamoDB | Data storage (single-table design) |
| S3 | Static hosting + file storage |
| CloudFront | CDN with OAI |
| API Gateway | REST API endpoints |
| Cognito | Admin authentication (JWT) |
| SES | Email notifications |
| Secrets Manager | Credential storage |
| EventBridge | Scheduled monitoring |

## Key Libraries

| Library | Purpose |
|---------|---------|
| `@aws-sdk/client-*` | AWS SDK v3 clients |
| `sharp` | Image processing (Lambda Layer) |
| `svgjs` (SVG.js) | SVG pattern generation |
| `@11ty/eleventy` | Static site generation |
| `tailwindcss` | Frontend styling |
| `fast-check` | Property-based testing |
| `vitest` | Test runner |
| `aws-sdk-client-mock` | AWS SDK mocking for tests |

## External Services

| Service | Purpose |
|---------|---------|
| WAHA (Docker) | WhatsApp HTTP API gateway |
| n8n (Docker) | Workflow orchestration |
| hCaptcha | CAPTCHA for public forms |

## Common Commands

```bash
# Install dependencies
npm install

# Run tests
npx vitest run

# Run tests in watch mode
npx vitest

# Run property-based tests only
npx vitest run --grep "property"

# Type check
npx tsc --noEmit

# Lint
npx eslint .

# Format
npx prettier --write .

# Build (compile TypeScript)
npx tsc

# Deploy (SAM/CloudFormation)
sam build && sam deploy
```

## Code Conventions

- Use AWS SDK v3 (modular imports, not v2)
- All Lambda handlers export a `handler` function conforming to AWS Lambda types
- Use DynamoDB Document Client (`@aws-sdk/lib-dynamodb`) for simplified operations
- Sharp is deployed as a Lambda Layer (compiled for Amazon Linux 2)
- Presigned URLs for all S3 file access (no public buckets except via CloudFront OAI)
- UTC ISO 8601 timestamps throughout
- All measurements in millimeters internally, converted for display
