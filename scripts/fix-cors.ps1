# Fix CORS for Pattern API endpoints

$apiId = "dp5pdbigb1"
$region = "us-east-1"

Write-Host "Configurando CORS para /api/patterns..." -ForegroundColor Cyan

# Resource /api/patterns (agj8wy)
Write-Host "`nConfigurando integration response para OPTIONS /api/patterns..." -ForegroundColor Yellow

aws apigateway put-integration-response `
    --rest-api-id $apiId `
    --resource-id agj8wy `
    --http-method OPTIONS `
    --status-code 200 `
    --response-parameters file://scripts/cors-response-params.json `
    --region $region

# Resource /api/patterns/generate (6vwta5)
Write-Host "`nVerificando si existe OPTIONS en /api/patterns/generate..." -ForegroundColor Yellow

$methodExists = aws apigateway get-method --rest-api-id $apiId --resource-id 6vwta5 --http-method OPTIONS --region $region 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Creando método OPTIONS para /api/patterns/generate..." -ForegroundColor Yellow
    
    aws apigateway put-method `
        --rest-api-id $apiId `
        --resource-id 6vwta5 `
        --http-method OPTIONS `
        --authorization-type NONE `
        --region $region
    
    aws apigateway put-method-response `
        --rest-api-id $apiId `
        --resource-id 6vwta5 `
        --http-method OPTIONS `
        --status-code 200 `
        --response-parameters "method.response.header.Access-Control-Allow-Headers=true,method.response.header.Access-Control-Allow-Methods=true,method.response.header.Access-Control-Allow-Origin=true" `
        --region $region
}

Write-Host "`nConfigurando integration para OPTIONS /api/patterns/generate..." -ForegroundColor Yellow

aws apigateway put-integration `
    --rest-api-id $apiId `
    --resource-id 6vwta5 `
    --http-method OPTIONS `
    --type MOCK `
    --request-templates '{\"application/json\": \"{\\\"statusCode\\\": 200}\"}' `
    --region $region

Write-Host "`nConfigurando integration response para OPTIONS /api/patterns/generate..." -ForegroundColor Yellow

aws apigateway put-integration-response `
    --rest-api-id $apiId `
    --resource-id 6vwta5 `
    --http-method OPTIONS `
    --status-code 200 `
    --response-parameters file://scripts/cors-response-params-post.json `
    --region $region

# Deploy to prod stage
Write-Host "`nDesplegando cambios a stage 'prod'..." -ForegroundColor Cyan

aws apigateway create-deployment `
    --rest-api-id $apiId `
    --stage-name prod `
    --description "Configurar CORS para endpoints de patterns" `
    --region $region

Write-Host "`n✅ CORS configurado correctamente!" -ForegroundColor Green
Write-Host "Prueba el endpoint en el navegador en 30 segundos." -ForegroundColor Yellow
