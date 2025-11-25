// --- CONFIGURATION: PREDEFINED MAP ---
const campusMap = {
    // Map physical ESP32 Device Names to logical Location IDs
    beacons: {
        "ESP32_A": "entrance",
        "ESP32_B": "hallway_main",
        "ESP32_C": "library",
        "ESP32_D": "cafeteria"
    },
    // Define the graph: Connections between locations
    graph: {
        "entrance": ["hallway_main"],
        "hallway_main": ["entrance", "library", "cafeteria"],
        "library": ["hallway_main"],
        "cafeteria": ["hallway_main"]
    },
    // Human readable names for UI
    names: {
        "entrance": "Main Entrance",
        "hallway_main": "Main Hallway",
        "library": "Library",
        "cafeteria": "Cafeteria"
    }
};

// --- APP LOGIC ---

// PWA Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
}

// UI Elements
const setupScreen = document.getElementById('setup-screen');
const navScreen = document.getElementById('nav-screen');
const destSelect = document.getElementById('destination-select');
const startNavBtn = document.getElementById('startNavBtn');
const stopBtn = document.getElementById('stopBtn');
const statusLabel = document.getElementById('status');
const currentLocLabel = document.getElementById('current-loc');
const guidanceLabel = document.getElementById('guidance-text');
const debugBeacon = document.getElementById('debug-beacon');
const debugRssi = document.getElementById('debug-rssi');

let targetLocation = null;
let abortController;

// 1. Populate Dropdown
Object.keys(campusMap.names).forEach(key => {
    const option = document.createElement('option');
    option.value = key;
    option.innerText = campusMap.names[key];
    destSelect.appendChild(option);
});

// Enable button only when destination is picked
destSelect.addEventListener('change', () => {
    startNavBtn.disabled = false;
    targetLocation = destSelect.value;
});

// 2. Navigation Algorithm (BFS for shortest path)
function getNextStep(current, target) {
    if (current === target) return "You have arrived!";
    
    let queue = [[current]];
    let visited = new Set();
    visited.add(current);
    
    while (queue.length > 0) {
        let path = queue.shift();
        let node = path[path.length - 1];
        
        if (node === target) {
            // The next step is the second node in the path
            const nextNode = path[1];
            return `Go towards ${campusMap.names[nextNode]}`;
        }
        
        const neighbors = campusMap.graph[node] || [];
        for (let neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                let newPath = [...path, neighbor];
                queue.push(newPath);
            }
        }
    }
    return "Path unclear.";
}

// 3. Bluetooth Scanning Logic
startNavBtn.addEventListener('click', async () => {
    if (!navigator.bluetooth) {
        alert("Bluetooth not supported.");
        return;
    }

    setupScreen.classList.add('hidden');
    navScreen.classList.remove('hidden');
    statusLabel.innerText = "Connecting to Beacons...";

    try {
        const device = await navigator.bluetooth.requestDevice({
            // We accept all devices so we can filter by name against our map
            acceptAllDevices: true,
            optionalServices: [] 
        });

        abortController = new AbortController();
        
        // Watch for advertisements
        device.addEventListener('advertisementreceived', (event) => {
            const rssi = event.rssi;
            const deviceName = event.device.name; // or event.name depending on browser version

            debugBeacon.innerText = deviceName || "Unknown";
            debugRssi.innerText = rssi;

            // -- CORE LOGIC: MAP MATCHING --
            if (deviceName && campusMap.beacons[deviceName]) {
                const detectedLocation = campusMap.beacons[deviceName];
                
                // Only trust strong signals (e.g., > -85) to avoid jumping around
                if (rssi > -85) {
                    currentLocLabel.innerText = campusMap.names[detectedLocation];
                    const instruction = getNextStep(detectedLocation, targetLocation);
                    guidanceLabel.innerText = instruction;
                }
            }
        });

        await device.watchAdvertisements({ signal: abortController.signal });
        statusLabel.innerText = "Navigating...";

    } catch (error) {
        console.error(error);
        stopNavigation(); // Reset on error
    }
});

function stopNavigation() {
    if (abortController) abortController.abort();
    navScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    guidanceLabel.innerText = "Waiting for signal...";
}

stopBtn.addEventListener('click', stopNavigation);