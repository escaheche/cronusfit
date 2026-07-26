$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$distId = "EKSSI9LYAOBGP"
$functionArn = "arn:aws:cloudfront::682579209127:function/cronusfit-url-rewrite"

Write-Host "Fetching current distribution config..."
aws cloudfront get-distribution-config --id $distId --output json | Out-File -FilePath "dist-config-raw.json" -Encoding utf8

$rawConfig = Get-Content "dist-config-raw.json" -Raw | ConvertFrom-Json
$etag = $rawConfig.ETag
$config = $rawConfig.DistributionConfig

Write-Host "Adding CloudFront Function to DefaultCacheBehavior..."
$config.DefaultCacheBehavior.FunctionAssociations = @{
    Quantity = 1
    Items = @(
        @{
            FunctionARN = $functionArn
            EventType = "viewer-request"
        }
    )
}

Write-Host "Saving updated config..."
$config | ConvertTo-Json -Depth 20 | Out-File -FilePath "dist-config-updated.json" -Encoding ASCII -NoNewline

Write-Host "Updating CloudFront distribution..."
aws cloudfront update-distribution `
    --id $distId `
    --distribution-config file://dist-config-updated.json `
    --if-match $etag

if ($LASTEXITCODE -eq 0) {
    Write-Host "Distribution updated successfully"
    Write-Host "CloudFront is now deploying the changes. This may take 5-10 minutes."
    Remove-Item "dist-config-raw.json"
    Remove-Item "dist-config-updated.json"
} else {
    Write-Host "Failed to update distribution"
    Write-Host "Check dist-config-updated.json for the config that was attempted"
    exit 1
}
