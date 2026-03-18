"""
Nobø Energy Hub Web Control Server
FastAPI backend for local control of Nobø heating system via pynobo library
"""

import os
import asyncio
import logging
import threading
from collections import deque
from typing import Dict, List, Optional, Any
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel
import pynobo

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ===== CONFIGURATION =====
# Replace these with your actual Nobø Hub values
# You can also set them via environment variables: NOBO_SERIAL and NOBO_IP
NOBO_SERIAL = os.environ.get('NOBO_SERIAL', '111111111111')  # Replace with your hub's 12-digit serial number
NOBO_IP = os.environ.get('NOBO_IP', '10.0.0.100')  # Replace with your hub's IP address

# Demo mode - set to True to use simulated data instead of connecting to real hub
# Can be enabled via environment variable or using the test serial number
DEMO_MODE = os.environ.get('NOBO_DEMO', '').lower() in ('true', '1', 'yes') or NOBO_SERIAL == '111111111111'
DEMO_SOFTWARE_VERSION = "1.4.0 (Simulated)"  # Software version shown in demo mode

# Demo mode zone data - 8 grouped zones with realistic Norwegian indoor temperatures
DEMO_ZONES = [
    {
        "zone_id": "1",
        "name": "Large Bathroom",
        "icon": "🛁",
        "rooms": ["Large Bathroom"],
        "components": ["210000016247"],  # NTB-2R device
        "component_names": ["Large Bathroom Heater"],
        "current_temp": 24.2,
        "comfort_temp": 24.0,
        "eco_temp": 21.0,
        "mode": "comfort",
        "override_id": None
    },
    {
        "zone_id": "2",
        "name": "Small Bathroom",
        "icon": "🛁",
        "rooms": ["Small Bathroom"],
        "components": ["210000016248"],  # NTB-2R device
        "component_names": ["Small Bathroom Heater"],
        "current_temp": 23.8,
        "comfort_temp": 23.5,
        "eco_temp": 20.5,
        "mode": "comfort",
        "override_id": None
    },
    {
        "zone_id": "3",
        "name": "Hallway",
        "icon": "🚪",
        "rooms": ["Hallway"],
        "components": ["000000016249"],  # NTB-2R device (000-prefix)
        "component_names": ["Hallway Heater"],
        "current_temp": 21.5,
        "comfort_temp": 21.0,
        "eco_temp": 19.0,
        "mode": "normal",
        "override_id": None
    },
    {
        "zone_id": "4",
        "name": "Upstairs Bedrooms",
        "icon": "🛏️",
        "rooms": ["North", "South"],
        "components": ["160004028112", "160004028113"],  # R80 RDC 700 devices
        "component_names": ["North Room Heater", "South Room Heater"],
        "current_temp": None,  # R80 has no built-in temperature sensor
        "comfort_temp": 21.0,
        "eco_temp": 18.0,
        "mode": "eco",
        "override_id": None
    },
    {
        "zone_id": "5",
        "name": "Living Area",
        "icon": "🍳🛋️",
        "rooms": ["Kitchen", "Living Room"],
        "components": ["160004028114", "160004028115"],  # R80 RDC 700 devices
        "component_names": ["Kitchen Heater", "Living Room Heater"],
        "current_temp": None,  # R80 has no built-in temperature sensor
        "comfort_temp": 21.0,
        "eco_temp": 19.0,
        "mode": "normal",
        "override_id": None
    },
    {
        "zone_id": "6",
        "name": "Tech Room",
        "icon": "💻",
        "rooms": ["Tech Room"],
        "components": ["160004028116"],  # R80 RDC 700 device
        "component_names": ["Tech Room Heater"],
        "current_temp": None,  # R80 has no built-in temperature sensor
        "comfort_temp": 21.5,
        "eco_temp": 19.0,
        "mode": "comfort",
        "override_id": None
    },
    {
        "zone_id": "7",
        "name": "Downstairs Bedrooms",
        "icon": "🛏️",
        "rooms": ["Master", "North", "South"],
        "components": ["160004028117", "160004028118", "160004028119"],  # R80 RDC 700 devices
        "component_names": ["Master Heater", "North Heater", "South Heater"],
        "current_temp": None,  # R80 has no built-in temperature sensor
        "comfort_temp": 20.5,
        "eco_temp": 18.0,
        "mode": "eco",
        "override_id": None
    },
    {
        "zone_id": "8",
        "name": "Laundry Room",
        "icon": "🧺",
        "rooms": ["Laundry Room"],
        "components": ["000000016250", "160004028120"],  # Mixed: NTB-2R + R80 RDC 700
        "component_names": ["Laundry Heater", "Drying Area Controller"],
        "current_temp": 18.5,  # NTB-2R provides temperature reading
        "comfort_temp": 22.0,
        "eco_temp": 18.0,
        "mode": "normal",
        "override_id": None
    },
]

# Away temperature (set by Nobø, not configurable)
AWAY_TEMPERATURE = 7.0

# ========================

# Global variables
hub: Optional[pynobo.nobo] = None
connected_websockets: List[WebSocket] = []
hub_connected = False
hub_thread: Optional[threading.Thread] = None
websocket_lock = asyncio.Lock()  # Lock for thread-safe websocket list access
connection_lock = threading.Lock()  # Lock for thread-safe hub_connected access
log_lock = threading.Lock()  # Lock for thread-safe command log access

# Command log buffer — keeps the last 500 entries
command_log: deque = deque(maxlen=500)


def add_log_entry(direction: str, description: str, command: str = "", source: str = "api"):
    """Add an entry to the command log buffer (thread-safe)."""
    entry = {
        "timestamp": datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3],
        "direction": direction,       # "sent" | "received" | "error"
        "command": command,
        "description": description,
        "source": source,             # "api" | "hub" | "websocket"
    }
    with log_lock:
        command_log.append(entry)


# ===== Helper Functions =====
def detect_device_type(serial: str) -> tuple[str, bool, bool]:
    """
    Detect device type from serial number prefix using pynobo MODELS.
    
    Args:
        serial: 12-digit serial number (with or without spaces)
    
    Returns:
        tuple: (device_name, supports_comfort, supports_eco)
    """
    # Remove spaces and ensure it's a string
    serial_clean = str(serial).replace(' ', '').strip()
    
    # Get first 3 digits (model prefix)
    if len(serial_clean) < 3:
        return ("Unknown", False, False)
    
    model_prefix = serial_clean[:3]
    
    # Look up in pynobo MODELS
    if model_prefix in pynobo.nobo.MODELS:
        model = pynobo.nobo.MODELS[model_prefix]
        return (model.name, model.supports_comfort, model.supports_eco)
    
    # Fallback: some devices use 000 prefix (legacy firmware or manufacturing variant) and are NTB-2R compatible
    if model_prefix == '000':
        return ("NTB-2R", True, True)
    
    # Default for unknown models
    return ("Unknown", False, False)


def format_serial_display(serial: str) -> str:
    """
    Format serial number for display with spaces: XXX XXX XXX XXX
    
    Args:
        serial: 12-digit serial number
    
    Returns:
        Formatted serial with spaces
    """
    serial_clean = str(serial).replace(' ', '').strip()
    if len(serial_clean) == 12:
        return f"{serial_clean[0:3]} {serial_clean[3:6]} {serial_clean[6:9]} {serial_clean[9:12]}"
    return serial_clean


def parse_serial_input(serial: str) -> str:
    """
    Parse serial number input (with or without spaces) to 12-digit format.
    
    Args:
        serial: Serial number input
    
    Returns:
        12-digit serial without spaces
    """
    return str(serial).replace(' ', '').strip()


# ===== Lifespan Context Manager =====
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events"""
    # Startup
    logger.info("Starting Nobø Web Control Server...")
    try:
        await connect_to_hub()
    except Exception as e:
        logger.error(f"Failed to connect to hub on startup: {e}")
        # Don't fail startup - allow server to run and show disconnected state
    
    yield
    
    # Shutdown
    logger.info("Shutting down server...")
    # Close all websocket connections
    for ws in connected_websockets:
        try:
            await ws.close()
        except:
            pass
    connected_websockets.clear()
    
    # Disconnect from hub
    if hub:
        try:
            hub.stop()
        except:
            pass


app = FastAPI(title="Nobø Web Control", version="1.0.0", lifespan=lifespan)


# ===== Pydantic Models =====
class TemperatureUpdate(BaseModel):
    comfort: Optional[float] = None
    eco: Optional[float] = None


class ZoneInfo(BaseModel):
    zone_id: str
    name: str
    current_temperature: float
    comfort_temperature: float
    eco_temperature: float
    current_mode: str
    active_override_id: Optional[str] = None
    device_type: str
    supports_temp_adjust: bool


class ZoneAdd(BaseModel):
    name: str
    icon: str = ""


class ZoneUpdate(BaseModel):
    name: Optional[str] = None
    icon: Optional[str] = None


# ===== Hub Connection & Callbacks =====
def connect_to_hub_sync():
    """Connect to the Nobø Hub (synchronous, runs in thread)"""
    global hub, hub_connected
    
    try:
        logger.info(f"Connecting to Nobø Hub at {NOBO_IP} with serial {NOBO_SERIAL}...")
        hub = pynobo.nobo(NOBO_SERIAL, NOBO_IP, discover=False)
        with connection_lock:
            hub_connected = True
        logger.info("Successfully connected to Nobø Hub")
        
        # Register callback for hub updates
        hub.register_callback(hub_update_callback)
        
    except Exception as e:
        logger.error(f"Failed to connect to Nobø Hub: {e}")
        with connection_lock:
            hub_connected = False
        hub = None
        raise


async def connect_to_hub():
    """Connect to the Nobø Hub (async wrapper)"""
    global hub_thread, hub_connected
    
    # Check if demo mode is enabled
    if DEMO_MODE:
        logger.info("Demo mode enabled - using simulated data")
        with connection_lock:
            hub_connected = True
        return
    
    # Run the synchronous connection in a thread to avoid event loop conflicts
    hub_thread = threading.Thread(target=connect_to_hub_sync, daemon=True)
    hub_thread.start()
    
    # Wait a moment for connection to establish
    await asyncio.sleep(2)


def hub_update_callback(hub_instance):
    """Callback function triggered when hub data changes"""
    logger.info("Hub data updated - broadcasting to websocket clients")
    add_log_entry("received", "Hub data update received", source="hub")
    
    # Schedule the broadcast in the main event loop
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(broadcast_zone_update(), loop)
    except Exception as e:
        logger.error(f"Error scheduling broadcast: {e}")


async def broadcast_zone_update():
    """Send updated zone data to all connected WebSocket clients"""
    with connection_lock:
        connected = hub_connected
    
    if not connected or not hub:
        return
    
    try:
        zones_data = get_zones_data()
        message = {
            "type": "zones_update",
            "data": zones_data,
            "timestamp": datetime.now().isoformat()
        }
        
        # Send to all connected clients (thread-safe)
        async with websocket_lock:
            disconnected = []
            for websocket in connected_websockets:
                try:
                    await websocket.send_json(message)
                except Exception as e:
                    logger.warning(f"Failed to send to websocket: {e}")
                    disconnected.append(websocket)
            
            # Remove disconnected clients
            for ws in disconnected:
                if ws in connected_websockets:
                    connected_websockets.remove(ws)
                
    except Exception as e:
        logger.error(f"Error broadcasting zone update: {e}")


def get_zones_data() -> List[Dict[str, Any]]:
    """Get current data for all zones"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        return []
    
    # Demo mode - return simulated data
    if DEMO_MODE:
        zones = []
        for demo_zone in DEMO_ZONES:
            # Detect device type for EACH component individually
            components_types = []
            any_supports_temp = False
            any_manual = False
            for comp_serial in demo_zone['components']:
                cname, csupports_comfort, csupports_eco = detect_device_type(comp_serial)
                components_types.append(cname)
                if csupports_comfort or csupports_eco:
                    any_supports_temp = True
                else:
                    any_manual = True

            # Use first component's type for the zone-level device_type field
            device_name = components_types[0] if components_types else "Unknown"

            # Format components for display
            components_display = [format_serial_display(c) for c in demo_zone['components']]

            # Component friendly names
            components_names = demo_zone.get('component_names', [''] * len(demo_zone['components']))

            zones.append({
                'zone_id': demo_zone['zone_id'],
                'name': demo_zone['name'],
                'icon': demo_zone.get('icon', ''),
                'rooms': demo_zone.get('rooms', []),
                'components': demo_zone['components'],
                'components_display': components_display,
                'components_types': components_types,
                'components_names': components_names,
                'current_temperature': demo_zone['current_temp'],
                'comfort_temperature': demo_zone['comfort_temp'],
                'eco_temperature': demo_zone['eco_temp'],
                'away_temperature': AWAY_TEMPERATURE,
                'current_mode': demo_zone['mode'],
                'active_override_id': demo_zone.get('override_id'),
                'device_type': device_name,
                'supports_comfort': any_supports_temp,
                'supports_eco': any_supports_temp,
                'supports_temp_adjust': any_supports_temp,
                'has_manual_devices': any_manual,
            })
        return zones
    
    # Real hub mode
    if not hub:
        return []
    
    zones = []
    try:
        for zone_id, zone in hub.zones.items():
            zone_name = zone.get('name', f'Zone {zone_id}')
            
            # Get components for this zone
            zone_components = []
            for comp_id, comp in hub.components.items():
                if comp.get('zone', '') == zone_id:
                    zone_components.append(comp_id)
            
            # Detect device type for EACH component individually
            components_types = []
            any_supports_temp = False
            any_manual = False
            for comp_serial in zone_components:
                cname, csupports_comfort, csupports_eco = detect_device_type(comp_serial)
                components_types.append(cname)
                if csupports_comfort or csupports_eco:
                    any_supports_temp = True
                else:
                    any_manual = True

            # Use first component's type for zone-level device_type field
            if zone_components:
                device_name = components_types[0]
            else:
                device_name = "Unknown"
            
            # Format components for display
            components_display = [format_serial_display(c) for c in zone_components]
            
            # Get current temperature
            current_temp = zone.get('temp', 0.0)
            if current_temp:
                current_temp = float(current_temp) / 100.0  # pynobo stores temps in centidegrees
            
            # Get comfort and eco temperatures
            comfort_temp = zone.get('comfort_temperature', 2100) / 100.0
            eco_temp = zone.get('eco_temperature', 1700) / 100.0
            
            # Determine current mode
            mode = determine_zone_mode(zone_id, zone)
            
            zones.append({
                'zone_id': str(zone_id),
                'name': zone_name,
                'icon': '',  # Could be configured per zone
                'rooms': [zone_name],  # Default to zone name
                'components': zone_components,
                'components_display': components_display,
                'components_types': components_types,
                'components_names': [''] * len(zone_components),
                'current_temperature': current_temp,
                'comfort_temperature': comfort_temp,
                'eco_temperature': eco_temp,
                'away_temperature': AWAY_TEMPERATURE,
                'current_mode': mode,
                'active_override_id': zone.get('active_override_id'),
                'device_type': device_name,
                'supports_comfort': any_supports_temp,
                'supports_eco': any_supports_temp,
                'supports_temp_adjust': any_supports_temp,
                'has_manual_devices': any_manual,
            })
    except Exception as e:
        logger.error(f"Error getting zones data: {e}")
    
    return zones


def determine_zone_mode(zone_id: str, zone: Dict) -> str:
    """Determine the current mode of a zone"""
    # Check for active override
    if zone.get('active_override_id'):
        override = hub.overrides.get(zone.get('active_override_id'))
        if override:
            mode = override.get('mode', 0)
            if mode == 0:
                return 'comfort'
            elif mode == 1:
                return 'eco'
            elif mode == 2:
                return 'away'
            elif mode == 3:
                return 'off'
    
    # No override - check current schedule
    # This is a simplified version - actual implementation would check week profiles
    return 'normal'


# ===== API Endpoints =====
@app.get("/api/status")
async def get_status():
    """Get connection status"""
    with connection_lock:
        connected = hub_connected
    
    return {
        "connected": connected,
        "demo_mode": DEMO_MODE,
        "hub_serial": NOBO_SERIAL if connected else None,
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/hub")
async def get_hub_info():
    """Get hub information"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Demo mode - return simulated hub info
        if DEMO_MODE:
            return {
                "name": "Nobø Hub",
                "serial": NOBO_SERIAL,
                "software_version": DEMO_SOFTWARE_VERSION,
                "connected": True,
                "demo_mode": True
            }
        
        # Real hub mode
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        # Get hub info from pynobo
        hub_info = {
            "name": getattr(hub, 'hub_name', 'Nobø Hub'),
            "serial": NOBO_SERIAL,
            "software_version": getattr(hub, 'hub_version', 'Unknown'),
            "connected": hub_connected
        }
        return hub_info
    except Exception as e:
        logger.error(f"Error getting hub info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/zones")
async def get_zones():
    """Get all zones with current status"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        zones_data = get_zones_data()
        return {"zones": zones_data}
    except Exception as e:
        logger.error(f"Error getting zones: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zones")
async def add_zone(zone: ZoneAdd):
    """Create a new zone"""
    with connection_lock:
        connected = hub_connected

    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")

    try:
        if DEMO_MODE:
            # Auto-increment zone_id based on current max
            new_id = str(max((int(z['zone_id']) for z in DEMO_ZONES), default=0) + 1)
            DEMO_ZONES.append({
                "zone_id": new_id,
                "name": zone.name.strip(),
                "icon": zone.icon.strip(),
                "rooms": [],
                "components": [],
                "current_temp": None,
                "comfort_temp": 21.0,
                "eco_temp": 18.0,
                "mode": "normal",
                "override_id": None,
            })
            logger.info(f"Demo mode: Zone '{zone.name}' created with id {new_id}")
            return {"status": "success", "zone_id": new_id, "name": zone.name}

        # Real hub mode - not yet implemented
        raise HTTPException(status_code=501, detail="Add zone not yet implemented for real hub")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding zone: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/zones/{zone_id}")
async def update_zone(zone_id: str, update: ZoneUpdate):
    """Rename a zone and/or change its icon"""
    with connection_lock:
        connected = hub_connected

    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")

    try:
        if DEMO_MODE:
            demo_zone = next((z for z in DEMO_ZONES if z['zone_id'] == zone_id), None)
            if not demo_zone:
                raise HTTPException(status_code=404, detail="Zone not found")

            old_name = demo_zone['name']
            if update.name is not None:
                demo_zone['name'] = update.name.strip()
            if update.icon is not None:
                demo_zone['icon'] = update.icon.strip()

            add_log_entry(
                "sent",
                f"[DEMO] Zone '{old_name}' updated: name='{demo_zone['name']}' icon='{demo_zone['icon']}'",
                source="api",
            )
            logger.info(f"Demo mode: Zone {zone_id} updated")
            return {"status": "success", "zone_id": zone_id, "name": demo_zone['name'], "icon": demo_zone['icon']}

        # Real hub mode — icon is stored locally only (pynobo doesn't support icons)
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")

        if zone_id not in hub.zones:
            raise HTTPException(status_code=404, detail="Zone not found")

        zone = hub.zones[zone_id]
        old_name = zone.get('name', zone_id)

        if update.name is not None:
            hub.update_zone(zone_id, update.name.strip())
            add_log_entry(
                "sent",
                f"update_zone({zone_id}, '{update.name.strip()}')",
                command=f"update_zone zone_id={zone_id} name={update.name.strip()}",
                source="api",
            )

        await asyncio.sleep(0.3)
        return {"status": "success", "zone_id": zone_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating zone: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/zones/{zone_id}")
async def delete_zone(zone_id: str):
    """Delete a zone"""
    with connection_lock:
        connected = hub_connected

    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")

    try:
        if DEMO_MODE:
            demo_zone = next((z for z in DEMO_ZONES if z['zone_id'] == zone_id), None)
            if not demo_zone:
                raise HTTPException(status_code=404, detail="Zone not found")

            zone_name = demo_zone['name']
            DEMO_ZONES.remove(demo_zone)
            add_log_entry(
                "sent",
                f"[DEMO] Zone '{zone_name}' (id={zone_id}) deleted",
                source="api",
            )
            logger.info(f"Demo mode: Zone '{zone_name}' deleted")
            return {"status": "success", "zone_id": zone_id}

        # Real hub mode — not yet implemented
        raise HTTPException(status_code=501, detail="Delete zone not yet implemented for real hub")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting zone: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zones/{zone_id}/override/{mode}")
async def set_zone_override(zone_id: str, mode: str):
    """Set override mode for a specific zone"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    # Validate mode — 'off' is not a valid Nobø Eco Hub override mode
    mode_map = {
        'comfort': pynobo.nobo.API.OVERRIDE_MODE_COMFORT,
        'eco': pynobo.nobo.API.OVERRIDE_MODE_ECO,
        'away': pynobo.nobo.API.OVERRIDE_MODE_AWAY,
        'normal': -1  # Special case: remove override
    }
    
    if mode not in mode_map:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}")
    
    try:
        # Demo mode - update simulated data
        if DEMO_MODE:
            demo_zone = next((z for z in DEMO_ZONES if z['zone_id'] == zone_id), None)
            if not demo_zone:
                raise HTTPException(status_code=404, detail="Zone not found")
            
            demo_zone['mode'] = mode
            add_log_entry(
                "sent",
                f"[DEMO] Would send: create_override(now, 0, {mode.upper()}, zone_{zone_id})",
                command=f"create_override now 0 {mode} {zone_id}",
                source="api",
            )
            add_log_entry(
                "received",
                f"[DEMO] Zone '{demo_zone['name']}' mode set to {mode}",
                source="api",
            )
            return {"status": "success", "zone_id": zone_id, "mode": mode}
        
        # Real hub mode
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        if mode == 'normal':
            # Remove override - return to schedule
            hub.create_override('now', 0, pynobo.nobo.API.OVERRIDE_MODE_NORMAL, zone_id)
            add_log_entry(
                "sent",
                f"create_override(now, 0, NORMAL, zone_{zone_id}) — cancel override",
                command=f"create_override now 0 NORMAL {zone_id}",
                source="api",
            )
        else:
            # Set override mode
            hub.create_override('now', 0, mode_map[mode], zone_id)
            add_log_entry(
                "sent",
                f"create_override(now, 0, {mode.upper()}, zone_{zone_id})",
                command=f"create_override now 0 {mode} {zone_id}",
                source="api",
            )
        
        # Wait a moment for hub to update
        await asyncio.sleep(0.5)
        
        return {"status": "success", "zone_id": zone_id, "mode": mode}
    except Exception as e:
        logger.error(f"Error setting zone override: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zones/{zone_id}/temperature")
async def set_zone_temperature(zone_id: str, temps: TemperatureUpdate):
    """Set comfort and/or eco temperature for a zone"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Demo mode - validate device type from DEMO_ZONES
        if DEMO_MODE:
            demo_zone = next((z for z in DEMO_ZONES if z['zone_id'] == zone_id), None)
            if not demo_zone:
                raise HTTPException(status_code=404, detail="Zone not found")
            
            # Check if any device in the zone supports temperature adjustment
            any_supports = False
            device_name = "Unknown"
            for i, comp in enumerate(demo_zone['components']):
                cname, csupports_comfort, csupports_eco = detect_device_type(comp)
                if i == 0:
                    device_name = cname
                if csupports_comfort or csupports_eco:
                    any_supports = True
                    break
            
            if not any_supports:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Temperature cannot be adjusted remotely for {device_name} devices. Temperature is set manually on the physical device."
                )
            
            # In demo mode, just validate and return success
            if temps.comfort is not None:
                if not 7 <= temps.comfort <= 30:
                    raise HTTPException(status_code=400, detail="Comfort temperature must be between 7 and 30°C")
                demo_zone['comfort_temp'] = temps.comfort
            if temps.eco is not None:
                if not 7 <= temps.eco <= 30:
                    raise HTTPException(status_code=400, detail="Eco temperature must be between 7 and 30°C")
                demo_zone['eco_temp'] = temps.eco
            
            add_log_entry(
                "sent",
                f"[DEMO] Would send: update_zone(zone_{zone_id}, comfort={temps.comfort}, eco={temps.eco})",
                command=f"update_zone {zone_id} comfort={temps.comfort} eco={temps.eco}",
                source="api",
            )
            return {"status": "success", "zone_id": zone_id, "comfort": temps.comfort, "eco": temps.eco}
        
        # Real hub mode
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        # Get current zone
        if zone_id not in hub.zones:
            raise HTTPException(status_code=404, detail="Zone not found")
        
        zone = hub.zones[zone_id]
        
        # Get components for this zone and auto-detect device type
        zone_components = []
        for comp_id, comp in hub.components.items():
            if comp.get('zone', '') == zone_id:
                zone_components.append(comp_id)
        
        any_supports = False
        device_name = "Unknown"
        for i, comp_serial in enumerate(zone_components):
            cname, csupports_comfort, csupports_eco = detect_device_type(comp_serial)
            if i == 0:
                device_name = cname
            if csupports_comfort or csupports_eco:
                any_supports = True
                break
        
        # Check if any device supports temperature adjustment
        if not any_supports:
            raise HTTPException(
                status_code=400, 
                detail=f"Temperature cannot be adjusted remotely for {device_name} devices. Temperature is set manually on the physical device."
            )
        
        # Validate temperatures (7-30°C range)
        if temps.comfort is not None:
            if not 7 <= temps.comfort <= 30:
                raise HTTPException(status_code=400, detail="Comfort temperature must be between 7 and 30°C")
        if temps.eco is not None:
            if not 7 <= temps.eco <= 30:
                raise HTTPException(status_code=400, detail="Eco temperature must be between 7 and 30°C")
        
        # Get current temperatures to avoid overwriting
        current_comfort = zone.get('comfort_temperature', 2100)
        current_eco = zone.get('eco_temperature', 1700)
        
        # Update temperatures
        if temps.comfort is not None and temps.eco is not None:
            # Both temperatures provided - update together
            comfort_centidegrees = int(temps.comfort * 100)
            eco_centidegrees = int(temps.eco * 100)
            hub.update_zone(zone_id, zone['name'], comfort_centidegrees, eco_centidegrees)
        elif temps.comfort is not None:
            # Only comfort temperature provided
            comfort_centidegrees = int(temps.comfort * 100)
            hub.update_zone(zone_id, zone['name'], comfort_centidegrees, current_eco)
        elif temps.eco is not None:
            # Only eco temperature provided
            eco_centidegrees = int(temps.eco * 100)
            hub.update_zone(zone_id, zone['name'], current_comfort, eco_centidegrees)
        
        # Wait for update
        await asyncio.sleep(0.5)
        
        return {"status": "success", "zone_id": zone_id, "comfort": temps.comfort, "eco": temps.eco}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting zone temperature: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/global/override/{mode}")
async def set_global_override(mode: str):
    """Set global override mode for all zones"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    # Validate mode — 'off' is not a valid Nobø Eco Hub override mode
    # 'home' is an alias for 'normal' (cancel all overrides)
    mode_map = {
        'comfort': pynobo.nobo.API.OVERRIDE_MODE_COMFORT,
        'eco': pynobo.nobo.API.OVERRIDE_MODE_ECO,
        'away': pynobo.nobo.API.OVERRIDE_MODE_AWAY,
        'normal': -1,
        'home': -1  # Home mode = cancel all overrides, return to schedules
    }
    
    if mode not in mode_map:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}")
    
    try:
        # Demo mode - update all simulated zones
        if DEMO_MODE:
            for demo_zone in DEMO_ZONES:
                # For home mode, set to 'normal' which means following schedule
                demo_zone['mode'] = 'normal' if mode == 'home' else mode
            add_log_entry(
                "sent",
                f"[DEMO] Would send: create_override(now, 0, {mode.upper()}, all zones)",
                command=f"create_override now 0 {mode} all",
                source="api",
            )
            add_log_entry(
                "received",
                f"[DEMO] All zones set to {mode}",
                source="api",
            )
            return {"status": "success", "mode": mode}
        
        # Real hub mode
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        # Apply override to all zones
        for zone_id in hub.zones.keys():
            if mode == 'normal' or mode == 'home':
                hub.create_override('now', 0, pynobo.nobo.API.OVERRIDE_MODE_NORMAL, zone_id)
                add_log_entry(
                    "sent",
                    f"create_override(now, 0, NORMAL, zone_{zone_id}) — cancel override",
                    command=f"create_override now 0 NORMAL {zone_id}",
                    source="api",
                )
            else:
                hub.create_override('now', 0, mode_map[mode], zone_id)
                add_log_entry(
                    "sent",
                    f"create_override(now, 0, {mode.upper()}, zone_{zone_id})",
                    command=f"create_override now 0 {mode} {zone_id}",
                    source="api",
                )
        
        # Wait for updates
        await asyncio.sleep(0.5)
        
        return {"status": "success", "mode": mode}
    except Exception as e:
        logger.error(f"Error setting global override: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/week_profiles")
async def get_week_profiles():
    """Get all week profiles"""
    with connection_lock:
        connected = hub_connected
    
    if not connected or not hub:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        profiles = []
        for profile_id, profile in hub.week_profiles.items():
            profiles.append({
                'profile_id': str(profile_id),
                'name': profile.get('name', f'Profile {profile_id}'),
                'profile': profile
            })
        return {"week_profiles": profiles}
    except Exception as e:
        logger.error(f"Error getting week profiles: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===== Schedule API Endpoints =====
@app.get("/api/zones/{zone_id}/schedule")
async def get_zone_schedule(zone_id: str):
    """Get the weekly schedule for a specific zone"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Demo mode - return sample schedule
        if DEMO_MODE:
            demo_zone = next((z for z in DEMO_ZONES if z['zone_id'] == zone_id), None)
            if not demo_zone:
                raise HTTPException(status_code=404, detail="Zone not found")
            
            # Sample schedule: Eco 00:00-07:00, Comfort 07:00-22:00, Eco 22:00-24:00
            sample_schedule = {
                "zone_id": zone_id,
                "zone_name": demo_zone['name'],
                "schedule": {
                    "monday": [
                        {"start": "00:00", "end": "07:00", "mode": "eco"},
                        {"start": "07:00", "end": "22:00", "mode": "comfort"},
                        {"start": "22:00", "end": "24:00", "mode": "eco"}
                    ],
                    "tuesday": [
                        {"start": "00:00", "end": "07:00", "mode": "eco"},
                        {"start": "07:00", "end": "22:00", "mode": "comfort"},
                        {"start": "22:00", "end": "24:00", "mode": "eco"}
                    ],
                    "wednesday": [
                        {"start": "00:00", "end": "07:00", "mode": "eco"},
                        {"start": "07:00", "end": "22:00", "mode": "comfort"},
                        {"start": "22:00", "end": "24:00", "mode": "eco"}
                    ],
                    "thursday": [
                        {"start": "00:00", "end": "07:00", "mode": "eco"},
                        {"start": "07:00", "end": "22:00", "mode": "comfort"},
                        {"start": "22:00", "end": "24:00", "mode": "eco"}
                    ],
                    "friday": [
                        {"start": "00:00", "end": "07:00", "mode": "eco"},
                        {"start": "07:00", "end": "22:00", "mode": "comfort"},
                        {"start": "22:00", "end": "24:00", "mode": "eco"}
                    ],
                    "saturday": [
                        {"start": "00:00", "end": "09:00", "mode": "eco"},
                        {"start": "09:00", "end": "23:00", "mode": "comfort"},
                        {"start": "23:00", "end": "24:00", "mode": "eco"}
                    ],
                    "sunday": [
                        {"start": "00:00", "end": "09:00", "mode": "eco"},
                        {"start": "09:00", "end": "23:00", "mode": "comfort"},
                        {"start": "23:00", "end": "24:00", "mode": "eco"}
                    ]
                }
            }
            return sample_schedule
        
        # Real hub mode - get week profile from pynobo
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        if zone_id not in hub.zones:
            raise HTTPException(status_code=404, detail="Zone not found")
        
        zone = hub.zones[zone_id]
        week_profile_id = zone.get('week_profile_id')
        
        if not week_profile_id or week_profile_id not in hub.week_profiles:
            raise HTTPException(status_code=404, detail="Week profile not found for zone")
        
        week_profile = hub.week_profiles[week_profile_id]
        
        return {
            "zone_id": zone_id,
            "zone_name": zone.get('name', f'Zone {zone_id}'),
            "week_profile_id": week_profile_id,
            "week_profile": week_profile
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting zone schedule: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zones/{zone_id}/schedule")
async def update_zone_schedule(zone_id: str, schedule: dict):
    """Update the weekly schedule for a specific zone"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Demo mode - just validate and return success
        if DEMO_MODE:
            demo_zone = next((z for z in DEMO_ZONES if z['zone_id'] == zone_id), None)
            if not demo_zone:
                raise HTTPException(status_code=404, detail="Zone not found")
            
            logger.info(f"Demo mode: Schedule updated for zone {zone_id}")
            return {"status": "success", "zone_id": zone_id, "message": "Schedule updated (demo mode)"}
        
        # Real hub mode - update week profile using pynobo
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        if zone_id not in hub.zones:
            raise HTTPException(status_code=404, detail="Zone not found")
        
        # This would need to be implemented based on pynobo's week profile format
        # For now, return not implemented
        raise HTTPException(status_code=501, detail="Schedule update not yet implemented for real hub")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating zone schedule: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===== Device Management API Endpoints =====
@app.get("/api/devices")
async def get_devices():
    """Get all registered devices with their zone assignments"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        zones_data = get_zones_data()
        devices = []
        
        for zone in zones_data:
            for i, serial in enumerate(zone['components']):
                device_name, supports_comfort, supports_eco = detect_device_type(serial)
                devices.append({
                    'serial': serial,
                    'serial_display': zone['components_display'][i] if i < len(zone['components_display']) else format_serial_display(serial),
                    'device_type': device_name,
                    'zone_id': zone['zone_id'],
                    'zone_name': zone['name'],
                    'supports_comfort': supports_comfort,
                    'supports_eco': supports_eco,
                    'supports_temp_adjust': supports_comfort or supports_eco,
                    'current_mode': zone.get('current_mode', 'normal'),
                })
        
        return {"devices": devices}
    except Exception as e:
        logger.error(f"Error getting devices: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class DeviceAdd(BaseModel):
    serial: str
    zone_id: str
    name: Optional[str] = None


@app.post("/api/devices")
async def add_device(device: DeviceAdd):
    """Add a new device to a zone"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Parse and validate serial
        serial = parse_serial_input(device.serial)
        if len(serial) != 12:
            raise HTTPException(status_code=400, detail="Serial number must be 12 digits")
        
        # Auto-detect device type
        device_name, supports_comfort, supports_eco = detect_device_type(serial)
        if device_name == "Unknown":
            raise HTTPException(status_code=400, detail=f"Unknown device model for serial prefix {serial[:3]}")
        
        # Demo mode - add to DEMO_ZONES
        if DEMO_MODE:
            demo_zone = next((z for z in DEMO_ZONES if z['zone_id'] == device.zone_id), None)
            if not demo_zone:
                raise HTTPException(status_code=404, detail="Zone not found")
            
            if serial in demo_zone['components']:
                raise HTTPException(status_code=400, detail="Device already registered in this zone")
            
            demo_zone['components'].append(serial)
            if 'component_names' not in demo_zone:
                demo_zone['component_names'] = [''] * (len(demo_zone['components']) - 1)
            demo_zone['component_names'].append(device.name or '')
            logger.info(f"Demo mode: Device {serial} added to zone {device.zone_id}")
            
            return {
                "status": "success",
                "serial": serial,
                "serial_display": format_serial_display(serial),
                "device_type": device_name,
                "zone_id": device.zone_id,
                "name": device.name or ''
            }
        
        # Real hub mode
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        raise HTTPException(status_code=501, detail="Add device not yet implemented for real hub")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding device: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class DeviceReplace(BaseModel):
    new_serial: str


@app.put("/api/devices/{serial}")
async def replace_device(serial: str, replacement: DeviceReplace):
    """Replace a device with a new one"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Parse serials
        old_serial = parse_serial_input(serial)
        new_serial = parse_serial_input(replacement.new_serial)
        
        if len(new_serial) != 12:
            raise HTTPException(status_code=400, detail="New serial number must be 12 digits")
        
        # Auto-detect new device type
        device_name, _, _ = detect_device_type(new_serial)
        if device_name == "Unknown":
            raise HTTPException(status_code=400, detail=f"Unknown device model for serial prefix {new_serial[:3]}")
        
        # Demo mode - replace in DEMO_ZONES
        if DEMO_MODE:
            found = False
            for demo_zone in DEMO_ZONES:
                if old_serial in demo_zone['components']:
                    idx = demo_zone['components'].index(old_serial)
                    demo_zone['components'][idx] = new_serial
                    found = True
                    logger.info(f"Demo mode: Device {old_serial} replaced with {new_serial} in zone {demo_zone['zone_id']}")
                    break
            
            if not found:
                raise HTTPException(status_code=404, detail="Device not found")
            
            return {
                "status": "success",
                "old_serial": old_serial,
                "new_serial": new_serial,
                "serial_display": format_serial_display(new_serial),
                "device_type": device_name
            }
        
        # Real hub mode
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        raise HTTPException(status_code=501, detail="Replace device not yet implemented for real hub")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error replacing device: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/devices/{serial}")
async def remove_device(serial: str):
    """Remove a device from its zone"""
    with connection_lock:
        connected = hub_connected
    
    if not connected:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Parse serial
        serial_clean = parse_serial_input(serial)
        
        # Demo mode - remove from DEMO_ZONES
        if DEMO_MODE:
            found = False
            for demo_zone in DEMO_ZONES:
                if serial_clean in demo_zone['components']:
                    idx = demo_zone['components'].index(serial_clean)
                    demo_zone['components'].pop(idx)
                    if 'component_names' in demo_zone and idx < len(demo_zone['component_names']):
                        demo_zone['component_names'].pop(idx)
                    found = True
                    logger.info(f"Demo mode: Device {serial_clean} removed from zone {demo_zone['zone_id']}")
                    break
            
            if not found:
                raise HTTPException(status_code=404, detail="Device not found")
            
            return {"status": "success", "serial": serial_clean}
        
        # Real hub mode
        if not hub:
            raise HTTPException(status_code=503, detail="Hub not connected")
        
        raise HTTPException(status_code=501, detail="Remove device not yet implemented for real hub")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error removing device: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===== Command Log Endpoints =====

@app.get("/api/log")
async def get_log(limit: int = 500):
    """Return the last N entries from the command log buffer"""
    with log_lock:
        entries = list(command_log)
    # Return most-recent first; honour the limit
    entries = entries[-limit:]
    entries_reversed = list(reversed(entries))
    return {
        "entries": entries_reversed,
        "total": len(entries_reversed),
        "demo_mode": DEMO_MODE,
    }


@app.post("/api/log/clear")
async def clear_log():
    """Clear the command log buffer"""
    with log_lock:
        command_log.clear()
    return {"status": "success", "message": "Log cleared"}


# ===== WebSocket Endpoint =====
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates"""
    await websocket.accept()
    
    async with websocket_lock:
        connected_websockets.append(websocket)
        total = len(connected_websockets)
    
    logger.info(f"WebSocket client connected. Total clients: {total}")
    
    try:
        # Send initial data
        with connection_lock:
            connected = hub_connected
        
        if connected and hub:
            zones_data = get_zones_data()
            await websocket.send_json({
                "type": "zones_update",
                "data": zones_data,
                "timestamp": datetime.now().isoformat()
            })
        
        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for messages from client (e.g., ping/pong)
                data = await websocket.receive_text()
                if data == "ping":
                    await websocket.send_text("pong")
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"WebSocket error: {e}")
                break
    
    finally:
        async with websocket_lock:
            if websocket in connected_websockets:
                connected_websockets.remove(websocket)
            total = len(connected_websockets)
        logger.info(f"WebSocket client disconnected. Total clients: {total}")


# ===== Static Files =====
# Serve static files (HTML, CSS, JS, images)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def read_root():
    """Serve the main HTML page"""
    try:
        with open("static/index.html", "r", encoding="utf-8") as f:
            content = f.read()
        return HTMLResponse(content=content)
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Error: index.html not found</h1>", status_code=404)


# ===== Main Entry Point =====
if __name__ == "__main__":
    import uvicorn
    
    logger.info("Starting Nobø Web Control Server...")
    logger.info(f"Hub Serial: {NOBO_SERIAL}")
    logger.info(f"Hub IP: {NOBO_IP}")
    logger.info("Access the web interface at http://localhost:8000")
    
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
