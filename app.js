//

// --- MAP CONFIGURATION ---
const campusMap = {
    beacons: {
        "ESP32_A": "entrance",
        "ESP32_B": "hallway_main",
        "ESP32_C": "library",
        "ESP32_D": "cafeteria"
    },
    coordinates: {
        "entrance":     { x: 0,  y: 0 },
        "hallway_main": { x: 0,  y: 10 },
        "library":      { x: 10, y: 10 }, 
        "cafeteria":    { x: -10, y: 10 }
    },
    names: {
        "entrance": "Main Entrance",
        "hallway_main": "Main Hallway",
        "library": "Library",
        "cafeteria": "Cafeteria"
    }
};

// --- GLOBAL STATE ---
const TIMEOUT_MS = 3000; 
let visibleBeacons = {}; 
let targetLocation = null;
let userPosition = { x: 0, y: 0 };
let targetBearing = 0; 
let scanActive = false;
let animationLoop;

// --- UI ELEMENTS ---
const setupScreen = document.getElementById('setup-screen');
const navScreen = document.getElementById('nav-screen');
const destSelect = document.getElementById('destination-select');
const startNavBtn = document.getElementById('startNavBtn');
const stopBtn = document.getElementById('stopBtn');
const destLabel = document.getElementById('dest-label');
const guidanceLabel = document.getElementById('guidance-text');
const navArrow = document.getElementById('nav-arrow');
const confidenceFill = document.getElementById('confidence-fill');
const debugCoords = document.getElementById('debug-coords');
const beaconList = document.getElementById('beacon-list');

// Service Worker (Cache)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);

// 1. Setup Dropdown
Object.keys(campusMap.names).forEach(key => {
    const option = document.createElement('option');
    option.value = key;
    option.innerText = campusMap.names[key];
    destSelect.appendChild(option);
});

destSelect.addEventListener('change', () => {
    startNavBtn.disabled = false;
    targetLocation = destSelect.value;
});

// --- CORE MATH ---
function getWeight(rssi) {
    // Map RSSI to weight: -100(weak) to -40(strong)
    const safeRssi = Math.max(-100, Math.min(-40, rssi));
    return (safeRssi + 105) / 65; 
}

function calculateUserPosition() {
    const now = Date.now();
    let totalX = 0, totalY = 0, totalWeight = 0;
    let activeCount = 0;
    
    // Clear list
    beaconList.innerHTML = "";

    // Iterate over visible beacons
    for (let id in visibleBeacons) {
        const beacon = visibleBeacons[id];
        
        // Remove stale beacons
        if (now - beacon.lastSeen > TIMEOUT_MS) {
            delete visibleBeacons[id];
            continue;
        }

        // Add to UI List
        const li = document.createElement('li');
        li.innerHTML = `<span>${campusMap.names[id]}</span> <span class="rssi-val">${beacon.rssi} dBm</span>`;
        beaconList.appendChild(li);

        // Triangulation Math
        const weight = getWeight(beacon.rssi);
        const coords = campusMap.coordinates[id];
        
        if (coords) {
            totalX += coords.x * weight;
            totalY += coords.y * weight;
            totalWeight += weight;
            activeCount++;
        }
    }

    if (activeCount === 0) {
        beaconList.innerHTML = `<li style="text-align:center; color:#999;">Searching for beacons...</li>`;
    }

    // Update Position
    if (totalWeight > 0) {
        userPosition.x = totalX / totalWeight;
        userPosition.y = totalY / totalWeight;
        
        debugCoords.innerText = `${userPosition.x.toFixed(1)}, ${userPosition.y.toFixed(1)}`;
        
        // Update Confidence Bar
        let confidence = Math.min(100, activeCount * 33);
        confidenceFill.style.width = `${confidence}%`;
        
        calculateTargetVector();
    } else {
        guidanceLabel.innerText = "No signal detected";
        confidenceFill.style.width = "0%";
    }
}

function calculateTargetVector() {
    if (!targetLocation) return;
    const target = campusMap.coordinates[targetLocation];
    
    // Check Arrival
    const dist = Math.hypot(target.x - userPosition.x, target.y - userPosition.y);
    if (dist < 2.0) {
        guidanceLabel.innerText = "You have arrived!";
        navArrow.style.opacity = 0;
        return;
    }
    navArrow.style.opacity = 1;

    // Calculate Angle
    let dy = target.y - userPosition.y;
    let dx = target.x - userPosition.x;
    let thetaRad = Math.atan2(dy, dx);
    let thetaDeg = thetaRad * (180 / Math.PI);
    
    targetBearing = (90 - thetaDeg + 360) % 360; 
    
    guidanceLabel.innerText = `Walk to ${campusMap.names[targetLocation]}`;
}

// --- SENSORS & BLUETOOTH (POPUP FREE) ---

// 1. Compass Handling
function handleOrientation(event) {
    let currentHeading = event.webkitCompassHeading || Math.abs(event.alpha - 360);
    let rotation = targetBearing - currentHeading;
    navArrow.style.transform = `rotate(${rotation}deg)`;
}

// 2. Beacon Handler (Shared logic)
function handleBeaconSignal(deviceName, rssi) {
    // Only care if it's in our map
    if (campusMap.beacons[deviceName]) {
        const id = campusMap.beacons[deviceName];
        visibleBeacons[id] = {
            rssi: rssi,
            lastSeen: Date.now()
        };
    }
}

startNavBtn.addEventListener('click', async () => {
    // Check for "Experimental Web Platform Features" support
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) {
        alert("Your browser does not support Background Scanning. \n\nPlease enable 'Web Bluetooth' and 'Experimental Web Platform Features' in brave://flags");
        return;
    }

    // Compass Permission (iOS)
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch (e) {}
    }

    // Switch UI
    setupScreen.classList.add('hidden');
    navScreen.classList.remove('hidden');
    destLabel.innerText = campusMap.names[targetLocation];
    
    // Start Sensors
    window.addEventListener('deviceorientation', handleOrientation);
    animationLoop = setInterval(calculateUserPosition, 500);

    try {
        // --- THE FIX: USE requestLEScan INSTEAD OF requestDevice ---
        // This scan runs in the background and DOES NOT show a device picker list.
        const scan = await navigator.bluetooth.requestLEScan({
            filters: [{ namePrefix: "ESP32" }], // Only listen to our beacons
            keepRepeatedDevices: true,
            acceptAllAdvertisements: false
        });

        scanActive = true;
        
        // Listen to the global navigator event
        navigator.bluetooth.addEventListener('advertisementreceived', (event) => {
            handleBeaconSignal(event.device.name, event.rssi);
        });

    } catch (error) {
        console.error("Scan Error:", error);
        alert("Scan failed to start. Make sure Bluetooth is on and flags are enabled.");
        stopNavigation();
    }
});

function stopNavigation() {
    // Stop the scan if possible (API limitation: sometimes hard to stop without refresh)
    scanActive = false;
    if (animationLoop) clearInterval(animationLoop);
    window.removeEventListener('deviceorientation', handleOrientation);
    navScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    visibleBeacons = {}; 
}

stopBtn.addEventListener('click', stopNavigation);