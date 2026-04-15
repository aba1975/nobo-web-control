<#
.SYNOPSIS
    Creates a Windows Task Scheduler task that starts Nobø Web Control at system startup.

.DESCRIPTION
    Registers a scheduled task named "NoboWebControl" that:
    - Triggers at system startup (before any user logs in)
    - Runs with SYSTEM privileges (highest)
    - Restarts automatically on failure (up to 3 retries, 1 minute apart)
    - Keeps running indefinitely

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
    # Install in demo mode
    .\install-task.ps1

    # Install pointing at a real hub
    .\install-task.ps1 -NoboSerial "123456789012" -NoboIp "192.168.1.100"

.NOTES
    Requires: Administrator privileges, Python 3.8+
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

$TaskName     = "NoboWebControl"
$TaskDesc     = "Nobø Web Control — local heating management web server"
$ServerScript = Join-Path $InstallDir "server.py"
$VenvPython   = Join-Path $InstallDir "venv\Scripts\python.exe"
$LogDir       = Join-Path $InstallDir "logs"

function Require-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "This script must be run as Administrator."
        exit 1
    }
}

function Get-PythonExe {
    if (Test-Path $VenvPython) { return $VenvPython }
    $sys = Get-Command python -ErrorAction SilentlyContinue
    if ($sys) { return $sys.Source }
    Write-Error "Python not found.  Create a virtualenv at '$InstallDir\venv' or install Python and add it to PATH."
    exit 1
}

Require-Admin

Write-Host "`n==> Checking prerequisites" -ForegroundColor Cyan
if (-not (Test-Path $ServerScript)) {
    Write-Error "server.py not found at '$ServerScript'.  Check -InstallDir."
    exit 1
}

$pythonExe = Get-PythonExe
Write-Host "Python      : $pythonExe" -ForegroundColor Green

# Create logs directory
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# Build environment variable string for the wrapper command
$envVars = @(
    "NOBO_SERIAL=$NoboSerial",
    "NOBO_IP=$NoboIp"
)
if ($NoboDemo) { $envVars += "NOBO_DEMO=$NoboDemo" }

# We run the server via cmd /C so we can set env vars inline
# and redirect output to a log file.
$cmdArgs  = "/C set `"NOBO_SERIAL=$NoboSerial`" && set `"NOBO_IP=$NoboIp`""
if ($NoboDemo) { $cmdArgs += " && set `"NOBO_DEMO=$NoboDemo`"" }
$logFile  = Join-Path $LogDir "nobo-task.log"
$cmdArgs += " && `"$pythonExe`" `"$ServerScript`" >> `"$logFile`" 2>&1"

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "==> Removing existing task '$TaskName'" -ForegroundColor Cyan
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Write-Host "==> Creating Task Scheduler task '$TaskName'" -ForegroundColor Cyan

# Build the action, trigger, settings, and principal objects
$action   = New-ScheduledTaskAction `
    -Execute  "cmd.exe" `
    -Argument $cmdArgs `
    -WorkingDirectory $InstallDir

$trigger  = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit       (New-TimeSpan -Days 0) `
    -RestartCount             3 `
    -RestartInterval          (New-TimeSpan -Minutes 1) `
    -MultipleInstances        IgnoreNew `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId    "SYSTEM" `
    -LogonType ServiceAccount `
    -RunLevel  Highest

Register-ScheduledTask `
    -TaskName   $TaskName `
    -Description $TaskDesc `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -Principal  $principal `
    -Force | Out-Null

# Start immediately
Write-Host "==> Starting task now" -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

Write-Host "`n✅  Task '$TaskName' registered and started." -ForegroundColor Green
Write-Host "   Trigger : At system startup"
Write-Host "   Runs as : SYSTEM (highest privileges)"
Write-Host "   Log file: $logFile"
Write-Host "   Web UI  : http://localhost:8000"
Write-Host "   To view : Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo"
