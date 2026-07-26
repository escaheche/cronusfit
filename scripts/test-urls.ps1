$baseUrl = "https://d29tumvobv6mdj.cloudfront.net"

Write-Host "Testing CronusFit URLs..." -ForegroundColor Cyan
Write-Host ""

function Test-Url {
    param(
        [string]$url,
        [string]$description
    )
    
    Write-Host "Testing: $description" -NoNewline
    try {
        $response = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Host " [OK] (200)" -ForegroundColor Green
            return $true
        } else {
            Write-Host " [FAILED] ($($response.StatusCode))" -ForegroundColor Red
            return $false
        }
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host " [FAILED] ($statusCode)" -ForegroundColor Red
        return $false
    }
}

Write-Host "Public Site URLs:" -ForegroundColor Yellow
Test-Url "$baseUrl/" "Home page"
Test-Url "$baseUrl/products/" "Products page"
Test-Url "$baseUrl/cotizacion/" "Quote form page"
Test-Url "$baseUrl/estado/" "Status page"

Write-Host ""
Write-Host "Admin Panel URLs:" -ForegroundColor Yellow
Test-Url "$baseUrl/admin/" "Admin panel"
Test-Url "$baseUrl/admin/index.html" "Admin index (direct)"

Write-Host ""
Write-Host "Static Assets:" -ForegroundColor Yellow
Test-Url "$baseUrl/assets/css/main.css" "Main CSS"
Test-Url "$baseUrl/admin/css/admin.css" "Admin CSS"

Write-Host ""
Write-Host "Done!" -ForegroundColor Cyan
