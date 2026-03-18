#Requires -Version 5.1
<#
.SYNOPSIS
    PowerShell ISE Redeploy Script for Nobø Web Control
.DESCRIPTION
    Step-by-step redeploy script that removes any existing installation and performs
    a clean fresh deployment of the Nobø Web Control system.
    Designed for PowerShell ISE — run each step by selecting it and pressing F8.
    Each numbered step is self-contained and can be run independently.
.NOTES
    Repository : https://github.com/aba1975/nobo-web-control
    Branch     : copilot/consolidate-feature-work-from-pr-7-8-9
    Requires   : PowerShell 5.1 or later, Git, Python 3.10+
#>

# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 0 — Configuration Variables                           ║
# ║  Edit these values before running any other step.           ║
# ╚══════════════════════════════════════════════════════════════╝

$InstallDir    = "C:\nobo-web-control"
$PythonVersion = "3.10"                                          # Minimum required
$PythonExe     = $null                                           # Resolved in Step 2 (python / py / python3)
$ServerPort    = 8000
$NoboSerial    = "111111111111"                                  # 12-digit hub serial (demo default)
$NoboIP        = "10.0.0.100"                                   # Hub IP address
$DemoMode      = $true                                           # $true = demo mode, $false = real hub
$Branch        = "copilot/consolidate-feature-work-from-pr-7-8-9"
$RepoUrl       = "https://github.com/aba1975/nobo-web-control.git"
# Fallback commit SHA — use when git checkout $Branch fails (e.g. old Git clients)
$FallbackSHA   = "047ec3394fc66a2c6507f391983b2fc64b50372c"

Write-Host "`nNobø Web Control — Redeploy Script" -ForegroundColor Cyan
Write-Host "===================================" -ForegroundColor Cyan
Write-Host "  This script removes any existing installation and deploys a fresh copy." -ForegroundColor Yellow
Write-Host "  Install dir : $InstallDir" -ForegroundColor White
Write-Host "  Branch      : $Branch" -ForegroundColor White
Write-Host "  Demo mode   : $DemoMode" -ForegroundColor White
Write-Host "  Server port : $ServerPort" -ForegroundColor White
if (-not $DemoMode) {
    Write-Host "  Hub serial  : $NoboSerial" -ForegroundColor White
    Write-Host "  Hub IP      : $NoboIP" -ForegroundColor White
}
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
Write-Host "  Checking port $ServerPort for listening processes ..." -ForegroundColor Cyan
try {
    $netstatOutput = & netstat -ano 2>&1 | Select-String ":$ServerPort\s"
    if ($netstatOutput) {
        Write-Host "  [INFO] Processes on port $ServerPort`:" -ForegroundColor Yellow
        foreach ($line in $netstatOutput) {
            Write-Host "    $line" -ForegroundColor Yellow
            if ($line -match '\s+(\d+)\s*$') {
                $pidPort = [int]$Matches[1]
                if ($pidPort -gt 0) {
                    try {
                        $procPort = Get-Process -Id $pidPort -ErrorAction SilentlyContinue
                        if ($procPort) {
                            Write-Host "    PID $pidPort = $($procPort.Name)" -ForegroundColor Yellow
                            Stop-Process -Id $pidPort -Force
                            Write-Host "  [OK] Stopped PID $pidPort." -ForegroundColor Green
                            $serverStopped = $true
                        }
                    } catch {
                        Write-Host "  [WARN] Could not stop PID $pidPort : $_" -ForegroundColor Yellow
                    }
                }
            }
        }
    } else {
        Write-Host "  [OK] No process listening on port $ServerPort." -ForegroundColor Green
    }
} catch {
    Write-Host "  [WARN] Could not run netstat: $_" -ForegroundColor Yellow
}

if (-not $serverStopped) {
    Write-Host "  [OK] No running server process found." -ForegroundColor Green
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 2 — Detect Python Executable                          ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Detecting Python executable ===" -ForegroundColor Cyan

$PythonCandidates = @("python", "py", "python3")
$PythonExe = $null

foreach ($candidate in $PythonCandidates) {
    try {
        $pyVerOutput = & $candidate --version 2>&1
        if ($pyVerOutput -match 'Python\s+([\d.]+)') {
            $foundVersion = [version]$Matches[1]
            $minVersion   = [version]$PythonVersion
            if ($foundVersion -ge $minVersion) {
                $PythonExe = $candidate
                Write-Host "  [OK] Python: $pyVerOutput (via '$candidate')" -ForegroundColor Green
                break
            } else {
                Write-Host "  [INFO] '$candidate' reports $pyVerOutput but $PythonVersion+ required — skipping." -ForegroundColor Yellow
            }
        }
    } catch {
        # candidate not found; try the next one
    }
}

if (-not $PythonExe) {
    Write-Host "  [FAIL] Python $PythonVersion+ not found." -ForegroundColor Red
    Write-Host "         Tried: $($PythonCandidates -join ', ')" -ForegroundColor Yellow
    Write-Host "         Download: https://www.python.org/downloads/" -ForegroundColor Yellow
    Write-Host "         After installing, check 'Add Python to PATH', or use the Python Launcher." -ForegroundColor Yellow
    Write-Host "         Try running manually: py --version  or  python3 --version" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] Using '$PythonExe' for all subsequent steps." -ForegroundColor Green
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 3 — Remove Old Installation                           ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Removing old installation ===" -ForegroundColor Cyan

if (-not (Test-Path $InstallDir)) {
    Write-Host "  [INFO] No existing installation found at $InstallDir." -ForegroundColor Cyan
} else {
    # Deactivate venv if currently active
    if ($env:VIRTUAL_ENV) {
        Write-Host "  [INFO] Deactivating virtual environment: $env:VIRTUAL_ENV" -ForegroundColor Yellow
        try {
            deactivate
            Write-Host "  [OK] Virtual environment deactivated." -ForegroundColor Green
        } catch {
            $env:VIRTUAL_ENV = $null
            $env:PATH = ($env:PATH -split ';' | Where-Object { $_ -notmatch [regex]::Escape($InstallDir) }) -join ';'
            Write-Host "  [OK] Virtual environment deactivated (env vars cleared)." -ForegroundColor Green
        }
    }

    # Remove the installation directory
    Write-Host "  Removing $InstallDir ..." -ForegroundColor Cyan
    try {
        Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction Stop
        Write-Host "  [OK] Removed: $InstallDir" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] Could not remove $InstallDir : $_" -ForegroundColor Red
        Write-Host "         Possible causes: locked files, permission denied." -ForegroundColor Yellow
        Write-Host "         Ensure Step 1 stopped the server, close Explorer windows" -ForegroundColor Yellow
        Write-Host "         pointing to $InstallDir, then re-run this step." -ForegroundColor Yellow
        Write-Host "         Or run PowerShell as Administrator." -ForegroundColor Yellow
    }

    # Remove desktop shortcut
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $batFile     = Join-Path $desktopPath "NoboWebControl.bat"
    if (Test-Path $batFile) {
        try {
            Remove-Item -Path $batFile -Force
            Write-Host "  [OK] Removed desktop shortcut: $batFile" -ForegroundColor Green
        } catch {
            Write-Host "  [WARN] Could not remove desktop shortcut: $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  [INFO] Desktop shortcut not found — skipping." -ForegroundColor Cyan
    }
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 4 — Clone and Checkout Repository                     ║
# ╚══════════════════════════════════════════════════════════════╝
#
# NOTE: Branch names with forward slashes (e.g. "org/feature") break
#       "git clone --branch". We use a two-step clone + fetch approach.

Write-Host "`n=== Cloning repository ===" -ForegroundColor Cyan

try {
    # Step 4a — Create install directory and clone
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Write-Host "  [OK] Created directory: $InstallDir" -ForegroundColor Green
    }

    Write-Host "  Cloning $RepoUrl into $InstallDir ..." -ForegroundColor Cyan
    & git clone $RepoUrl $InstallDir
    if ($LASTEXITCODE -ne 0) { throw "git clone failed (exit code $LASTEXITCODE)" }
    Write-Host "  [OK] Clone complete." -ForegroundColor Green

    # Step 4b — Fetch and checkout the target branch
    Set-Location $InstallDir

    Write-Host "  Fetching branch: $Branch ..." -ForegroundColor Cyan
    & git fetch origin $Branch
    if ($LASTEXITCODE -ne 0) { throw "git fetch failed (exit code $LASTEXITCODE)" }

    Write-Host "  Checking out: $Branch ..." -ForegroundColor Cyan
    & git checkout $Branch
    if ($LASTEXITCODE -ne 0) { throw "git checkout failed (exit code $LASTEXITCODE)" }

    Write-Host "  [OK] Branch '$Branch' checked out." -ForegroundColor Green

    # Verify server.py
    if (Test-Path (Join-Path $InstallDir "server.py")) {
        Write-Host "  [OK] Verified: server.py exists." -ForegroundColor Green
    } else {
        Write-Host "  [WARN] server.py not found. The checkout may be on the wrong branch." -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [FAIL] Repository setup failed: $_" -ForegroundColor Red
    Write-Host "  Fallback: try checking out by commit SHA instead:" -ForegroundColor Yellow
    Write-Host "    cd $InstallDir" -ForegroundColor Yellow
    Write-Host "    git checkout $FallbackSHA" -ForegroundColor Yellow
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 5 — Create Python Virtual Environment                 ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Creating Python virtual environment ===" -ForegroundColor Cyan
Set-Location $InstallDir

if (-not $PythonExe) {
    Write-Host "  [ERROR] PythonExe is not set. Ensure Step 2 (Python detection) completed successfully." -ForegroundColor Red
    return
}

$venvDir    = Join-Path $InstallDir "venv"
$activatePs = Join-Path $venvDir "Scripts\Activate.ps1"

try {
    Write-Host "  Creating venv in $venvDir (using '$PythonExe') ..." -ForegroundColor Cyan
    & $PythonExe -m venv venv
    if ($LASTEXITCODE -ne 0) { throw "$PythonExe -m venv failed (exit code $LASTEXITCODE)" }
    Write-Host "  [OK] Virtual environment created." -ForegroundColor Green

    # Activate
    if (Test-Path $activatePs) {
        & $activatePs
        Write-Host "  [OK] Virtual environment activated." -ForegroundColor Green
        $pyInVenv = & "$InstallDir\venv\Scripts\python.exe" -c "import sys; print(sys.executable)" 2>&1
        Write-Host "  Python in use: $pyInVenv" -ForegroundColor Cyan
    } else {
        throw "Activate.ps1 not found at $activatePs"
    }
} catch {
    Write-Host "  [FAIL] Virtual environment setup failed: $_" -ForegroundColor Red
    Write-Host "         Ensure Python 3.10+ is installed and on PATH." -ForegroundColor Yellow
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 6 — Install Python Dependencies                       ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Installing Python dependencies ===" -ForegroundColor Cyan

# Re-activate in case this step is run independently
$activatePs = Join-Path $InstallDir "venv\Scripts\Activate.ps1"
if (Test-Path $activatePs) { & $activatePs }

$reqFile = Join-Path $InstallDir "requirements.txt"

try {
    if (Test-Path $reqFile) {
        Write-Host "  Installing from requirements.txt ..." -ForegroundColor Cyan
        & pip install -r $reqFile
        if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt failed" }
    } else {
        # Fallback: install packages individually with minimum version requirements
        Write-Host "  requirements.txt not found — installing packages individually ..." -ForegroundColor Yellow
        $packages = @(
            "fastapi>=0.100.0",
            "uvicorn[standard]>=0.23.0",
            "pynobo>=1.8.0",
            "pydantic>=2.0.0",
            "websockets>=11.0"
        )
        foreach ($pkg in $packages) {
            Write-Host "  Installing $pkg ..." -ForegroundColor Cyan
            & pip install $pkg
            if ($LASTEXITCODE -ne 0) { Write-Host "  [WARN] Failed to install $pkg" -ForegroundColor Yellow }
        }
    }
    Write-Host "  [OK] Dependencies installed." -ForegroundColor Green
    Write-Host "`n  Installed packages:" -ForegroundColor Cyan
    & pip list --format=columns | Select-String -Pattern "fastapi|uvicorn|pynobo|pydantic|websockets" | ForEach-Object {
        Write-Host "    $_" -ForegroundColor Green
    }
} catch {
    Write-Host "  [FAIL] Dependency installation failed: $_" -ForegroundColor Red
    Write-Host "         Try: pip install pynobo --upgrade" -ForegroundColor Yellow
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 7 — Create Configuration Files                        ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Creating configuration files ===" -ForegroundColor Cyan

# Generate .env file
$envFile   = Join-Path $InstallDir ".env"
$demoValue = if ($DemoMode) { "true" } else { "false" }

$envContent = @"
# Nobø Web Control — Environment Configuration
# Generated by Redeploy-NoboWebControl.ps1

NOBO_SERIAL=$NoboSerial
NOBO_IP=$NoboIP
NOBO_DEMO=$demoValue
SERVER_PORT=$ServerPort
"@

try {
    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Host "  [OK] Created .env: $envFile" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Could not write .env file: $_" -ForegroundColor Yellow
}

# Generate nobo-config.ps1 helper (sets env vars for current session)
$configPs1     = Join-Path $InstallDir "nobo-config.ps1"
$configContent = @"
# Nobø Web Control — Session Environment Variables
# Run this script (or dot-source it) to configure the current PowerShell session:
#   . .\nobo-config.ps1

`$env:NOBO_SERIAL = "$NoboSerial"
`$env:NOBO_IP     = "$NoboIP"
`$env:NOBO_DEMO   = "$demoValue"
`$env:SERVER_PORT = "$ServerPort"

Write-Host "Nobø environment variables set for this session." -ForegroundColor Green
"@

try {
    Set-Content -Path $configPs1 -Value $configContent -Encoding UTF8
    Write-Host "  [OK] Created nobo-config.ps1: $configPs1" -ForegroundColor Green
    Write-Host "       Dot-source it to load vars: . .\nobo-config.ps1" -ForegroundColor Cyan
} catch {
    Write-Host "  [WARN] Could not write nobo-config.ps1: $_" -ForegroundColor Yellow
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 8 — Verify Installation                               ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Verifying installation ===" -ForegroundColor Cyan

$requiredFiles = @(
    "server.py",
    "static\index.html",
    "static\app.js",
    "static\style.css",
    "static\images\ntb-2r.svg",
    "static\images\r80-rdc-700.svg"
)

$allFilesOk = $true
foreach ($rel in $requiredFiles) {
    $full = Join-Path $InstallDir $rel
    if (Test-Path $full) {
        Write-Host "  [OK] $rel" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $rel" -ForegroundColor Red
        $allFilesOk = $false
    }
}

# Check Python modules
$activatePs = Join-Path $InstallDir "venv\Scripts\Activate.ps1"
if (Test-Path $activatePs) { & $activatePs }

$venvPython = Join-Path $InstallDir "venv\Scripts\python.exe"
$pyRunner   = if (Test-Path $venvPython) { $venvPython } else { $PythonExe }

Write-Host "`n  Checking Python modules ..." -ForegroundColor Cyan
$moduleCheck = & $pyRunner -c "import fastapi; import pynobo; import uvicorn; print('All modules OK')" 2>&1
if ($moduleCheck -match "All modules OK") {
    Write-Host "  [OK] $moduleCheck" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Module check: $moduleCheck" -ForegroundColor Red
    Write-Host "         Run: pip install pynobo --upgrade" -ForegroundColor Yellow
}

Write-Host "`n--- Installation Summary ---" -ForegroundColor Cyan
Write-Host "  Install directory : $InstallDir" -ForegroundColor White
Write-Host "  Branch            : $Branch" -ForegroundColor White
Write-Host "  Demo mode         : $DemoMode" -ForegroundColor White
if ($allFilesOk) {
    Write-Host "  File check        : All files present" -ForegroundColor Green
} else {
    Write-Host "  File check        : Some files missing — review above" -ForegroundColor Red
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 9 — Start the Server                                  ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Starting the server ===" -ForegroundColor Cyan

# Set environment variables for this session
$env:NOBO_SERIAL = $NoboSerial
$env:NOBO_IP     = $NoboIP
$env:NOBO_DEMO   = if ($DemoMode) { "true" } else { "false" }
$env:SERVER_PORT = "$ServerPort"

Write-Host "  Environment variables set:" -ForegroundColor Cyan
Write-Host "    NOBO_SERIAL = $env:NOBO_SERIAL"
Write-Host "    NOBO_IP     = $env:NOBO_IP"
Write-Host "    NOBO_DEMO   = $env:NOBO_DEMO"
Write-Host "    SERVER_PORT = $env:SERVER_PORT"

if ($DemoMode) {
    Write-Host "`n  [INFO] Running in DEMO MODE — no real Nobø Hub required." -ForegroundColor Yellow
} else {
    Write-Host "`n  [INFO] Connecting to real hub at $NoboIP (serial: $NoboSerial)" -ForegroundColor Cyan
}

# Activate venv
$activatePs = Join-Path $InstallDir "venv\Scripts\Activate.ps1"
if (Test-Path $activatePs) { & $activatePs }

Set-Location $InstallDir

Write-Host "`n  Starting server on port $ServerPort ..." -ForegroundColor Cyan
Write-Host "  Access the UI at: http://localhost:$ServerPort" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop the server.`n" -ForegroundColor Yellow

# Start the server (blocking — runs until Ctrl+C)
$venvPython = Join-Path $InstallDir "venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    & $venvPython server.py
} elseif ($PythonExe) {
    & $PythonExe server.py
} else {
    Write-Host "  [ERROR] No Python executable found. Run Steps 2 and 5 first." -ForegroundColor Red
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 10 — Create Desktop Shortcut (Optional)               ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Creating desktop shortcut ===" -ForegroundColor Cyan

$demoValue   = if ($DemoMode) { "true" } else { "false" }
$startScript = Join-Path $InstallDir "Start-NoboWebControl.ps1"
$venvPython  = Join-Path $InstallDir "venv\Scripts\python.exe"

$startContent = @"
# Nobø Web Control — Startup Script
# Double-click or run from PowerShell to start the server.

`$env:NOBO_SERIAL = "$NoboSerial"
`$env:NOBO_IP     = "$NoboIP"
`$env:NOBO_DEMO   = "$demoValue"
`$env:SERVER_PORT = "$ServerPort"

Set-Location "$InstallDir"
& "$InstallDir\venv\Scripts\Activate.ps1"

Write-Host "Starting Nobø Web Control on port $ServerPort ..." -ForegroundColor Cyan
Start-Process "http://localhost:$ServerPort"
& "$venvPython" server.py
"@

try {
    Set-Content -Path $startScript -Value $startContent -Encoding UTF8
    Write-Host "  [OK] Created startup script: $startScript" -ForegroundColor Green
} catch {
    Write-Host "  [WARN] Could not create startup script: $_" -ForegroundColor Yellow
}

# Create a .bat launcher on the Desktop
$desktopPath = [Environment]::GetFolderPath("Desktop")
$batFile     = Join-Path $desktopPath "NoboWebControl.bat"

$batContent = @"
@echo off
title Nobo Web Control
powershell.exe -ExecutionPolicy Bypass -File "$startScript"
pause
"@

try {
    Set-Content -Path $batFile -Value $batContent -Encoding ASCII
    Write-Host "  [OK] Desktop shortcut created: $batFile" -ForegroundColor Green
    Write-Host "       Double-click it to start the server and open the browser." -ForegroundColor Cyan
} catch {
    Write-Host "  [WARN] Could not create desktop shortcut: $_" -ForegroundColor Yellow
    Write-Host "         You can still start the server manually using Step 9." -ForegroundColor Yellow
}
