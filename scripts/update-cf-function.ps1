$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "Updating CloudFront function code..."

# Get current ETag
$etag = aws cloudfront describe-function --name cronusfit-url-rewrite --query 'ETag' --output text

# Update function code
aws cloudfront update-function `
    --name cronusfit-url-rewrite `
    --function-config file://scripts/cf-function-config.json `
    --function-code fileb://scripts/url-rewrite.js `
    --if-match $etag

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to update function"
    exit 1
}

Write-Host "Function updated, now publishing..."

# Get new ETag after update
$newEtag = aws cloudfront describe-function --name cronusfit-url-rewrite --query 'ETag' --output text

# Publish the updated function
aws cloudfront publish-function --name cronusfit-url-rewrite --if-match $newEtag

if ($LASTEXITCODE -eq 0) {
    Write-Host "Function published successfully"
    Write-Host "Changes will propagate to CloudFront in 1-2 minutes"
} else {
    Write-Host "Failed to publish function"
    exit 1
}
