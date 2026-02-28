// ===== Global State =====
let ws = null;
let reconnectInterval = null;
let pingInterval = null;  // Store ping interval ID
let zones = [];
let hubInfo = {};
let temperatureTimers = {}; // For debouncing temperature changes

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nobø Control - Initializing...');
    initWebSocket();
    fetchHubInfo();
    fetchZones();
});

// ===== WebSocket Connection =====
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    updateConnectionStatus('connecting');
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            updateConnectionStatus('connected');
            
            // Clear reconnect interval
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
            
            // Clear old ping interval if it exists
            if (pingInterval) {
                clearInterval(pingInterval);
            }
            
            // Send ping every 30 seconds to keep connection alive
            pingInterval = setInterval(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send('ping');
                }
            }, 30000);
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('WebSocket message received:', data.type);
                
                if (data.type === 'zones_update') {
                    zones = data.data;
                    renderZones();
                    updateLastUpdated();
                }
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus('error');
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
            updateConnectionStatus('disconnected');
            
            // Clear ping interval
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            
            // Attempt to reconnect every 5 seconds
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    console.log('Attempting to reconnect WebSocket...');
                    initWebSocket();
                }, 5000);
            }
        };
    } catch (error) {
        console.error('Error creating WebSocket:', error);
        updateConnectionStatus('error');
    }
}

// ===== API Calls =====
async function fetchHubInfo() {
    try {
        const response = await fetch('/api/hub');
        if (response.ok) {
            hubInfo = await response.json();
            updateHubInfo();
        } else {
            console.error('Failed to fetch hub info:', response.statusText);
        }
    } catch (error) {
        console.error('Error fetching hub info:', error);
    }
}

async function fetchZones() {
    try {
        const response = await fetch('/api/zones');
        if (response.ok) {
            const data = await response.json();
            zones = data.zones || [];
            renderZones();
            updateLastUpdated();
        } else {
            console.error('Failed to fetch zones:', response.statusText);
            showError('Failed to load zones');
        }
    } catch (error) {
        console.error('Error fetching zones:', error);
        showError('Error connecting to server');
    }
}

async function setZoneOverride(zoneId, mode) {
    try {
        const response = await fetch(`/api/zones/${zoneId}/override/${mode}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            console.log(`Zone ${zoneId} override set to ${mode}`);
            // Update will come via WebSocket
        } else {
            const error = await response.json();
            showError(`Failed to set override: ${error.detail || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error setting zone override:', error);
        showError('Error setting zone override');
    }
}

async function setZoneTemperature(zoneId, comfort, eco) {
    try {
        const body = {};
        if (comfort !== null) body.comfort = comfort;
        if (eco !== null) body.eco = eco;
        
        const response = await fetch(`/api/zones/${zoneId}/temperature`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        if (response.ok) {
            console.log(`Zone ${zoneId} temperature updated`);
            // Update will come via WebSocket
        } else {
            const error = await response.json();
            showError(`Failed to set temperature: ${error.detail || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error setting zone temperature:', error);
        showError('Error setting zone temperature');
    }
}

async function setGlobalOverride(mode) {
    try {
        const response = await fetch(`/api/global/override/${mode}`, {
            method: 'POST'
        });
        
        if (response.ok) {
            console.log(`Global override set to ${mode}`);
            // Update will come via WebSocket
        } else {
            const error = await response.json();
            showError(`Failed to set global override: ${error.detail || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error setting global override:', error);
        showError('Error setting global override');
    }
}

// ===== UI Update Functions =====
function updateConnectionStatus(status) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    statusDot.className = 'status-dot';
    
    switch (status) {
        case 'connected':
            statusDot.classList.add('connected');
            statusText.textContent = 'Connected';
            break;
        case 'disconnected':
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Disconnected';
            break;
        case 'connecting':
            statusText.textContent = 'Connecting...';
            break;
        case 'error':
            statusDot.classList.add('disconnected');
            statusText.textContent = 'Connection Error';
            break;
    }
}

function updateHubInfo() {
    const hubNameEl = document.getElementById('hubName');
    const hubVersionEl = document.getElementById('hubVersion');
    
    if (hubInfo.name) {
        hubNameEl.textContent = hubInfo.name;
    }
    if (hubInfo.software_version) {
        hubVersionEl.textContent = `Version ${hubInfo.software_version}`;
    }
}

function updateLastUpdated() {
    const lastUpdatedEl = document.getElementById('lastUpdated');
    const now = new Date();
    lastUpdatedEl.textContent = now.toLocaleTimeString();
}

function renderZones() {
    const zonesGrid = document.getElementById('zonesGrid');
    
    if (zones.length === 0) {
        zonesGrid.innerHTML = '<div class="loading-message">No zones found</div>';
        return;
    }
    
    zonesGrid.innerHTML = zones.map(zone => createZoneCard(zone)).join('');
}

function createZoneCard(zone) {
    const modeClass = zone.current_mode || 'normal';
    const modeIcon = getModeIcon(modeClass);
    const modeLabel = getModeLabel(modeClass);
    
    // Device type information
    const deviceType = zone.device_type || 'R80 RDC 700';
    const supportsTemp = zone.supports_temp_adjust || false;
    const deviceBadgeClass = deviceType === 'NTB-2R' ? 'ntb-2r' : 'r80-rdc';
    const deviceIcon = deviceType === 'NTB-2R' ? '/static/images/ntb-2r.svg' : '/static/images/r80-rdc.svg';
    
    // Manual temperature notice for R80 RDC 700
    const manualTempNotice = !supportsTemp ? `
        <div class="manual-temp-notice">
            <span class="icon">🔧</span>
            <span>Temperature is adjusted manually on the device</span>
        </div>
    ` : '';
    
    // Temperature controls - only show for devices that support it
    const tempControlsClass = supportsTemp ? '' : 'no-temp-adjust';
    
    return `
        <div class="zone-card mode-${modeClass}">
            <div class="device-badge ${deviceBadgeClass}">${deviceType}</div>
            
            <div class="zone-image">
                <img src="${deviceIcon}" alt="${zone.name}">
            </div>
            
            <div class="zone-name">${zone.name}</div>
            
            <div class="zone-temps">
                <div class="current-temp">${zone.current_temperature.toFixed(1)}°C</div>
                <div class="target-temp">Target: ${zone.comfort_temperature.toFixed(1)}°C</div>
            </div>
            
            <div class="mode-indicator ${modeClass}">
                ${modeIcon} ${modeLabel}
            </div>
            
            <div class="mode-selector">
                <button class="mode-btn comfort ${modeClass === 'comfort' ? 'active' : ''}" 
                        onclick="setZoneOverride('${zone.zone_id}', 'comfort')">
                    🔥 Comfort
                </button>
                <button class="mode-btn eco ${modeClass === 'eco' ? 'active' : ''}" 
                        onclick="setZoneOverride('${zone.zone_id}', 'eco')">
                    🌿 Eco
                </button>
                <button class="mode-btn away ${modeClass === 'away' ? 'active' : ''}" 
                        onclick="setZoneOverride('${zone.zone_id}', 'away')">
                    🏠 Away
                </button>
                <button class="mode-btn normal ${modeClass === 'normal' ? 'active' : ''}" 
                        onclick="setZoneOverride('${zone.zone_id}', 'normal')">
                    ⭘ Normal
                </button>
            </div>
            
            ${manualTempNotice}
            
            <div class="temp-controls ${tempControlsClass}">
                <div class="temp-control">
                    <span class="temp-label">Comfort</span>
                    <div class="temp-adjuster">
                        <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'comfort', -0.5)">−</button>
                        <span class="temp-value">${zone.comfort_temperature.toFixed(1)}°C</span>
                        <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'comfort', 0.5)">+</button>
                    </div>
                </div>
                
                <div class="temp-control">
                    <span class="temp-label">Eco</span>
                    <div class="temp-adjuster">
                        <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'eco', -0.5)">−</button>
                        <span class="temp-value">${zone.eco_temperature.toFixed(1)}°C</span>
                        <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'eco', 0.5)">+</button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function getModeIcon(mode) {
    const icons = {
        'comfort': '🔥',
        'eco': '🌿',
        'away': '🏠',
        'off': '⭘',
        'normal': '⭘'
    };
    return icons[mode] || '⭘';
}

function getModeLabel(mode) {
    const labels = {
        'comfort': 'Comfort',
        'eco': 'Eco',
        'away': 'Away',
        'off': 'Off',
        'normal': 'Schedule'
    };
    return labels[mode] || 'Unknown';
}

// ===== Temperature Adjustment with Debouncing =====
function adjustTemperature(zoneId, tempType, delta) {
    // Find the zone
    const zone = zones.find(z => z.zone_id === zoneId);
    if (!zone) return;
    
    // Check if device supports temperature adjustment
    if (!zone.supports_temp_adjust) {
        showError(`Temperature cannot be adjusted remotely for ${zone.device_type} devices`);
        return;
    }
    
    // Calculate new temperature
    let currentTemp = tempType === 'comfort' ? zone.comfort_temperature : zone.eco_temperature;
    let newTemp = currentTemp + delta;
    
    // Clamp to valid range (7-30°C)
    newTemp = Math.max(7, Math.min(30, newTemp));
    
    // Update local state immediately for responsive UI
    if (tempType === 'comfort') {
        zone.comfort_temperature = newTemp;
    } else {
        zone.eco_temperature = newTemp;
    }
    renderZones();
    
    // Clear existing timer for this zone/type
    const timerKey = `${zoneId}_${tempType}`;
    if (temperatureTimers[timerKey]) {
        clearTimeout(temperatureTimers[timerKey]);
    }
    
    // Set new timer to send update after 500ms of no changes
    temperatureTimers[timerKey] = setTimeout(() => {
        console.log(`Sending temperature update for zone ${zoneId}, ${tempType}: ${newTemp}`);
        
        if (tempType === 'comfort') {
            setZoneTemperature(zoneId, newTemp, null);
        } else {
            setZoneTemperature(zoneId, null, newTemp);
        }
        
        delete temperatureTimers[timerKey];
    }, 500);
}

// ===== Error Toast =====
function showError(message) {
    const toast = document.getElementById('errorToast');
    const errorMessage = document.getElementById('errorMessage');
    
    errorMessage.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 5000);
}

// ===== Utility Functions =====
function formatTemperature(temp) {
    return temp ? temp.toFixed(1) : '0.0';
}

// ===== Export functions to global scope for onclick handlers =====
window.setGlobalOverride = setGlobalOverride;
window.setZoneOverride = setZoneOverride;
window.adjustTemperature = adjustTemperature;
