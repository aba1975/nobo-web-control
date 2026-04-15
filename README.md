# Nobø Energy Hub Local Control

A modern, web-based control system for the Nobø Energy Hub, providing local control of your heating system through an intuitive interface inspired by the Mill heating app.

## Features

### Core Functionality
- 🌡️ **Real-time Temperature Monitoring** - See current temperatures for all zones
- 🎛️ **Zone Control** - Individual control of each heating zone with override capabilities
- 🔥 **Multiple Modes** - Comfort, Eco, Away, and Schedule modes
- 📅 **Weekly Schedule Editor** - Configure heating schedules for each zone
- 🔧 **Device Management** - Add, remove, and replace devices with auto-detection
- 🏠 **Global Controls** - Quick Home and Away modes for all zones

### Device Support

The system supports **23 unique device models** across 26 serial number prefixes, automatically detected from the first 3 digits of each device's serial number.

| Serial Prefix(es) | Device Model | Notes |
|---|---|---|
| `000`, `210` | NTB-2R | Thermostat with floor sensor — full remote control including temperature adjustment |
| `120` | RS 700 | Panel heater receiver |
| `121` | RSX 700 | Panel heater receiver |
| `130` | RCE 700 | Panel heater receiver |
| `160`, `165` | R80 RDC 700 | Panel heater receiver — `165` is the UK/GB variant (LST) |
| `168` | NCU-2R | |
| `169` | DCU-2R | |
| `170` | Serie 18, ewt touch | |
| `180` | 2NC9 700 | |
| `182`, `183` | R80 RSC 700 | |
| `184` | NCU-1R | |
| `186` | DCU-1R | |
| `190` | Safir | |
| `192` | R80 TXF 700 | |
| `194` | R80 RXC 700 | |
| `198` | NCU-ER | |
| `199` | DCU-ER | |
| `200` | TRB 36 700 | |
| `220` | TR36 | |
| `230` | TCU 700 | |
| `231` | THB 700 | |
| `232` | TXB 700 | |
| `234` | SW4 | |

- 🎨 **Auto-Detection** - Device types automatically detected from serial number prefix
- 🔍 **Device-Aware UI** - Controls automatically adjust based on device capabilities

### User Interface
- 🗂️ **Multi-Page Navigation** - Zones, Schedule, and Devices pages with hash-based routing
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile devices
- ⚡ **Live Updates** - WebSocket-based real-time updates without page refresh
- 🎨 **Modern UI** - Clean, card-based design inspired by the Mill app
- 🌐 **Local Control** - No cloud required - works entirely on your local network
- 🧪 **Demo Mode** - Test the system without a real hub connection

## Architecture

```
nobo-web-control/
├── server.py                          # FastAPI backend using pynobo
├── auth.py                            # Session-based authentication module
├── away_schedule.py                   # Away schedule persistence & helpers
├── config_persistence.py              # Demo-zone / schedule / server-state persistence
├── static/
│   ├── index.html                     # Main webpage with 3-page navigation
│   ├── style.css                      # Styling (Mill-app inspired, card-based)
│   ├── app.js                         # Frontend logic + WebSocket for live updates
│   ├── auth.js                        # Authentication UI (user panel, admin)
│   └── images/                        # Device images (PNG + SVG per model)
│       ├── NTB-2R.png                 # NTB-2R thermostat
│       ├── R80-RDC-700.png            # R80 RDC 700 panel heater receiver
│       ├── NCU-2R.png                 # NCU-2R controller
│       ├── DCU-2R.png                 # DCU-2R controller
│       ├── 2NC9-700.png               # 2NC9 700
│       ├── ... (23 device models)     # PNG + SVG for each supported device
│       └── placeholder.svg            # Fallback for unknown devices
├── data/                              # Runtime data (gitignored)
│   ├── users.json                     # User accounts (created at first run)
│   ├── away_schedule.json             # Persisted away schedule
│   ├── demo_zones.json                # Persisted zone configuration (demo mode)
│   ├── demo_schedules.json            # Persisted weekly schedules (demo mode)
│   └── server_state.json              # Persisted global_mode_source
├── scripts/
│   ├── install-service.ps1            # Install as Windows Service (NSSM)
│   ├── uninstall-service.ps1          # Remove Windows Service
│   ├── install-task.ps1               # Install as Task Scheduler task
│   └── uninstall-task.ps1             # Remove Task Scheduler task
├── docs/
│   └── windows-autostart.md           # Windows auto-start setup guide
├── tests/
│   ├── conftest.py                    # Shared pytest fixtures (demo mode)
│   ├── test_server.py                 # Unit tests for server helpers
│   ├── test_api.py                    # API endpoint integration tests
│   ├── test_devices.py                # Device management tests
│   ├── test_serial_validation.py      # Serial number validation tests
│   ├── test_auth.py                   # Authentication tests
│   ├── test_away_schedule.py          # Away schedule feature tests
│   └── test_persistence.py            # Config persistence tests
├── Deploy-NoboWebControl.ps1          # Windows deployment script
├── Redeploy-NoboWebControl.ps1        # Windows redeployment script
├── Remove-NoboWebControl.ps1          # Windows removal/cleanup script
├── API_Nobo.pdf                       # Nobø Hub API reference
├── Manual_Nobo.pdf                    # Nobø Hub user manual
├── requirements.txt                   # Python dependencies
└── README.md                          # This file
```

## Prerequisites

- **Python 3.8 or higher**
- **pip** (Python package installer)
- **Nobø Energy Hub** on your local network (or use demo mode)
- Hub serial number and IP address (if connecting to real hub)

## Installation

1. **Clone or download this repository**

```bash
git clone https://github.com/aba1975/nobo-web-control.git
cd nobo-web-control
```

2. **Install Python dependencies**

```bash
pip install -r requirements.txt
```

## Configuration

Before running the server, you need to configure your Nobø Hub connection details.

### Finding Your Hub Information

**Serial Number:**
- Found on the back/bottom of your Nobø Hub
- 12-digit number (e.g., `123456789012`)
- Also available in the official Nobø app settings

**IP Address:**
- Check your router's connected devices list
- Look for a device named "Nobø Hub" or similar
- The IP address will be something like `192.168.1.100`

### Setting Configuration

You can configure the hub connection in two ways:

#### Option 1: Environment Variables (Recommended)

```bash
export NOBO_SERIAL="123456789012"
export NOBO_IP="192.168.1.100"
```

On Windows (Command Prompt):
```cmd
set NOBO_SERIAL=123456789012
set NOBO_IP=192.168.1.100
```

On Windows (PowerShell):
```powershell
$env:NOBO_SERIAL="123456789012"
$env:NOBO_IP="192.168.1.100"
```

#### Option 2: Edit server.py

Open `server.py` and modify these lines near the top:

```python
NOBO_SERIAL = os.environ.get('NOBO_SERIAL', '123456789012')  # Replace with your serial
NOBO_IP = os.environ.get('NOBO_IP', '192.168.1.100')  # Replace with your IP
```

#### Device Types & Auto-Detection

The system automatically detects device types from serial number prefixes:

**1. Nobø NTB-2R (Thermostat Receiver) - Serial prefix: 210**
- Full remote control with mode switching AND temperature adjustment
- Has a built-in temperature sensor
- UI shows: current temp, comfort/eco temp with +/- adjustment buttons, and mode buttons
- Blue badge in the UI

**2. Nobø R80 RDC 700 (Panel Heater Receiver) - Serial prefix: 160**
- Mode control only: can switch between Comfort/Eco/Away remotely
- Temperature is set **manually on the physical dial on the heater** — cannot be adjusted remotely
- UI shows: mode buttons only, NO temperature +/- controls
- Displays a notice: "Comfort & Eco temperatures are adjusted manually on the device"
- May still report current temperature if a sensor is connected
- Grey badge in the UI

**Auto-Detection:**
- Devices are automatically identified by their serial number prefix
- Serial numbers are displayed as: `XXX XXX XXX XXX` (e.g., `210 000 016 247`)
- No manual configuration needed!

### Demo Mode

The system includes a comprehensive demo mode for testing without a real hub:

**Enable demo mode:**
```bash
# Option 1: Use environment variable
export NOBO_DEMO=true
python server.py

# Option 2: Use the reserved demo serial number
export NOBO_SERIAL=111111111111
python server.py

# Option 3: Set --demo flag (if implemented)
python server.py --demo
```

**Demo mode features:**
- ✅ Shows 7 realistic zones with grouped rooms
- ✅ All zones with different device types (NTB-2R and R80 RDC 700)
- ✅ Realistic Norwegian indoor temperatures with slight variations
- ✅ All modes work (Comfort, Eco, Away, Schedule)
- ✅ Temperature adjustments work for NTB-2R zones
- ✅ Schedule editor with sample weekly profiles
- ✅ Device management (add/remove/replace devices)
- ✅ Live websocket updates
- ✅ Status shows "🟡 Demo Mode"

**Note:** The serial `111111111111` is reserved for demo mode and will never connect to a real hub. Use your actual 12-digit serial number when connecting to a real device.

## Running the Server

### Standard Method

```bash
python server.py
```

### Demo Mode

```bash
# Using environment variable
export NOBO_DEMO=true
python server.py

# Or using the demo serial
export NOBO_SERIAL=111111111111
python server.py
```

### Using Uvicorn Directly

```bash
uvicorn server:app --host 0.0.0.0 --port 8000
```

The server will start and display:
```
Starting Nobø Web Control Server...
Hub Serial: 123456789012
Hub IP: 192.168.1.100
Access the web interface at http://localhost:8000
```

## Accessing the Interface

Once the server is running, open your web browser and navigate to:

```
http://localhost:8000
```

Or from another device on your network:
```
http://YOUR_SERVER_IP:8000
```

Replace `YOUR_SERVER_IP` with the IP address of the computer running the server.

## Usage

### Zones Page (Home)

The main Zones page shows all your heating zones:

**Global Controls:**
- 🏠 **Home**: All zones follow their weekly schedule (default state)
- 🏖️ **Away**: All zones switch to away mode (7°C)

**Zone Cards:**
- View current temperature and mode
- See device type (NTB-2R or R80 RDC 700)
- For grouped zones, see all rooms (e.g., "North · South")
- Override individual zones: Comfort, Eco, or Away
- For NTB-2R: Adjust comfort and eco temperatures with +/- buttons
- Cancel overrides to return to schedule
- Status indicator shows if zone is following schedule or has an override

### Schedule Page

Edit weekly heating schedules for each zone:

- Select a zone from the dropdown
- View 7-day timeline with color-coded blocks
- Comfort mode = Orange, Eco mode = Green
- See when each mode is active throughout the week
- Save changes to apply new schedule

### Devices Page

Manage your heating devices:

**Add Device:**
- Enter 12-digit serial number (formatted as XXX XXX XXX XXX)
- Device type auto-detected from serial prefix
- Assign to a zone
- Click "Add Device"

**Registered Devices:**
- View all devices with their serial numbers, types, and zones
- Replace: Swap a device with a new one (keeps settings)
- Remove: Delete a device from the system

## API Endpoints

### Zones
- `GET /api/zones` - Get all zones with current status
- `POST /api/zones/{zone_id}/override/{mode}` - Set zone override (comfort/eco/away/normal)
- `POST /api/zones/{zone_id}/temperature` - Update zone temperatures (NTB-2R only)
- `GET /api/zones/{zone_id}/schedule` - Get zone weekly schedule
- `POST /api/zones/{zone_id}/schedule` - Update zone weekly schedule

### Global
- `POST /api/global/override/{mode}` - Set global override for all zones (returns `source: "manual"`)

### Scheduled Away Mode
- `GET /api/global-mode/away-schedule` - Get current away schedule
- `PUT /api/global-mode/away-schedule` - Save/update away schedule
- `DELETE /api/global-mode/away-schedule` - Clear away schedule

### Devices
- `GET /api/devices` - List all registered devices
- `POST /api/devices` - Add a new device
- `PUT /api/devices/{serial}` - Replace a device
- `DELETE /api/devices/{serial}` - Remove a device

### Hub
- `GET /api/hub` - Get hub information
- `GET /api/status` - Get connection status

### WebSocket
- `WS /ws` - WebSocket connection for real-time updates

## Important Notes

### Device Type Limitations

- **NTB-2R devices** (Serial: 210xxx): Full control including remote temperature adjustment
- **R80 RDC 700 devices** (Serial: 160xxx): Mode control only - temperature must be adjusted manually on the device's physical dial
- The UI automatically shows/hides controls based on device capabilities
- Device types are auto-detected from serial number prefixes

### Single Connection Limitation

⚠️ **The Nobø Hub only allows one TCP connection at a time.** When this web control system is connected to your hub, you cannot use the official Nobø app simultaneously. You'll need to stop the server to use the official app again.

### Network Requirements

- The server must be on the same local network as your Nobø Hub
- No internet connection is required for operation
- All communication happens locally
- Use demo mode for testing without a real hub

These icons help you quickly identify which type of device is in each zone.

## API Documentation

The server provides a REST API for integration with other systems:

### Endpoints

- `GET /api/status` - Connection status
- `GET /api/hub` - Hub information
- `GET /api/zones` - All zones with current status
- `POST /api/zones/{zone_id}/override/{mode}` - Set zone override mode
- `POST /api/zones/{zone_id}/temperature` - Set zone temperatures
- `POST /api/global/override/{mode}` - Set global override for all zones
- `GET /api/week_profiles` - Get week profiles
- `WebSocket /ws` - Real-time updates

See the source code in `server.py` for detailed API documentation.

## Troubleshooting

### Server won't start
- Check that Python 3.8+ is installed: `python --version`
- Ensure all dependencies are installed: `pip install -r requirements.txt`
- Check that port 8000 is not already in use

### Can't connect to hub
- Verify the hub serial number is correct (12 digits)
- Verify the hub IP address is correct
- Ensure the hub and server are on the same network
- Check that no other application is connected to the hub
- Try restarting the Nobø Hub

### WebSocket disconnects
- This is normal and will automatically reconnect
- Check your network stability
- Look at server logs for error messages

### Temperature changes don't apply
- Changes are debounced (500ms delay) to avoid flooding the hub
- Check the server logs for errors
- Verify the hub is responding (check connection status indicator)

## Development

### Project Structure

- **server.py**: FastAPI backend with pynobo integration
- **static/index.html**: Main HTML structure
- **static/style.css**: Styling with CSS custom properties for theming
- **static/app.js**: Frontend JavaScript with WebSocket communication
- **static/images/**: Image assets

### Running in Development Mode

For auto-reload during development:

```bash
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

### Customization

The design uses CSS custom properties (variables) defined in `style.css`, making it easy to customize colors and styling:

```css
:root {
    --color-comfort: #ff6b35;
    --color-eco: #27ae60;
    --color-away: #3498db;
    /* ... more variables ... */
}
```

## Security Considerations

- This server should only be run on a trusted local network
- There is no authentication - anyone with network access can control your heating
- Do not expose this server to the internet without proper security measures

## Authentication

The web interface is protected by a session-based authentication layer.

### Default Credentials

| Username | Password  |
|----------|-----------|
| `admin`  | `nobohub` |

> **Change the default password immediately** after first login via the 👤 user icon in the top-right corner.

### Changing the Admin Password

1. Log in with the default credentials.
2. Click the **👤** icon in the upper-right corner of the UI.
3. Expand **🔑 Change Password** and enter your current password, then your new password twice.

### User Management (Admin)

Clicking the 👤 icon and expanding **🛠️ Manage Users** lets you:
- **Add** new users with a username, password, and role (`user` or `admin`).
- **Delete** users (you cannot delete your own account).

Non-admin users can change their own password and rename their username.

### Where User Data is Stored

User accounts are stored in `data/users.json` as a JSON file with bcrypt-hashed passwords.  
The `data/` directory is created automatically on first run and is excluded from version control.

```json
{
  "admin": {
    "password_hash": "$2b$12$...",
    "role": "admin"
  }
}
```

### Security Notes

- **Passwords** are stored using bcrypt with a per-password salt — no plaintext is ever written to disk.
- **Session cookies** are `HttpOnly` (not accessible to JavaScript) and `SameSite=Lax` to mitigate CSRF. When the server is accessed over HTTPS, cookies are also marked `Secure`.
- **Brute-force protection**: after 5 consecutive failed login attempts for a username, that username is locked out for 60 seconds.
- **API and WebSocket endpoints** (`/api/*`, `/ws`) remain unauthenticated so that local integrations (e.g. Home Assistant, scripts) continue to work without modification.
- For production deployments, place the server behind a reverse proxy (e.g. nginx) with a valid TLS certificate.


Contributions are welcome! Please feel free to submit issues or pull requests.

## Scheduled Away Mode

You can schedule the system to automatically enter **GLOBAL Away** mode for a defined time window (e.g. while you're on holiday) and automatically return to **GLOBAL Home** when the window ends.

### Feature Overview

- Set a **start** and **end** date/time in ISO-8601 format
- The scheduler checks every 30 seconds and transitions the system at the correct time
- On server restart, if the current time is inside the window the system immediately enters Away mode
- When the window expires the schedule is automatically disabled and Home mode is restored
- If no schedule is set (or the schedule is disabled), manual global mode selection works exactly as before

### Example Schedule

Away from **2026-04-22 10:00 UTC** to **2026-05-01 13:00 UTC**:

```json
{
  "enabled": true,
  "start_at": "2026-04-22T10:00:00Z",
  "end_at": "2026-05-01T13:00:00Z"
}
```

### API Usage

**Get current schedule:**
```
GET /api/global-mode/away-schedule
```
Response: `{ "enabled": bool, "start_at": "...", "end_at": "...", "currently_active": bool }`

**Save/update schedule:**
```
PUT /api/global-mode/away-schedule
Content-Type: application/json

{ "enabled": true, "start_at": "2026-04-22T10:00:00Z", "end_at": "2026-05-01T13:00:00Z" }
```
- `start_at` and `end_at` must be valid ISO-8601 datetime strings with timezone offset
- `end_at` must be strictly after `start_at`
- If the request is made while the current time is already inside the window, Away mode is applied immediately
- Returns `400` for invalid input

**Clear schedule:**
```
DELETE /api/global-mode/away-schedule
```
- If the schedule was active at deletion time, the system switches back to Home mode
- Returns `{ "status": "cleared" }`

**`GET /api/status`** includes:
```json
{
  "away_schedule": { "enabled": bool, "start_at": "...", "end_at": "...", "currently_active": bool },
  "global_mode_source": "manual" | "schedule"
}
```

### Datetime Format

**API (server-side):** Use ISO-8601 strings with a timezone offset or `Z` suffix (UTC):
- `"2026-04-22T10:00:00Z"` — UTC
- `"2026-04-22T12:00:00+02:00"` — Europe/Oslo (CEST)

Naive datetimes (no timezone suffix) are treated as UTC.

**UI (browser):** Dates and times are displayed and entered in Norwegian convention:
- Date: `DD.MM.YYYY` (e.g., `22.04.2026`)
- Time: 24-hour `HH:mm` (e.g., `10:00`)
- Combined display: `22.04.2026 10:00`

The UI converts between the display format (DD.MM.YYYY HH:mm) and ISO-8601 transparently; the API always uses ISO timestamps.

### Behavior Rules

| Situation | Effective mode |
|-----------|----------------|
| Schedule active (inside window) | Away (enforced every 30 s) |
| Schedule enabled but not yet started | Manual selection works normally |
| Schedule disabled or not set | Manual selection works normally |
| Manual Away without a schedule | Stays Away until user selects another mode |

### UI

The web interface shows a collapsible **📅 Schedule Away** panel below the global mode buttons:
- Enter start/end date and time in separate fields using the format `DD.MM.YYYY` and `HH:mm`
  - Example: Start `22.04.2026` `10:00`, End `01.05.2026` `13:00`
- Click **Save Schedule** to enable
- The panel auto-opens on page load when a schedule exists
- The status line shows whether the schedule is active, upcoming, disabled, or not set
- The Away button shows a 📅 badge when the schedule is controlling the mode

### Data Storage

The schedule is persisted in `data/away_schedule.json` (same directory as user credentials). The file is created automatically on first save.

## Windows Auto-Start

To make the server start automatically after a Windows reboot (e.g., Windows Update restart),
use one of the scripts in the `scripts/` directory.

> **Full documentation**: [`docs/windows-autostart.md`](docs/windows-autostart.md)

### Quick Start — Windows Service (Recommended)

```powershell
# Open PowerShell as Administrator, then:
cd C:\path\to\nobo-web-control

# Install in demo mode
.\scripts\install-service.ps1

# Install with a real hub
.\scripts\install-service.ps1 -NoboSerial "123456789012" -NoboIp "192.168.1.100"
```

This creates a Windows Service named **NoboWebControl** that:
- Starts automatically at boot (no login needed)
- Restarts on failure after 5 seconds
- Logs to `logs\nobo-stdout.log` and `logs\nobo-stderr.log`

To remove the service:

```powershell
.\scripts\uninstall-service.ps1
```

### Alternative — Task Scheduler

```powershell
.\scripts\install-task.ps1          # install
.\scripts\uninstall-task.ps1        # remove
```

See [`docs/windows-autostart.md`](docs/windows-autostart.md) for full setup steps,
how to verify the server is running after a reboot, and troubleshooting.

---

## License

This project is provided as-is for personal use. Please check the license for details.

## Acknowledgments

- Built with [FastAPI](https://fastapi.tiangolo.com/)
- Uses [pynobo](https://github.com/echoromeo/pynobo) library for Nobø Hub communication
- Created for local control of Nobø Energy Hub heating systems

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Note**: This is an unofficial third-party control system and is not affiliated with or endorsed by Glen Dimplex Nordic AS (Nobø) or any related companies.
