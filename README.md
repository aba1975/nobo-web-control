# Nobø Energy Hub Local Control

A modern, web-based control system for the Nobø Energy Hub, providing local control of your heating system through an intuitive interface inspired by the Mill heating app.

## Features

- 🌡️ **Real-time Temperature Monitoring** - See current temperatures for all zones
- 🎛️ **Zone Control** - Individual control of each heating zone
- 🔥 **Multiple Modes** - Comfort, Eco, Away, and Schedule modes
- 🌐 **Local Control** - No cloud required - works entirely on your local network
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile devices
- ⚡ **Live Updates** - WebSocket-based real-time updates without page refresh
- 🎨 **Modern UI** - Clean, card-based design inspired by the Mill app

## Architecture

```
nobo-web-control/
├── server.py              # FastAPI backend using pynobo
├── static/
│   ├── index.html         # Main webpage
│   ├── style.css          # Styling (Mill-app inspired, card-based)
│   ├── app.js             # Frontend logic + WebSocket for live updates
│   └── images/
│       └── placeholder.svg # Placeholder device image (simple heater icon SVG)
├── requirements.txt       # Python dependencies
└── README.md              # This file
```

## Prerequisites

- **Python 3.8 or higher**
- **pip** (Python package installer)
- **Nobø Energy Hub** on your local network
- Hub serial number and IP address

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

## Running the Server

### Standard Method

```bash
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

### Global Controls

Use the buttons at the top to quickly set all zones to the same mode:
- **Comfort All** - Set all zones to comfort temperature
- **Eco All** - Set all zones to eco (energy-saving) temperature  
- **Away All** - Set all zones to away mode (minimal heating)
- **Back to Schedule** - Return all zones to their programmed schedule

### Zone Cards

Each zone is displayed as a card showing:
- Zone/room name
- Current temperature (large display)
- Target comfort temperature
- Current mode indicator with color coding
- Mode selection buttons
- Temperature adjustment controls

### Mode Selection

Click the mode buttons to change a zone's operating mode:
- 🔥 **Comfort** - Maintain comfort temperature
- 🌿 **Eco** - Use eco temperature (energy saving)
- 🏠 **Away** - Minimal heating for when you're away
- ⭘ **Normal** - Follow the programmed schedule

### Temperature Adjustment

Use the **+** and **−** buttons to adjust temperatures:
- **Comfort temperature**: The temperature maintained in comfort mode
- **Eco temperature**: The reduced temperature for eco mode
- Temperature range: 7°C to 30°C
- Changes are sent after 500ms of inactivity (debounced)

## Important Notes

### Single Connection Limitation

⚠️ **The Nobø Hub only allows one TCP connection at a time.** When this web control system is connected to your hub, you cannot use the official Nobø app simultaneously. You'll need to stop the server to use the official app again.

### Network Requirements

- The server must be on the same local network as your Nobø Hub
- No internet connection is required for operation
- All communication happens locally

### Device Images

The current version uses placeholder heater icons for all zones. In a future update, these can be replaced with actual photos of your heating devices.

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
