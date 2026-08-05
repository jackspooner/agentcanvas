[CmdletBinding()]
param(
  [ValidateSet('Start', 'Status', 'Stop', 'Restart')]
  [string]$Action = 'Start',
  [string]$HealthUrl = ''
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateRoot = Join-Path $repoRoot 'tmp'
$pidPath = Join-Path $stateRoot 'agentcanvas-background.pid.json'
$stdoutPath = Join-Path $stateRoot 'agentcanvas-background.stdout.log'
$stderrPath = Join-Path $stateRoot 'agentcanvas-background.stderr.log'

function Get-HealthUrl {
  if ($HealthUrl) { return $HealthUrl.TrimEnd('/') }
  if ($env:AGENT_CANVAS_PUBLIC_BASE_URL) { return $env:AGENT_CANVAS_PUBLIC_BASE_URL.TrimEnd('/') }
  return 'http://127.0.0.1:23003'
}

function Read-ProcessRecord {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  try {
    return Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
  } catch {
    throw "AgentCanvas background state is invalid: $pidPath"
  }
}

function Get-AgentCanvasProcess([object]$record) {
  if (-not $record -or -not $record.pid) { return $null }
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)" -ErrorAction SilentlyContinue
  if (-not $process) { return $null }
  if ($process.CommandLine -notmatch 'src[\\/]server\.ts' -or $process.CommandLine -notmatch 'tsx') {
    throw "PID $($record.pid) is not the AgentCanvas background process; refusing to manage it."
  }
  return $process
}

function Test-Health {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$(Get-HealthUrl)/health" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Show-Status {
  $record = Read-ProcessRecord
  $process = Get-AgentCanvasProcess $record
  [ordered]@{
    running = [bool]$process
    pid = if ($process) { [int]$process.ProcessId } else { $null }
    healthUrl = Get-HealthUrl
    healthy = if ($process) { Test-Health } else { $false }
    stdoutLog = $stdoutPath
    stderrLog = $stderrPath
  } | ConvertTo-Json -Compress
}

function Stop-AgentCanvas {
  $record = Read-ProcessRecord
  $process = Get-AgentCanvasProcess $record
  if (-not $process) {
    if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
    Write-Output 'AgentCanvas is not running.'
    return
  }
  Stop-Process -Id ([int]$process.ProcessId) -ErrorAction Stop
  Wait-Process -Id ([int]$process.ProcessId) -Timeout 10 -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $pidPath) { Remove-Item -LiteralPath $pidPath -Force }
  Write-Output "Stopped AgentCanvas (PID $($process.ProcessId))."
}

function Start-AgentCanvas {
  $record = Read-ProcessRecord
  $existing = Get-AgentCanvasProcess $record
  if ($existing) {
    Write-Output "AgentCanvas is already running (PID $($existing.ProcessId))."
    Show-Status
    return
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js was not found on PATH.' }
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'node_modules\tsx'))) {
    throw 'Dependencies are not installed. Run npm ci from the AgentCanvas repository root.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'dist\web\index.html'))) {
    throw 'AgentCanvas is not built. Run npm run plugins:build, npm run plugins:materialize -- --defaults, and npm run build first.'
  }
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  $process = Start-Process -FilePath 'node' `
    -ArgumentList @('--import', 'tsx/esm', 'src/server.ts') `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru
  $record = [ordered]@{
    pid = $process.Id
    startedAt = [DateTime]::UtcNow.ToString('o')
    repository = $repoRoot
    healthUrl = Get-HealthUrl
  }
  $record | ConvertTo-Json | Set-Content -LiteralPath $pidPath -Encoding utf8
  $healthy = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-Health) { $healthy = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $healthy) {
    $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { '' }
    throw "AgentCanvas did not become healthy at $(Get-HealthUrl). See $stderrPath. $stderr"
  }
  Write-Output "Started AgentCanvas in the background (PID $($process.Id))."
  Write-Output "Health: $(Get-HealthUrl)/health"
  Write-Output "Logs: $stdoutPath and $stderrPath"
}

switch ($Action) {
  'Start' { Start-AgentCanvas }
  'Status' { Show-Status }
  'Stop' { Stop-AgentCanvas }
  'Restart' { Stop-AgentCanvas; Start-AgentCanvas }
}
