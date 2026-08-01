# Add CORS headers to actual API methods (GET /api/patterns and POST /api/patterns/generate)

$apiId = "dp5pdbigb1"
$region = "us-east-1"

Write-Host "Añadiendo headers CORS a respuestas de métodos..." -ForegroundColor Cyan

# GET /api/patterns - Add response header parameters to method response
Write-Host "`nConfigurando GET /api/patterns..." -ForegroundColor Yellow

aws apigateway update-method-response `
    --rest-api-id $apiId `
    --resource-id agj8wy `
    --http-method GET `
    --status-code 200 `
    --patch-operations "op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value=false" `
    --region $region

aws apigateway update-integration-response `
    --rest-api-id $apiId `
    --resource-id agj8wy `
    --http-method GET `
    --status-code 200 `
    --patch-operations "op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value='*'" `
    --region $region

# POST /api/patterns/generate - Add response header parameters to method response
Write-Host "`nConfigurando POST /api/patterns/generate..." -ForegroundColor Yellow

aws apigateway update-method-response `
    --rest-api-id $apiId `
    --resource-id 6vwta5 `
    --http-method POST `
    --status-code 200 `
    --patch-operations "op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value=false" `
    --region $region

aws apigateway update-integration-response `
    --rest-api-id $apiId `
    --resource-id 6vwta5 `
    --http-method POST `
    --status-code 200 `
    --patch-operations "op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value='*'" `
    --region $region

# Deploy changes
Write-Host "`nDesplegando cambios a stage 'prod'..." -ForegroundColor Cyan

aws apigateway create-deployment `
    --rest-api-id $apiId `
    --stage-name prod `
    --description "Añadir CORS headers a respuestas de métodos" `
    --region $region

Write-Host "`n✅ CORS configurado en todos los métodos!" -ForegroundColor Green
Write-Host "Espera 30 segundos y prueba la creación de patrones desde el admin panel." -ForegroundColor Yellow
