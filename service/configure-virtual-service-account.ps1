param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceName,

  [Parameter(Mandatory = $true)]
  [string]$InstallRoot,

  [Parameter(Mandatory = $true)]
  [string]$DataRoot,

  [string]$ServyRoot = 'C:\ProgramData\Servy',
  [string]$ServyCli = 'C:\Program Files\Servy\servy-cli.exe',
  [string]$TargetConfigPath,
  [ValidateRange(0, 900)]
  [int]$HoldSeconds = 0
)

$ErrorActionPreference = 'Stop'
$account = "NT SERVICE\$ServiceName"

foreach ($requiredPath in @($InstallRoot, $DataRoot, $ServyRoot, $ServyCli)) {
  if (-not (Test-Path -LiteralPath $requiredPath)) {
    throw "Required path does not exist: $requiredPath"
  }
}

function Grant-PathAccess {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Rights
  )

  & icacls.exe $Path /grant "${account}:$Rights" /Q | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to grant $Rights on $Path to $account"
  }
}

$temporaryDirectory = Join-Path $DataRoot ".servy-account-migration-$([guid]::NewGuid().ToString('N'))"
$exportPath = Join-Path $temporaryDirectory 'service.json'
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
  & $ServyCli export --name=$ServiceName --config=json --path=$exportPath --quiet
  if ($LASTEXITCODE -ne 0) {
    throw "Servy export failed for $ServiceName"
  }

  $configuration = Get-Content -LiteralPath $exportPath -Raw | ConvertFrom-Json
  if ($TargetConfigPath) {
    if (-not (Test-Path -LiteralPath $TargetConfigPath)) {
      throw "Target configuration does not exist: $TargetConfigPath"
    }
    $targetConfiguration = Get-Content -LiteralPath $TargetConfigPath -Raw | ConvertFrom-Json
    foreach ($property in @(
      'ExecutablePath',
      'StartupDirectory',
      'Parameters',
      'EnvironmentVariables',
      'RecoveryAction',
      'MaxRestartAttempts'
    )) {
      if ($null -ne $targetConfiguration.$property) {
        $configuration | Add-Member -NotePropertyName $property -NotePropertyValue $targetConfiguration.$property -Force
      }
    }
  }

  Grant-PathAccess -Path $InstallRoot -Rights '(OI)(CI)RX'
  Grant-PathAccess -Path $DataRoot -Rights '(OI)(CI)M'
  Grant-PathAccess -Path $ServyRoot -Rights '(OI)(CI)RX'
  foreach ($writableDirectory in @('db', 'logs', 'recovery')) {
    Grant-PathAccess -Path (Join-Path $ServyRoot $writableDirectory) -Rights '(OI)(CI)M'
  }

  $startupTypes = @{ 2 = 'Automatic'; 3 = 'Manual'; 4 = 'Disabled'; 5 = 'AutomaticDelayedStart' }
  $priorities = @{ 0 = 'Idle'; 1 = 'BelowNormal'; 2 = 'Normal'; 3 = 'AboveNormal'; 4 = 'High'; 5 = 'RealTime' }
  $recoveryActions = @{ 0 = 'None'; 1 = 'RestartService'; 2 = 'RestartProcess'; 3 = 'RestartComputer' }
  if ([string]$configuration.EnvironmentVariables -match '(?i)(^|;)[^=]*(TOKEN|SECRET|PASSWORD|API_KEY|KEY)=') {
    throw 'Refusing to expose a secret-bearing environment through Servy command arguments; use the Servy UI or another credential-safe account migration path.'
  }
  $installArguments = @(
    'install',
    "--name=$ServiceName",
    "--path=$($configuration.ExecutablePath)",
    "--displayName=$($configuration.DisplayName)",
    "--description=$($configuration.Description)",
    "--startupDir=$($configuration.StartupDirectory)",
    "--params=$($configuration.Parameters)",
    "--startupType=$($startupTypes[[int]$configuration.StartupType])",
    "--priority=$($priorities[[int]$configuration.Priority])",
    "--stdout=$($configuration.StdoutPath)",
    "--stderr=$($configuration.StderrPath)",
    "--maxRotations=$($configuration.MaxRotations)",
    "--recoveryAction=$($recoveryActions[[int]$configuration.RecoveryAction])",
    "--maxRestartAttempts=$($configuration.MaxRestartAttempts)",
    "--envVars=$($configuration.EnvironmentVariables)",
    "--deps=$($configuration.ServiceDependencies)",
    "--user=$account",
    "--startTimeout=$($configuration.StartTimeout)",
    "--stopTimeout=$($configuration.StopTimeout)",
    '--quiet'
  )
  if ($configuration.EnableConsoleUI) { $installArguments += '--enableConsoleUI' }
  if ($configuration.EnableSizeRotation) {
    $installArguments += '--enableSizeRotation'
    $installArguments += "--rotationSize=$($configuration.RotationSize)"
  }
  if ($configuration.EnableDateRotation) {
    $installArguments += '--enableDateRotation'
    $installArguments += "--dateRotationType=$($configuration.DateRotationType)"
  }
  if ($configuration.EnableHealthMonitoring) {
    $installArguments += '--enableHealth'
    $installArguments += "--heartbeatInterval=$($configuration.HeartbeatInterval)"
    $installArguments += "--maxFailedChecks=$($configuration.MaxFailedChecks)"
  }

  & $ServyCli @installArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Servy install failed for $ServiceName"
  }

  Write-Output "Configured $ServiceName to run as $account."
  if ($HoldSeconds -gt 0) {
    Start-Sleep -Seconds $HoldSeconds
  }
} finally {
  Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
