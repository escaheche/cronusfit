# Deploy Design Upload Lambda and API Gateway Integration
$ErrorActionPreference = "Continue"

Write-Host "Desplegando Design Upload Lambda..." -ForegroundColor Cyan

$LAMBDA_NAME = "cronusfit-design-upload"
$API_ID = "dp5pdbigb1"
$STAGE = "prod"
$REGION = "us-east-1"
$ROLE_ARN = "arn:aws:iam::637423478482:role/cronusfit-lambda-execution-role"
$CODE_PATH = "dist/lambdas/design-upload"

# PASO 1: Crear ZIP
Write-Host "Empaquetando codigo..." -ForegroundColor Yellow
Push-Location $CODE_PATH
if (Test-Path "function.zip") { Remove-Item "function.zip" -Force }
Compress-Archive -Path * -DestinationPath "function.zip" -CompressionLevel Optimal
Pop-Location
Write-Host "  OK: function.zip creado" -ForegroundColor Green

# PASO 2: Crear o actualizar Lambda
Write-Host "Desplegando Lambda..." -ForegroundColor Yellow
$lambdaCheck = aws lambda get-function --function-name $LAMBDA_NAME --region $REGION --output text 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  Actualizando funcion existente..." -ForegroundColor Cyan
    aws lambda update-function-code --function-name $LAMBDA_NAME --zip-file "fileb://$CODE_PATH/function.zip" --region $REGION | Out-Null
    Start-Sleep -Seconds 5
    aws lambda update-function-configuration --function-name $LAMBDA_NAME --timeout 30 --memory-size 512 --region $REGION | Out-Null
    Write-Host "  OK: Funcion actualizada" -ForegroundColor Green
} else {
    Write-Host "  Creando nueva funcion..." -ForegroundColor Cyan
    aws lambda create-function --function-name $LAMBDA_NAME --runtime nodejs20.x --role $ROLE_ARN --handler handler.handler --zip-file "fileb://$CODE_PATH/function.zip" --timeout 30 --memory-size 512 --region $REGION | Out-Null
    Write-Host "  OK: Funcion creada" -ForegroundColor Green
}

# Actualizar variables de entorno por separado usando JSON file
Write-Host "  Configurando variables de entorno..." -ForegroundColor Cyan
$envJson = '{"Variables":{"S3_ASSETS_BUCKET":"cronusfit-exhibition-site-prod","TABLE_NAME":"CronusFit"}}'
$envJson | Out-File -FilePath "env-temp.json" -Encoding utf8 -NoNewline
aws lambda update-function-configuration --function-name $LAMBDA_NAME --environment file://env-temp.json --region $REGION | Out-Null
Remove-Item "env-temp.json" -Force
Write-Host "  OK: Variables configuradas" -ForegroundColor Green

# PASO 3: Permiso para API Gateway
Write-Host "Configurando permisos..." -ForegroundColor Yellow
$timestamp = Get-Date -Format "yyyyMMddHHmmss"
$sourceArn = "arn:aws:execute-api:$($REGION):637423478482:$($API_ID)/*/*/*"
aws lambda add-permission --function-name $LAMBDA_NAME --statement-id "apigw-$timestamp" --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn $sourceArn --region $REGION 2>&1 | Out-Null
Write-Host "  OK: Permisos configurados" -ForegroundColor Green

# PASO 4: Obtener recursos de API Gateway
Write-Host "Configurando API Gateway..." -ForegroundColor Yellow

$resources = aws apigateway get-resources --rest-api-id $API_ID --region $REGION | ConvertFrom-Json

$apiResource = $resources.items | Where-Object { $_.path -eq "/api" }
if (-not $apiResource) {
    Write-Host "  ERROR: No se encontro recurso /api" -ForegroundColor Red
    exit 1
}
$apiResourceId = $apiResource.id
Write-Host "  Recurso /api: $apiResourceId" -ForegroundColor Cyan

# Crear /designs si no existe
$designsResource = $resources.items | Where-Object { $_.path -eq "/api/designs" }
if (-not $designsResource) {
    Write-Host "  Creando /designs..." -ForegroundColor Cyan
    $result = aws apigateway create-resource --rest-api-id $API_ID --parent-id $apiResourceId --path-part "designs" --region $REGION | ConvertFrom-Json
    $designsResourceId = $result.id
    Write-Host "  OK: /designs creado: $designsResourceId" -ForegroundColor Green
} else {
    $designsResourceId = $designsResource.id
    Write-Host "  /designs existe: $designsResourceId" -ForegroundColor Cyan
}

# Actualizar resource list
$resources = aws apigateway get-resources --rest-api-id $API_ID --region $REGION | ConvertFrom-Json

# Crear /upload si no existe
$uploadResource = $resources.items | Where-Object { $_.path -eq "/api/designs/upload" }
if (-not $uploadResource) {
    Write-Host "  Creando /upload..." -ForegroundColor Cyan
    $result = aws apigateway create-resource --rest-api-id $API_ID --parent-id $designsResourceId --path-part "upload" --region $REGION | ConvertFrom-Json
    $uploadResourceId = $result.id
    Write-Host "  OK: /upload creado: $uploadResourceId" -ForegroundColor Green
} else {
    $uploadResourceId = $uploadResource.id
    Write-Host "  /upload existe: $uploadResourceId" -ForegroundColor Cyan
}

# PASO 5: Metodo OPTIONS para CORS
Write-Host "Configurando CORS (OPTIONS)..." -ForegroundColor Yellow
$optionsCheck = aws apigateway get-method --rest-api-id $API_ID --resource-id $uploadResourceId --http-method OPTIONS --region $REGION --output text 2>&1
if ($LASTEXITCODE -ne 0) {
    aws apigateway put-method --rest-api-id $API_ID --resource-id $uploadResourceId --http-method OPTIONS --authorization-type NONE --region $REGION | Out-Null
    
    $mockTemplate = '{"application/json":"{\"statusCode\": 200}"}'
    $mockTemplate | Out-File -FilePath "mock-temp.json" -Encoding utf8 -NoNewline
    aws apigateway put-integration --rest-api-id $API_ID --resource-id $uploadResourceId --http-method OPTIONS --type MOCK --request-templates file://mock-temp.json --region $REGION | Out-Null
    Remove-Item "mock-temp.json" -Force
    
    aws apigateway put-method-response --rest-api-id $API_ID --resource-id $uploadResourceId --http-method OPTIONS --status-code 200 --response-parameters "method.response.header.Access-Control-Allow-Origin=true,method.response.header.Access-Control-Allow-Methods=true,method.response.header.Access-Control-Allow-Headers=true" --region $REGION | Out-Null
    
    $corsParams = '{
  "method.response.header.Access-Control-Allow-Origin": "''https://d29tumvobv6mdj.cloudfront.net''",
  "method.response.header.Access-Control-Allow-Methods": "''POST,OPTIONS''",
  "method.response.header.Access-Control-Allow-Headers": "''Content-Type,Authorization''"
}'
    $corsParams | Out-File -FilePath "cors-temp.json" -Encoding utf8
    aws apigateway put-integration-response --rest-api-id $API_ID --resource-id $uploadResourceId --http-method OPTIONS --status-code 200 --response-parameters file://cors-temp.json --region $REGION | Out-Null
    Remove-Item "cors-temp.json" -Force
    
    Write-Host "  OK: OPTIONS configurado" -ForegroundColor Green
} else {
    Write-Host "  OPTIONS ya existe" -ForegroundColor Cyan
}

# PASO 6: Metodo POST
Write-Host "Configurando metodo POST..." -ForegroundColor Yellow
$lambdaArn = aws lambda get-function --function-name $LAMBDA_NAME --region $REGION --query "Configuration.FunctionArn" --output text

# Obtener authorizer
$authorizers = aws apigateway get-authorizers --rest-api-id $API_ID --region $REGION | ConvertFrom-Json
$authorizerId = $authorizers.items[0].id
Write-Host "  Authorizer: $authorizerId" -ForegroundColor Cyan

$postCheck = aws apigateway get-method --rest-api-id $API_ID --resource-id $uploadResourceId --http-method POST --region $REGION --output text 2>&1
if ($LASTEXITCODE -ne 0) {
    aws apigateway put-method --rest-api-id $API_ID --resource-id $uploadResourceId --http-method POST --authorization-type COGNITO_USER_POOLS --authorizer-id $authorizerId --region $REGION | Out-Null
    Write-Host "  OK: Metodo POST creado" -ForegroundColor Green
} else {
    Write-Host "  POST ya existe" -ForegroundColor Cyan
}

# Configurar integracion Lambda Proxy
$integrationUri = "arn:aws:apigateway:$($REGION):lambda:path/2015-03-31/functions/$lambdaArn/invocations"
aws apigateway put-integration --rest-api-id $API_ID --resource-id $uploadResourceId --http-method POST --type AWS_PROXY --integration-http-method POST --uri $integrationUri --region $REGION | Out-Null
Write-Host "  OK: Integracion Lambda configurada" -ForegroundColor Green

# PASO 7: Deploy
Write-Host "Desplegando a stage prod..." -ForegroundColor Yellow
aws apigateway create-deployment --rest-api-id $API_ID --stage-name $STAGE --description "Add design-upload endpoint" --region $REGION | Out-Null
Write-Host "  OK: Desplegado a prod" -ForegroundColor Green

Write-Host ""
Write-Host "DEPLOYMENT COMPLETADO" -ForegroundColor Green
Write-Host "Endpoint: https://$API_ID.execute-api.$REGION.amazonaws.com/$STAGE/api/designs/upload" -ForegroundColor White
