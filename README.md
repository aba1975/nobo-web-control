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
├── server.py              # FastAPI backend using pynobo
├── static/
│   ├── index.html         # Main webpage with 3-page navigation
│   ├── style.css          # Styling (Mill-app inspired, card-based)
│   ├── app.js             # Frontend logic + WebSocket for live updates
│   └── images/
│       ├── ntb-2r.svg     # NTB-2R device image
│       └── r80-rdc-700.svg # R80 RDC 700 device image
├── requirements.txt       # Python dependencies
└── README.md              # This file
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
- Mode control only: can switch between Comfort/Eco/Away/Off remotely
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
- ✅ All modes work (Comfort, Eco, Away, Off, Schedule)
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
- `POST /api/global/override/{mode}` - Set global override for all zones

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

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## License

This project is provided as-is for personal use. Please check the license for details.

## Acknowledgments

- Built with [FastAPI](https://fastapi.tiangolo.com/)
- Uses [pynobo](https://github.com/echoromeo/pynobo) library for Nobø Hub communication
- UI design inspired by the Mill heating app
- Created for local control of Nobø Energy Hub heating systems

## Support

For issues, questions, or suggestions, please open an issue on GitHub.

---

**Note**: This is an unofficial third-party control system and is not affiliated with or endorsed by Glen Dimplex Nordic AS (Nobø) or any related companies.
