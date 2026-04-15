<#
.SYNOPSIS
    Uninstalls the NoboWebControl Windows Service.

.DESCRIPTION
    Stops and removes the "NoboWebControl" Windows Service that was installed
    by install-service.ps1.  The install directory and log files are left intact.

.EXAMPLE
    .\uninstall-service.ps1

.NOTES
    Requires: Administrator privileges
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ServiceName = "NoboWebControl"

function Require-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "This script must be run as Administrator."
        exit 1
    }
}

Require-Admin

# Check if service exists
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' is not installed — nothing to do." -ForegroundColor Yellow
    exit 0
}

Write-Host "==> Stopping service '$ServiceName' ..." -ForegroundColor Cyan
Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue

Write-Host "==> Removing service '$ServiceName' ..." -ForegroundColor Cyan
sc.exe delete $ServiceName | Out-Null

Write-Host "`n✅  Service '$ServiceName' removed." -ForegroundColor Green
Write-Host "   Log files and configuration in 'data\' and 'logs\' were NOT deleted."
