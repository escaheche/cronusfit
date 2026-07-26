# Requirements Document

## Introduction

Cronus Fit es una plataforma automatizada de creación de catálogos para una empresa de ropa deportiva (identidad de marca: logo de reloj de arena en tonos azul/dorado). La plataforma automatiza el flujo completo desde la generación de patrones de corte hasta la aprobación de mockups, generación de archivos listos para impresión, publicación web del catálogo y creación de contenido para redes sociales. La plataforma integra comunicación bidireccional por WhatsApp para envío de mockups y cotizaciones a clientes con respuesta interactiva. La infraestructura combina servicios de AWS Free Tier (presupuesto cero) con n8n como orquestador de flujos y WAHA como gateway de WhatsApp, ambos desplegados en la nube.

## Glossary

- **Platform**: El sistema de automatización de catálogo Cronus Fit que comprende todos los módulos descritos en este documento
- **Pattern_Generator**: El módulo responsable de crear patrones de corte SVG usando plantillas paramétricas configurables basadas en imágenes de referencia
- **SVG_Pattern**: Un archivo de gráficos vectoriales escalables que contiene piezas de patrón de corte listas para producción con márgenes de costura, líneas de hilo, piquetes y marcadores de talla
- **Parametric_Template**: Una plantilla base de patrón de corte definida matemáticamente con puntos de control ajustables para generar variaciones de talla y estilo
- **Mockup_Generator**: El módulo responsable de crear representaciones visuales frontal/trasera de prendas con diseños aplicados
- **Mockup**: Una visualización digital que muestra cómo se verá un diseño de prenda en el producto final, incluyendo vistas frontal y trasera
- **Approval_Workflow**: El proceso por el cual un Admin revisa y aprueba o rechaza mockups generados antes de que puedan usarse en el catálogo
- **Admin**: El administrador de la plataforma (propietario de la empresa) que controla todas las decisiones de publicación y aprobaciones
- **Exhibition_Website**: El sitio web estático alojado en S3 con CloudFront que muestra productos aprobados del catálogo a los clientes
- **Client**: Un visitante externo del Exhibition_Website que puede explorar productos y solicitar cotizaciones
- **Quote_Request**: Un formulario enviado por un cliente expresando interés en comprar productos específicos con detalles de cantidad y personalización
- **Quote_Status**: El estado de una cotización dentro de su ciclo de vida: pending (recibida), quoted (cotizada con precio), accepted (aceptada por el cliente), rejected (rechazada por el cliente)
- **DTF_Print_File**: Un archivo listo para impresión formateado para transferencia directa a película (Direct-to-Film), típicamente PNG a 300+ DPI con fondo transparente
- **Sublimation_Print_File**: Un archivo listo para impresión formateado para sublimación, típicamente PNG/TIFF a 300+ DPI con sangrado completo e imagen espejada
- **Social_Content_Generator**: El módulo responsable de auto-generar imágenes y textos para Instagram y Facebook a partir de productos aprobados del catálogo
- **Garment_Type**: Una categoría de prenda de vestir (camiseta, short, legging, sudadera, tank top, o cualquier tipo personalizado)
- **Age_Group**: Clasificación del grupo etario al que pertenece una talla: "children" (niños, tallas 2T a 16) o "adult" (adultos, tallas XS a 6XL)
- **Children_Size**: Tallas para niños a partir de 2 años: 2T, 4T, 6, 8, 10, 12, 14, 16 — basadas en proporciones corporales infantiles (mayor ratio cabeza-cuerpo, extremidades más cortas en relación al torso, cintura más alta relativa al largo total)
- **Adult_Size**: Tallas para adultos: XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL — basadas en proporciones corporales adultas estándar
- **Grading_Increment_Table**: Tabla configurable que define las diferencias de medida (en centímetros) entre tallas consecutivas para cada punto de control; existe una tabla separada para Children_Size y otra para Adult_Size debido a las diferencias proporcionales entre grupos etarios
- **AWS_Free_Tier**: El conjunto de servicios de AWS disponibles sin costo dentro de sus límites de capa gratuita (S3, CloudFront, Lambda, DynamoDB, API Gateway, Cognito, SES, etc.)
- **WAHA**: WhatsApp HTTP API — un gateway de WhatsApp auto-hospedado (contenedor Docker basado en devlikeapro/waha) que expone una API REST para enviar y recibir mensajes de WhatsApp
- **n8n**: Plataforma de automatización de flujos de trabajo (contenedor Docker n8nio/n8n) que orquesta la comunicación entre AWS y WAHA mediante webhooks
- **WhatsApp_Channel**: El canal de comunicación bidireccional por WhatsApp que permite enviar mockups y cotizaciones a clientes y recibir respuestas interactivas (aprobar/rechazar)
- **JWT_Token**: JSON Web Token emitido por AWS Cognito tras una autenticación exitosa, utilizado para autorizar solicitudes a los endpoints protegidos de la API
- **Cognito_User_Pool**: El servicio de AWS Cognito que gestiona la identidad, autenticación y sesiones de los usuarios Admin de la plataforma
- **Admin_Session**: Una sesión autenticada de un Admin en la interfaz de administración, sujeta a expiración por inactividad configurable
- **Audit_Log**: Registro cronológico e inmutable de todas las acciones administrativas realizadas en la plataforma, incluyendo identidad del Admin, timestamp, tipo de acción y recurso afectado
- **OAI**: Origin Access Identity — una identidad especial de CloudFront que permite acceder a objetos en un bucket S3 privado sin hacer el bucket público
- **Rate_Limiting**: Mecanismo de control que restringe la cantidad de solicitudes permitidas desde una fuente (IP) en un período de tiempo definido para prevenir abuso
- **CAPTCHA**: Challenge-response test utilizado para distinguir usuarios humanos de bots automatizados, aplicado en formularios públicos para prevenir spam

## Requirements

### Requirement 1: Generación de Patrones Basada en Plantillas Paramétricas

**User Story:** Como Admin, quiero seleccionar un tipo de prenda y ajustar parámetros a partir de una imagen de referencia, para obtener patrones de corte SVG listos para producción sin necesidad de dibujar manualmente.

#### Acceptance Criteria

1. WHEN an Admin selects a Garment_Type and provides measurements, THE Pattern_Generator SHALL generate an SVG_Pattern from the corresponding Parametric_Template within 10 seconds
2. WHEN an Admin uploads a reference image alongside a Garment_Type selection, THE Pattern_Generator SHALL display the image as visual reference while the Admin adjusts template parameters, accepting only JPEG or PNG formats with a maximum file size of 10MB
3. WHEN an SVG_Pattern is generated, THE Pattern_Generator SHALL include seam allowances of configurable width between 0.5cm and 3.0cm (default 1.5cm) on all pattern pieces
4. WHEN an SVG_Pattern is generated, THE Pattern_Generator SHALL include grain line indicators on each pattern piece
5. WHEN an SVG_Pattern is generated, THE Pattern_Generator SHALL include alignment notches at joining edges between pattern pieces
6. WHEN an SVG_Pattern is generated, THE Pattern_Generator SHALL label each pattern piece with its name, size, and cut quantity
7. THE Pattern_Generator SHALL provide Parametric_Templates for all standard Garment_Types: camiseta, short, legging, sudadera, and tank top
8. THE Pattern_Generator SHALL provide age-group-aware Parametric_Templates for each standard Garment_Type, with separate base templates for Children_Size and Adult_Size that reflect the anatomical proportions specific to each Age_Group
9. WHEN an Admin requests a custom Garment_Type, THE Pattern_Generator SHALL allow the Admin to create a new Parametric_Template by defining a minimum of 4 control points and their associated measurements, and SHALL require the Admin to specify the target Age_Group for the template
10. THE Pattern_Generator SHALL produce SVG files where each pattern piece is a separate grouped element with a unique identifier, using millimeters as the coordinate unit for real-scale production output
11. IF required measurements are missing or outside valid ranges (1cm to 200cm per individual measurement), THEN THE Pattern_Generator SHALL block pattern generation entirely and display specific validation errors indicating which measurements are invalid and their acceptable range, requiring the Admin to correct all invalid measurements before generation can proceed
12. IF SVG_Pattern generation fails due to a processing error or an unavailable Parametric_Template, THEN THE Pattern_Generator SHALL display an error message indicating the cause of failure and preserve any measurements already entered by the Admin

### Requirement 2: Escalado de Patrones por Tallas (Adultos y Niños)

**User Story:** Como Admin, quiero generar patrones en múltiples tallas tanto para adultos como para niños a partir de un patrón base, para ofrecer un rango completo de tallas sin crear cada una individualmente.

#### Acceptance Criteria

1. WHEN an Admin selects an Age_Group and a size range (one or more sizes from Children_Size: 2T, 4T, 6, 8, 10, 12, 14, 16 or Adult_Size: XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL) for a generated pattern, THE Pattern_Generator SHALL produce graded SVG_Patterns for each selected size within 30 seconds for the complete set
2. THE Pattern_Generator SHALL maintain separate Grading_Increment_Tables for Children_Size and Adult_Size, each defining the measurement difference (in centimeters) between consecutive sizes for each control point of the Parametric_Template
3. WHEN grading is applied for Children_Size, THE Pattern_Generator SHALL use the children's Grading_Increment_Table and adjust body proportions specific to children's anatomy (larger head-to-body ratio, shorter limbs relative to torso, higher waist position relative to total length, narrower shoulders relative to hip width) rather than linearly scaling adult patterns
4. WHEN grading is applied for Adult_Size, THE Pattern_Generator SHALL use the adult Grading_Increment_Table and scale each pattern piece according to adult proportion increments while maintaining the relative proportions between width and length measurements
5. WHEN grading is applied, THE Pattern_Generator SHALL preserve on each graded size the same count of notches, grain lines, and labels as the base pattern, positioned at the same relative location (proportional to piece dimensions) as in the original
6. THE Pattern_Generator SHALL output each size as a separate SVG file or as labeled layers within a single SVG file, based on Admin preference
7. IF the Pattern_Generator cannot apply grading to a base pattern due to any reason (including but not limited to missing increment table for the selected Age_Group, invalid base pattern geometry, time limits, or resource constraints), THEN THE Pattern_Generator SHALL display an error message indicating the specific reason grading failed, SHALL not produce any partial output, and SHALL clean up any partial output that may have been generated before the failure was detected
8. WHEN an Admin configures a Grading_Increment_Table, THE Pattern_Generator SHALL validate that all increment values are positive numbers between 0.1cm and 10cm per size step, and that the table contains entries for all consecutive size transitions within the selected Age_Group

### Requirement 3: Serialización y Deserialización de Patrones SVG

**User Story:** Como desarrollador, quiero que los patrones se serialicen y deserialicen de forma confiable, para poder almacenarlos, recuperarlos y modificarlos sin pérdida de datos.

#### Acceptance Criteria

1. THE Pattern_Generator SHALL serialize SVG_Pattern data into a JSON representation that preserves all pattern piece geometries, control points, seam allowances, grain lines, notches, labels, and metadata, with each serialized item not exceeding the DynamoDB 400KB item size limit
2. WHEN stored JSON is deserialized, THE Pattern_Generator SHALL produce an SVG_Pattern file that passes SVG 1.1 schema validation and contains all pattern pieces, attributes, and metadata present in the original SVG_Pattern; IF the resulting SVG would fail schema validation, THEN deserialization SHALL fail and return an error rather than producing an invalid SVG_Pattern
3. THE Pattern_Generator SHALL guarantee that serializing an SVG_Pattern, deserializing the resulting JSON, and re-serializing the output produces a JSON representation with identical keys, values, and structure (byte-equivalent after key-order normalization)
4. WHEN an SVG_Pattern is deserialized from storage, THE Pattern_Generator SHALL produce an SVG file where all pattern piece geometries, dimensions, and positions match the original within a tolerance of 0.01mm; IF the deserialized pattern pieces have correct positions but incorrect dimensions (outside 0.01mm tolerance), THEN deserialization SHALL be considered failed and SHALL return an error
5. IF stored JSON is malformed or contains missing required fields during deserialization, THEN THE Pattern_Generator SHALL reject the input without producing a partial SVG_Pattern and SHALL return an error indication specifying which fields are invalid or missing

### Requirement 4: Generación de Mockups

**User Story:** Como Admin, quiero generar mockups frontales y traseros de prendas con diseños aplicados, para previsualizar productos antes de ofrecerlos a los clientes.

#### Acceptance Criteria

1. WHEN an Admin requests a mockup for an approved SVG_Pattern, THE Mockup_Generator SHALL produce a front-view PNG image and a back-view PNG image of the garment within 30 seconds
2. WHEN an Admin provides a design graphic in PNG, JPEG, or SVG format, THE Mockup_Generator SHALL apply the design onto the mockup in the placement area selected by the Admin from predefined zones (chest, full-front, full-back, left-sleeve, right-sleeve)
3. THE Mockup_Generator SHALL render mockups at a minimum resolution of 1200x1600 pixels in PNG format with transparent background
4. WHEN a mockup is generated, THE Mockup_Generator SHALL store the mockup with status "pending_approval" in the system as an atomic operation; IF storage fails, THEN the mockup generation SHALL be considered incomplete, no mockup object or status SHALL be created in memory, and the Admin SHALL be notified of the failure
5. THE Mockup_Generator SHALL support applying designs to all standard Garment_Types: camiseta, short, legging, sudadera, and tank top
6. IF the Admin provides a design graphic in an unsupported format or exceeding 10MB in file size, THEN THE Mockup_Generator SHALL reject the request and display an error message indicating the accepted formats and maximum file size
7. IF the design graphic dimensions exceed the selected placement area boundaries, THEN THE Mockup_Generator SHALL scale the design proportionally to fit within the placement area and notify the Admin of the applied scaling percentage; IF no scaling is applied, THEN no notification SHALL be sent

### Requirement 5: Flujo de Aprobación de Mockups

**User Story:** Como Admin, quiero aprobar o rechazar mockups generados antes de que estén disponibles para el catálogo, para que solo productos de calidad aprobada se muestren a los clientes.

#### Acceptance Criteria

1. WHEN a Mockup is generated, THE Approval_Workflow SHALL set the mockup status to "pending_approval"
2. WHEN an Admin approves a Mockup, THE Approval_Workflow SHALL update the mockup status to "approved" and record the approval timestamp
3. WHEN an Admin rejects a Mockup, THE Approval_Workflow SHALL require the Admin to provide a rejection reason between 1 and 500 characters in length before allowing rejection, and SHALL update the mockup status to "rejected" and store the provided reason; IF the audit trail recording for the rejection fails, THEN the entire rejection operation SHALL be prevented and the Admin SHALL be notified of the failure
4. IF a Mockup does not have status "approved", THEN THE Approval_Workflow SHALL prevent the mockup from being selected for publication on the Exhibition_Website catalog
5. WHILE a Mockup has status "pending_approval", THE Approval_Workflow SHALL display the mockup in the Admin review queue ordered by generation date from oldest to newest
6. THE Approval_Workflow SHALL maintain an audit trail of all approval and rejection actions recording: action type (approved/rejected), mockup identifier, Admin identity, timestamp, and rejection reason if applicable
7. IF an Admin attempts to approve or reject a Mockup that does not have status "pending_approval", THEN THE Approval_Workflow SHALL reject the action, display an error message indicating the mockup is not in a reviewable state, and log the invalid attempt in the audit trail recording: action attempted, mockup identifier, Admin identity, and timestamp

### Requirement 6: Sitio Web de Exhibición con Control Manual de Publicación

**User Story:** Como Admin, quiero controlar manualmente cuándo se publican los productos aprobados en el sitio web de exhibición, para poder programar revelaciones de productos como sorpresas para los clientes.

#### Acceptance Criteria

1. THE Exhibition_Website SHALL display only products that have been explicitly marked as "published" by the Admin
2. WHEN an Admin marks an approved Mockup as "published", THE Exhibition_Website SHALL trigger a static site rebuild and include the product in the public catalog within 5 minutes of the publish action; the product SHALL remain hidden from the public catalog until the rebuild completes successfully; IF a rebuild is already in progress from a previous action, THEN the new rebuild request SHALL be queued and processed after the current rebuild completes
3. WHEN an Admin marks a product as "unpublished", THE Exhibition_Website SHALL trigger a static site rebuild and remove the product from the public catalog within 5 minutes of the unpublish action; the product SHALL remain visible until the rebuild completes successfully; IF a rebuild is already in progress from a previous action, THEN the new rebuild request SHALL be queued and processed after the current rebuild completes
4. THE Exhibition_Website SHALL NOT automatically publish any product upon approval — publication requires a separate explicit Admin action
5. IF an Admin attempts to mark a Mockup as "published" and the Mockup does not have status "approved", THEN THE Exhibition_Website SHALL reject the action and display an error message indicating that only approved mockups can be published
6. THE Exhibition_Website SHALL be hosted as a static site on S3 with CloudFront distribution
7. THE Exhibition_Website SHALL implement responsive design that renders correctly on viewport widths from 320px to 2560px
8. THE Exhibition_Website SHALL display the Cronus Fit brand identity (hourglass logo in blue/gold tones) in the header and favicon
9. THE Exhibition_Website SHALL display each published product with its front and back mockup images, product name, target Age_Group, and available sizes (Children_Size and/or Adult_Size as applicable)
10. THE Exhibition_Website SHALL support bilingual content display in Spanish and English, with language selection available to the Client
11. THE Exhibition_Website SHALL default to Spanish language and persist the Client language preference in browser local storage for a minimum of 30 days

### Requirement 7: Sistema de Solicitud de Cotizaciones con Seguimiento

**User Story:** Como Client, quiero solicitar cotizaciones para productos que me interesan y poder seguir el estado de mis solicitudes, para obtener información de precios para posibles pedidos.

#### Acceptance Criteria

1. WHEN a Client views a published product, THE Exhibition_Website SHALL display a "Request Quote" / "Solicitar Cotización" action
2. WHEN a Client submits a Quote_Request, THE Exhibition_Website SHALL collect: client name (1-100 characters), email (valid format), phone number with country code (7-15 digits, WhatsApp-compatible format), selected product, desired quantity (1-10000 units), desired Age_Group (children or adult), desired sizes (one or more from available sizes within the selected Age_Group: Children_Size 2T, 4T, 6, 8, 10, 12, 14, 16 or Adult_Size XS, S, M, L, XL, XXL, 3XL, 4XL, 5XL, 6XL), and optional customization notes (max 1000 characters)
3. WHEN a Quote_Request is submitted, THE Platform SHALL validate that all required fields are present, that the email format is valid, and that quantity is a positive integer within range
4. WHEN a valid Quote_Request is submitted, THE Platform SHALL store the request with Quote_Status "pending" and send a confirmation email to the Client via AWS SES within 60 seconds; IF the email service experiences delays beyond 60 seconds, THE Platform SHALL still accept and store the quote request and deliver the confirmation email when the service recovers
5. WHEN a Quote_Request is received, THE Platform SHALL notify the Admin via email with the complete request details
6. IF a Quote_Request submission fails validation, THEN THE Exhibition_Website SHALL display specific field-level error messages to the Client indicating which fields are invalid and why
7. WHEN an Admin updates a Quote_Request with pricing information, THE Platform SHALL change the Quote_Status to "quoted" and send the Client an email containing a unique link to view and respond to the quote, and simultaneously send the quote details via WhatsApp_Channel to the Client phone number
8. WHEN a Client clicks the unique quote link and selects "accept", THE Platform SHALL update the Quote_Status to "accepted" only after successfully sending the Admin notification email; IF Admin notification fails, THEN the status update SHALL not be committed and THE Platform SHALL retry Admin notification with exponential backoff before allowing eventual consistency
9. WHEN a Client clicks the unique quote link and selects "reject", THE Platform SHALL update the Quote_Status to "rejected" only after successfully sending the Admin notification email; IF Admin notification fails, THEN the status update SHALL not be committed and THE Platform SHALL retry Admin notification with exponential backoff before allowing eventual consistency
10. THE Platform SHALL allow the Admin to view all Quote_Requests filtered by Quote_Status
11. WHEN a Client submits a Quote_Request, THE Platform SHALL provide the Client with a quote tracking number that the Client can use to check the current Quote_Status via a status lookup page on the Exhibition_Website

### Requirement 8: Generación de Archivos Listos para Impresión DTF

**User Story:** Como Admin, quiero generar archivos listos para impresión formateados para DTF, para poder enviar diseños directamente a la impresora DTF sin preparación manual de archivos.

#### Acceptance Criteria

1. WHEN an Admin selects DTF as the printing method for an approved design, THE Platform SHALL generate a DTF_Print_File within 30 seconds
2. THE Platform SHALL generate DTF_Print_Files as PNG images at minimum 300 DPI resolution with transparent background
3. THE Platform SHALL generate DTF_Print_Files with colors in CMYK color space
4. WHEN a DTF_Print_File is generated, THE Platform SHALL include a white ink underbase layer as a separate PNG file at the same DPI and dimensions as the main design file
5. WHEN an Admin specifies print area dimensions for a DTF_Print_File, THE Platform SHALL validate that width and height are between 10mm and 500mm per side, and size the output file to match those exact dimensions in millimeters
6. IF DTF_Print_File generation fails due to any reason (including but not limited to insufficient source image resolution below 300 DPI at target print size, processing error, or resource constraints), THEN THE Platform SHALL display an error message indicating the failure reason, preserve the original approved design unchanged, and prevent any file download for the failed generation
7. WHEN a DTF_Print_File is successfully generated, THE Platform SHALL make the file available for immediate download by the Admin through the admin interface

### Requirement 9: Generación de Archivos Listos para Impresión por Sublimación

**User Story:** Como Admin, quiero generar archivos listos para impresión formateados para sublimación, para poder enviar diseños directamente a la impresora de sublimación sin preparación manual de archivos.

#### Acceptance Criteria

1. WHEN an Admin selects sublimation as the printing method for an approved design, THE Platform SHALL generate a Sublimation_Print_File within 30 seconds
2. THE Platform SHALL generate Sublimation_Print_Files as PNG images at 300 DPI resolution with full-bleed (3mm bleed on all edges)
3. THE Platform SHALL generate Sublimation_Print_Files with the image horizontally mirrored for transfer application
4. THE Platform SHALL apply color correction adjustments to Sublimation_Print_Files by increasing color saturation by 15% to compensate for sublimation ink transfer loss on polyester fabrics
5. WHEN an Admin specifies print area dimensions for a Sublimation_Print_File, THE Platform SHALL validate that width and height are between 1cm and 150cm regardless of the current operational context, and size the output file to match those exact dimensions (excluding the 3mm bleed added per criterion 2)
6. IF Sublimation_Print_File generation fails due to insufficient source image resolution (below 300 DPI at target print size) or processing error, THEN THE Platform SHALL display an error message indicating the failure reason and preserve the original approved design unchanged
7. WHEN a Sublimation_Print_File is successfully generated, THE Platform SHALL display a success confirmation message to the Admin indicating the file is ready for download

### Requirement 10: Auto-Generación de Contenido para Redes Sociales

**User Story:** Como Admin, quiero que la plataforma auto-genere contenido para redes sociales desde productos aprobados, para mantener una presencia online activa sin dedicar tiempo a la creación de contenido.

#### Acceptance Criteria

1. WHEN a product is marked as "published", THE Social_Content_Generator SHALL generate an Instagram post image (1080x1080 pixels) in PNG format at 72 DPI featuring the product mockup with Cronus Fit branding within 30 seconds
2. WHEN a product is marked as "published", THE Social_Content_Generator SHALL generate a Facebook post image (1200x630 pixels) in PNG format at 72 DPI featuring the product mockup with Cronus Fit branding within 30 seconds
3. WHEN a product is marked as "published", THE Social_Content_Generator SHALL generate a suggested caption text in Spanish of maximum 2200 characters including between 5 and 15 relevant hashtags
4. THE Social_Content_Generator SHALL store generated content in the Admin review queue only after all content types (Instagram image, Facebook image, and caption text) have been successfully generated
5. THE Social_Content_Generator SHALL NOT automatically post content to social media — the Admin copies and posts manually
6. WHEN generating content successfully, THE Social_Content_Generator SHALL apply the Cronus Fit brand identity (hourglass logo, blue/gold color scheme as defined in brand assets) as an overlay on all generated images; IF content generation is failing due to processing errors, THEN branding overlay application SHALL be skipped
7. IF Social_Content_Generator fails to generate content for a published product due to missing mockup images or processing error, THEN THE Platform SHALL log the failure, notify the Admin, allow the Admin to retry generation manually, and SHALL NOT create a queue entry for the failed generation

### Requirement 11: Cumplimiento de Infraestructura AWS Free Tier

**User Story:** Como propietario de la empresa, quiero que toda la plataforma funcione dentro de los límites de AWS Free Tier, para no incurrir en costos de infraestructura.

#### Acceptance Criteria

1. THE Platform SHALL use only AWS services within their Free Tier allocation limits
2. THE Platform SHALL use S3 for static website hosting and file storage (within 5GB storage, 20,000 GET, 2,000 PUT monthly limits)
3. THE Platform SHALL use Lambda for all compute operations (within 1 million requests and 400,000 GB-seconds monthly)
4. THE Platform SHALL use DynamoDB for data storage (within 25GB storage, 25 read capacity units, 25 write capacity units)
5. THE Platform SHALL use API Gateway for REST API endpoints (within 1 million API calls monthly)
6. THE Platform SHALL use CloudFront for content delivery (within 1TB data transfer, 10 million requests monthly)
7. THE Platform SHALL use SES for email notifications (within 62,000 outbound emails monthly when sent from Lambda)
8. THE Platform SHALL check Free Tier usage metrics every 6 hours, and IF the monitoring system detects that any AWS service exceeds 80% of its monthly Free Tier limit, THEN THE Platform SHALL send an alert email to the Admin within 10 minutes of detection regardless of whether visible usage metrics appear normal
9. THE Platform SHALL implement request throttling at the API Gateway level, limiting requests to 100 per second per endpoint, to prevent exceeding Free Tier limits under unexpected traffic spikes
10. IF any AWS service reaches 100% of its Free Tier monthly limit, THEN THE Platform SHALL disable non-essential operations (social content generation, new mockup generation) and SHALL maintain read-only access to the Exhibition_Website and existing data only after confirming that non-essential operations have been successfully disabled

### Requirement 12: Integración de WhatsApp para Mockups y Cotizaciones

**User Story:** Como Admin, quiero enviar mockups y cotizaciones a los clientes por WhatsApp y que ellos puedan aprobar o rechazar directamente desde el chat, para agilizar la comunicación usando el canal preferido de mis clientes.

#### Acceptance Criteria

1. THE Platform SHALL integrate WAHA as the WhatsApp gateway and n8n as the workflow orchestrator, both deployed as cloud-hosted containers accessible via HTTPS endpoints
2. WHEN a Mockup reaches status "pending_approval" and the Admin opts to share it with a Client, THE WhatsApp_Channel SHALL send the mockup images (front and back views) to the Client WhatsApp number within 60 seconds via n8n triggering the WAHA API
3. WHEN the WhatsApp_Channel sends a mockup to a Client for pending approval, THE message SHALL include interactive reply buttons labeled "Aprobar ✓" and "Rechazar ✗" that the Client can tap to respond; messages shared for informational purposes only SHALL NOT include interactive reply buttons
4. WHEN a Client taps "Aprobar ✓" in WhatsApp, THE Platform SHALL process the response via WAHA webhook → n8n workflow → AWS API Gateway, and update the mockup approval status accordingly
5. WHEN a Client taps "Rechazar ✗" in WhatsApp, THE Platform SHALL send a follow-up message requesting a brief rejection reason, and upon receiving the text response SHALL update the mockup status to "rejected" with the provided reason
6. WHEN a Quote_Request reaches Quote_Status "quoted", THE WhatsApp_Channel SHALL send the Client a message containing: product name, quoted price, quantity, Age_Group, available sizes (from Children_Size or Adult_Size as applicable), and interactive buttons "Aceptar Cotización" and "Rechazar Cotización"
7. WHEN a Client taps "Aceptar Cotización" in WhatsApp, THE Platform SHALL update the Quote_Status to "accepted" and notify the Admin via email and WhatsApp
8. WHEN a Client taps "Rechazar Cotización" in WhatsApp, THE Platform SHALL update the Quote_Status to "rejected" and notify the Admin via email and WhatsApp
9. THE WhatsApp_Channel SHALL authenticate all incoming webhook messages from WAHA using a shared secret token to prevent unauthorized status updates
10. IF the WAHA service or n8n is unavailable when a WhatsApp message needs to be sent, THEN THE Platform SHALL queue the message and retry delivery up to 3 times with exponential backoff (30s, 60s, 120s), and IF all retries fail, SHALL keep the message in the queue, notify the Admin, and fall back to email-only delivery
11. THE WhatsApp_Channel SHALL maintain a delivery log recording: message type (mockup/quote), recipient phone number, delivery timestamp, delivery status (sent/delivered/read/failed), and Client response if applicable
12. THE n8n workflow SHALL expose a webhook endpoint that AWS Lambda invokes to trigger WhatsApp messages, and SHALL forward Client responses back to AWS API Gateway for processing

### Requirement 13: Seguridad y Control de Acceso Administrativo

**User Story:** Como propietario de la empresa, quiero que solo administradores autenticados puedan acceder a la plataforma y realizar operaciones, para prevenir accesos no autorizados y proteger la integridad de los datos y procesos del catálogo.

#### Acceptance Criteria

1. THE Platform SHALL require all Admin users to authenticate via Cognito_User_Pool before accessing the admin interface or performing any platform operation (pattern generation, mockup creation, approvals, publishing, quote management, print file generation, social content generation)
2. WHEN a request is made to any API endpoint (except Exhibition_Website read-only endpoints and quote submission/status lookup), THE Platform SHALL validate that the request includes a valid JWT_Token issued by the Cognito_User_Pool; IF the token is missing, expired, or invalid, THEN THE Platform SHALL reject the request with HTTP 401 status and SHALL NOT execute the requested operation
3. WHILE an Admin_Session is active, THE Platform SHALL track the time elapsed since the last Admin interaction; WHEN the inactivity period exceeds the configured timeout (default 30 minutes, configurable between 5 and 120 minutes), THE Platform SHALL invalidate the Admin_Session and require re-authentication
4. WHEN a login attempt fails, THE Platform SHALL record the attempt associated with the originating IP address; IF 5 failed login attempts occur from the same IP address within a 15-minute window, THEN THE Platform SHALL temporarily block further login attempts from that IP for 15 minutes and log the lockout event
5. WHEN an Admin performs any action on the Platform, THE Audit_Log SHALL record the Admin identity, timestamp (UTC ISO 8601 format), action type, and affected resource identifier within 5 seconds of action completion; IF Audit_Log recording fails, THEN THE Platform SHALL still complete the Admin action but SHALL queue the audit entry for retry and notify the Admin of the logging delay
6. THE Exhibition_Website public read-only endpoints and the quote status lookup endpoint SHALL be accessible without authentication and SHALL NOT require a JWT_Token
7. WHEN a Client submits a Quote_Request via the public form (POST), THE Platform SHALL require successful CAPTCHA verification before processing the submission; THE Platform SHALL enforce Rate_Limiting of maximum 10 quote submissions per IP address per hour; IF the rate limit is exceeded, THEN THE Platform SHALL reject the submission with an error message indicating the Client should try again later
8. THE Platform SHALL store all API keys and tokens for WAHA and n8n integration in AWS Secrets Manager or environment variables managed through secure deployment pipelines; THE Platform SHALL NOT store credentials in source code, configuration files committed to version control, or client-accessible locations; THE Platform SHALL support credential rotation without requiring application redeployment
9. THE Platform SHALL configure all S3 buckets with Block Public Access enabled, except for the Exhibition_Website hosting bucket which SHALL be accessible only through a CloudFront distribution using OAI; direct S3 URL access to the website bucket SHALL be denied
