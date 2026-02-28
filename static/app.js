// ===== Global State =====
let ws = null;
let reconnectInterval = null;
let pingInterval = null;
let zones = [];
let hubInfo = {};
let temperatureTimers = {};
let currentPage = 'main';
let globalMode = 'home';  // 'home', 'away', 'eco', or 'comfort'
let scheduleData = {};
let currentScheduleZone = null;
let currentZoneDetail = null;

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
    let hash = window.location.hash.slice(1) || 'main';
    
    // Check if it's a zone detail route
    if (hash.startsWith('zone/')) {
        const zoneId = hash.split('/')[1];
        navigateToZoneDetail(zoneId);
    } else {
        navigateToPage(hash);
    }
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
        if (pageName === 'devices') {
            loadDevicesPage();
        }
    }
}

function navigateToZoneDetail(zoneId) {
    currentZoneDetail = zoneId;
    navigateToPage('zoneDetail');
    renderZoneDetail(zoneId);
}

function navigateBack() {
    window.location.hash = '#main';
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
                // Ignore pong responses
                if (event.data === 'pong') {
                    return;
                }
                
                const data = JSON.parse(event.data);
                console.log('WebSocket message received:', data.type);
                
                if (data.type === 'zone_update') {
                    handleZoneUpdate(data.zones);
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
            console.log('WebSocket closed');
            updateConnectionStatus('disconnected');
            
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    console.log('Attempting to reconnect...');
                    initWebSocket();
                }, 5000);
            }
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        updateConnectionStatus('error');
    }
}

function handleZoneUpdate(data) {
    // Handle both {zones: []} and [] formats
    zones = data.zones || data;
    updateLastUpdated();
    
    if (currentPage === 'main') {
        renderZoneList();
    } else if (currentPage === 'zoneDetail' && currentZoneDetail) {
        renderZoneDetail(currentZoneDetail);
    } else if (currentPage === 'devices') {
        renderDevicesList();
    }
}

// ===== API Calls =====
async function fetchHubInfo() {
    try {
        const response = await fetch('/api/hub');
        if (!response.ok) throw new Error('Failed to fetch hub info');
        
        hubInfo = await response.json();
        updateHubInfo();
    } catch (error) {
        console.error('Error fetching hub info:', error);
    }
}

async function fetchZones() {
    try {
        const response = await fetch('/api/zones');
        if (!response.ok) throw new Error('Failed to fetch zones');
        
        const data = await response.json();
        zones = data.zones || data; // Handle both {zones: []} and [] formats
        
        if (currentPage === 'main') {
            renderZoneList();
        } else if (currentPage === 'zoneDetail' && currentZoneDetail) {
            renderZoneDetail(currentZoneDetail);
        }
        
        updateLastUpdated();
    } catch (error) {
        console.error('Error fetching zones:', error);
        showError('Failed to fetch zones');
    }
}

async function setGlobalMode(mode) {
    globalMode = mode;
    updateGlobalModeButtons();
    
    try {
        const response = await fetch(`/api/global/override/${mode}`, {
            method: 'POST'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to set global mode');
        }
        
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
            const error = await response.json();
            throw new Error(error.detail || 'Failed to set zone override');
        }
        
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
    const btnEco = document.getElementById('btnEco');
    const btnComfort = document.getElementById('btnComfort');
    
    btnHome.classList.toggle('active', globalMode === 'home');
    btnAway.classList.toggle('active', globalMode === 'away');
    btnEco.classList.toggle('active', globalMode === 'eco');
    btnComfort.classList.toggle('active', globalMode === 'comfort');
}

// ===== Zone List Rendering =====
function renderZoneList() {
    const zoneList = document.getElementById('zoneList');
    
    if (zones.length === 0) {
        zoneList.innerHTML = '<div class="loading-message">No zones found</div>';
        return;
    }
    
    zoneList.innerHTML = zones.map(zone => createZoneListItem(zone)).join('');
}

function createZoneListItem(zone) {
    const mode = zone.current_mode || 'normal';
    const icon = zone.icon || '';
    
    // Color-coded dot based on mode
    let dotColor = '#95a5a6'; // grey for off/normal
    let modeLabel = 'Following Schedule';
    
    if (mode === 'comfort') {
        dotColor = '#E74C3C';
        modeLabel = 'Comfort';
    } else if (mode === 'eco') {
        dotColor = '#27AE60';
        modeLabel = 'Eco';
    } else if (mode === 'away') {
        dotColor = '#3498DB';
        modeLabel = 'Away';
    } else if (mode === 'off') {
        dotColor = '#95A5A6';
        modeLabel = 'Off';
    }
    
    // Subtitle for grouped zones
    const subtitle = zone.rooms && zone.rooms.length > 1 
        ? `<div class="zone-list-subtitle">${zone.rooms.join(' · ')}</div>` 
        : '';
    
    const currentTemp = zone.current_temperature != null ? zone.current_temperature.toFixed(1) : '--';
    
    return `
        <div class="zone-list-item" onclick="navigateToZoneDetail('${zone.zone_id}')">
            <div class="zone-list-dot" style="background-color: ${dotColor};"></div>
            <div class="zone-list-info">
                <div class="zone-list-name">${icon} ${zone.name}</div>
                ${subtitle}
            </div>
            <div class="zone-list-temp">${currentTemp}°C</div>
            <div class="zone-list-mode">${modeLabel}</div>
            <div class="zone-list-chevron">›</div>
        </div>
    `;
}

// ===== Zone Detail Rendering =====
function renderZoneDetail(zoneId) {
    const zone = zones.find(z => z.zone_id === zoneId);
    if (!zone) {
        document.getElementById('zoneDetailContent').innerHTML = '<p>Zone not found</p>';
        return;
    }
    
    const mode = zone.current_mode || 'normal';
    const hasOverride = mode !== 'normal';
    const deviceType = zone.device_type || 'Unknown';
    const supportsTemp = zone.supports_temp_adjust || false;
    
    // Product image
    const deviceImage = deviceType === 'NTB-2R' 
        ? '/static/images/ntb-2r.svg' 
        : '/static/images/r80-rdc-700.svg';
    
    // Device badge
    const deviceBadgeClass = deviceType === 'NTB-2R' ? 'device-badge-blue' : 'device-badge-grey';
    
    // Status
    const statusIcon = hasOverride ? '⚡' : '📅';
    const statusText = hasOverride 
        ? `Override: ${getModeLabel(mode)}`
        : 'Following Schedule';
    
    // Temperature controls section
    const tempSection = supportsTemp ? `
        <div class="detail-section">
            <h3>Temperatures</h3>
            <div class="temp-control">
                <span class="temp-label">Comfort temp:</span>
                <div class="temp-adjuster">
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'comfort', -0.5)">−</button>
                    <span class="temp-value">${zone.comfort_temperature != null ? zone.comfort_temperature.toFixed(1) : '--'}°C</span>
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'comfort', 0.5)">+</button>
                </div>
            </div>
            <div class="temp-control">
                <span class="temp-label">Eco temp:</span>
                <div class="temp-adjuster">
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'eco', -0.5)">−</button>
                    <span class="temp-value">${zone.eco_temperature != null ? zone.eco_temperature.toFixed(1) : '--'}°C</span>
                    <button class="temp-btn" onclick="adjustTemperature('${zone.zone_id}', 'eco', 0.5)">+</button>
                </div>
            </div>
            <div class="temp-control temp-locked">
                <span class="temp-label">Away temp:</span>
                <div class="temp-value-locked">
                    ${zone.away_temperature != null ? zone.away_temperature.toFixed(1) : '7.0'}°C 🔒 <span class="temp-lock-text">(set by Nobø)</span>
                </div>
            </div>
        </div>
    ` : `
        <div class="detail-section">
            <h3>Temperatures</h3>
            <div class="manual-temp-notice">
                <span class="icon">🔧</span>
                <span>Comfort & Eco temperatures are adjusted manually on the device</span>
            </div>
            <div class="temp-control temp-locked">
                <span class="temp-label">Away temp:</span>
                <div class="temp-value-locked">
                    ${zone.away_temperature != null ? zone.away_temperature.toFixed(1) : '7.0'}°C 🔒 <span class="temp-lock-text">(set by Nobø)</span>
                </div>
            </div>
        </div>
    `;
    
    // Override section
    const overrideSection = `
        <div class="detail-section">
            <h3>Override</h3>
            <div class="override-buttons">
                <button class="override-btn ${mode === 'comfort' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'comfort')">🔥 Comfort</button>
                <button class="override-btn ${mode === 'eco' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'eco')">🌿 Eco</button>
                <button class="override-btn ${mode === 'away' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'away')">🏖️ Away</button>
                <button class="override-btn ${mode === 'off' ? 'active' : ''}" onclick="setZoneOverride('${zone.zone_id}', 'off')">⭘ Off</button>
            </div>
            ${hasOverride ? `<button class="cancel-override-btn" onclick="setZoneOverride('${zone.zone_id}', 'normal')">✖ Cancel Override — Return to Schedule</button>` : ''}
        </div>
    `;
    
    // Schedule section
    const scheduleSection = `
        <div class="detail-section">
            <h3>Schedule</h3>
            <button class="btn btn-primary" onclick="openScheduleModal('${zone.zone_id}')">
                <span class="icon">📅</span> Set Schedule
            </button>
        </div>
    `;
    
    // Rooms/Thermostats section
    const componentsHtml = (zone.components || []).map((serial, idx) => {
        const displaySerial = zone.components_display ? zone.components_display[idx] : serial;
        const roomName = zone.rooms && zone.rooms[idx] ? zone.rooms[idx] : `Device ${idx + 1}`;
        return `
            <div class="component-item">
                <span class="component-name">📟 ${roomName}</span>
                <span class="component-serial">${displaySerial}</span>
            </div>
        `;
    }).join('');
    
    const roomsSection = `
        <div class="detail-section">
            <h3>Rooms / Thermostats</h3>
            <div class="components-list">
                ${componentsHtml || '<p>No devices assigned</p>'}
            </div>
        </div>
    `;
    
    const html = `
        <div class="zone-detail">
            <div class="zone-detail-header">
                <button class="back-btn" onclick="navigateBack()">← Back to Zones</button>
            </div>
            
            <div class="zone-detail-image">
                <img src="${deviceImage}" alt="${deviceType}">
                <div class="device-badge ${deviceBadgeClass}">${deviceType}</div>
            </div>
            
            <div class="zone-detail-title">
                <h2>${zone.icon} ${zone.name}</h2>
            </div>
            
            <div class="zone-detail-current">
                <span class="detail-currently">Currently: ${zone.current_temperature != null ? zone.current_temperature.toFixed(1) : '--'}°C</span>
                <span class="detail-status">${statusIcon} ${statusText}</span>
            </div>
            
            ${tempSection}
            ${overrideSection}
            ${scheduleSection}
            ${roomsSection}
        </div>
    `;
    
    document.getElementById('zoneDetailContent').innerHTML = html;
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
    
    // Re-render zone detail
    if (currentPage === 'zoneDetail') {
        renderZoneDetail(zoneId);
    }
    
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

// ===== Schedule Modal =====
function openScheduleModal(zoneId) {
    currentScheduleZone = zoneId;
    const zone = zones.find(z => z.zone_id === zoneId);
    
    if (zone) {
        document.getElementById('scheduleModalZoneName').textContent = zone.name;
    }
    
    document.getElementById('scheduleModal').classList.add('show');
    loadScheduleFromAPI();
}

function closeScheduleModal() {
    document.getElementById('scheduleModal').classList.remove('show');
    currentScheduleZone = null;
}

async function loadScheduleFromAPI() {
    if (!currentScheduleZone) return;
    
    try {
        const response = await fetch(`/api/zones/${currentScheduleZone}/schedule`);
        if (!response.ok) {
            throw new Error('Failed to load schedule');
        }
        
        const data = await response.json();
        scheduleData = data.schedule || {};
        renderSchedule();
    } catch (error) {
        console.error('Error loading schedule:', error);
        showError('Failed to load schedule');
        // Render with default sample data
        renderSchedule();
    }
}

function renderSchedule() {
    const scheduleDays = document.getElementById('scheduleDays');
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // Default schedule if no data loaded
    if (!scheduleData || Object.keys(scheduleData).length === 0) {
        scheduleData = {};
        days.forEach(day => {
            scheduleData[day] = [
                { start: '00:00', end: '08:00', mode: 'comfort' },
                { start: '08:00', end: '21:00', mode: 'eco' },
                { start: '21:00', end: '24:00', mode: 'comfort' }
            ];
        });
    }
    
    scheduleDays.innerHTML = days.map((day, index) => {
        const blocks = scheduleData[day] || [];
        const blockHtml = blocks.map(block => {
            const startMinutes = timeToMinutes(block.start);
            const endMinutes = timeToMinutes(block.end);
            const duration = endMinutes - startMinutes;
            const widthPercent = (duration / (24 * 60)) * 100;
            
            const modeIcon = block.mode === 'comfort' ? '🔥' : block.mode === 'eco' ? '🌿' : block.mode === 'away' ? '🏖️' : '⭘';
            const modeClass = `timeline-block-${block.mode}`;
            
            return `<div class="timeline-block ${modeClass}" style="width: ${widthPercent}%">
                <span class="timeline-icon">${modeIcon}</span>
                <span class="timeline-label">${block.mode.charAt(0).toUpperCase() + block.mode.slice(1)}</span>
                <span class="timeline-time">${block.start} — ${block.end}</span>
            </div>`;
        }).join('');
        
        return `
            <div class="schedule-day">
                <div class="schedule-day-header">
                    <div class="day-name">${dayNames[index]}</div>
                    <button class="btn btn-sm" onclick="copyDay('${day}')">Copy to ▼</button>
                </div>
                <div class="day-timeline">
                    ${blockHtml || '<div class="timeline-block timeline-block-eco" style="width: 100%">No schedule</div>'}
                </div>
                <button class="btn btn-sm" onclick="addTimeBlock('${day}')">+ Add Time Block</button>
            </div>
        `;
    }).join('');
}

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

function addTimeBlock(day) {
    showError('Schedule editing functionality coming soon');
}

function copyDay(day) {
    showError('Copy day functionality coming soon');
}

async function saveSchedule() {
    if (!currentScheduleZone) return;
    
    try {
        const response = await fetch(`/api/zones/${currentScheduleZone}/schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedule: scheduleData })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to save schedule');
        }
        
        showError('✅ Schedule saved successfully');
        setTimeout(() => {
            closeScheduleModal();
        }, 1500);
    } catch (error) {
        console.error('Error saving schedule:', error);
        showError(error.message);
    }
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
                const roomName = zone.rooms && zone.rooms[idx] ? zone.rooms[idx] : 'Device';
                devicesHtml += `
                    <div class="device-item">
                        <div class="device-info">
                            <div class="device-serial">📟 ${roomName} — ${displaySerial}</div>
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

async function addDevice() {
    const serialInput = document.getElementById('deviceSerial');
    const zoneSelect = document.getElementById('deviceZone');
    
    const serial = serialInput.value.replace(/\s/g, '');
    const zoneId = zoneSelect.value;
    
    if (!serial || serial.length !== 12) {
        showError('Please enter a valid 12-digit serial number');
        return;
    }
    
    if (!zoneId) {
        showError('Please select a zone');
        return;
    }
    
    try {
        const response = await fetch('/api/devices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serial, zone_id: zoneId })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to add device');
        }
        
        // Clear form
        serialInput.value = '';
        zoneSelect.value = '';
        document.getElementById('detectedModel').textContent = '';
        
        // Refresh zones and devices list
        await fetchZones();
        renderDevicesList();
        
        showError('✅ Device added successfully');
    } catch (error) {
        console.error('Error adding device:', error);
        showError(error.message);
    }
}

async function replaceDevice(serial, zoneId) {
    const newSerial = prompt('Enter new device serial number (12 digits):');
    if (!newSerial) return;
    
    const cleanSerial = newSerial.replace(/\s/g, '');
    if (cleanSerial.length !== 12) {
        showError('Serial number must be 12 digits');
        return;
    }
    
    try {
        const response = await fetch(`/api/devices/${serial}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_serial: cleanSerial })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to replace device');
        }
        
        // Refresh zones and devices list
        await fetchZones();
        renderDevicesList();
        
        showError('✅ Device replaced successfully');
    } catch (error) {
        console.error('Error replacing device:', error);
        showError(error.message);
    }
}

async function removeDevice(serial, zoneId) {
    if (!confirm(`Are you sure you want to remove device ${serial}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/devices/${serial}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to remove device');
        }
        
        // Refresh zones and devices list
        await fetchZones();
        renderDevicesList();
        
        showError('✅ Device removed successfully');
    } catch (error) {
        console.error('Error removing device:', error);
        showError(error.message);
    }
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
window.navigateToZoneDetail = navigateToZoneDetail;
window.navigateBack = navigateBack;
window.openScheduleModal = openScheduleModal;
window.closeScheduleModal = closeScheduleModal;
window.addTimeBlock = addTimeBlock;
window.copyDay = copyDay;
window.saveSchedule = saveSchedule;
window.formatSerialInput = formatSerialInput;
window.detectDeviceModel = detectDeviceModel;
window.addDevice = addDevice;
window.replaceDevice = replaceDevice;
window.removeDevice = removeDevice;
