<#
.SYNOPSIS
    Removes the NoboWebControl Task Scheduler task.

.DESCRIPTION
    Stops and unregisters the "NoboWebControl" scheduled task that was
    created by install-task.ps1.  Log files and configuration are NOT deleted.

.EXAMPLE
    .\uninstall-task.ps1

.NOTES
    Requires: Administrator privileges
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "NoboWebControl"

function Require-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Error "This script must be run as Administrator."
        exit 1
    }
}

Require-Admin

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Task '$TaskName' is not registered — nothing to do." -ForegroundColor Yellow
    exit 0
}

# Stop if currently running
if ($task.State -eq "Running") {
    Write-Host "==> Stopping running task '$TaskName' ..." -ForegroundColor Cyan
    Stop-ScheduledTask -TaskName $TaskName
}

Write-Host "==> Unregistering task '$TaskName' ..." -ForegroundColor Cyan
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Host "`n✅  Task '$TaskName' removed." -ForegroundColor Green
Write-Host "   Log files and configuration in 'data\' and 'logs\' were NOT deleted."
