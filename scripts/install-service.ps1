<#
.SYNOPSIS
    Installs Nobø Web Control as a Windows Service using NSSM.

.DESCRIPTION
    This script:
    1. Checks whether NSSM (Non-Sucking Service Manager) is available.
    2. If not found, downloads it automatically from nssm.cc.
    3. Creates and starts a Windows Service named "NoboWebControl" that
       runs server.py through the virtual-environment Python interpreter.
    4. Configures the service for Automatic startup with restart-on-failure.
    5. Logs stdout and stderr to the logs\ directory under the install root.

.PARAMETER InstallDir
    Path to the nobo-web-control repository clone.
    Defaults to the directory that contains this script's parent folder.

.PARAMETER NoboSerial
    Nobø Hub serial number (12 digits).  Leave as "111111111111" for demo mode.

.PARAMETER NoboIp
    Nobø Hub IP address.  Not required in demo mode.

.PARAMETER NoboDemo
    Set to "true" to force demo mode regardless of the serial number.

.EXAMPLE
    # Install in demo mode (default serial triggers demo automatically)
    .\install-service.ps1

    # Install pointing at a real hub
    .\install-service.ps1 -NoboSerial "123456789012" -NoboIp "192.168.1.100"

.NOTES
    Requires: Administrator privileges, Python 3.8+, pip
    NSSM home page: https://nssm.cc
#>

[CmdletBinding()]
param(
    [string]$InstallDir  = (Split-Path -Parent $PSScriptRoot),
    [string]$NoboSerial  = "111111111111",
    [string]$NoboIp      = "10.0.0.100",
    [string]$NoboDemo    = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$ServiceName  = "NoboWebControl"
$ServiceLabel = "Nobø Web Control"
$ServerScript = Join-Path $InstallDir "server.py"
$VenvPython   = Join-Path $InstallDir "venv\Scripts\python.exe"
$LogDir       = Join-Path $InstallDir "logs"
$NssmVersion  = "2.24"
$NssmUrl      = "https://nssm.cc/release/nssm-$NssmVersion.zip"
$NssmCacheDir = Join-Path $env:TEMP "nssm-$NssmVersion"
$NssmExe      = Join-Path $NssmCacheDir "nssm-$NssmVersion\win64\nssm.exe"

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

function Write-Step([string]$msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Require-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "This script must be run as Administrator."
        exit 1
    }
}

function Find-Nssm {
    # 1. Already on PATH
    $inPath = Get-Command nssm -ErrorAction SilentlyContinue
    if ($inPath) { return $inPath.Source }

    # 2. Previously cached by this script
    if (Test-Path $NssmExe) { return $NssmExe }

    return $null
}

function Download-Nssm {
    Write-Step "Downloading NSSM $NssmVersion from $NssmUrl"
    $zipPath = Join-Path $env:TEMP "nssm-$NssmVersion.zip"
    Invoke-WebRequest -Uri $NssmUrl -OutFile $zipPath -UseBasicParsing
    Expand-Archive -Path $zipPath -DestinationPath $NssmCacheDir -Force
    Remove-Item $zipPath -Force
    Write-Host "NSSM extracted to: $NssmExe" -ForegroundColor Green
    return $NssmExe
}

function Get-PythonExe {
    if (Test-Path $VenvPython) { return $VenvPython }

    # Fall back to system Python
    $sys = Get-Command python -ErrorAction SilentlyContinue
    if ($sys) { return $sys.Source }

    Write-Error "Python not found.  Create a virtualenv at '$InstallDir\venv' or install Python and add it to PATH."
    exit 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

Require-Admin

Write-Step "Checking prerequisites"
Write-Host "Install dir : $InstallDir"
Write-Host "Server script: $ServerScript"

if (-not (Test-Path $ServerScript)) {
    Write-Error "server.py not found at '$ServerScript'.  Check -InstallDir."
    exit 1
}

# Locate or download NSSM
$nssm = Find-Nssm
if (-not $nssm) {
    $nssm = Download-Nssm
}
Write-Host "NSSM        : $nssm" -ForegroundColor Green

# Locate Python
$pythonExe = Get-PythonExe
Write-Host "Python      : $pythonExe" -ForegroundColor Green

# Create logs directory
Write-Step "Creating logs directory"
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
Write-Host "Logs dir    : $LogDir"

# Remove any previous service installation
if (& $nssm status $ServiceName 2>$null) {
    Write-Step "Removing existing '$ServiceName' service"
    & $nssm stop    $ServiceName confirm 2>$null
    & $nssm remove  $ServiceName confirm
}

# Install the service
Write-Step "Installing Windows Service '$ServiceName'"
& $nssm install $ServiceName $pythonExe "$ServerScript"
if ($LASTEXITCODE -ne 0) { Write-Error "NSSM install failed."; exit 1 }

# Service metadata
& $nssm set $ServiceName Description  "Local web control for Nobø Energy Hub (https://github.com/aba1975/nobo-web-control)"
& $nssm set $ServiceName DisplayName  $ServiceLabel
& $nssm set $ServiceName Start        SERVICE_AUTO_START
& $nssm set $ServiceName AppDirectory $InstallDir

# Environment variables
& $nssm set $ServiceName AppEnvironmentExtra `
    "NOBO_SERIAL=$NoboSerial" `
    "NOBO_IP=$NoboIp" `
    "NOBO_DEMO=$NoboDemo"

# Logging
& $nssm set $ServiceName AppStdout    (Join-Path $LogDir "nobo-stdout.log")
& $nssm set $ServiceName AppStderr    (Join-Path $LogDir "nobo-stderr.log")
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 10485760   # 10 MB per log file

# Restart on failure
& $nssm set $ServiceName AppExit      Default Restart
& $nssm set $ServiceName AppRestartDelay 5000       # 5 seconds before restart

# Start the service immediately
Write-Step "Starting service"
& $nssm start $ServiceName
if ($LASTEXITCODE -ne 0) { Write-Warning "Service start failed — check 'sc query $ServiceName' for details." }

Write-Host "`n✅  Service '$ServiceName' installed and started." -ForegroundColor Green
Write-Host "   Startup type : Automatic (starts on every reboot)"
Write-Host "   Logs         : $LogDir"
Write-Host "   Control      : sc start|stop|query $ServiceName"
Write-Host "   Web UI       : http://localhost:8000"
