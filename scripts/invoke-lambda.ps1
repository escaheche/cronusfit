$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$payload = @{
    httpMethod = "POST"
    body = '{"garmentType":"camiseta","ageGroup":"adult","size":"M","measurements":{"chestWidth":500,"bodyLength":720,"shoulderWidth":450,"sleeveLength":250},"seamAllowance":1.5}'
    headers = @{ "Content-Type" = "application/json" }
    requestContext = @{
        authorizer = @{
            claims = @{
                sub = "f4580498-f071-70f7-c511-173c77aee9ac"
                "cognito:username" = "cronusfit-admin"
            }
        }
    }
    pathParameters = $null
    queryStringParameters = $null
} | ConvertTo-Json -Depth 5 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$base64 = [System.Convert]::ToBase64String($bytes)

$result = aws lambda invoke --function-name cronusfit-pattern-generate-prod --payload $base64 --region us-east-1 response.json
Write-Host $result
Write-Host "--- Response ---"
Get-Content response.json
