# Windows Auto-Start for Nobø Web Control

This guide explains how to make **Nobø Web Control** start automatically after
a Windows reboot (e.g., after Windows Update restarts the PC) without requiring
manual PowerShell ISE interaction.

Two options are provided. **Option 1 (Windows Service via NSSM)** is recommended
for production use because it gives you proper service management, logging rotation,
and restart-on-failure. **Option 2 (Task Scheduler)** is simpler to set up if NSSM
is unavailable.

---

## Prerequisites

- **Windows 10 / 11** or **Windows Server 2019+**
- **Python 3.8 or higher** installed and on `PATH`
  (or a virtual environment at `venv\` in the install directory)
- **pip dependencies installed** — run `pip install -r requirements.txt` first
- **Administrator privileges** for both installation scripts

---

## Where things live

| Path | Purpose |
|------|---------|
| `data\demo_zones.json` | Persisted zone configuration (demo mode) |
| `data\demo_schedules.json` | Persisted weekly schedules (demo mode) |
| `data\server_state.json` | Persisted `global_mode_source` |
| `data\away_schedule.json` | Persisted away schedule |
| `data\users.json` | User accounts |
| `logs\` | Service / task log files |

The `data\` directory is created automatically on first run and is **gitignored**,
so your configuration survives git pulls.

---

## Option 1: Windows Service via NSSM (Recommended)

[NSSM (Non-Sucking Service Manager)](https://nssm.cc) wraps any executable as a
proper Windows Service with full `sc.exe` integration, automatic restart on
failure, and log rotation.

### Install

Open **PowerShell as Administrator** in the repository folder and run:

```powershell
# Demo mode (default — no real hub needed)
.\scripts\install-service.ps1

# Production mode — point at your real hub
.\scripts\install-service.ps1 -NoboSerial "123456789012" -NoboIp "192.168.1.100"
```

The script will:
1. Check for NSSM on `PATH` or in `%TEMP%\nssm-2.24\`; if not found, download it.
2. Create a service called **NoboWebControl** with `Automatic` startup.
3. Set restart-on-failure (restarts after 5 seconds).
4. Log stdout/stderr to `logs\nobo-stdout.log` and `logs\nobo-stderr.log`
   (rotated at 10 MB).
5. Start the service immediately.

#### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-InstallDir` | Parent of `scripts\` | Root of the repository clone |
| `-NoboSerial` | `111111111111` | Hub serial (demo if `111111111111`) |
| `-NoboIp` | `10.0.0.100` | Hub IP address |
| `-NoboDemo` | *(empty)* | Set to `"true"` to force demo mode |

### Uninstall

```powershell
.\scripts\uninstall-service.ps1
```

### Manage the service

```powershell
# Check status
sc.exe query NoboWebControl

# Stop / start / restart
sc.exe stop  NoboWebControl
sc.exe start NoboWebControl

# View logs (live tail)
Get-Content logs\nobo-stdout.log -Wait -Tail 50
```

---

## Option 2: Task Scheduler

If you cannot or do not want to install NSSM, use the built-in Windows
Task Scheduler.

### Install

Open **PowerShell as Administrator** in the repository folder and run:

```powershell
# Demo mode
.\scripts\install-task.ps1

# Production mode
.\scripts\install-task.ps1 -NoboSerial "123456789012" -NoboIp "192.168.1.100"
```

The script:
1. Creates a task named **NoboWebControl** that triggers at system startup.
2. Runs as `SYSTEM` with highest privileges (no user login needed).
3. Restarts up to 3 times (1 minute apart) on failure.
4. Appends stdout/stderr to `logs\nobo-task.log`.
5. Starts the task immediately.

#### Parameters

Same as Option 1 (`-InstallDir`, `-NoboSerial`, `-NoboIp`, `-NoboDemo`).

### Uninstall

```powershell
.\scripts\uninstall-task.ps1
```

### Manage the task

```powershell
# Check status
Get-ScheduledTask -TaskName NoboWebControl | Get-ScheduledTaskInfo

# Stop / start
Stop-ScheduledTask  -TaskName NoboWebControl
Start-ScheduledTask -TaskName NoboWebControl
```

---

## Confirming the server is running after a reboot

After restarting Windows, verify the server started correctly:

### 1. Check the web UI

Open `http://localhost:8000` in a browser.  You should see the Nobø Web Control interface.

### 2. Check the health endpoint

```powershell
Invoke-RestMethod http://localhost:8000/api/health
```

Expected output:

```json
{
  "status": "ok",
  "connected": true,
  "demo_mode": true,
  "timestamp": "2024-01-01T12:00:00.000000"
}
```

### 3. Check the listening port

```powershell
netstat -an | findstr ":8000"
```

You should see a line like `TCP  0.0.0.0:8000  ... LISTENING`.

### 4. Check Service logs (Option 1)

```powershell
Get-Content logs\nobo-stdout.log -Tail 30
```

Look for startup lines:

```
INFO - server - Starting Nobø Web Control Server — mode=demo
INFO - server - Config data dir: data  |  demo_zones=loaded from disk  |  global_mode_source=manual
```

### 5. Check Service / Task status

**Option 1 (Service)**:
```powershell
sc.exe query NoboWebControl
# STATE should be: RUNNING
```

**Option 2 (Task)**:
```powershell
(Get-ScheduledTask -TaskName NoboWebControl | Get-ScheduledTaskInfo).LastTaskResult
# Should be 0 (success) or 267009 (still running)
```

---

## Configuration Persistence

All runtime configuration changes you make through the web interface are
**automatically saved to disk** in the `data\` directory:

| Change | Persisted to |
|--------|-------------|
| Zone modes (comfort / eco / away / normal) | `data\demo_zones.json` |
| Zone names and icons | `data\demo_zones.json` |
| Temperature setpoints | `data\demo_zones.json` |
| Device assignments and names | `data\demo_zones.json` |
| Weekly schedules | `data\demo_schedules.json` |
| Global mode source (manual / schedule) | `data\server_state.json` |
| Away schedule | `data\away_schedule.json` |
| User accounts | `data\users.json` |

Writes are **atomic** (write to `.tmp` then rename) to prevent corruption if
the server is terminated abruptly (e.g., power loss mid-write).

On startup, the server logs which configuration was loaded:

```
INFO - Demo zones: loaded from data\demo_zones.json
```

or, on first run:

```
INFO - Demo zones: using hardcoded defaults (no persisted store found)
```

---

## Troubleshooting

### Server not starting after reboot

1. Open **Event Viewer** → Windows Logs → Application and search for `NoboWebControl`.
2. Check `logs\nobo-stderr.log` (Option 1) or `logs\nobo-task.log` (Option 2).
3. Verify Python is accessible to the SYSTEM account:

   ```powershell
   # Check the Python path used by the service
   sc.exe qc NoboWebControl
   ```

4. Ensure all pip dependencies are installed in the same Python environment:

   ```powershell
   cd C:\path\to\nobo-web-control
   .\venv\Scripts\python.exe -c "import fastapi, pynobo; print('OK')"
   ```

### Port 8000 already in use

Another process is listening on port 8000. Find it and stop it:

```powershell
netstat -ano | findstr ":8000"
# Note the PID in the last column, then:
Stop-Process -Id <PID> -Force
```

### Service fails to start — Python not found

Make sure the virtual environment exists:

```powershell
cd C:\path\to\nobo-web-control
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
```

Then reinstall the service so it picks up the new venv path:

```powershell
.\scripts\uninstall-service.ps1
.\scripts\install-service.ps1
```

### Resetting to demo defaults

If you want to clear all persisted configuration and start fresh, delete the
`data\` directory:

```powershell
Remove-Item -Recurse -Force .\data\
```

The server will recreate `data\users.json` on next startup and use
hardcoded demo defaults until you make changes through the UI.
