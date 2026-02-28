"""
Nobø Energy Hub Web Control Server
FastAPI backend for local control of Nobø heating system via pynobo library
"""

import os
import asyncio
import logging
import threading
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
NOBO_SERIAL = os.environ.get('NOBO_SERIAL', 'YOUR_SERIAL_HERE')  # Replace with your hub's 12-digit serial number
NOBO_IP = os.environ.get('NOBO_IP', '10.0.0.100')  # Replace with your hub's IP address

# ========================

# Global variables
hub: Optional[pynobo.nobo] = None
connected_websockets: List[WebSocket] = []
hub_connected = False
hub_thread: Optional[threading.Thread] = None
websocket_lock = asyncio.Lock()  # Lock for thread-safe websocket list access
connection_lock = threading.Lock()  # Lock for thread-safe hub_connected access


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
    global hub_thread
    
    # Run the synchronous connection in a thread to avoid event loop conflicts
    hub_thread = threading.Thread(target=connect_to_hub_sync, daemon=True)
    hub_thread.start()
    
    # Wait a moment for connection to establish
    await asyncio.sleep(2)


def hub_update_callback(hub_instance):
    """Callback function triggered when hub data changes"""
    logger.info("Hub data updated - broadcasting to websocket clients")
    
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
    
    if not connected or not hub:
        return []
    
    zones = []
    try:
        for zone_id, zone in hub.zones.items():
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
                'name': zone.get('name', f'Zone {zone_id}'),
                'current_temperature': current_temp,
                'comfort_temperature': comfort_temp,
                'eco_temperature': eco_temp,
                'current_mode': mode,
                'active_override_id': zone.get('active_override_id')
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
        "hub_serial": NOBO_SERIAL if connected else None,
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/hub")
async def get_hub_info():
    """Get hub information"""
    with connection_lock:
        connected = hub_connected
    
    if not connected or not hub:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
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
    
    if not connected or not hub:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        zones_data = get_zones_data()
        return {"zones": zones_data}
    except Exception as e:
        logger.error(f"Error getting zones: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/zones/{zone_id}/override/{mode}")
async def set_zone_override(zone_id: str, mode: str):
    """Set override mode for a specific zone"""
    with connection_lock:
        connected = hub_connected
    
    if not connected or not hub:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    # Validate mode
    mode_map = {
        'comfort': 0,
        'eco': 1,
        'away': 2,
        'off': 3,
        'normal': -1  # Special case: remove override
    }
    
    if mode not in mode_map:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}")
    
    try:
        if mode == 'normal':
            # Remove override - return to schedule
            hub.create_override('now', 0, pynobo.API.OVERRIDE_MODE_NORMAL, zone_id)
        else:
            # Set override mode
            hub.create_override('now', 0, mode_map[mode], zone_id)
        
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
    
    if not connected or not hub:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    try:
        # Validate temperatures (7-30°C range)
        if temps.comfort is not None:
            if not 7 <= temps.comfort <= 30:
                raise HTTPException(status_code=400, detail="Comfort temperature must be between 7 and 30°C")
        if temps.eco is not None:
            if not 7 <= temps.eco <= 30:
                raise HTTPException(status_code=400, detail="Eco temperature must be between 7 and 30°C")
        
        # Get current zone
        if zone_id not in hub.zones:
            raise HTTPException(status_code=404, detail="Zone not found")
        
        zone = hub.zones[zone_id]
        
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
    
    if not connected or not hub:
        raise HTTPException(status_code=503, detail="Hub not connected")
    
    # Validate mode
    mode_map = {
        'comfort': 0,
        'eco': 1,
        'away': 2,
        'off': 3,
        'normal': -1
    }
    
    if mode not in mode_map:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}")
    
    try:
        # Apply override to all zones
        for zone_id in hub.zones.keys():
            if mode == 'normal':
                hub.create_override('now', 0, pynobo.API.OVERRIDE_MODE_NORMAL, zone_id)
            else:
                hub.create_override('now', 0, mode_map[mode], zone_id)
        
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
