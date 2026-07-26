# Requirements Document

## Introduction

Este documento especifica los requerimientos para el sitio web de exhibición de CronusFit — un sitio estático público separado del sistema de automatización de catálogo. El sitio web de exhibición tiene su propio ciclo de despliegue, superficie de seguridad (pública vs. admin) y ritmo de cambio, manteniendo un contexto acotado limpio con respecto al sistema de catálogo.

El sitio se construye con Eleventy (@11ty/eleventy) y TailwindCSS, se aloja en S3 con distribución CloudFront (OAI), es bilingüe (español primario, inglés secundario), y muestra productos de ropa deportiva de la marca CronusFit (logo de reloj de arena, identidad azul/dorado). El sitio consume datos de productos del sistema de catálogo pero se despliega de forma independiente.

Toda la infraestructura se mantiene dentro de los límites de AWS Free Tier. Los endpoints públicos están protegidos con hCaptcha y rate limiting por IP.

## Glossary

- **Exhibition_Site**: El sitio web estático público construido con Eleventy que muestra productos aprobados de CronusFit a visitantes externos
- **Site_Builder**: El módulo de Eleventy (@11ty/eleventy) responsable de generar el sitio estático HTML a partir de datos de productos y plantillas
- **Admin**: El propietario de la empresa que controla la publicación de productos y gestiona el contenido del sitio
- **Client**: Un visitante externo del Exhibition_Site que puede navegar productos, solicitar cotizaciones y consultar el estado de sus solicitudes
- **Product_Data**: Los datos de productos aprobados y publicados que el Exhibition_Site consume del sistema de catálogo, incluyendo imágenes de mockup, nombre, tipo de prenda, grupo etario y tallas disponibles
- **Quote_Form**: El formulario público de solicitud de cotización ("Solicitar Cotización") disponible en la página /cotizacion/ del Exhibition_Site
- **Quote_Status_Page**: La página pública en /estado/ donde un Client puede consultar el estado actual de su cotización usando su número de seguimiento
- **Quote_API**: Los endpoints de API Gateway que procesan envíos de cotizaciones y consultas de estado desde el Exhibition_Site
- **CloudFront_Distribution**: La distribución CDN de CloudFront con OAI que sirve el contenido estático del Exhibition_Site desde S3
- **OAI**: Origin Access Identity — identidad especial de CloudFront que permite acceso al bucket S3 privado sin hacerlo público
- **S3_Bucket**: El bucket de S3 privado que almacena los archivos estáticos generados del Exhibition_Site
- **hCaptcha**: Servicio de verificación CAPTCHA utilizado en formularios públicos para distinguir usuarios humanos de bots automatizados
- **Rate_Limiter**: Mecanismo que restringe la cantidad de solicitudes permitidas desde una IP en un período de tiempo definido para prevenir abuso
- **i18n_System**: El sistema de internacionalización que gestiona el contenido bilingüe (español/inglés) mediante archivos de traducción es.json y en.json
- **Site_Rebuild**: El proceso de regenerar todos los archivos estáticos del Exhibition_Site mediante Eleventy cuando el Admin publica o despublica un producto
- **Cache_Invalidation**: El proceso de invalidar la caché de CloudFront después de un Site_Rebuild para que los visitantes vean el contenido actualizado
- **TailwindCSS**: Framework de CSS utilitario utilizado para el diseño responsive y estilizado del Exhibition_Site
- **Brand_Identity**: La identidad visual de CronusFit compuesta por el logo de reloj de arena y la paleta de colores azul/dorado

## Requirements

### Requirement 1: Generación de Sitio Estático con Eleventy

**User Story:** Como Admin, quiero que el sitio de exhibición se genere como un sitio estático con Eleventy, para tener un sitio rápido, seguro y económico de servir que no requiere servidor.

#### Acceptance Criteria

1. THE Site_Builder SHALL generate a complete static HTML site using @11ty/eleventy from Product_Data stored in DynamoDB and template files located in the exhibition-site directory
2. WHEN a Site_Rebuild is triggered, THE Site_Builder SHALL generate all HTML pages, CSS assets, JavaScript assets, and image assets within 60 seconds for up to 100 products, where images are converted to WebP format at 80% quality and resized to a maximum of 1200px on the longest side
3. THE Site_Builder SHALL generate pages utilizando TailwindCSS para estilos, produciendo un archivo CSS final minificado que contenga únicamente las clases utilizadas en el sitio
4. THE Site_Builder SHALL generate a home page (index.html) that displays a product showcase with the most recently published products (ordered by publication date descending), showing a maximum of 12 products on the home page
5. THE Site_Builder SHALL generate individual product detail pages at /products/{product-id}/ for each published product, displaying front and back mockup images, product name, Garment_Type, target Age_Group, available sizes, and a link to the Quote_Form pre-filled with the product identifier
6. THE Site_Builder SHALL generate a product listing page that displays all published products with client-side filtering by Garment_Type and Age_Group
7. THE Site_Builder SHALL generate the Quote_Form page at /cotizacion/ with all required form fields as defined in the quote submission requirements (client name, email, phone number, selected product, quantity, Age_Group, desired sizes, and optional customization notes)
8. THE Site_Builder SHALL generate the Quote_Status_Page at /estado/ with a tracking number input field that allows the Client to query their current Quote_Status
9. IF Product_Data is unavailable or malformed during Site_Rebuild, THEN THE Site_Builder SHALL abort the rebuild, preserve the previously deployed version of the site, and log the error with details of which data was invalid
10. IF zero published products exist when a Site_Rebuild is triggered, THEN THE Site_Builder SHALL generate the site structure with empty product listing and home page displaying a message indicating no products are currently available, without treating this as an error condition

### Requirement 2: Hospedaje en S3 con CloudFront y OAI

**User Story:** Como Admin, quiero que el sitio se aloje en S3 con CloudFront como CDN usando OAI, para servir contenido de forma rápida y segura sin exponer el bucket públicamente.

#### Acceptance Criteria

1. THE Exhibition_Site SHALL be hosted on a private S3_Bucket accessible only through the CloudFront_Distribution via OAI
2. THE CloudFront_Distribution SHALL serve all Exhibition_Site content over HTTPS with TLS 1.2 minimum and SHALL redirect all HTTP requests to HTTPS automatically
3. THE CloudFront_Distribution SHALL configure cache headers with a TTL of 24 hours for static assets (CSS, JS, images, fonts, SVG) and 1 hour for HTML pages
4. WHEN a Site_Rebuild completes successfully, THE Exhibition_Site SHALL trigger a Cache_Invalidation on the CloudFront_Distribution for all updated paths within 2 minutes of rebuild completion; IF the number of updated paths exceeds 15, THEN THE Exhibition_Site SHALL use a wildcard invalidation (/*) instead of individual path invalidations
5. THE S3_Bucket SHALL deny all direct public access; all read access SHALL occur exclusively through CloudFront OAI
6. THE CloudFront_Distribution SHALL configure custom error responses mapping both HTTP 403 and HTTP 404 origin responses to the site's 404 page served with HTTP 404 status code to the client
7. IF Cache_Invalidation fails after a Site_Rebuild, THEN THE Exhibition_Site SHALL retry the invalidation once after 30 seconds; IF the retry also fails, THEN THE Exhibition_Site SHALL notify the Admin via email indicating the failed paths and the error reason

### Requirement 3: Soporte Bilingüe (Español/Inglés)

**User Story:** Como Client, quiero navegar el sitio en español o inglés, para poder entender la información de productos en mi idioma preferido.

#### Acceptance Criteria

1. THE Exhibition_Site SHALL display all interface text, labels, and navigation elements in both Spanish and English using the i18n_System
2. THE i18n_System SHALL load translations from structured JSON files: es.json for Spanish and en.json for English; IF a translation file fails to load or is malformed JSON, THEN THE Exhibition_Site SHALL fall back to Spanish for all interface text and display a non-blocking notification to the Client indicating the selected language is temporarily unavailable
3. THE Exhibition_Site SHALL default to Spanish language for all new visitors who have no language preference stored in browser localStorage
4. WHEN a Client selects a language preference, THE Exhibition_Site SHALL persist the selection in browser localStorage with a key expiration of no less than 30 days and apply the stored preference automatically on subsequent visits without requiring the Client to re-select
5. WHEN a Client switches language, THE Exhibition_Site SHALL update all visible interface text, labels, navigation elements, form field labels, button text, error messages, footer content, and accessibility labels within 1 second without requiring a full page reload
6. THE i18n_System SHALL include translations for all static interface elements including: navigation labels, form field labels, button text, error messages, footer content, and accessibility labels (aria-label attributes); each translation key present in es.json SHALL have a corresponding key in en.json
7. THE Exhibition_Site SHALL display product names and descriptions in the Client's selected language; IF a translation is not available for a specific product field, THEN THE Exhibition_Site SHALL display the Spanish version as fallback without any visible error indicator to the Client
8. THE Site_Builder SHALL generate URL structures that are language-agnostic (same URLs for both languages) with language switching handled client-side via JavaScript
9. THE Exhibition_Site SHALL provide a visible language switcher control accessible from every page, positioned in the site header or navigation area, allowing the Client to toggle between Spanish and English

### Requirement 4: Página Principal y Exhibición de Productos

**User Story:** Como Client, quiero ver una página principal atractiva que muestre los productos destacados de CronusFit, para descubrir rápidamente la oferta de ropa deportiva.

#### Acceptance Criteria

1. THE Exhibition_Site SHALL display the Brand_Identity (hourglass logo in blue/gold tones) in the site header and as favicon
2. THE Exhibition_Site SHALL display published products on the home page with front mockup image, product name, and available sizes, ordered by publication date from newest to oldest, showing a maximum of 50 products per page with pagination controls when more than 50 published products exist
3. THE Exhibition_Site SHALL implement responsive design that renders all content without horizontal overflow, without text truncation that hides information, and without overlapping elements on viewport widths from 320px to 2560px
4. WHEN a Client clicks on a product card, THE Exhibition_Site SHALL navigate to the product detail page showing front and back mockup images, product name, target Age_Group, available sizes (Children_Size and/or Adult_Size as applicable), and a "Request Quote" call-to-action
5. THE Exhibition_Site SHALL display a product listing page with grid layout that supports filtering by Garment_Type and Age_Group independently or in combination
6. WHEN a Client applies filters on the product listing page, THE Exhibition_Site SHALL update the displayed products without a full page reload and show a count of matching products within 2 seconds of filter selection
7. THE Exhibition_Site SHALL implement lazy loading for product images, loading only images within the visible viewport and one viewport height below the current scroll position
8. IF no products match the applied filters or no products are currently published, THEN THE Exhibition_Site SHALL display a descriptive empty state message indicating the reason (no filter matches or no products available) in place of the product grid
9. IF a product image fails to load or is unavailable, THEN THE Exhibition_Site SHALL display a branded placeholder image with the CronusFit logo in place of the missing product image without breaking the page layout

### Requirement 5: Formulario de Solicitud de Cotización con hCaptcha

**User Story:** Como Client, quiero solicitar una cotización para productos que me interesan a través de un formulario protegido, para obtener información de precios de manera segura.

#### Acceptance Criteria

1. THE Quote_Form SHALL collect the following required fields: client name (1-100 characters), email (valid format per RFC 5322), phone number with country code (7-15 digits, WhatsApp-compatible format matching E.164 standard), selected product, desired quantity (1-10000 units), desired Age_Group (children or adult), and desired sizes (one or more from available sizes within the selected Age_Group)
2. THE Quote_Form SHALL collect an optional customization notes field (maximum 1000 characters)
3. THE Quote_Form SHALL integrate hCaptcha verification that the Client must complete before submission; the hCaptcha widget SHALL be rendered within the form and a valid hCaptcha response token SHALL be required as part of the submission payload
4. WHEN a Client submits the Quote_Form with valid data and a verified hCaptcha token, THE Exhibition_Site SHALL send the data to the Quote_API endpoint via HTTPS POST and SHALL display a loading indicator until a response is received or a 30-second timeout elapses
5. WHEN the Quote_API receives a valid submission, THE Quote_API SHALL return a quote tracking number to the Client and display a success confirmation message in the Client's selected language indicating that the quote request was received and including the tracking number for future reference
6. IF the Quote_Form submission fails client-side validation, THEN THE Exhibition_Site SHALL display specific field-level error messages in the Client's selected language indicating which fields are invalid and the expected format
7. IF the hCaptcha verification fails or is not completed, THEN THE Exhibition_Site SHALL prevent form submission and display an error message requesting the Client to complete the CAPTCHA verification
8. IF the Quote_API returns an error response or the request times out after 30 seconds, THEN THE Exhibition_Site SHALL display a non-technical error message in the Client's selected language indicating that the submission could not be processed and suggesting the Client retry, and SHALL preserve all form data entered by the Client so no re-entry is required
9. THE Quote_Form SHALL sanitize all input fields by stripping HTML tags and encoding special characters to prevent XSS attacks before sending data to the Quote_API
10. IF the hCaptcha service fails to load or is unreachable, THEN THE Exhibition_Site SHALL disable the form submit button and display a message in the Client's selected language indicating that the form is temporarily unavailable and suggesting the Client retry after a brief wait

### Requirement 6: Página de Consulta de Estado de Cotización

**User Story:** Como Client, quiero consultar el estado de mi cotización usando mi número de seguimiento, para saber si ya fue procesada y cuál es su estado actual.

#### Acceptance Criteria

1. THE Quote_Status_Page SHALL display a form with a single input field for the quote tracking number, accepting alphanumeric characters with a maximum length of 36 characters
2. THE Quote_Status_Page SHALL integrate hCaptcha verification that the Client must complete before querying
3. IF the Client submits the form with an empty or whitespace-only tracking number field, THEN THE Quote_Status_Page SHALL display a field-level validation error indicating that a tracking number is required, and SHALL NOT send a request to the Quote_API
4. WHEN a Client submits a valid tracking number with verified hCaptcha, THE Exhibition_Site SHALL send the query to the Quote_API status endpoint via HTTPS GET
5. WHEN the Quote_API returns a valid status, THE Quote_Status_Page SHALL display: the current Quote_Status (pending, quoted, accepted, rejected), the submission date in the format appropriate to the Client's selected language (DD/MM/YYYY for Spanish, MM/DD/YYYY for English), and the product name associated with the quote
6. IF the tracking number is not found, THEN THE Quote_Status_Page SHALL display a message indicating that no quote was found with that tracking number
7. IF the hCaptcha verification fails or is not completed, THEN THE Quote_Status_Page SHALL prevent the query and display an error message requesting the Client to complete the CAPTCHA verification
8. IF the Quote_API status endpoint returns an error, THEN THE Quote_Status_Page SHALL display a generic error message and allow the Client to retry the query without requiring the Client to re-enter the tracking number
9. THE Quote_Status_Page SHALL enforce Rate_Limiting of maximum 10 status queries per IP address per 15-minute window; IF the rate limit is exceeded, THEN THE Quote_Status_Page SHALL reject the query and display an error message indicating the Client should try again later

### Requirement 7: Rate Limiting por IP en Endpoints Públicos

**User Story:** Como Admin, quiero que todos los endpoints públicos tengan rate limiting por IP, para prevenir abuso, ataques de fuerza bruta y consumo excesivo de recursos del Free Tier.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL restrict requests to the Quote_API submission endpoint to a maximum of 5 requests per IP address per fixed 15-minute window, where the 6th and subsequent requests within the same window are denied
2. THE Rate_Limiter SHALL restrict requests to the Quote_API status endpoint to a maximum of 10 requests per IP address per fixed 15-minute window, where the 11th and subsequent requests within the same window are denied
3. WHEN a Client exceeds the rate limit for any public endpoint, THE Rate_Limiter SHALL return an HTTP 429 (Too Many Requests) response with a Retry-After header indicating the number of seconds remaining until the current 15-minute window expires
4. THE Rate_Limiter SHALL store rate limit counters in DynamoDB with automatic TTL expiration matching the rate limit window duration
5. THE Rate_Limiter SHALL use the leftmost untrusted IP address from the CloudFront X-Forwarded-For header as the rate limit key, treating the rightmost IP (appended by CloudFront) as the client IP when only one IP is present
6. IF a rate-limited request is received, THEN THE Exhibition_Site SHALL display a localized message in the Client's selected language indicating the number of seconds remaining before they can retry
7. THE Rate_Limiter SHALL log all rate limit violations including: source IP, endpoint, timestamp, and request count at time of violation
8. IF the X-Forwarded-For header is missing or empty, THEN THE Rate_Limiter SHALL reject the request with an HTTP 400 response

### Requirement 8: Seguridad de Endpoints Públicos con hCaptcha

**User Story:** Como Admin, quiero que todos los formularios públicos estén protegidos con hCaptcha, para prevenir envíos automatizados por bots que podrían consumir recursos del sistema.

#### Acceptance Criteria

1. THE Quote_API SHALL validate the hCaptcha token server-side before processing any Quote_Form submission
2. THE Quote_API SHALL validate the hCaptcha token server-side before processing any Quote_Status_Page query
3. IF the Quote_API receives a request with a missing, malformed, or expired hCaptcha token, THEN THE Quote_API SHALL reject the request with HTTP 403 and an error message indicating the reason for rejection (missing token, invalid token, or expired token)
4. THE Quote_API SHALL verify hCaptcha tokens by calling the hCaptcha verification API (https://api.hcaptcha.com/siteverify) with the site secret key stored in AWS Secrets Manager
5. IF the hCaptcha verification API does not respond within 5 seconds or returns a non-success HTTP status, THEN THE Quote_API SHALL reject the request and return an HTTP 503 response indicating temporary unavailability
6. THE Quote_API SHALL reject hCaptcha tokens that have already been used (one-time use enforcement) by storing verified tokens with a 5-minute TTL in DynamoDB; IF a previously used token is submitted, THEN THE Quote_API SHALL return HTTP 403 with an error message indicating the token has already been consumed
7. THE Exhibition_Site SHALL render the hCaptcha widget on the Quote_Form and Quote_Status_Page, and SHALL include the resulting hCaptcha response token in each request submitted to the Quote_API

### Requirement 9: Publicación Manual por el Admin

**User Story:** Como Admin, quiero controlar manualmente cuándo se publican y despublican productos en el sitio de exhibición, para programar lanzamientos de productos a mi criterio.

#### Acceptance Criteria

1. THE Exhibition_Site SHALL display only products explicitly marked as "published" by the Admin
2. WHEN an Admin marks a product as "published", THE Exhibition_Site SHALL trigger a Site_Rebuild followed by Cache_Invalidation, making the product visible in the public catalog within 5 minutes; the product SHALL remain hidden from the public catalog until the Site_Rebuild completes successfully
3. WHEN an Admin marks a product as "unpublished", THE Exhibition_Site SHALL trigger a Site_Rebuild followed by Cache_Invalidation, removing the product from the public catalog within 5 minutes; the product SHALL remain visible in the public catalog until the Site_Rebuild completes successfully
4. THE Exhibition_Site SHALL NOT automatically publish any product — publication requires an explicit Admin action
5. IF an Admin attempts to publish a product that does not have an "approved" mockup status, THEN THE Exhibition_Site SHALL reject the action and display an error message indicating that only approved products can be published
6. WHEN multiple publish or unpublish actions occur within a 60-second window, THE Exhibition_Site SHALL queue Site_Rebuild requests and process them sequentially, with a maximum queue depth of 10 pending rebuilds; IF the queue is full, THEN THE Exhibition_Site SHALL reject the action and notify the Admin to retry after the current rebuilds complete
7. WHEN a Site_Rebuild completes successfully, THE Exhibition_Site SHALL upload the generated static files to S3_Bucket, replacing only the files that changed, and trigger Cache_Invalidation for the updated paths
8. IF a Site_Rebuild fails due to a processing error or resource constraint, THEN THE Exhibition_Site SHALL preserve the previously published site state unchanged, log the failure reason, notify the Admin of the failure, and automatically retry the rebuild once after a 30-second delay; IF the retry also fails, THEN THE Exhibition_Site SHALL mark the rebuild as failed and require the Admin to manually trigger a new rebuild
9. IF Cache_Invalidation fails after a successful Site_Rebuild, THEN THE Exhibition_Site SHALL retry invalidation up to 3 times with 10-second intervals, and IF all retries fail, THEN THE Exhibition_Site SHALL notify the Admin that the site content was updated but cached content may be stale until the next successful invalidation

### Requirement 10: Cumplimiento de AWS Free Tier

**User Story:** Como Admin, quiero que el sitio de exhibición opere dentro de los límites del AWS Free Tier, para no incurrir en costos de infraestructura.

#### Acceptance Criteria

1. THE Exhibition_Site infrastructure SHALL use only the following AWS services within their Free Tier allocation limits: S3, CloudFront, API Gateway, Lambda, DynamoDB, Cognito, SES, Secrets Manager, and EventBridge
2. THE S3_Bucket SHALL operate within 5GB storage and 20,000 GET requests monthly for static site hosting
3. THE CloudFront_Distribution SHALL operate within 1TB data transfer and 10,000,000 requests monthly
4. THE Quote_API SHALL operate within 1,000,000 API Gateway calls and 1,000,000 Lambda invocations monthly
5. THE Rate_Limiter DynamoDB storage SHALL operate within 25GB storage and 25 read/write capacity units
6. WHEN the Exhibition_Site usage monitoring check runs (every 5 minutes via EventBridge), THE Exhibition_Site SHALL compare current usage of S3, CloudFront, API Gateway, Lambda, and DynamoDB against their respective Free Tier monthly limits
7. WHEN any monitored service reaches 80% of its Free Tier monthly limit, THE Exhibition_Site SHALL send an email notification to the Admin via SES within 10 minutes of detection, indicating the service name and current usage percentage
8. IF any AWS service reaches 100% of its Free Tier monthly limit, THEN THE Exhibition_Site SHALL maintain read-only access to the static site (S3 + CloudFront) and disable the Quote_API endpoints to prevent additional charges
9. WHEN a new AWS billing month begins (first day of month at 00:00 UTC), THE Exhibition_Site SHALL automatically restore full functionality including Quote_API endpoints and reset all usage counters
10. IF the monitoring Lambda itself fails to execute, THEN THE Exhibition_Site SHALL notify the Admin via SES within 15 minutes of the missed scheduled check
