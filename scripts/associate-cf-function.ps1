$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Get the CloudFront distribution ID from template
$distId = "EKSSI9LYAOBGP"

Write-Host "Publishing CloudFront function..."
$publishResult = aws cloudfront publish-function `
    --name "cronusfit-url-rewrite" `
    --if-match (aws cloudfront describe-function --name "cronusfit-url-rewrite" --region us-east-1 --query 'ETag' --output text) `
    --region us-east-1

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to publish function"
    exit 1
}

$functionArn = ($publishResult | ConvertFrom-Json).FunctionSummary.FunctionMetadata.FunctionARN
Write-Host "Function published: $functionArn"

# Get current distribution config
Write-Host "Fetching current distribution config..."
$configResult = aws cloudfront get-distribution-config --id $distId --output json
$config = ($configResult | ConvertFrom-Json).DistributionConfig
$etag = aws cloudfront get-distribution-config --id $distId --query 'ETag' --output text

# Add FunctionAssociations to DefaultCacheBehavior
if (-not $config.DefaultCacheBehavior.FunctionAssociations) {
    $config.DefaultCacheBehavior | Add-Member -MemberType NoteProperty -Name FunctionAssociations -Value @{
        Quantity = 1
        Items = @(
            @{
                FunctionARN = $functionArn
                EventType = "viewer-request"
            }
        )
    }
} else {
    # Check if association already exists
    $existingAssoc = $config.DefaultCacheBehavior.FunctionAssociations.Items | Where-Object { $_.FunctionARN -eq $functionArn }
    if (-not $existingAssoc) {
        $config.DefaultCacheBehavior.FunctionAssociations.Quantity++
        $config.DefaultCacheBehavior.FunctionAssociations.Items += @{
            FunctionARN = $functionArn
            EventType = "viewer-request"
        }
    } else {
        Write-Host "Function already associated, skipping"
        exit 0
    }
}

# Save modified config to temp file
$tempConfig = "cf-config-temp.json"
$config | ConvertTo-Json -Depth 10 | Set-Content $tempConfig

Write-Host "Updating distribution..."
aws cloudfront update-distribution `
    --id $distId `
    --distribution-config "file://$tempConfig" `
    --if-match $etag

Remove-Item $tempConfig
Write-Host "Distribution updated successfully"
