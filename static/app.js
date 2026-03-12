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
let activeFormState = null;   // { type: 'add'|'edit', day: string, blockIndex: number|null }
let copyDayPopoverDay = null; // which day's copy popover is currently open

const SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const SCHEDULE_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('Nobø Control - Initializing...');
    initThemeToggle();
    initRouter();
    initWebSocket();
    fetchHubInfo();
    fetchZones();
});

// ===== Theme Toggle =====
function initThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    // Determine initial theme
    const saved = localStorage.getItem('nobo-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);

    toggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        localStorage.setItem('nobo-theme', next);
    });

    // Listen for system preference changes (when no saved preference)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('nobo-theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    // Update meta theme-color
    const metaThemeColor = document.getElementById('metaThemeColor');
    if (metaThemeColor) {
        metaThemeColor.setAttribute('content', theme === 'dark' ? '#1a1d23' : '#2c3e50');
    }
}

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
    window.location.hash = '#zone/' + zoneId;
    navigateToPage('zoneDetail');
    renderZoneDetail(zoneId);
}

function navigateBack() {
    currentZoneDetail = null;
    window.location.hash = '#main';
    navigateToPage('main');
    renderZoneList();
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
    // Show skeleton loaders on first load
    if (zones.length === 0 && currentPage === 'main') {
        showSkeletonLoaders();
    }
    
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
        showToast('Failed to fetch zones', 'error');
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
        showToast(`Global mode set to ${getModeLabel(mode)}`, 'success');
    } catch (error) {
        console.error('Error setting global mode:', error);
        showToast('Failed to set global mode', 'error');
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
        if (mode === 'normal') {
            showToast('Override cancelled — returning to schedule', 'info');
        } else {
            showToast(`Zone set to ${getModeLabel(mode)}`, 'success');
        }
    } catch (error) {
        console.error('Error setting zone override:', error);
        showToast('Failed to set zone override', 'error');
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
        showToast(error.message, 'error');
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

function showSkeletonLoaders() {
    const zoneList = document.getElementById('zoneList');
    if (!zoneList) return;
    const skeletonCount = 3;
    zoneList.innerHTML = Array.from({ length: skeletonCount }, () => `
        <div class="skeleton-zone-item" aria-hidden="true">
            <div class="skeleton-top">
                <div class="skeleton-dot"></div>
                <div class="skeleton-text skeleton-name"></div>
            </div>
            <div class="skeleton-bottom">
                <div class="skeleton-temp"></div>
                <div class="skeleton-mode"></div>
            </div>
        </div>
    `).join('');
}

function createZoneListItem(zone) {
    const mode = zone.current_mode || 'normal';
    const icon = zone.icon || '';
    
    // Color-coded dot and label based on mode
    let dotColor = '#95a5a6'; // grey for off/normal
    let modeLabel = 'Schedule';
    let modeCssClass = '';
    const hasOverride = mode !== 'normal';
    
    if (mode === 'comfort') {
        dotColor = '#E74C3C';
        modeLabel = 'Comfort';
        modeCssClass = 'mode-comfort';
    } else if (mode === 'eco') {
        dotColor = '#27AE60';
        modeLabel = 'Eco';
        modeCssClass = 'mode-eco';
    } else if (mode === 'away') {
        dotColor = '#3498DB';
        modeLabel = 'Away';
        modeCssClass = 'mode-away';
    } else if (mode === 'off') {
        dotColor = '#95A5A6';
        modeLabel = 'Off';
    } else {
        // 'normal' — following schedule
        modeLabel = 'Schedule';
    }
    
    // Subtitle for grouped zones
    const subtitle = zone.rooms && zone.rooms.length > 1 
        ? `<div class="zone-list-subtitle">${zone.rooms.join(' · ')}</div>` 
        : '';
    
    const supportsTemp = zone.supports_temp_adjust || false;
    const currentTemp = supportsTemp && zone.current_temperature != null
        ? zone.current_temperature.toFixed(1) + '°C'
        : '—';
    
    return `
        <div class="zone-list-item ripple-container" 
             onclick="navigateToZoneDetail('${zone.zone_id}')"
             role="button"
             tabindex="0"
             aria-label="${zone.name}, ${currentTemp}, ${modeLabel}"
             onkeydown="if(event.key==='Enter'||event.key===' ')navigateToZoneDetail('${zone.zone_id}')">
            <div class="zone-list-item-top">
                <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                    <div class="zone-list-dot${hasOverride ? ' active-override' : ''}" 
                         style="background-color: ${dotColor};" 
                         aria-hidden="true"></div>
                    <div class="zone-list-info">
                        <div class="zone-list-name">${icon} ${zone.name}</div>
                        ${subtitle}
                    </div>
                </div>
                <div class="zone-list-chevron" aria-hidden="true">›</div>
            </div>
            <div class="zone-list-bottom">
                <div class="zone-list-temp">${currentTemp}</div>
                <div class="zone-list-mode${modeCssClass ? ' ' + modeCssClass : ''}">${modeLabel}</div>
            </div>
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
    
    // Current temperature display
    const currentTempDisplay = supportsTemp && zone.current_temperature != null
        ? zone.current_temperature.toFixed(1) + '°C'
        : '—';
    const noSensorNotice = !supportsTemp ? `
        <div class="no-sensor-notice">
            <span class="icon">📵</span>
            <span>No built-in temperature sensor — temperature is read locally on the device</span>
        </div>
    ` : '';

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
            <div id="inlineAddDeviceForm-${zone.zone_id}" class="inline-add-device-form" style="display:none;">
                <div class="form-group">
                    <label for="inlineDeviceSerial-${zone.zone_id}">Serial Number:</label>
                    <input type="text" id="inlineDeviceSerial-${zone.zone_id}"
                           placeholder="210 000 016 247" maxlength="15"
                           oninput="formatSerialInput(this); detectInlineDeviceModel('${zone.zone_id}')">
                    <span id="inlineDetectedModel-${zone.zone_id}" class="detected-model"></span>
                </div>
                <div class="form-actions">
                    <button class="btn btn-primary" onclick="addDeviceToZone('${zone.zone_id}')">
                        <span class="icon">➕</span> Add
                    </button>
                    <button class="btn btn-secondary" onclick="closeInlineAddDevice('${zone.zone_id}')">Cancel</button>
                </div>
            </div>
            <button class="btn btn-secondary" id="openInlineAddDeviceBtn-${zone.zone_id}"
                    onclick="openInlineAddDevice('${zone.zone_id}')" style="margin-top:12px;">
                <span class="icon">➕</span> Add Device
            </button>
        </div>
    `;
    
    const html = `
        <div class="zone-detail">
            <div class="zone-detail-header">
                <button class="back-btn" onclick="navigateBack()">← Back to Main</button>
            </div>
            
            <div class="zone-detail-image">
                <img src="${deviceImage}" alt="${deviceType}">
                <div class="device-badge ${deviceBadgeClass}">${deviceType}</div>
            </div>
            
            <div class="zone-detail-title">
                <h2>${zone.icon} ${zone.name}</h2>
            </div>
            
            <div class="zone-detail-current">
                <span class="detail-currently">${currentTempDisplay}</span>
                <span class="detail-status">${statusIcon} ${statusText}</span>
            </div>
            
            ${noSensorNotice}
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
        showToast(`Temperature cannot be adjusted remotely for ${zone.device_type} devices`, 'warning');
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
        showToast('Failed to load schedule', 'error');
        // Render with default sample data
        renderSchedule();
    }
}

// ===== Schedule Helpers =====

function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(minutes) {
    if (minutes >= 24 * 60) return '24:00';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateTimeOptions() {
    const options = [];
    for (let h = 0; h < 24; h++) {
        options.push(`${String(h).padStart(2, '0')}:00`);
        options.push(`${String(h).padStart(2, '0')}:30`);
    }
    options.push('24:00');
    return options;
}

function fillGaps(day) {
    let blocks = (scheduleData[day] || []).slice();
    blocks.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    const endOfDay = 24 * 60;
    const filled = [];
    let cursor = 0;

    for (const block of blocks) {
        const start = timeToMinutes(block.start);
        const end = timeToMinutes(block.end);
        if (start > cursor) {
            filled.push({ start: minutesToTime(cursor), end: minutesToTime(start), mode: 'eco' });
        }
        if (end > cursor) {
            // Use Math.max defensively in case blocks were entered with overlapping times
            filled.push({ start: minutesToTime(Math.max(start, cursor)), end: minutesToTime(end), mode: block.mode });
            cursor = end;
        }
    }
    if (cursor < endOfDay) {
        filled.push({ start: minutesToTime(cursor), end: '24:00', mode: 'eco' });
    }

    // Merge adjacent blocks with the same mode
    const merged = [];
    for (const block of filled) {
        if (merged.length > 0 &&
            merged[merged.length - 1].mode === block.mode &&
            merged[merged.length - 1].end === block.start) {
            merged[merged.length - 1] = { ...merged[merged.length - 1], end: block.end };
        } else {
            merged.push({ ...block });
        }
    }
    scheduleData[day] = merged;
}

function generateTimeSelectHtml(id, selectedValue, excludeFirst, excludeLast) {
    const times = generateTimeOptions().filter(t =>
        !(excludeFirst && t === '00:00') && !(excludeLast && t === '24:00')
    );
    return `<select id="${id}" class="time-select">${
        times.map(t => `<option value="${t}"${t === selectedValue ? ' selected' : ''}>${t}</option>`).join('')
    }</select>`;
}

function getModeButtonsHtml(containerId, selectedMode) {
    return ['comfort', 'eco', 'away'].map(mode => {
        const icon = mode === 'comfort' ? '🔥' : mode === 'eco' ? '🌿' : '🏖️';
        const label = mode.charAt(0).toUpperCase() + mode.slice(1);
        return `<button type="button" class="mode-btn mode-btn-${mode}${selectedMode === mode ? ' active' : ''}"
            data-mode="${mode}" onclick="selectMode('${containerId}','${mode}')">${icon} ${label}</button>`;
    }).join('');
}

function buildAddFormHtml(day) {
    const startSelect = generateTimeSelectHtml(`formStart-${day}`, '00:00', false, true);
    const endSelect = generateTimeSelectHtml(`formEnd-${day}`, '24:00', true, false);
    const modeId = `formMode-${day}`;
    return `<div class="block-edit-form">
        <div class="block-edit-form-title">➕ Add Time Block</div>
        <div class="block-edit-fields">
            <label class="field-label">Start ${startSelect}</label>
            <label class="field-label">End ${endSelect}</label>
            <div class="field-label">Mode
                <div class="mode-selector" id="${modeId}" data-selected="comfort">
                    ${getModeButtonsHtml(modeId, 'comfort')}
                </div>
            </div>
        </div>
        <div class="block-edit-actions">
            <button class="btn btn-primary btn-sm" onclick="submitAddTimeBlock('${day}')">Add</button>
            <button class="btn btn-secondary btn-sm" onclick="closeAllForms()">Cancel</button>
        </div>
    </div>`;
}

function buildEditFormHtml(day, blockIndex, block, totalBlocks) {
    const startSelect = generateTimeSelectHtml(`editStart-${day}-${blockIndex}`, block.start, false, true);
    const endSelect = generateTimeSelectHtml(`editEnd-${day}-${blockIndex}`, block.end, true, false);
    const modeId = `editMode-${day}-${blockIndex}`;
    const canDelete = totalBlocks > 1;
    return `<div class="block-edit-form editing">
        <div class="block-edit-form-title">✏️ Edit Time Block</div>
        <div class="block-edit-fields">
            <label class="field-label">Start ${startSelect}</label>
            <label class="field-label">End ${endSelect}</label>
            <div class="field-label">Mode
                <div class="mode-selector" id="${modeId}" data-selected="${block.mode}">
                    ${getModeButtonsHtml(modeId, block.mode)}
                </div>
            </div>
        </div>
        <div class="block-edit-actions">
            <button class="btn btn-primary btn-sm" onclick="submitEditTimeBlock('${day}',${blockIndex})">Save</button>
            ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteTimeBlock('${day}',${blockIndex})">🗑 Delete</button>` : ''}
            <button class="btn btn-secondary btn-sm" onclick="closeAllForms()">Cancel</button>
        </div>
    </div>`;
}

function buildCopyDayPopoverHtml(sourceDay, days, dayNames) {
    const checkboxes = days
        .filter(d => d !== sourceDay)
        .map(d => {
            const name = dayNames[days.indexOf(d)];
            return `<label class="copy-day-check"><input type="checkbox" class="copy-to-check" value="${d}"> ${name}</label>`;
        }).join('');
    return `<div class="copy-day-popover" onclick="event.stopPropagation()">
        <div class="copy-quick-select">
            <button class="btn btn-xs" onclick="selectCopyDayGroup('weekdays','${sourceDay}')">Mon–Fri</button>
            <button class="btn btn-xs" onclick="selectCopyDayGroup('weekend','${sourceDay}')">Sat–Sun</button>
            <button class="btn btn-xs" onclick="selectCopyDayGroup('all','${sourceDay}')">All Days</button>
        </div>
        <div class="copy-day-checks">${checkboxes}</div>
        <div class="copy-day-footer">
            <button class="btn btn-primary btn-sm" onclick="confirmCopyDay('${sourceDay}')">Copy</button>
            <button class="btn btn-secondary btn-sm" onclick="closeCopyDayPopover()">Cancel</button>
        </div>
    </div>`;
}

function renderSchedule() {
    const scheduleDays = document.getElementById('scheduleDays');
    const days = SCHEDULE_DAYS;
    const dayNames = SCHEDULE_DAY_NAMES;

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

        const blockHtml = blocks.map((block, bi) => {
            const duration = timeToMinutes(block.end) - timeToMinutes(block.start);
            const widthPercent = (duration / (24 * 60)) * 100;
            const modeIcon = block.mode === 'comfort' ? '🔥' : block.mode === 'eco' ? '🌿' : '🏖️';
            const modeClass = `timeline-block-${block.mode}`;
            const isEditing = activeFormState && activeFormState.type === 'edit' &&
                activeFormState.day === day && activeFormState.blockIndex === bi;
            const modeLabel = block.mode.charAt(0).toUpperCase() + block.mode.slice(1);
            return `<div class="timeline-block ${modeClass}${isEditing ? ' editing' : ''}"
                style="width:${widthPercent.toFixed(2)}%"
                onclick="openEditTimeBlock('${day}',${bi})"
                title="${modeLabel}: ${block.start}–${block.end}">
                <span class="timeline-icon">${modeIcon}</span>
                <span class="timeline-label">${modeLabel}</span>
                <span class="timeline-time">${block.start}–${block.end}</span>
            </div>`;
        }).join('');

        let formHtml = '';
        if (activeFormState && activeFormState.day === day) {
            if (activeFormState.type === 'add') {
                formHtml = buildAddFormHtml(day);
            } else if (activeFormState.type === 'edit' && blocks[activeFormState.blockIndex]) {
                formHtml = buildEditFormHtml(day, activeFormState.blockIndex, blocks[activeFormState.blockIndex], blocks.length);
            }
        }

        const copyPopoverHtml = copyDayPopoverDay === day
            ? buildCopyDayPopoverHtml(day, days, dayNames)
            : '';

        const showAddBtn = !(activeFormState && activeFormState.type === 'add' && activeFormState.day === day);

        return `<div class="schedule-day" data-day="${day}">
            <div class="schedule-day-header">
                <div class="day-name">${dayNames[index]}</div>
                <div class="copy-day-wrapper">
                    <button class="btn btn-sm" onclick="copyDay('${day}')">Copy to ▼</button>
                    ${copyPopoverHtml}
                </div>
            </div>
            <div class="day-timeline">
                ${blockHtml || '<div class="timeline-block timeline-block-eco" style="width:100%">No schedule</div>'}
            </div>
            ${formHtml}
            ${showAddBtn ? `<button class="btn btn-sm add-block-btn" onclick="addTimeBlock('${day}')">+ Add Block</button>` : ''}
        </div>`;
    }).join('');
}

// ===== Schedule Block Editing =====

function addTimeBlock(day) {
    closeCopyDayPopover();
    activeFormState = { type: 'add', day };
    renderSchedule();
    const dayEl = document.querySelector(`.schedule-day[data-day="${day}"]`);
    if (dayEl) dayEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openEditTimeBlock(day, blockIndex) {
    closeCopyDayPopover();
    activeFormState = { type: 'edit', day, blockIndex };
    renderSchedule();
    const dayEl = document.querySelector(`.schedule-day[data-day="${day}"]`);
    if (dayEl) dayEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeAllForms() {
    activeFormState = null;
    closeCopyDayPopover();
    renderSchedule();
}

function selectMode(containerId, mode) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.setAttribute('data-selected', mode);
    container.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
}

function submitAddTimeBlock(day) {
    const startEl = document.getElementById(`formStart-${day}`);
    const endEl = document.getElementById(`formEnd-${day}`);
    const modeEl = document.getElementById(`formMode-${day}`);
    if (!startEl || !endEl || !modeEl) return;

    const start = startEl.value;
    const end = endEl.value;
    const mode = modeEl.getAttribute('data-selected') || 'comfort';

    if (timeToMinutes(start) >= timeToMinutes(end)) {
        showToast('Start time must be before end time', 'error');
        return;
    }

    const blocks = scheduleData[day] || [];
    const startMin = timeToMinutes(start);
    const endMin = timeToMinutes(end);
    for (const block of blocks) {
        const bStart = timeToMinutes(block.start);
        const bEnd = timeToMinutes(block.end);
        if (startMin < bEnd && endMin > bStart) {
            showToast(`Overlaps with ${block.mode} block (${block.start}–${block.end}). Edit or delete it first.`, 'error');
            return;
        }
    }

    if (!scheduleData[day]) scheduleData[day] = [];
    scheduleData[day].push({ start, end, mode });
    scheduleData[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    fillGaps(day);
    activeFormState = null;
    renderSchedule();
    showToast(`Added ${mode} block ${start}–${end}`, 'success');
}

function submitEditTimeBlock(day, blockIndex) {
    const startEl = document.getElementById(`editStart-${day}-${blockIndex}`);
    const endEl = document.getElementById(`editEnd-${day}-${blockIndex}`);
    const modeEl = document.getElementById(`editMode-${day}-${blockIndex}`);
    if (!startEl || !endEl || !modeEl) return;

    const start = startEl.value;
    const end = endEl.value;
    const mode = modeEl.getAttribute('data-selected') || 'eco';

    if (timeToMinutes(start) >= timeToMinutes(end)) {
        showToast('Start time must be before end time', 'error');
        return;
    }

    const blocks = scheduleData[day] || [];
    const startMin = timeToMinutes(start);
    const endMin = timeToMinutes(end);
    for (let i = 0; i < blocks.length; i++) {
        if (i === blockIndex) continue;
        const bStart = timeToMinutes(blocks[i].start);
        const bEnd = timeToMinutes(blocks[i].end);
        if (startMin < bEnd && endMin > bStart) {
            showToast(`Overlaps with ${blocks[i].mode} block (${blocks[i].start}–${blocks[i].end}).`, 'error');
            return;
        }
    }

    scheduleData[day][blockIndex] = { start, end, mode };
    scheduleData[day].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    fillGaps(day);
    activeFormState = null;
    renderSchedule();
    showToast(`Updated block to ${mode} ${start}–${end}`, 'success');
}

function deleteTimeBlock(day, blockIndex) {
    const blocks = scheduleData[day] || [];
    if (blocks.length <= 1) {
        showToast('Cannot delete the only block. Change its mode instead.', 'warning');
        return;
    }
    const removed = blocks[blockIndex];
    scheduleData[day].splice(blockIndex, 1);
    fillGaps(day);
    activeFormState = null;
    renderSchedule();
    showToast(`Deleted ${removed.mode} block (${removed.start}–${removed.end})`, 'info');
}

// ===== Copy Day =====

function copyDay(day) {
    activeFormState = null;
    if (copyDayPopoverDay === day) {
        copyDayPopoverDay = null;
    } else {
        copyDayPopoverDay = day;
    }
    renderSchedule();
}

function closeCopyDayPopover() {
    if (copyDayPopoverDay !== null) {
        copyDayPopoverDay = null;
    }
}

function selectCopyDayGroup(group, sourceDay) {
    const popover = document.querySelector('.copy-day-popover');
    if (!popover) return;
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const weekend = ['saturday', 'sunday'];
    const allDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    let targetDays;
    if (group === 'weekdays') targetDays = weekdays.filter(d => d !== sourceDay);
    else if (group === 'weekend') targetDays = weekend.filter(d => d !== sourceDay);
    else targetDays = allDays.filter(d => d !== sourceDay);
    popover.querySelectorAll('.copy-to-check').forEach(cb => {
        cb.checked = targetDays.includes(cb.value);
    });
}

function confirmCopyDay(sourceDay) {
    const popover = document.querySelector('.copy-day-popover');
    if (!popover) return;
    const selected = Array.from(popover.querySelectorAll('.copy-to-check:checked')).map(cb => cb.value);
    if (selected.length === 0) {
        showToast('Select at least one day to copy to', 'warning');
        return;
    }
    const sourceBlocks = (scheduleData[sourceDay] || []).map(b => ({ ...b }));
    selected.forEach(targetDay => {
        scheduleData[targetDay] = sourceBlocks.map(b => ({ ...b }));
    });
    copyDayPopoverDay = null;
    renderSchedule();
    const names = selected.map(d => SCHEDULE_DAY_NAMES[SCHEDULE_DAYS.indexOf(d)]);
    showToast(`Copied schedule to: ${names.join(', ')}`, 'success');
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
        
        showToast('Schedule saved successfully', 'success');
        setTimeout(() => {
            closeScheduleModal();
        }, 1500);
    } catch (error) {
        console.error('Error saving schedule:', error);
        showToast(error.message, 'error');
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
                const supportsTemp = zone.supports_temp_adjust || false;
                const mode = zone.current_mode || 'normal';

                // Mode badge
                const modeBadgeClass = mode === 'comfort' ? 'mode-badge-comfort'
                    : mode === 'eco' ? 'mode-badge-eco'
                    : mode === 'away' ? 'mode-badge-away'
                    : mode === 'off' ? 'mode-badge-off'
                    : 'mode-badge-normal';
                const modeLabel = getModeLabel(mode);
                const tempLabel = supportsTemp ? 'Remote adjust ✅' : 'Manual only 🔧';

                devicesHtml += `
                    <div class="device-item">
                        <div class="device-info">
                            <div class="device-serial">📟 ${roomName} — ${displaySerial}</div>
                            <div class="device-type">${zone.device_type}</div>
                            <div class="device-zone">→ ${zone.name}</div>
                            <div class="device-status-row">
                                <span class="device-mode-badge ${modeBadgeClass}">${modeLabel}</span>
                                <span class="device-temp-support">${tempLabel}</span>
                            </div>
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

// ===== Inline Add Device (Zone Detail) =====
function openInlineAddDevice(zoneId) {
    const form = document.getElementById(`inlineAddDeviceForm-${zoneId}`);
    const btn = document.getElementById(`openInlineAddDeviceBtn-${zoneId}`);
    if (form) form.style.display = 'block';
    if (btn) btn.style.display = 'none';
}

function closeInlineAddDevice(zoneId) {
    const form = document.getElementById(`inlineAddDeviceForm-${zoneId}`);
    const btn = document.getElementById(`openInlineAddDeviceBtn-${zoneId}`);
    const serialInput = document.getElementById(`inlineDeviceSerial-${zoneId}`);
    const modelSpan = document.getElementById(`inlineDetectedModel-${zoneId}`);
    if (form) form.style.display = 'none';
    if (btn) btn.style.display = '';
    if (serialInput) serialInput.value = '';
    if (modelSpan) modelSpan.textContent = '';
}

function detectInlineDeviceModel(zoneId) {
    const serialInput = document.getElementById(`inlineDeviceSerial-${zoneId}`);
    const detectedModel = document.getElementById(`inlineDetectedModel-${zoneId}`);
    if (!serialInput || !detectedModel) return;
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

async function addDeviceToZone(zoneId) {
    const serialInput = document.getElementById(`inlineDeviceSerial-${zoneId}`);
    if (!serialInput) return;
    const serial = serialInput.value.replace(/\s/g, '');

    if (!serial || serial.length !== 12) {
        showToast('Please enter a valid 12-digit serial number', 'warning');
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

        await fetchZones();
        showToast('Device added successfully', 'success');
        // Re-render zone detail to reflect the new device
        renderZoneDetail(zoneId);
    } catch (error) {
        console.error('Error adding device to zone:', error);
        showToast(error.message, 'error');
    }
}

// ===== Add Zone Modal =====
function openAddZoneModal() {
    const nameInput = document.getElementById('newZoneName');
    const iconInput = document.getElementById('newZoneIcon');
    if (nameInput) nameInput.value = '';
    if (iconInput) iconInput.value = '';
    document.getElementById('addZoneModal').classList.add('show');
}

function closeAddZoneModal() {
    document.getElementById('addZoneModal').classList.remove('show');
}

async function addZone() {
    const nameInput = document.getElementById('newZoneName');
    const iconInput = document.getElementById('newZoneIcon');
    const name = nameInput ? nameInput.value.trim() : '';
    const icon = iconInput ? iconInput.value.trim() : '';

    if (!name) {
        showToast('Please enter a zone name', 'warning');
        return;
    }

    try {
        const response = await fetch('/api/zones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, icon })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to add zone');
        }

        closeAddZoneModal();
        await fetchZones();
        showToast(`Zone "${name}" created`, 'success');
    } catch (error) {
        console.error('Error adding zone:', error);
        showToast(error.message, 'error');
    }
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
        showToast('Please enter a valid 12-digit serial number', 'warning');
        return;
    }
    
    if (!zoneId) {
        showToast('Please select a zone', 'warning');
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
        
        showToast('Device added successfully', 'success');
    } catch (error) {
        console.error('Error adding device:', error);
        showToast(error.message, 'error');
    }
}

async function replaceDevice(serial, zoneId) {
    const newSerial = prompt('Enter new device serial number (12 digits):');
    if (!newSerial) return;
    
    const cleanSerial = newSerial.replace(/\s/g, '');
    if (cleanSerial.length !== 12) {
        showToast('Serial number must be 12 digits', 'warning');
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
        
        showToast('Device replaced successfully', 'success');
    } catch (error) {
        console.error('Error replacing device:', error);
        showToast(error.message, 'error');
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
        
        showToast('Device removed successfully', 'success');
    } catch (error) {
        console.error('Error removing device:', error);
        showToast(error.message, 'error');
    }
}

// ===== Toast Notifications =====
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
        <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
        <div class="toast-body">
            <span class="toast-message">${escapeHtml(message)}</span>
        </div>
        <button class="toast-close" onclick="dismissToast(this.parentElement)" aria-label="Dismiss notification">×</button>
    `;

    container.appendChild(toast);

    // Auto-dismiss after 4 seconds
    const timeout = setTimeout(() => {
        dismissToast(toast);
    }, 4000);

    // Store timeout so manual close can clear it
    toast._dismissTimeout = timeout;
}

function dismissToast(toast) {
    if (!toast || toast._dismissed) return;
    toast._dismissed = true;
    if (toast._dismissTimeout) {
        clearTimeout(toast._dismissTimeout);
    }
    toast.classList.add('toast-dismissing');
    toast.addEventListener('animationend', () => {
        toast.remove();
    }, { once: true });
    // Fallback removal
    setTimeout(() => { toast.remove(); }, 400);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// Backwards compatibility alias
function showError(message) {
    // Detect success messages by leading emoji
    if (message && message.startsWith('✅')) {
        showToast(message.replace('✅ ', '').replace('✅', ''), 'success');
    } else {
        showToast(message, 'error');
    }
}

// ===== Ripple Effect =====
function addRipple(event) {
    const element = event.currentTarget;
    if (!element.classList.contains('ripple-container')) return;

    const rect = element.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${event.clientX - rect.left}px`;
    ripple.style.top = `${event.clientY - rect.top}px`;
    element.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

// Attach ripple to dynamically created elements via delegation
document.addEventListener('click', (event) => {
    const target = event.target.closest('.ripple-container');
    if (target) {
        addRipple({ currentTarget: target, clientX: event.clientX, clientY: event.clientY });
    }
    // Close copy-day popover when clicking outside it
    if (copyDayPopoverDay !== null && !event.target.closest('.copy-day-wrapper')) {
        copyDayPopoverDay = null;
        renderSchedule();
    }
});

// ===== Export functions to global scope =====
window.setGlobalMode = setGlobalMode;
window.setZoneOverride = setZoneOverride;
window.adjustTemperature = adjustTemperature;
window.navigateToZoneDetail = navigateToZoneDetail;
window.navigateBack = navigateBack;
window.openScheduleModal = openScheduleModal;
window.closeScheduleModal = closeScheduleModal;
window.addTimeBlock = addTimeBlock;
window.openEditTimeBlock = openEditTimeBlock;
window.closeAllForms = closeAllForms;
window.selectMode = selectMode;
window.submitAddTimeBlock = submitAddTimeBlock;
window.submitEditTimeBlock = submitEditTimeBlock;
window.deleteTimeBlock = deleteTimeBlock;
window.copyDay = copyDay;
window.closeCopyDayPopover = closeCopyDayPopover;
window.selectCopyDayGroup = selectCopyDayGroup;
window.confirmCopyDay = confirmCopyDay;
window.saveSchedule = saveSchedule;
window.formatSerialInput = formatSerialInput;
window.detectDeviceModel = detectDeviceModel;
window.addDevice = addDevice;
window.replaceDevice = replaceDevice;
window.removeDevice = removeDevice;
window.dismissToast = dismissToast;
window.openInlineAddDevice = openInlineAddDevice;
window.closeInlineAddDevice = closeInlineAddDevice;
window.detectInlineDeviceModel = detectInlineDeviceModel;
window.addDeviceToZone = addDeviceToZone;
window.openAddZoneModal = openAddZoneModal;
window.closeAddZoneModal = closeAddZoneModal;
window.addZone = addZone;
