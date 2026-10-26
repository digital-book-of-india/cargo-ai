# QA-03 Dynamic Ingestion Idempotency & Tenant Verification Test
$backendEnvPath = "apps/backend/.env"
if (-not (Test-Path $backendEnvPath)) {
    Write-Host "Error: apps/backend/.env not found." -ForegroundColor Red
    exit 1
}

# 1. Parse real AI_SERVICE_TOKEN from backend .env
$envContent = Get-Content $backendEnvPath
$tokenLine = $envContent | Where-Object { $_ -match "^AI_SERVICE_TOKEN\s*=\s*(.+)$" } | Select-Object -First 1
if (-not $tokenLine) {
    Write-Host "Error: AI_SERVICE_TOKEN not configured in apps/backend/.env" -ForegroundColor Red
    exit 1
}
$token = ($tokenLine -replace "^AI_SERVICE_TOKEN\s*=\s*", "").Trim(" `"'")

$backend = "http://localhost:4000"
$headers = @{
    "Content-Type" = "application/json"
    "x-service-token" = $token
}

Write-Host "Fetching worker configuration from $backend..." -ForegroundColor Cyan
try {
    $configResp = Invoke-RestMethod -Uri "$backend/internal/v1/monitoring/config?workerId=qa-tester" -Headers $headers -Method GET
} catch {
    Write-Host "Config request failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.Response) {
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        Write-Host $reader.ReadToEnd() -ForegroundColor Red
    }
    exit 1
}

$camera = $configResp.data.cameras[0]
if (-not $camera -or -not $camera.zones -or $camera.zones.Count -eq 0) {
    Write-Host "`nNo enabled camera with active zones found." -ForegroundColor Yellow
    Write-Host "Please open the Owner UI at http://localhost:3000, go to Cameras -> Zone, and click 'Validate' & 'Enable'." -ForegroundColor Yellow
    exit 0
}

$siteId = $camera.siteId
$cameraId = $camera.cameraId
$zoneId = $camera.zones[0].id
$eventKey = "qa03-" + [System.Guid]::NewGuid().ToString()

$trackId = "track-" + [System.Guid]::NewGuid().ToString().Substring(0, 8)
$payload = @{
    eventKey = $eventKey
    companyId = "000000000000000000000000"
    siteId = $siteId
    cameraId = $cameraId
    zoneId = $zoneId
    eventType = "package_line_crossing"
    occurredAt = [System.DateTime]::UtcNow.ToString("o")
    track = @{
        trackId = $trackId
        class = "package"
        confidence = 0.95
        bbox = @(0.15, 0.25, 0.45, 0.65)
    }
    movement = @{
        direction = "OUT"
        countDelta = 1
    }
    model = @{
        name = "cargo-yolo-v8"
        version = "1.0.0"
    }
} | ConvertTo-Json -Depth 5

$ingestHeaders = @{
    "Content-Type" = "application/json"
    "x-service-token" = $token
    "Idempotency-Key" = $eventKey
}

Write-Host "`n[Leg 1] First ingestion attempt..." -ForegroundColor Cyan
$resp1 = Invoke-WebRequest -Uri "$backend/internal/v1/ai/events" -Method POST -Headers $ingestHeaders -Body $payload
Write-Host "Status: $($resp1.StatusCode) (Expected 202 Accepted)" -ForegroundColor Green
Write-Host "Body: $($resp1.Content)"

Write-Host "`n[Leg 2] Duplicate ingestion attempt (Same eventKey + Same Payload)..." -ForegroundColor Cyan
$resp2 = Invoke-WebRequest -Uri "$backend/internal/v1/ai/events" -Method POST -Headers $ingestHeaders -Body $payload
Write-Host "Status: $($resp2.StatusCode) (Expected 200 OK duplicate)" -ForegroundColor Green
Write-Host "Body: $($resp2.Content)"

Write-Host "`n[Leg 3] Conflicting ingestion attempt (Same eventKey + Different Payload)..." -ForegroundColor Cyan
$payloadBad = @{
    eventKey = $eventKey
    companyId = "000000000000000000000000"
    siteId = $siteId
    cameraId = $cameraId
    zoneId = $zoneId
    eventType = "package_line_crossing"
    occurredAt = [System.DateTime]::UtcNow.ToString("o")
    track = @{
        trackId = "track-CONFLICT"
        class = "pallet"
        confidence = 0.80
        bbox = @(0.1, 0.1, 0.2, 0.2)
    }
    movement = @{
        direction = "IN"
        countDelta = 1
    }
} | ConvertTo-Json -Depth 5

try {
    $resp3 = Invoke-WebRequest -Uri "$backend/internal/v1/ai/events" -Method POST -Headers $ingestHeaders -Body $payloadBad
    Write-Host "Unexpected Success: $($resp3.StatusCode)" -ForegroundColor Red
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    Write-Host "Status: $status (Expected 409 DUPLICATE_EVENT conflict)" -ForegroundColor Green
}
