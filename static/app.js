// ===== Global State =====
let ws = null;
let reconnectInterval = null;
let pingInterval = null;
let zones = [];
let hubInfo = {};
let temperatureTimers = {};
let currentPage = 'zones';
let globalMode = 'home';  // 'home' or 'away'
let scheduleData = {};
let currentScheduleZone = null;

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nobø Control - Initializing...');
    initRouter();
    initWebSocket();
    fetchHubInfo();
    fetchZones();
});

// ===== Router =====
function initRouter() {
    // Handle hash changes
    window.addEventListener('hashchange', handleRouteChange);
    
    // Handle initial route
    handleRouteChange();
}

function handleRouteChange() {
    const hash = window.location.hash.slice(1) || 'zones';
    navigateToPage(hash);
}

function navigateToPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });
    
    // Show selected page
    const pageElement = document.getElementById(`${pageName}Page`);
    if (pageElement) {
        pageElement.classList.add('active');
        currentPage = pageName;
        
        // Update nav links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
            if (link.dataset.page === pageName) {
                link.classList.add('active');
            }
        });
        
        // Load page-specific data
        if (pageName === 'schedule') {
            loadSchedulePage();
        } else if (pageName === 'devices') {
            loadDevicesPage();
        }
    }
}

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
            
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
            
            if (pingInterval) {
                clearInterval(pingInterval);
            }
            
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
            
            if (pingInterval) {
                clearInterval(pingInterval);
                pingInterval = null;
            }
            
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
        }
    } catch (error) {
        console.error('Error fetching zones:', error);
        showError('Failed to load zones');
    }
}

async function setGlobalMode(mode) {
    try {
        globalMode = mode;
        updateGlobalModeButtons();
        
        // Set override for all zones
        const apiMode = mode === 'home' ? 'normal' : 'away';
        const response = await fetch(`/api/global/override/${apiMode}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('Failed to set global mode');
        }
        
        // Refresh zones
        await fetchZones();
    } catch (error) {
        console.error('Error setting global mode:', error);
        showError('Failed to set global mode');
    }
}

async function setZoneOverride(zoneId, mode) {
    try {
        const response = await fetch(`/api/zones/${zoneId}/override/${mode}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            throw new Error('Failed to set zone override');
        }
        
        // Refresh zones
        await fetchZones();
    } catch (error) {
        console.error('Error setting zone override:', error);
        showError('Failed to set zone override');
    }
}

async function setZoneTemperature(zoneId, comfort, eco) {
    try {
        const body = {};
        if (comfort !== null) body.comfort = comfort;
        if (eco !== null) body.eco = eco;
        
        const response = await fetch(`/api/zones/${zoneId}/temperature`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to update temperature');
        }
    } catch (error) {
        console.error('Error setting temperature:', error);
        showError(error.message);
    }
}

// ===== UI Update Functions =====
function updateConnectionStatus(status) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    
    statusDot.className = 'status-dot';
    
    switch (status) {
        case 'connected':
            if (hubInfo.demo_mode) {
                statusDot.classList.add('demo');
                statusText.textContent = '🟡 Demo Mode';
            } else {
                statusDot.classList.add('connected');
                statusText.textContent = 'Connected';
            }
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
    
    // Update connection status if demo mode
    if (hubInfo.demo_mode) {
        updateConnectionStatus('connected');
    }
}

function updateLastUpdated() {
    const lastUpdatedEl = document.getElementById('lastUpdated');
    const now = new Date();
    lastUpdatedEl.textContent = now.toLocaleTimeString();
}

function updateGlobalModeButtons() {
    const btnHome = document.getElementById('btnHome');
    const btnAway = document.getElementById('btnAway');
    
    btnHome.classList.toggle('active', globalMode === 'home');
    btnAway.classList.toggle('active', globalMode === 'away');
}

// ===== Zone Rendering =====
function renderZones() {
    const zonesGrid = document.getElementById('zonesGrid');
    
    if (zones.length === 0) {
        zonesGrid.innerHTML = '<div class="loading-message">No zones found</div>';
        return;
    }
    
    zonesGrid.innerHTML = zones.map(zone => createZoneCard(zone)).join('');
}

function createZoneCard(zone) {
    const mode = zone.current_mode || 'normal';
    const hasOverride = mode !== 'normal';
    
    // Device info
    const deviceType = zone.device_type || 'Unknown';
    const supportsTemp = zone.supports_temp_adjust || false;
    const supportsComfort = zone.supports_comfort || false;
    const supportsEco = zone.supports_eco || false;
    
    // Icon and subtitle
    const icon = zone.icon || '';
    const subtitle = zone.rooms && zone.rooms.length > 1 
        ? `<div class="zone-subtitle">${zone.rooms.join(' · ')}</div>` 
        : '';
    
    // Product image
    const deviceImage = deviceType === 'NTB-2R' 
        ? '/static/images/ntb-2r.svg' 
        : '/static/images/r80-rdc.svg';
    
    // Status indicator
    const statusClass = hasOverride ? 'override' : 'schedule';
    const statusIcon = hasOverride ? '⚡' : '📅';
    const statusText = hasOverride 
        ? `Override: ${getModeLabel(mode)}`
        : 'Following Schedule';
    
    // Temperature controls
    const tempControls = supportsTemp ? `
        <div class="temp-controls">
            <div class="temp-control">
                <span class="temp-label">Comfort temp:</span>
                <div class="temp-adjuster">
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'comfort', -0.5)">−</button>
                    <span class="temp-value">${zone.comfort_temperature.toFixed(1)}°C</span>
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'comfort', 0.5)">+</button>
                </div>
            </div>
            <div class="temp-control">
                <span class="temp-label">Eco temp:</span>
                <div class="temp-adjuster">
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'eco', -0.5)">−</button>
                    <span class="temp-value">${zone.eco_temperature.toFixed(1)}°C</span>
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'eco', 0.5)">+</button>
                </div>
            </div>
        </div>
    ` : `
        <div class="manual-temp-notice">
            <span class="icon">🔧</span>
            <span>Comfort & Eco temperatures are adjusted manually on the device</span>
        </div>
    `;
    
    // Away temperature (locked)
    const awayTemp = `
        <div class="temp-control">
            <span class="temp-label">Away temp:</span>
            <div class="temp-value-locked">
                <span class="temp-value">${zone.away_temperature.toFixed(1)}°C</span>
                <span class="temp-lock">🔒</span>
                <span class="temp-lock-text">(set by Nobø)</span>
            </div>
        </div>
    `;
    
    // Override buttons
    const overrideButtons = `
        <div class="override-section">
            <div class="override-label">Override:</div>
            <div class="override-buttons">
                ${supportsComfort ? `<button class="override-btn ${mode === 'comfort' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'comfort')">🔥 Comfort</button>` : ''}
                ${supportsEco ? `<button class="override-btn ${mode === 'eco' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'eco')">🌿 Eco</button>` : ''}
                <button class="override-btn ${mode === 'away' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'away')">🏖️ Away</button>
                <button class="override-btn ${mode === 'off' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'off')">⭘ Off</button>
            </div>
            ${hasOverride ? `<button class="cancel-override-btn" onclick="setZoneOverride('${zone.zone_id}', 'normal')">✖ Cancel Override — Return to Schedule</button>` : ''}
        </div>
    `;
    
    // Device badge
    const deviceBadgeClass = deviceType === 'NTB-2R' ? 'device-badge-ntb' : 'device-badge-r80';
    
    return `
        <div class="zone-card">
            <div class="device-badge ${deviceBadgeClass}">${deviceType}</div>
            
            <div class="zone-image">
                <img src="${deviceImage}" alt="${deviceType}">
            </div>
            
            <div class="zone-header">
                <div class="zone-name">${icon} ${zone.name}</div>
                ${subtitle}
            </div>
            
            <div class="zone-status ${statusClass}">
                <span class="status-icon">${statusIcon}</span>
                <span class="status-text">${statusText}</span>
            </div>
            
            <div class="zone-current-temp">
                <span class="temp-label">Currently:</span>
                <span class="temp-value">${zone.current_temperature.toFixed(1)}°C</span>
            </div>
            
            ${tempControls}
            ${awayTemp}
            ${overrideButtons}
        </div>
    `;
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

// ===== Temperature Adjustment =====
function adjustTemperature(zoneId, tempType, delta) {
    const zone = zones.find(z => z.zone_id === zoneId);
    if (!zone) return;
    
    if (!zone.supports_temp_adjust) {
        showError(`Temperature cannot be adjusted remotely for ${zone.device_type} devices`);
        return;
    }
    
    let currentTemp = tempType === 'comfort' ? zone.comfort_temperature : zone.eco_temperature;
    let newTemp = currentTemp + delta;
    
    newTemp = Math.max(7, Math.min(30, newTemp));
    
    if (tempType === 'comfort') {
        zone.comfort_temperature = newTemp;
    } else {
        zone.eco_temperature = newTemp;
    }
    renderZones();
    
    const timerKey = `${zoneId}_${tempType}`;
    if (temperatureTimers[timerKey]) {
        clearTimeout(temperatureTimers[timerKey]);
    }
    
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

// ===== Schedule Page =====
function loadSchedulePage() {
    const zoneSelect = document.getElementById('scheduleZoneSelect');
    zoneSelect.innerHTML = '<option value="">Select a zone...</option>';
    
    zones.forEach(zone => {
        const option = document.createElement('option');
        option.value = zone.zone_id;
        option.textContent = zone.name;
        zoneSelect.appendChild(option);
    });
}

function loadScheduleForZone() {
    const zoneSelect = document.getElementById('scheduleZoneSelect');
    const zoneId = zoneSelect.value;
    
    if (!zoneId) {
        document.getElementById('scheduleEditor').style.display = 'none';
        return;
    }
    
    currentScheduleZone = zoneId;
    document.getElementById('scheduleEditor').style.display = 'block';
    
    // TODO: Load actual schedule from API
    renderSchedule();
}

function renderSchedule() {
    const scheduleDays = document.getElementById('scheduleDays');
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // Sample schedule data
    const sampleSchedule = {
        monday: [
            { start: '00:00', end: '07:00', mode: 'eco' },
            { start: '07:00', end: '22:00', mode: 'comfort' },
            { start: '22:00', end: '24:00', mode: 'eco' }
        ]
    };
    
    scheduleDays.innerHTML = days.map((day, index) => {
        return `
            <div class="schedule-day">
                <div class="day-name">${day}</div>
                <div class="day-timeline">
                    <div class="timeline-bar">
                        <!-- Timeline blocks will be rendered here -->
                        <div class="timeline-block eco" style="width: 29.17%">Eco 00:00-07:00</div>
                        <div class="timeline-block comfort" style="width: 62.5%">Comfort 07:00-22:00</div>
                        <div class="timeline-block eco" style="width: 8.33%">Eco 22:00-24:00</div>
                    </div>
                </div>
                <div class="day-actions">
                    <button class="btn btn-sm" onclick="addTimeBlock('${day.toLowerCase()}')">+ Add</button>
                    <button class="btn btn-sm" onclick="copyDay('${day.toLowerCase()}')">Copy to...</button>
                </div>
            </div>
        `;
    }).join('');
}

function addTimeBlock(day) {
    showError('Schedule editing coming soon');
}

function copyDay(day) {
    showError('Copy day functionality coming soon');
}

function saveSchedule() {
    showError('Schedule saving coming soon');
}

function cancelSchedule() {
    document.getElementById('scheduleEditor').style.display = 'none';
    document.getElementById('scheduleZoneSelect').value = '';
}

// ===== Devices Page =====
function loadDevicesPage() {
    // Populate zone selector
    const zoneSelect = document.getElementById('deviceZone');
    zoneSelect.innerHTML = '<option value="">Select zone...</option>';
    
    zones.forEach(zone => {
        const option = document.createElement('option');
        option.value = zone.zone_id;
        option.textContent = zone.name;
        zoneSelect.appendChild(option);
    });
    
    // Render devices list
    renderDevicesList();
}

function renderDevicesList() {
    const devicesList = document.getElementById('devicesList');
    
    let devicesHtml = '';
    zones.forEach(zone => {
        if (zone.components && zone.components.length > 0) {
            zone.components.forEach((serial, idx) => {
                const displaySerial = zone.components_display ? zone.components_display[idx] : serial;
                devicesHtml += `
                    <div class="device-item">
                        <div class="device-info">
                            <div class="device-serial">📟 ${displaySerial}</div>
                            <div class="device-type">${zone.device_type}</div>
                            <div class="device-zone">→ ${zone.name}</div>
                        </div>
                        <div class="device-actions">
                            <button class="btn btn-sm" onclick="replaceDevice('${serial}', '${zone.zone_id}')">Replace</button>
                            <button class="btn btn-sm btn-danger" onclick="removeDevice('${serial}', '${zone.zone_id}')">Remove</button>
                        </div>
                    </div>
                `;
            });
        }
    });
    
    if (devicesHtml === '') {
        devicesHtml = '<div class="loading-message">No devices registered</div>';
    }
    
    devicesList.innerHTML = devicesHtml;
}

function formatSerialInput(input) {
    let value = input.value.replace(/\s/g, '');
    
    if (value.length > 12) {
        value = value.slice(0, 12);
    }
    
    let formatted = '';
    for (let i = 0; i < value.length; i++) {
        if (i > 0 && i % 3 === 0) {
            formatted += ' ';
        }
        formatted += value[i];
    }
    
    input.value = formatted;
}

function detectDeviceModel() {
    const serialInput = document.getElementById('deviceSerial');
    const detectedModel = document.getElementById('detectedModel');
    const serial = serialInput.value.replace(/\s/g, '');
    
    if (serial.length >= 3) {
        const prefix = serial.slice(0, 3);
        
        if (prefix === '210') {
            detectedModel.textContent = '→ Auto-detected: NTB-2R ✅';
            detectedModel.style.color = '#27ae60';
        } else if (prefix === '160') {
            detectedModel.textContent = '→ Auto-detected: R80 RDC 700 ✅';
            detectedModel.style.color = '#27ae60';
        } else {
            detectedModel.textContent = '→ Unknown device model';
            detectedModel.style.color = '#e74c3c';
        }
    } else {
        detectedModel.textContent = '';
    }
}

function addDevice() {
    showError('Add device functionality coming soon');
}

function replaceDevice(serial, zoneId) {
    showError('Replace device functionality coming soon');
}

function removeDevice(serial, zoneId) {
    showError('Remove device functionality coming soon');
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

// ===== Export functions to global scope =====
window.setGlobalMode = setGlobalMode;
window.setZoneOverride = setZoneOverride;
window.adjustTemperature = adjustTemperature;
window.loadScheduleForZone = loadScheduleForZone;
window.addTimeBlock = addTimeBlock;
window.copyDay = copyDay;
window.saveSchedule = saveSchedule;
window.cancelSchedule = cancelSchedule;
window.formatSerialInput = formatSerialInput;
window.detectDeviceModel = detectDeviceModel;
window.addDevice = addDevice;
window.replaceDevice = replaceDevice;
window.removeDevice = removeDevice;
