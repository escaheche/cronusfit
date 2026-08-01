# Implementation Plan: Design File Upload for Mockup Generation

## Overview

Implementar el flujo completo de carga de archivos de diseño desde el admin panel para la generación de mockups. El usuario seleccionará un archivo (PNG, JPEG, SVG ≤ 10MB), lo subirá a S3, y luego usará la referencia S3 para generar el mockup.

## Context

✅ **Ya implementado:**
- Admin panel infrastructure (router, auth, API client)
- Mockup section UI (`admin/js/sections/mockups.js`)
- Backend mockup generation Lambda (`src/lambdas/mockup-generate/handler.ts`)

❌ **Faltante:**
- Endpoint para subir archivos de diseño a S3
- Integración del formulario de mockups con el endpoint de upload

## Tasks

- [x] 1. Implementar Lambda de upload de archivos de diseño
  - [x] 1.1 Crear `src/lambdas/design-upload/handler.ts`
    - Implementar `POST /api/designs/upload` (JWT required)
    - Aceptar payload: `{ fileName: string, fileType: string, fileContent: string (base64) }`
    - Validar formato: solo `image/png`, `image/jpeg`, `image/svg+xml`
    - Validar tamaño: ≤ 10 MB (decodificar base64 y verificar bytes)
    - Generar UUID único para el archivo: `designs/{uuid}-{fileName}`
    - Convertir base64 a Buffer
    - Subir a S3 bucket `cronusfit-exhibition-site-prod` con prefijo `designs/`
    - Retornar: `{ designFileKey: string, message: string }`
    - En error: retornar código 400/500 con mensaje específico
    - Registrar audit log entry (best-effort)
    - _Requirements: validación de archivos, S3 storage, JWT auth_

  - [x] 1.2 Compilar y desplegar el Lambda
    - Agregar handler a `scripts/build-lambdas.mjs` en la lista de handlers
    - Ejecutar `node scripts/build-lambdas.mjs`
    - Crear función Lambda en AWS: `cronusfit-design-upload`
    - Asignar rol IAM con permisos: S3 PutObject en `cronusfit-exhibition-site-prod/designs/*`, DynamoDB PutItem para audit log
    - Configurar timeout: 30 segundos
    - Configurar memory: 512 MB
    - Configurar variables de entorno: `BUCKET_NAME=cronusfit-exhibition-site-prod`, `TABLE_NAME=CronusFit`
    - _Requirements: deployment_

  - [ ] 1.3 Crear ruta en API Gateway
    - Crear recurso `/api/designs/upload` en API Gateway `dp5pdbigb1`
    - Crear método `POST` con integración Lambda Proxy a `cronusfit-design-upload`
    - Configurar Lambda Authorizer (usar el existente de Cognito)
    - Agregar método `OPTIONS` con integración MOCK para CORS
    - Configurar respuesta de método OPTIONS con headers CORS:
      - `Access-Control-Allow-Origin: https://d29tumvobv6mdj.cloudfront.net`
      - `Access-Control-Allow-Methods: POST,OPTIONS`
      - `Access-Control-Allow-Headers: Content-Type,Authorization`
    - Agregar headers CORS a respuesta POST (en el Lambda)
    - Desplegar a stage `prod`
    - _Requirements: API Gateway integration, CORS_

- [x] 2. Actualizar admin panel mockup section para integrar upload
  - [x] 2.1 Modificar `admin/js/sections/mockups.js`
    - En `_handleSubmit`: antes de llamar `Api.post('/api/mockups/generate', ...)`
    - Paso 1: Validar archivo seleccionado (ya existe `validateDesignFile`)
    - Paso 2: Convertir archivo a base64 usando `_fileToBase64` (ya existe)
    - Paso 3: Llamar `Api.post('/api/designs/upload', { fileName, fileType, fileContent })`
    - Paso 4: Extraer `designFileKey` de la respuesta
    - Paso 5: Llamar `Api.post('/api/mockups/generate', { patternId, zone, designFileKey })`
    - Manejar errores en cada paso:
      - Upload falla: mostrar `Toast.error`, mantener formulario intacto
      - Mockup generation falla: mostrar `Toast.error`, mantener formulario intacto
    - Actualizar spinner y texto del botón para reflejar "Subiendo diseño..." y "Generando mockup..."
    - _Requirements: UI integration, error handling_

  - [x] 2.2 Probar flujo completo end-to-end
    - Login con credenciales `cronusfit-admin` / `CronusFit2025!`
    - Navegar a `#mockups`
    - Seleccionar un patrón de la lista
    - Seleccionar zona de colocación
    - Subir un archivo PNG de prueba (< 10 MB)
    - Verificar que el spinner aparece con "Subiendo diseño..."
    - Verificar que cambia a "Generando mockup..."
    - Verificar que las imágenes frontal y trasera se muestran en el resultado
    - Verificar Toast de éxito con mensaje "Mockup generado correctamente. Estado: Pendiente de aprobación."
    - _Requirements: end-to-end testing_

## Notes

- El endpoint de upload usa base64 inline en lugar de multipart/form-data para simplificar el Lambda (no requiere parsing de multipart)
- Los archivos de diseño se almacenan en S3 con prefijo `designs/` para separarlos de otros assets
- El UUID se genera en el Lambda para evitar colisiones
- El nombre original del archivo se preserva en el S3 key para facilitar debugging
- La validación de tamaño se hace después de decodificar el base64 (el base64 es ~33% más grande que el binario)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1"] },
    { "id": 3, "tasks": ["2.2"] }
  ]
}
```
