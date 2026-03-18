#Requires -Version 5.1
<#
.SYNOPSIS
    PowerShell ISE Deployment Script for Nobø Web Control
.DESCRIPTION
    Step-by-step deployment script for the Nobø Web Control system.
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

$InstallDir     = "C:\nobo-web-control"
$PythonVersion  = "3.10"                                         # Minimum required
$PythonExe      = $null                                          # Resolved in Step 1 (python / py / python3)
$ServerPort     = 8000
$NoboSerial     = "111111111111"                                  # 12-digit hub serial (demo default)
$NoboIP         = "10.0.0.100"                                   # Hub IP address
$DemoMode       = $true                                          # $true = demo mode, $false = real hub
$Branch         = "copilot/consolidate-feature-work-from-pr-7-8-9"
$RepoUrl        = "https://github.com/aba1975/nobo-web-control.git"
# Fallback commit SHA — use when git checkout $Branch fails (e.g. old Git clients)
$FallbackSHA    = "dd41aa7efc8ef9bccceeaf47d95321f0abd8bdee"

Write-Host "Configuration loaded." -ForegroundColor Cyan
Write-Host "  Install dir : $InstallDir"
Write-Host "  Branch      : $Branch"
Write-Host "  Demo mode   : $DemoMode"
Write-Host "  Server port : $ServerPort"
if (-not $DemoMode) {
    Write-Host "  Hub serial  : $NoboSerial"
    Write-Host "  Hub IP      : $NoboIP"
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 1 — Check Prerequisites                               ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Checking prerequisites ===" -ForegroundColor Cyan
$allOk = $true

# Check Python — try multiple executable names in order
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
                Write-Host "  [PASS] Python: $pyVerOutput (via '$candidate')" -ForegroundColor Green
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
    $allOk = $false
}

# Check pip
try {
    $pipVer = & pip --version 2>&1
    Write-Host "  [PASS] pip  : $pipVer" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] pip not found. Re-install Python with 'Add pip to PATH' checked." -ForegroundColor Red
    $allOk = $false
}

# Check Git
try {
    $gitVer = & git --version 2>&1
    Write-Host "  [PASS] Git  : $gitVer" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Git not found." -ForegroundColor Red
    Write-Host "         Download: https://git-scm.com/download/win" -ForegroundColor Yellow
    $allOk = $false
}

if ($allOk) {
    Write-Host "`nAll prerequisites satisfied. Proceed to Step 2." -ForegroundColor Green
} else {
    Write-Host "`nOne or more prerequisites are missing. Install them before continuing." -ForegroundColor Red
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 2 — Create Installation Directory                     ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Creating installation directory ===" -ForegroundColor Cyan

if (Test-Path $InstallDir) {
    Write-Host "  [WARN] Directory already exists: $InstallDir" -ForegroundColor Yellow
    Write-Host "         If you want a clean install, delete it manually first." -ForegroundColor Yellow
    Write-Host "         Continuing with existing directory..." -ForegroundColor Yellow
} else {
    try {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
        Write-Host "  [OK] Created: $InstallDir" -ForegroundColor Green
    } catch {
        Write-Host "  [FAIL] Could not create directory: $_" -ForegroundColor Red
        Write-Host "         Try running PowerShell as Administrator." -ForegroundColor Yellow
    }
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 3 — Clone the Repository                              ║
# ╚══════════════════════════════════════════════════════════════╝
#
# NOTE: Branch names with forward slashes (e.g. "org/feature") break
#       "git clone --branch". We use a two-step clone + fetch approach.

Write-Host "`n=== Cloning repository ===" -ForegroundColor Cyan

try {
    # Step 3a — Clone the default branch
    if (Test-Path (Join-Path $InstallDir ".git")) {
        Write-Host "  [INFO] Git repo already exists in $InstallDir. Skipping initial clone." -ForegroundColor Yellow
    } else {
        Write-Host "  Cloning $RepoUrl into $InstallDir ..." -ForegroundColor Cyan
        $cloneOutput = & git clone $RepoUrl $InstallDir 2>&1 | Out-String
        if ($LASTEXITCODE -ne 0) { throw "git clone failed (exit code $LASTEXITCODE)`n$cloneOutput" }
        Write-Host $cloneOutput -ForegroundColor DarkGray
        Write-Host "  [OK] Clone complete." -ForegroundColor Green
    }

    # Step 3b — Fetch and checkout the target branch
    Set-Location $InstallDir

    Write-Host "  Fetching branch: $Branch ..." -ForegroundColor Cyan
    $fetchOutput = & git fetch origin $Branch 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "git fetch failed (exit code $LASTEXITCODE)`n$fetchOutput" }
    Write-Host $fetchOutput -ForegroundColor DarkGray

    Write-Host "  Checking out: $Branch ..." -ForegroundColor Cyan
    $checkoutOutput = & git checkout $Branch 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "git checkout failed (exit code $LASTEXITCODE)`n$checkoutOutput" }
    Write-Host $checkoutOutput -ForegroundColor DarkGray

    Write-Host "  [OK] Branch '$Branch' checked out." -ForegroundColor Green

    # Verify
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
# ║  STEP 4 — Create Python Virtual Environment                 ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Creating Python virtual environment ===" -ForegroundColor Cyan
Set-Location $InstallDir

if (-not $PythonExe) {
    Write-Host "  [ERROR] PythonExe is not set. Ensure Step 1 (Python detection) completed successfully." -ForegroundColor Red
    return
}

$venvDir    = Join-Path $InstallDir "venv"
$activatePs = Join-Path $venvDir "Scripts\Activate.ps1"

try {
    if (Test-Path $venvDir) {
        Write-Host "  [INFO] Virtual environment already exists. Skipping creation." -ForegroundColor Yellow
    } else {
        Write-Host "  Creating venv in $venvDir (using '$PythonExe') ..." -ForegroundColor Cyan
        & $PythonExe -m venv venv
        if ($LASTEXITCODE -ne 0) { throw "$PythonExe -m venv failed (exit code $LASTEXITCODE)" }
        Write-Host "  [OK] Virtual environment created." -ForegroundColor Green
    }

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
# ║  STEP 5 — Install Python Dependencies                       ║
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
# ║  STEP 6 — Create Configuration File (Optional)             ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Creating configuration files ===" -ForegroundColor Cyan

# Generate .env file
$envFile = Join-Path $InstallDir ".env"
$demoValue = if ($DemoMode) { "true" } else { "false" }

$envContent = @"
# Nobø Web Control — Environment Configuration
# Generated by Deploy-NoboWebControl.ps1

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
$configPs1 = Join-Path $InstallDir "nobo-config.ps1"
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
# ║  STEP 7 — Verify Installation                               ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Verifying installation ===" -ForegroundColor Cyan

$requiredFiles = @(
    "server.py",
    "static\index.html",
    "static\app.js",
    "static\style.css",
    "static\images\ntb-2r.svg",
    "static\images\r80-rdc-700.svg",
    "static\images\placeholder.svg",
    "static\images\r80-rsc-700.svg",
    "static\images\r80-rxc-700.svg",
    "static\images\r80-txf-700.svg",
    "static\images\ncu-1r.svg",
    "static\images\ncu-2r.svg",
    "static\images\ncu-er.svg",
    "static\images\dcu-er.svg",
    "static\images\2nc9-700.svg",
    "static\images\tr36.svg",
    "static\images\trb-36-700.svg"
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
# ║  STEP 8 — Start the Server                                  ║
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
    Write-Host "  [ERROR] No Python executable found. Run Steps 1 and 4 first." -ForegroundColor Red
}

# Alternatively, use uvicorn directly:
# & uvicorn server:app --host 0.0.0.0 --port $ServerPort --reload


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 9 — Create Windows Desktop Shortcut (Optional)        ║
# ╚══════════════════════════════════════════════════════════════╝

Write-Host "`n=== Creating desktop shortcut ===" -ForegroundColor Cyan

$demoValue   = if ($DemoMode) { "true" } else { "false" }
$startScript = Join-Path $InstallDir "Start-NoboWebControl.ps1"

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
& "$InstallDir\venv\Scripts\python.exe" server.py
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
    Write-Host "         You can still start the server manually using Step 8." -ForegroundColor Yellow
}


# ╔══════════════════════════════════════════════════════════════╗
# ║  STEP 10 — Troubleshooting Reference                        ║
# ╚══════════════════════════════════════════════════════════════╝
#
# ── Python not found ─────────────────────────────────────────────
#   Step 1 now tries 'python', 'py' (Python Launcher for Windows),
#   and 'python3' automatically, so Python 3.14 via 'py' will be found.
#   If all three fail, install Python 3.10+ from https://www.python.org/downloads/
#   During install, check "Add Python to PATH".
#   Alternatively, open a new PowerShell window and run: py --version
#   Then restart PowerShell and re-run Step 1.
#
# ── Port 8000 already in use ─────────────────────────────────────
#   Change $ServerPort in Step 0 to a free port (e.g. 8080).
#   Or find and stop the process using port 8000:
#     netstat -ano | findstr :8000
#     taskkill /PID <PID> /F
#
# ── Permission denied / cannot create directory ──────────────────
#   Run PowerShell as Administrator.
#   Or change $InstallDir to a path you own (e.g. "$env:USERPROFILE\nobo-web-control").
#
# ── Git clone / checkout fails ───────────────────────────────────
#   Branch names with "/" can confuse some Git versions.
#   Step 3 already uses the two-step clone+fetch approach.
#   As a last resort, check out by the fallback commit SHA defined in Step 0:
#     cd C:\nobo-web-control
#     git checkout <value of $FallbackSHA from Step 0>
#
# ── Script execution policy error ────────────────────────────────
#   Run this once in an Administrator PowerShell session:
#     Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
#
# ── pynobo import error ───────────────────────────────────────────
#   Activate venv first, then upgrade:
#     & "C:\nobo-web-control\venv\Scripts\Activate.ps1"
#     pip install pynobo --upgrade
#
# ── Cannot connect to the Nobø Hub ───────────────────────────────
#   1. Verify $NoboSerial (12 digits, found on hub label).
#   2. Verify $NoboIP — check your router's device list.
#   3. Ensure no other app (e.g. official Nobø app) is connected:
#      the hub allows only one TCP connection at a time.
#   4. Try ping <hub-ip> to confirm network reachability.
#   5. Use $DemoMode = $true to test without the hub.

Write-Host "`nTroubleshooting reference printed above (read the comments in the script)." -ForegroundColor Cyan
