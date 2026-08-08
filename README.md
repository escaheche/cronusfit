# CronusFit Web Platform

Plataforma automatizada de catálogo y gestión para **CronusFit**, marca de ropa deportiva sublimada. Opera 100% dentro de la capa gratuita de AWS (Free Tier), con costo de infraestructura cero.

---

## 🌐 URLs en producción

| Recurso | URL |
|---------|-----|
| Sitio público | https://d29tumvobv6mdj.cloudfront.net |
| Panel Admin | https://d29tumvobv6mdj.cloudfront.net/admin/ |


**Credenciales Admin:** `cronusfit-admin` / `CronusFit2025!`

---

## 🏗 Arquitectura

```
Clientes (web pública)                Admin (panel /admin/)
        │                                    │
        ▼                                    ▼
   S3 + CloudFront (CDN)           Cognito JWT auth
   Eleventy static site            API Gateway (REST)
        │                                    │
        └──────────── API Gateway ───────────┘
                           │
              ┌────────────┼────────────────────┐
              ▼            ▼                    ▼
           Lambda        Lambda              Lambda
          (Node 20)    (Node 20)           (Node 20)
              │            │                    │
         DynamoDB        S3 (assets)          SES email
         (single-table)
```

### Servicios AWS (Free Tier)

| Servicio | Uso |
|---------|-----|
| Lambda | Todo el cómputo (Node.js 20.x) |
| DynamoDB | Base de datos single-table `CronusFit` |
| S3 | Hosting del sitio + almacenamiento de archivos |
| CloudFront | CDN con OAI (sitio + admin panel) |
| API Gateway | Endpoints REST |
| Cognito | Autenticación Admin (JWT) |
| SES | Notificaciones por email |
| EventBridge | Monitor de uso Free Tier (cada 6h) |

---

## 📁 Estructura del proyecto

```
cronusfit-web/
├── src/                          # TypeScript backend (Lambdas)
│   ├── lambdas/                  # Handlers Lambda (25 funciones)
│   │   ├── pattern-generate/     # POST /api/patterns/generate
│   │   ├── pattern-grade/        # POST /api/patterns/grade
│   │   ├── mockup-generate/      # POST /api/mockups/generate
│   │   ├── approval-process/     # PUT /api/mockups/:id (approve/reject)
│   │   ├── site-publish/         # POST /products/:id/publish|unpublish
│   │   ├── site-rebuild/         # Reconstruye el sitio estático
│   │   ├── quote-submit/         # POST /quotes (público)
│   │   ├── quote-status/         # GET /quotes/:id/status (público)
│   │   ├── social-generate/      # POST /api/social/generate
│   │   ├── monitor-usage/        # EventBridge — Free Tier monitor
│   │   └── ...
│   ├── modules/                  # Lógica de negocio
│   │   ├── pattern/              # SVG generation, grading, templates
│   │   ├── mockup/               # Compositor con Sharp
│   │   ├── social/               # Generador de contenido IG/FB
│   │   ├── exhibition/           # Site builder (Eleventy)
│   │   ├── monitoring/           # Free Tier usage tracker
│   │   └── security/             # Cognito, rate limiter, captcha
│   ├── types/                    # Interfaces TypeScript compartidas
│   ├── db/                       # DynamoDB single-table operations
│   ├── storage/                  # S3 client
│   └── validation/               # Validación de inputs
│
├── admin/                        # Panel Admin (SPA estática)
│   ├── index.html                # Único punto de entrada de la SPA
│   ├── css/
│   │   └── admin.css             # TailwindCSS compilado
│   └── js/
│       ├── app.js                # Bootstrap + init
│       ├── router.js             # Hash Router (#patrones, #cotizaciones, ...)
│       ├── auth.js               # Auth Guard + Cognito SDK wrapper
│       ├── api.js                # HTTP client con JWT
│       ├── toast.js              # Notificaciones toast
│       ├── modal.js              # Modal reutilizable
│       ├── sidebar.js            # Navegación lateral con badges
│       ├── network.js            # Monitor de conectividad
│       └── sections/
│           ├── login.js          # Vista de login
│           ├── patrones.js       # Gestión de patrones SVG
│           ├── cotizaciones.js   # Cotizaciones de clientes
│           ├── mockups.js        # Generación de mockups
│           ├── aprobaciones.js   # Cola de aprobación
│           ├── publicaciones.js  # Publicar en el sitio web
│           └── redes.js          # Contenido para redes sociales
│
├── exhibition-site/              # Sitio público (Eleventy + TailwindCSS)
│   ├── index.html                # Página principal
│   ├── products/                 # Catálogo de productos
│   ├── cotizacion/               # Formulario de cotización
│   ├── estado/                   # Consulta de estado
│   └── i18n/                     # Traducciones (es.json, en.json)
│
├── templates/
│   └── parametric/               # Plantillas de patrones SVG
│       ├── adult/                # Camiseta, short, legging, sudadera, tank-top
│       └── children/             # Mismos tipos para niños (2T-16)
│
├── tests/
│   ├── unit/                     # Tests unitarios (vitest)
│   └── property/                 # Property-based tests (fast-check)
│
├── infrastructure/
│   └── template.yaml             # SAM/CloudFormation template
│
└── scripts/
    ├── build-lambdas.mjs         # Empaqueta Lambdas con esbuild
    └── test-pattern-api.ps1      # Script de prueba de la API
```

---

## 🔄 Flujo del negocio

```
1. Admin genera patrón SVG
   └─► POST /api/patterns/generate (Lambda, Cognito auth)
       └─► SVG almacenado en S3, metadata en DynamoDB

2. Admin publica el patrón en el sitio web
   └─► POST /products/:id/publish (Lambda)
       └─► Rebuild de Eleventy → S3 → CloudFront invalidation

3. Cliente cotiza desde el sitio web
   └─► POST /quotes (público, hCaptcha + rate limiting)
       └─► Notificación email al Admin via SES

4. Admin genera mockup para la cotización
   └─► POST /api/mockups/generate (Lambda, Sharp)
       └─► Imágenes frontal/trasera almacenadas en S3

5. Admin aprueba el mockup
   └─► PUT /api/mockups/:id {status: approved}

6. Admin publica el mockup
   └─► POST /products/:id/publish
       └─► Sitio reconstruido con imágenes del mockup
           └─► Contenido social (IG/FB) generado automáticamente
```

---

## 🛠 Comandos

```bash
# Instalar dependencias
npm install

# Tests
npm test                          # Todos los tests
npm run test:property             # Solo property-based tests

# Build
npm run build                     # Compila TypeScript
npm run build:css                 # CSS del sitio público
npm run build:admin-css           # CSS del panel admin
node scripts/build-lambdas.mjs    # Empaqueta Lambdas con esbuild

# Sitio local
npm run build:site                # Genera el sitio con Eleventy
npx @11ty/eleventy --config=exhibition-site/.eleventy.cjs --serve
# → http://localhost:8080

# Deploy
sam build                         # Empaqueta para SAM
sam deploy --guided               # Deploy a AWS (primera vez)

# Deploy admin panel
npm run deploy:admin              # Build CSS + sync S3 + invalidate CloudFront
```

---

## 🔑 Configuración AWS

### Recursos desplegados

| Recurso | 
|---------|-----------|
| Stack CloudFormation |
| S3 bucket |
| CloudFront Distribution | 
| Cognito User Pool | 
| Cognito App Client |
| DynamoDB tabla | 
| SES email verificado | 
| Región |

### Variables de entorno Lambda

Las Lambdas reciben automáticamente via SAM:


### ⚠️ Pendiente configurar

```bash
# 1. Actualizar hCaptcha en Secrets Manager (para formularios públicos)
aws secretsmanager update-secret \
  --secret-id cronusfit/hcaptcha-secret \
  --secret-string '{"siteKey":"TU_SITE_KEY","secretKey":"TU_SECRET_KEY"}' \
  --region us-east-1

# 2. Rotar Access Key IAM (la credencial usada durante el setup)
# → Ir a IAM > cronusfit-admin > Credenciales de seguridad
# → Eliminar la clave actual y crear una nueva
# → Actualizar: aws configure

# 3. Agregar número WhatsApp real en exhibition-site/index.html
# → Buscar: +56 9 XXXX XXXX
```

---

## 📊 Límites Free Tier monitoreados

El sistema monitorea automáticamente cada 6 horas:

| Servicio | Límite mensual | Alerta | Deshabilitado |
|---------|---------------|--------|---------------|
| Lambda | 1M invocaciones | 80% | 100% |
| S3 GET | 20,000 requests | 80% | 100% |
| S3 PUT | 2,000 requests | 80% | 100% |
| CloudFront | 10M requests | 80% | 100% |
| API Gateway | 1M calls | 80% | 100% |
| DynamoDB | 200M read units | 80% | 100% |
| SES | 62,000 emails | 80% | 100% |

Al alcanzar 100%: se deshabilita generación de mockups y contenido social. El sitio público y datos existentes permanecen accesibles.

---

## 🧪 Tests

```
tests/
├── unit/
│   └── admin/                    # Tests del panel admin
└── property/
    ├── social.property.test.ts   # Property 21: IG/FB 1:1 spec
    ├── exhibition-website.property.test.ts  # Properties 14-15
    ├── usage-threshold.property.test.ts     # Property 22
    └── ...                       # 21 propiedades en total
```

Todos los tests usan **vitest** como runner y **fast-check** para property-based testing.

---

## 🔒 Seguridad

- Todas las APIs Admin requieren JWT de Cognito (`Authorization: Bearer`)
- Formularios públicos protegidos con hCaptcha + rate limiting (5 req/15min)
- S3 con Block Public Access — acceso solo via CloudFront OAI o URLs presignadas
- JWT del panel Admin almacenado en `sessionStorage` (no persiste entre pestañas)
- Content-Security-Policy en CloudFront para `/admin/*`
- Logs de API nunca incluyen el JWT

---

## 📦 Exportación de patrones (local, sin costo)

Los patrones SVG se exportan directamente en el navegador del Admin usando **jsPDF**, sin pasar por Lambda ni S3:

- `Production_PDF` — PDF A4 vectorial 1:1
- `Tiled_PDF` — PDF mosaico para impresoras domésticas (A4/Letter) con página de calibración
- Impresión directa via `window.print()` con escala real

---

*CronusFit © 2026 — San Pedro de la Paz, Biobío, Chile*
