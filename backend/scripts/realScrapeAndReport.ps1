# realScrapeAndReport.ps1 -- Phase 36
# Drives the running backend through a chained (video -> comments) acquisition
# cycle, then prints the real accepted comment leads. No fake seeds.

$ErrorActionPreference = 'Continue'
$base = 'http://localhost:4000'

# 1. Read ADMIN_PASSWORD from backend/.env
$envFile = Join-Path $PSScriptRoot '..\.env'
$pwLine  = Get-Content $envFile -ErrorAction SilentlyContinue | Where-Object { $_ -match '^ADMIN_PASSWORD=' }
if (-not $pwLine) { Write-Host '[real] ADMIN_PASSWORD missing in .env'; exit 1 }
$pw = $pwLine -replace '^ADMIN_PASSWORD=', ''

# 2. Login + capture session
try {
  $login = Invoke-WebRequest -Uri ($base + '/api/auth/login') -Method Post `
    -ContentType 'application/json' -Body (@{ password = $pw } | ConvertTo-Json) `
    -SessionVariable session -UseBasicParsing -TimeoutSec 10
  Write-Host ('[real] login status=' + $login.StatusCode)
} catch {
  Write-Host ('[real] login failed: ' + $_.Exception.Message); exit 1
}

$qPending = '?status=pending' + [char]38 + 'limit=50'
$qPending1 = '?status=pending' + [char]38 + 'limit=1'

# 3. Poll loop
$startedAt = Get-Date
$maxTicks  = 28
$tick      = 0
$done      = $false

while ($tick -lt $maxTicks -and -not $done) {
  $tick++

  try {
    $t = Invoke-RestMethod -Uri ($base + '/api/admin/acquisition/trigger') `
      -Method Post -WebSession $session -TimeoutSec 30
    Write-Host ('[real] tick=' + $tick + ' trigger=' + ($t | ConvertTo-Json -Compress))
  } catch {
    Write-Host ('[real] tick=' + $tick + ' trigger error: ' + $_.Exception.Message)
  }

  Start-Sleep -Seconds 8

  try {
    $stats = Invoke-RestMethod -Uri ($base + '/api/admin/acquisition/stats') `
      -WebSession $session -TimeoutSec 20
    $s = $stats.data.acquisitionStatus
    Write-Host ('[real] tick=' + $tick + ' state=' + $s.state + ' stage=' + $s.stage + ' pendingRunId=' + $s.pendingRunId + ' commentsRunId=' + $s.commentsRunId + ' itemsThisCycle=' + $s.itemsThisCycle)

    $q = Invoke-RestMethod -Uri ($base + '/api/admin/outreach-queue' + $qPending1) `
      -WebSession $session -TimeoutSec 20
    $c = $q.data.counts
    Write-Host ('[real] tick=' + $tick + ' queue ready=' + $c.readyToReply + ' hot=' + $c.pendingByTemperature.hot + ' warm=' + $c.pendingByTemperature.warm + ' cold=' + $c.pendingByTemperature.cold)

    if ($s.state -eq 'completed' -and $c.readyToReply -ge 5) { $done = $true; break }
    if ($s.state -eq 'failed') { Write-Host '[real] cycle failed - bailing'; break }
  } catch {
    Write-Host ('[real] tick=' + $tick + ' stats error: ' + $_.Exception.Message)
  }

  Start-Sleep -Seconds 22
}

# 4. Final report
Write-Host ''
Write-Host '[real] === final outreach queue (pending) ==='
try {
  $final = Invoke-RestMethod -Uri ($base + '/api/admin/outreach-queue' + $qPending) `
    -WebSession $session -TimeoutSec 30
  Write-Host ('[real] counts: ' + ($final.data.counts | ConvertTo-Json -Compress))
  $rows = $final.data.items
  $count = if ($rows) { $rows.Count } else { 0 }
  Write-Host ('[real] returned ' + $count + ' rows')

  $rows | ForEach-Object {
    $payload = [ordered]@{
      username        = $_.username
      comment         = $_.commentText
      painType        = $_.painCategory
      buyerIntent     = $_.buyerReadinessScore
      heat            = $_.leadHeatScore
      suggestedReply  = $_.suggestedReply
      consultCta      = $_.consultCta
      whatsappCta     = $_.whatsappCta
      academyCta      = $_.academyCta
      videoUrl        = $_.sourceVideoUrl
      profileUrl      = $_.profileUrl
      outreachStatus  = $_.outreachStatus
    }
    Write-Host '----------------------------------------'
    $payload | ConvertTo-Json -Depth 5
  }
} catch {
  Write-Host ('[real] final fetch error: ' + $_.Exception.Message)
}

$elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
Write-Host ''
Write-Host ('[real] elapsed=' + $elapsed + 's')
