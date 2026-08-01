# Complete CORS setup for Pattern API

$apiId = "dp5pdbigb1"
$region = "us-east-1"

Write-Host "Configuración completa de CORS para Pattern API" -ForegroundColor Cyan

# GET /api/patterns
Write-Host "`n1. Configurando GET /api/patterns..." -ForegroundColor Yellow

Write-Host "   - Añadiendo integration response con CORS headers..."
aws apigateway put-integration-response `
    --rest-api-id $apiId `
    --resource-id agj8wy `
    --http-method GET `
    --status-code 200 `
    --response-parameters file://scripts/cors-integration-response.json `
    --region $region

# POST /api/patterns/generate
Write-Host "`n2. Configurando POST /api/patterns/generate..." -ForegroundColor Yellow

Write-Host "   - Añadiendo integration response con CORS headers..."
aws apigateway put-integration-response `
    --rest-api-id $apiId `
    --resource-id 6vwta5 `
    --http-method POST `
    --status-code 200 `
    --response-parameters file://scripts/cors-integration-response.json `
    --region $region

# Deploy
Write-Host "`n3. Desplegando todos los cambios..." -ForegroundColor Cyan

aws apigateway create-deployment `
    --rest-api-id $apiId `
    --stage-name prod `
    --description "CORS completo para Pattern API" `
    --region $region

Write-Host "`n✅ ¡CORS configurado completamente!" -ForegroundColor Green
Write-Host "`nEspera 30-60 segundos y prueba:" -ForegroundColor Yellow
Write-Host "1. Abre https://d29tumvobv6mdj.cloudfront.net/admin/" -ForegroundColor White
Write-Host "2. Inicia sesión" -ForegroundColor White
Write-Host "3. Ve a Patrones" -ForegroundColor White
Write-Host "4. Haz clic en 'Nuevo patrón' y crea un patrón" -ForegroundColor White
