# CronusFit - Estado del Despliegue

## ✅ Completado

### 1. CloudFront Function para Reescritura de URLs
- **Función creada**: `cronusfit-url-rewrite`
- **ARN**: `arn:aws:cloudfront::682579209127:function/cronusfit-url-rewrite`
- **Estado**: LIVE (publicada)
- **Asociada a**: DefaultCacheBehavior en distribución EKSSI9LYAOBGP
- **Propósito**: Resuelve URLs de directorios a `index.html` (ej: `/products/` → `/products/index.html`)

### 2. Scripts de Despliegue
- `scripts/create-cf-function.ps1` - Crea y publica la función CloudFront
- `scripts/update-distribution.ps1` - Asocia la función con la distribución
- `scripts/cf-function-config.json` - Configuración de la función
- `scripts/url-rewrite.js` - Código JavaScript de la función

### 3. Archivos de Configuración Corregidos
- Corregido el problema de codificación JSON en PowerShell
- Uso de `file://` para referencias de archivos en AWS CLI
- Encoding ASCII para evitar BOM en archivos JSON

## 🔄 En Progreso

### CloudFront Distribution Update
- **Estado**: InProgress (desplegando)
- **Distribución**: EKSSI9LYAOBGP (d29tumvobv6mdj.cloudfront.net)
- **Tiempo estimado**: 5-10 minutos desde las 00:54:31 UTC
- **Cambio aplicado**: FunctionAssociation añadida al DefaultCacheBehavior

## 🧪 Pendiente de Verificación

### Una vez que la distribución esté "Deployed":

1. **Sitio público** - https://d29tumvobv6mdj.cloudfront.net
   - [ ] Home page carga correctamente
   - [ ] Hipervínculos funcionan:
     - [ ] `/products/` → Página de productos
     - [ ] `/cotizacion/` → Formulario de cotización
     - [ ] `/estado/` → Consulta de estado

2. **Panel de administración** - https://d29tumvobv6mdj.cloudfront.net/admin/
   - [ ] Panel carga (ya no debe mostrar 403)
   - [ ] Login funciona con Cognito
   - [ ] Todas las secciones son accesibles vía hash router

## 📋 Próximos Pasos

### Paso 1: Verificar estado de CloudFront
```powershell
aws cloudfront get-distribution --id EKSSI9LYAOBGP --query 'Distribution.Status' --output text
```
Esperar hasta que retorne `Deployed` (no `InProgress`)

### Paso 2: Probar URLs públicas
```powershell
# Test home
curl https://d29tumvobv6mdj.cloudfront.net/

# Test products
curl https://d29tumvobv6mdj.cloudfront.net/products/

# Test cotizacion
curl https://d29tumvobv6mdj.cloudfront.net/cotizacion/

# Test admin panel
curl https://d29tumvobv6mdj.cloudfront.net/admin/
```

### Paso 3: Si aún hay problemas

#### Si `/admin/` sigue retornando 403:
El problema es que falta agregar el archivo `admin/index.html` a S3, o falta el CacheBehavior específico para `/admin/*`.

**Verificar que el archivo existe en S3:**
```powershell
aws s3 ls s3://cronusfit-exhibition-site-prod/admin/
```

**Si no existe, desplegarlo:**
```powershell
npm run deploy:admin
```

#### Si los hipervínculos del sitio público siguen sin funcionar:
La función CloudFront puede necesitar más tiempo para propagarse. Esperar 10-15 minutos adicionales y probar de nuevo.

**Crear invalidación si es necesario:**
```powershell
aws cloudfront create-invalidation --distribution-id EKSSI9LYAOBGP --paths "/*"
```

## 🔐 Importante - Seguridad

### Rotar Access Key
La Access Key `AKIAZ53HEFOT6BTNKYXX` fue expuesta en el chat. Después de verificar que todo funciona:

1. Ir a IAM Console: https://console.aws.amazon.com/iam/
2. Users → cronusfit-admin → Security credentials
3. Desactivar la access key actual
4. Crear nueva access key
5. Actualizar AWS CLI local:
   ```powershell
   aws configure
   ```

## 📊 Recursos AWS Utilizados

### Dentro del Free Tier:
- **CloudFront**: 1 distribución (50 GB transferencia gratis/mes)
- **CloudFront Functions**: 1 función (2M invocaciones gratis/mes)
- **S3**: cronusfit-exhibition-site-prod (5 GB storage gratis)
- **Lambda**: 23 funciones (~1M invocaciones gratis/mes)
- **Cognito**: 1 User Pool (50,000 MAU gratis)
- **DynamoDB**: 1 tabla (25 GB storage + 25 RCU/WCU gratis)

### Monitoreo requerido:
- CloudFront Requests: Limit 10M/mes (Free Tier)
- Lambda Invocations: Limit 1M/mes (Free Tier)
- S3 PUTs: Limit 2000/mes (Free Tier)

## 🎯 Estado General del Proyecto

- ✅ Infraestructura AWS configurada
- ✅ Lambdas desplegadas (23 funciones)
- ✅ Sitio público construido y desplegado
- ✅ Panel de administración construido y desplegado
- 🔄 CloudFront configurado (en propagación)
- ⏳ Pendiente: Pruebas end-to-end una vez que CloudFront esté completamente desplegado
