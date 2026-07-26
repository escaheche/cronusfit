$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Get auth token
$authJson = aws cognito-idp initiate-auth --client-id 7gfgmp718hi797qd5e4m1pk5ae --auth-flow USER_PASSWORD_AUTH --auth-parameters "USERNAME=cronusfit-admin,PASSWORD=CronusFit2024!" --region us-east-1
$authResult = $authJson | ConvertFrom-Json
$token = $authResult.AuthenticationResult.IdToken
Write-Host "Token obtained ($($token.Length) chars)"

# Call pattern generate API
$body = '{"garmentType":"camiseta","ageGroup":"adult","size":"M","measurements":{"chestWidth":500,"bodyLength":720,"shoulderWidth":450,"sleeveLength":250},"seamAllowance":1.5}'

try {
    $result = Invoke-WebRequest -Uri "https://dp5pdbigb1.execute-api.us-east-1.amazonaws.com/prod/api/patterns/generate" -Method POST -Headers @{Authorization=$token;"Content-Type"="application/json"} -Body $body -UseBasicParsing
    Write-Host "Status: $($result.StatusCode)"
    Write-Host $result.Content
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Host $reader.ReadToEnd()
    }
}
