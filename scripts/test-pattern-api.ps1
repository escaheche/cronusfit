# Test Pattern API endpoints with CORS

$apiBase = "https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod"
$corsOrigin = "https://d29tumvobv6mdj.cloudfront.net"

Write-Host "Probando Pattern API endpoints..." -ForegroundColor Cyan
Write-Host ""

# Test 1: OPTIONS /api/patterns (CORS preflight)
Write-Host "1. Probando OPTIONS /api/patterns (CORS preflight)..." -ForegroundColor Yellow
try {
    $response1 = Invoke-WebRequest -Uri "$apiBase/api/patterns" `
        -Method OPTIONS `
        -Headers @{
            "Origin" = $corsOrigin
            "Access-Control-Request-Method" = "GET"
            "Access-Control-Request-Headers" = "Authorization"
        } -UseBasicParsing

    if ($response1.StatusCode -eq 200 -and $response1.Headers.'Access-Control-Allow-Origin') {
        Write-Host "   ✅ OPTIONS /api/patterns: OK" -ForegroundColor Green
        Write-Host "      Access-Control-Allow-Origin: $($response1.Headers.'Access-Control-Allow-Origin')" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  Status: $($response1.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 2: OPTIONS /api/patterns/generate (CORS preflight)
Write-Host "2. Probando OPTIONS /api/patterns/generate (CORS preflight)..." -ForegroundColor Yellow
try {
    $response2 = Invoke-WebRequest -Uri "$apiBase/api/patterns/generate" `
        -Method OPTIONS `
        -Headers @{
            "Origin" = $corsOrigin
            "Access-Control-Request-Method" = "POST"
            "Access-Control-Request-Headers" = "Authorization,Content-Type"
        } -UseBasicParsing

    if ($response2.StatusCode -eq 200 -and $response2.Headers.'Access-Control-Allow-Origin') {
        Write-Host "   ✅ OPTIONS /api/patterns/generate: OK" -ForegroundColor Green
        Write-Host "      Access-Control-Allow-Origin: $($response2.Headers.'Access-Control-Allow-Origin')" -ForegroundColor Gray
    } else {
        Write-Host "   ⚠️  Status: $($response2.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}
Write-Host ""

# Test 3: GET /api/patterns (without auth - should return 401 but with CORS headers)
Write-Host "3. Probando GET /api/patterns (sin auth - debe retornar 401 con CORS)..." -ForegroundColor Yellow
try {
    $response3 = Invoke-WebRequest -Uri "$apiBase/api/patterns" `
        -Method GET `
        -Headers @{ "Origin" = $corsOrigin } `
        -UseBasicParsing
    Write-Host "   ⚠️  Status: $($response3.StatusCode) (esperado 401)" -ForegroundColor Yellow
} catch {
    if ($_.Exception.Response.StatusCode -eq 401) {
        $headers = $_.Exception.Response.Headers
        if ($headers['Access-Control-Allow-Origin']) {
            Write-Host "   ✅ GET /api/patterns retorna 401 con CORS headers" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️  GET /api/patterns retorna 401 pero sin CORS headers" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}
Write-Host ""

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Resumen:" -ForegroundColor White
Write-Host "- Si ves ✅ en OPTIONS: CORS preflight está funcionando" -ForegroundColor White
Write-Host "- Si ves ✅ en GET: Las respuestas incluyen CORS headers" -ForegroundColor White
Write-Host ""
Write-Host "Siguiente paso:" -ForegroundColor Yellow
Write-Host "1. Abre el navegador en: https://d29tumvobv6mdj.cloudfront.net/admin/" -ForegroundColor White
Write-Host "2. Abre DevTools (F12) → Console" -ForegroundColor White
Write-Host "3. Inicia sesión con: cronusfit-admin / CronusFit2025!" -ForegroundColor White
Write-Host "4. Ve a Patrones" -ForegroundColor White
Write-Host "5. Haz clic en 'Nuevo patrón'" -ForegroundColor White
Write-Host "6. Si no hay errores CORS en la consola, ¡funciona! 🎉" -ForegroundColor White
