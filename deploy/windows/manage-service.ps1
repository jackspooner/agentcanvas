[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [ValidateSet('Install', 'Uninstall', 'Start', 'Stop', 'Restart', 'Status')]
    [string]$Action = 'Install',
    [string]$InstallPath,
    [string]$ServiceName = 'AgentCanvas',
    [string]$DisplayName = 'AgentCanvas',
    [string]$Description = 'AgentCanvas local canvas and MCP service',
    [string]$DataPath
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this script from an elevated Windows PowerShell prompt.'
    }
}

function Invoke-Native {
    param([string]$FilePath, [string[]]$ArgumentList)
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE."
    }
}

function Get-ServiceRecord {
    Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

if (-not $InstallPath) {
    $InstallPath = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
} else {
    $InstallPath = (Resolve-Path $InstallPath).Path
}
if (-not $DataPath) {
    $DataPath = Join-Path $env:ProgramData 'AgentCanvas'
}
$DataPath = [IO.Path]::GetFullPath($DataPath)

if ($ServiceName -notmatch '^[A-Za-z][A-Za-z0-9_.-]{0,79}$') {
    throw 'ServiceName must contain only letters, numbers, dots, underscores, and hyphens.'
}
if ($Action -eq 'Install') {
    if (-not (Test-Path (Join-Path $InstallPath 'src\server.ts'))) {
        throw "AgentCanvas source entrypoint was not found under $InstallPath."
    }
    if (-not (Test-Path (Join-Path $InstallPath 'dist\web\index.html'))) {
        throw "Built browser assets were not found under $InstallPath. Run npm run build first."
    }
}

$serviceHostSource = Join-Path $PSScriptRoot 'AgentCanvasServiceHost.cs'
$serviceRuntimePath = Join-Path $env:ProgramData ("AgentCanvas\service\{0}" -f $ServiceName)
$serviceHostPath = Join-Path $serviceRuntimePath 'AgentCanvasServiceHost.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $compiler)) {
    $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { $null }

function Assert-NodeRuntime {
    if (-not $nodePath) {
        throw 'Node.js was not found on PATH. Install Node.js 24 or newer, then rerun this script.'
    }
    $nodeVersion = (& $nodePath --version 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(?<major>\d+)\.') {
        throw "Unable to determine the Node.js version from $nodePath."
    }
    if ([int]$Matches.major -lt 24) {
        throw "Node.js 24 or newer is required; found $nodeVersion."
    }
}

function Build-ServiceHost {
    if (-not (Test-Path $compiler)) {
        throw 'The .NET Framework C# compiler was not found. Install a supported .NET Framework runtime or compile AgentCanvasServiceHost.cs with a compatible Windows build tool.'
    }
    New-Item -ItemType Directory -Path $serviceRuntimePath -Force | Out-Null
    Invoke-Native $compiler @(
        '/nologo',
        '/target:exe',
        "/out:$serviceHostPath",
        '/r:System.dll',
        '/r:System.ServiceProcess.dll',
        $serviceHostSource
    )
}

function Grant-DataAccess {
    New-Item -ItemType Directory -Path $DataPath -Force | Out-Null
    Invoke-Native (Join-Path $env:WINDIR 'System32\icacls.exe') @(
        $DataPath,
        '/grant',
        'NT AUTHORITY\LOCAL SERVICE:(OI)(CI)(M)',
        '/T',
        '/C'
    )
}

function Install-AgentCanvasService {
    [CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
    param()

    Assert-Administrator
    Assert-NodeRuntime
    if (Get-ServiceRecord) {
        throw "The $ServiceName service already exists. Run -Action Uninstall before reinstalling it."
    }
    if (-not $PSCmdlet.ShouldProcess($ServiceName, 'Install AgentCanvas Windows service')) { return }

    Grant-DataAccess
    Build-ServiceHost
    $binaryPath = '"{0}" "{1}" "{2}" "{3}"' -f $serviceName, $InstallPath, $DataPath, $nodePath
    Invoke-Native (Join-Path $env:WINDIR 'System32\sc.exe') @(
        'create', $ServiceName,
        "binPath= `"$serviceHostPath`" $binaryPath",
        'start= auto',
        "DisplayName= $DisplayName",
        'obj= NT AUTHORITY\LocalService',
        'password= '
    )
    Invoke-Native (Join-Path $env:WINDIR 'System32\sc.exe') @('description', $ServiceName, $Description)
    Invoke-Native (Join-Path $env:WINDIR 'System32\sc.exe') @('failure', $ServiceName, 'reset= 86400', 'actions= restart/5000/restart/15000/restart/60000')
    Invoke-Native (Join-Path $env:WINDIR 'System32\sc.exe') @('failureflag', $ServiceName, '1')
    Start-Service -Name $ServiceName
    Write-Output "Installed and started $ServiceName using LocalService."
    Write-Output "Logs: $(Join-Path $DataPath 'logs')"
}

function Uninstall-AgentCanvasService {
    [CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
    param()

    Assert-Administrator
    $service = Get-ServiceRecord
    if (-not $service) {
        Write-Output "$ServiceName is not installed."
        return
    }
    if (-not $PSCmdlet.ShouldProcess($ServiceName, 'Stop and remove AgentCanvas Windows service')) { return }
    if ($service.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
    Invoke-Native (Join-Path $env:WINDIR 'System32\sc.exe') @('delete', $ServiceName)
    if (Test-Path $serviceHostPath) { Remove-Item -LiteralPath $serviceHostPath -Force }
    Write-Output "Removed $ServiceName. Data and logs were preserved at $DataPath."
}

switch ($Action) {
    'Install' { Install-AgentCanvasService }
    'Uninstall' { Uninstall-AgentCanvasService }
    'Start' { Assert-Administrator; Start-Service -Name $ServiceName }
    'Stop' { Assert-Administrator; Stop-Service -Name $ServiceName }
    'Restart' { Assert-Administrator; Restart-Service -Name $ServiceName }
    'Status' {
        $service = Get-ServiceRecord
        if ($service) { $service | Select-Object Name, Status, StartType } else { Write-Output "$ServiceName is not installed." }
    }
}
