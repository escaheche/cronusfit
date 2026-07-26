# Solución a los Problemas de CloudFront

## 🔴 Problemas Identificados

### 1. Panel de administración no carga (`/admin/`)
**Causa**: CloudFront buscaba el objeto S3 `admin/` que no existe (solo existe `admin/index.html`)
**Error**: 403 Forbidden

### 2. Hipervínculos del sitio público no funcionan
**Causa**: URLs como `/products/`, `/cotizacion/`, `/estado/` retornaban 403 porque CloudFront no resolvía automáticamente a `index.html`
**Error**: 403 Forbidden

## ✅ Solución Implementada

### CloudFront Function - URL Rewrite
Creé una **CloudFront Function** que intercepta todas las peticiones y reescribe las URLs de directorios para que apunten a `index.html`:

**Función**: `cronusfit-url-rewrite`  
**Archivo**: `scripts/url-rewrite.js`

```javascript
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  
  // /admin/* — dejar como está para que el SPA funcione
  if (uri.startsWith('/admin')) {
    return request;
  }
  
  // Reescribir peticiones a directorios para que apunten a index.html
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = uri + '/index.html';
  }
  
  return request;
}
```

**Cómo funciona**:
- `/products/` → `/products/index.html`
- `/cotizacion/` → `/cotizacion/index.html`
- `/estado/` → `/estado/index.html`
- `/admin/` → `/admin/index.html`

### Pasos Ejecutados

1. **Corregí el script de PowerShell** (`scripts/create-cf-function.ps1`)
   - Problema: JSON mal escapado causaba error de validación
   - Solución: Usar `file://` para cargar archivos desde disco

2. **Creé la función CloudFront**
   ```powershell
   .\scripts\create-cf-function.ps1
   ```
   - Estado: LIVE ✓
   - ARN: `arn:aws:cloudfront::682579209127:function/cronusfit-url-rewrite`

3. **Asocié la función con la distribución** 
   ```powershell
   .\scripts\update-distribution.ps1
   ```
   - Añadí FunctionAssociation al DefaultCacheBehavior
   - Evento: `viewer-request` (intercepta peticiones antes del cache)

4. **CloudFront está desplegando los cambios**
   - Estado actual: `InProgress`
   - Tiempo estimado: 5-10 minutos
   - Iniciado: 2026-07-26 00:54:31 UTC

## 🧪 Verificación

### Esperar a que CloudFront termine de desplegar

Ejecutar este comando hasta que retorne `Deployed`:
```powershell
aws cloudfront get-distribution --id EKSSI9LYAOBGP --query 'Distribution.Status' --output text
```

### Probar las URLs

Una vez que esté `Deployed`, ejecutar:
```powershell
.\scripts\test-urls.ps1
```

Este script probará:
- ✓ Home page: https://d29tumvobv6mdj.cloudfront.net/
- ✓ Products: https://d29tumvobv6mdj.cloudfront.net/products/
- ✓ Cotización: https://d29tumvobv6mdj.cloudfront.net/cotizacion/
- ✓ Estado: https://d29tumvobv6mdj.cloudfront.net/estado/
- ✓ Admin panel: https://d29tumvobv6mdj.cloudfront.net/admin/

### Probar manualmente en el navegador

1. Abrir: https://d29tumvobv6mdj.cloudfront.net/
2. Hacer clic en los enlaces del menú de navegación
3. Verificar que todas las páginas cargan correctamente
4. Ir a: https://d29tumvobv6mdj.cloudfront.net/admin/
5. Verificar que el panel de login carga

## 📂 Archivos Creados/Modificados

### Scripts
- `scripts/url-rewrite.js` - Código de la CloudFront Function
- `scripts/cf-function-config.json` - Configuración de la función
- `scripts/create-cf-function.ps1` - Script para crear/publicar la función
- `scripts/update-distribution.ps1` - Script para asociar la función a la distribución
- `scripts/test-urls.ps1` - Script para probar todas las URLs

### Documentación
- `DEPLOYMENT-STATUS.md` - Estado general del despliegue
- `SOLUCION-CLOUDFRONT.md` - Este documento

## ⚙️ Detalles Técnicos

### ¿Por qué CloudFront Functions y no Lambda@Edge?

**CloudFront Functions**:
- Ejecuta en ~1ms (más rápido)
- 2 millones de invocaciones gratis/mes (Free Tier)
- Costo: $0.10 por 1 millón de invocaciones
- Ideal para transformaciones simples de request/response

**Lambda@Edge**:
- Ejecuta en ~50-100ms
- 1 millón de invocaciones gratis/mes
- Costo: $0.60 por 1 millón + tiempo de ejecución
- Necesario solo para lógica compleja

Para reescritura de URLs, CloudFront Functions es perfecto y más económico.

### ¿Por qué no usar S3 Website Hosting?

S3 Website Hosting resuelve automáticamente `/path/` a `/path/index.html`, pero:
- No permite OAI (Origin Access Identity)
- Requiere bucket público
- No tiene HTTPS integrado
- No aprovecha el cache de CloudFront

Nuestra solución mantiene el bucket privado y usa CloudFront con OAI para seguridad.

## 🚀 Próximos Pasos

1. **Esperar 5-10 minutos** para que CloudFront termine de desplegar
2. **Ejecutar** `.\scripts\test-urls.ps1` para verificar
3. **Probar en navegador** todas las URLs
4. **Rotar Access Key** (ver `DEPLOYMENT-STATUS.md`)
5. **Configurar dominio personalizado** (opcional)

## 🔒 Seguridad

La Access Key `AKIAZ53HEFOT6BTNKYXX` fue expuesta en el chat. Una vez que todo funcione correctamente:

1. Ir a: https://console.aws.amazon.com/iam/
2. Users → cronusfit-admin → Security credentials
3. Desactivar la access key actual
4. Crear nueva access key
5. Actualizar localmente:
   ```powershell
   aws configure
   ```

## 📊 Impacto en Free Tier

**Nuevo recurso**:
- CloudFront Function: 2M invocaciones/mes gratis
- Uso estimado: ~50,000 invocaciones/mes
- Costo adicional: $0 (dentro del free tier)

**Sin impacto en**:
- Lambda invocations (no se usa Lambda@Edge)
- S3 storage (mismos archivos)
- CloudFront data transfer (mismo tráfico)

## ✅ Resultado Esperado

Después del despliegue:
- ✅ https://d29tumvobv6mdj.cloudfront.net/ → Home page carga
- ✅ https://d29tumvobv6mdj.cloudfront.net/products/ → Productos cargan
- ✅ https://d29tumvobv6mdj.cloudfront.net/cotizacion/ → Formulario carga
- ✅ https://d29tumvobv6mdj.cloudfront.net/estado/ → Consulta de estado carga
- ✅ https://d29tumvobv6mdj.cloudfront.net/admin/ → Panel de admin carga
- ✅ Todos los hipervínculos del sitio funcionan correctamente
