$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

$streamsJson = aws logs describe-log-streams --log-group-name /aws/lambda/cronusfit-pattern-generate-prod --order-by LastEventTime --descending --max-items 1 --region us-east-1
$streams = $streamsJson | ConvertFrom-Json
$streamName = $streams.logStreams[0].logStreamName
Write-Host "Log stream: $streamName"

$eventsJson = aws logs get-log-events --log-group-name /aws/lambda/cronusfit-pattern-generate-prod --log-stream-name "$streamName" --region us-east-1 --limit 30
$events = $eventsJson | ConvertFrom-Json
foreach ($e in $events.events) {
    Write-Host $e.message
}
