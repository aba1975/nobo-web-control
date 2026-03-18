#Requires -Version 5.1
<#
.SYNOPSIS
    PowerShell ISE Removal Script for Nobø Web Control
.DESCRIPTION
    Step-by-step removal script that completely uninstalls the Nobø Web Control system.
    Designed for PowerShell ISE — run each step by selecting it and pressing F8.
    Each numbered step is self-contained and can be run independently.
.NOTES
    Repository : https://github.com/aba1975/nobo-web-control
    Branch     : copilot/consolidate-feature-work-from-pr-7-8-9
    Requires   : PowerShell 5.1 or later
#>

# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 0 — Configuration Variables                           ║
# ║  Edit these values to match your deployment.                ║
# ╚══════════════════════════════════════════════════════════════╝

$InstallDir = "C:\nobo-web-control"   # Must match Deploy-NoboWebControl.ps1

Write-Host "`nNobø Web Control — Removal Script" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host "  The following will be removed:" -ForegroundColor Yellow
Write-Host "    Installation directory : $InstallDir" -ForegroundColor White
Write-Host "    Desktop shortcut       : NoboWebControl.bat" -ForegroundColor White
Write-Host "    Startup script         : Start-NoboWebControl.ps1 (in install dir)" -ForegroundColor White
Write-Host "    Environment variables  : NOBO_SERIAL, NOBO_IP, NOBO_DEMO, SERVER_PORT" -ForegroundColor White
Write-Host "`n  Run each step below (select + F8) to proceed." -ForegroundColor Cyan


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 1 — Stop Running Server                               ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Stopping running server ===" -ForegroundColor Cyan

$serverStopped = $false

# Check for python/py/python3 processes running server.py from the install dir
$pythonNames = @("python", "py", "python3")
foreach ($name in $pythonNames) {
    try {
        $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
        foreach ($proc in $procs) {
            try {
                $cmdLine = (Get-WmiObject Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
                if ($cmdLine -and $cmdLine -match [regex]::Escape($InstallDir) -and $cmdLine -match "server\.py") {
                    Write-Host "  [FOUND] Server process: PID $($proc.Id) ($name)" -ForegroundColor Yellow
                    Write-Host "          Command: $cmdLine" -ForegroundColor Yellow
                    try {
                        Stop-Process -Id $proc.Id -Force
                        Write-Host "  [OK] Stopped process PID $($proc.Id)." -ForegroundColor Green
                        $serverStopped = $true
                    } catch {
                        Write-Host "  [WARN] Could not stop PID $($proc.Id): $_" -ForegroundColor Yellow
                    }
                }
            } catch {
                # WMI query failed for this process — skip
            }
        }
    } catch {
        # Process not found — skip
    }
}

# Also check for any process listening on port 8000
Write-Host "  Checking port 8000 for listening processes ..." -ForegroundColor Cyan
try {
    $netstatOutput = & netstat -ano 2>&1 | Select-String ":8000\s"
    if ($netstatOutput) {
        Write-Host "  [INFO] Processes on port 8000:" -ForegroundColor Yellow
        foreach ($line in $netstatOutput) {
            Write-Host "    $line" -ForegroundColor Yellow
            # Extract PID from last column
            if ($line -match '\s+(\d+)\s*$') {
                $pid8000 = [int]$Matches[1]
                if ($pid8000 -gt 0) {
                    try {
                        $proc8000 = Get-Process -Id $pid8000 -ErrorAction SilentlyContinue
                        if ($proc8000) {
                            Write-Host "    PID $pid8000 = $($proc8000.Name)" -ForegroundColor Yellow
                            Stop-Process -Id $pid8000 -Force
                            Write-Host "  [OK] Stopped PID $pid8000." -ForegroundColor Green
                            $serverStopped = $true
                        }
                    } catch {
                        Write-Host "  [WARN] Could not stop PID $pid8000: $_" -ForegroundColor Yellow
                    }
                }
            }
        }
    } else {
        Write-Host "  [OK] No process listening on port 8000." -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Could not run netstat: $_" -ForegroundColor Yellow
}

if (-not $serverStopped) {
    Write-Host "  [OK] No running server process found." -ForegroundColor Green
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 2 — Deactivate Virtual Environment                    ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Deactivating virtual environment ===" -ForegroundColor Cyan

if ($env:VIRTUAL_ENV) {
    Write-Host "  [INFO] Virtual environment is active: $env:VIRTUAL_ENV" -ForegroundColor Yellow
    try {
        deactivate
        Write-Host "  [OK] Virtual environment deactivated." -ForegroundColor Green
    } catch {
        # 'deactivate' may not be available as a function — clear env vars manually
        $env:VIRTUAL_ENV = $null
        $env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notmatch [regex]::Escape($InstallDir) }) -join ';'
        Write-Host "  [OK] Virtual environment deactivated (env vars cleared)." -ForegroundColor Green
    }
} else {
    Write-Host "  [OK] No virtual environment currently active." -ForegroundColor Green
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 3 — Remove Desktop Shortcut                           ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Removing desktop shortcut and startup script ===" -ForegroundColor Cyan

# Remove desktop .bat launcher
$desktopPath = [Environment]::GetFolderPath("Desktop")
$batFile     = Join-Path $desktopPath "NoboWebControl.bat"

if (Test-Path $batFile) {
    try {
        Remove-Item -Path $batFile -Force
        Write-Host "  [OK] Removed desktop shortcut: $batFile" -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] Could not remove $batFile : $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [INFO] Desktop shortcut not found: $batFile" -ForegroundColor Cyan
}

# Remove Start-NoboWebControl.ps1 from install dir
$startScript = Join-Path $InstallDir "Start-NoboWebControl.ps1"

if (Test-Path $startScript) {
    try {
        Remove-Item -Path $startScript -Force
        Write-Host "  [OK] Removed startup script: $startScript" -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] Could not remove $startScript : $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  [INFO] Startup script not found: $startScript" -ForegroundColor Cyan
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 4 — Remove Installation Directory                     ║
# ╚══════════════════════════════════════════════════════════════╝
#
# IMPORTANT: Set $ConfirmRemoval = $true to authorize deletion.
# This permanently deletes $InstallDir and ALL its contents.

$ConfirmRemoval = $false   # <--- Change to $true to authorize deletion

Write-Host "`n=== Removing installation directory ===" -ForegroundColor Cyan

if (-not $ConfirmRemoval) {
    Write-Host "  [SKIP] Removal not confirmed." -ForegroundColor Yellow
    Write-Host "         To authorize, set `$ConfirmRemoval = `$true in this step, then re-run." -ForegroundColor Yellow
    Write-Host "         This will permanently delete: $InstallDir" -ForegroundColor Yellow
} elseif (-not (Test-Path $InstallDir)) {
    Write-Host "  [INFO] Installation directory not found: $InstallDir" -ForegroundColor Cyan
} else {
    Write-Host "  Removing $InstallDir ..." -ForegroundColor Cyan
    try {
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction Stop
        Write-Host "  [OK] Removed: $InstallDir" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] Could not remove directory: $_" -ForegroundColor Red
        Write-Host "         Possible causes: locked files, permission denied." -ForegroundColor Yellow
        Write-Host "         Try: Stop the server (Step 1), close all Explorer windows" -ForegroundColor Yellow
        Write-Host "              pointing to $InstallDir, then re-run this step." -ForegroundColor Yellow
        Write-Host "         Or run PowerShell as Administrator." -ForegroundColor Yellow
    }
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 5 — Clean Environment Variables                       ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Cleaning environment variables ===" -ForegroundColor Cyan

$envVarsToClean = @("NOBO_SERIAL", "NOBO_IP", "NOBO_DEMO", "SERVER_PORT")
foreach ($varName in $envVarsToClean) {
    if (Test-Path "env:$varName") {
        $oldVal = (Get-Item "env:$varName").Value
        Remove-Item "env:$varName" -ErrorAction SilentlyContinue
        Write-Host "  [OK] Removed `$env:$varName (was: $oldVal)" -ForegroundColor Green
    } else {
        Write-Host "  [INFO] `$env:$varName not set — skipping." -ForegroundColor Cyan
    }
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 6 — Verification                                      ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Verifying removal ===" -ForegroundColor Cyan

$allClean = $true

# Check install directory
if (Test-Path $InstallDir) {
    Write-Host "  [WARN] Installation directory still exists: $InstallDir" -ForegroundColor Yellow
    Write-Host "         Run Step 4 with `$ConfirmRemoval = `$true to remove it." -ForegroundColor Yellow
    $allClean = $false
} else {
    Write-Host "  [OK] Installation directory removed." -ForegroundColor Green
}

# Check desktop shortcut
$desktopPath = [Environment]::GetFolderPath("Desktop")
$batFile     = Join-Path $desktopPath "NoboWebControl.bat"
if (Test-Path $batFile) {
    Write-Host "  [WARN] Desktop shortcut still exists: $batFile" -ForegroundColor Yellow
    $allClean = $false
} else {
    Write-Host "  [OK] Desktop shortcut removed." -ForegroundColor Green
}

# Check environment variables
$envVarsToCheck = @("NOBO_SERIAL", "NOBO_IP", "NOBO_DEMO", "SERVER_PORT")
$remainingVars  = $envVarsToCheck | Where-Object { Test-Path "env:$_" }
if ($remainingVars.Count -gt 0) {
    Write-Host "  [WARN] Environment variables still set: $($remainingVars -join ', ')" -ForegroundColor Yellow
    $allClean = $false
} else {
    Write-Host "  [OK] Environment variables cleared." -ForegroundColor Green
}

Write-Host "`n--- Removal Summary ---" -ForegroundColor Cyan
if ($allClean) {
    Write-Host "  Nobø Web Control has been completely removed." -ForegroundColor Green
} else {
    Write-Host "  Removal incomplete — review warnings above." -ForegroundColor Yellow
}
