$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Check if function already exists
Write-Host "Checking if function exists..."
$existing = aws cloudfront describe-function --name cronusfit-url-rewrite 2>&1 | Out-String

if ($existing -match "NoSuchFunctionExists" -or $existing -match "ResourceNotFoundException") {
    Write-Host "Creating CloudFront function..."
    aws cloudfront create-function `
        --name cronusfit-url-rewrite `
        --function-config file://scripts/cf-function-config.json `
        --function-code fileb://scripts/url-rewrite.js
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Function created successfully"
    } else {
        Write-Host "Failed to create function"
        exit 1
    }
} else {
    Write-Host "Function already exists"
}

Write-Host "`nPublishing function..."
$etag = aws cloudfront describe-function --name cronusfit-url-rewrite --query 'ETag' --output text
aws cloudfront publish-function --name cronusfit-url-rewrite --if-match $etag

if ($LASTEXITCODE -eq 0) {
    Write-Host "Function published successfully"
} else {
    Write-Host "Failed to publish function"
    exit 1
}
