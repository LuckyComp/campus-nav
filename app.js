//

// Map Configuration
// Headings: 0=North, 90=East, 180=South, 270=West
const campusMap = {
    beacons: {
        "ESP32_A": "entrance",
        "ESP32_B": "hallway_main",
        "ESP32_C": "library"
    },
    names: {
        "entrance": "Main Entrance",
        "hallway_main": "Main Hallway",
        "library": "Library"
    },
    graph: {
        "entrance": { "hallway_main": 0 },
        "hallway_main": { "entrance": 180, "library": 90 },
        "library": { "hallway_main": 270 }
    }
};

// Sklearn Classifier
class SklearnClassifier {
    constructor() { this.model = null; this.ready = false; }
    
    async load(url) {
        try {
            const response = await fetch(url);
            this.model = await response.json();
            this.ready = true;
            console.log("Model loaded");
            return true;
        } catch (e) { console.error(e); return false; }
    }

    preprocess(text) { 
        return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 1); 
    }

    predict(text) {
        if (!this.ready) return null;
        const { vocabulary, classes, priors, feature_probs } = this.model;
        let scores = [...priors];
        
        this.preprocess(text).forEach(token => {
            if (vocabulary.hasOwnProperty(token)) {
                const idx = vocabulary[token];
                for (let i = 0; i < classes.length; i++) scores[i] += feature_probs[i][idx];
            }
        });

        let max = -Infinity, best = -1;
        scores.forEach((s, i) => { if(s > max) { max = s; best = i; } });
        return classes[best];
    }
}

// Global State
const ARRIVAL_RSSI = -65; 
let classifier = new SklearnClassifier();

classifier.load('campus-nav-model.json').then(s => {
    if(s) document.getElementById('classifier-result').innerText = "Where would you like to go?";
});

let currentStep = null;     // Changed from "entrance" to null (Unknown)
let nextStep = null;        
let finalDestination = null;
let targetBearing = 0;      
let scanActive = false;

// UI Elements
const setupScreen = document.getElementById('setup-screen');
const navScreen = document.getElementById('nav-screen');
const navPrompt = document.getElementById('nav-prompt');
const classifyBtn = document.getElementById('classifyBtn');
const classifierResult = document.getElementById('classifier-result');
const startNavBtn = document.getElementById('startNavBtn');
const stopBtn = document.getElementById('stopBtn');
const destLabel = document.getElementById('dest-label');
const guidanceLabel = document.getElementById('guidance-text');
const navArrow = document.getElementById('nav-arrow');
const signalBar = document.getElementById('confidence-fill');
const debugVal = document.getElementById('debug-coords');

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);

// BFS Pathfinding
function findNextStep(start, end) {
    if (start === end) return null;
    let queue = [[start]];
    let visited = new Set([start]);
    
    while (queue.length > 0) {
        let path = queue.shift();
        let node = path[path.length - 1];
        if (node === end) return path[1]; 
        
        const neighbors = Object.keys(campusMap.graph[node] || {});
        for (let neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([...path, neighbor]);
            }
        }
    }
    return null;
}

// Event Listeners
classifyBtn.addEventListener('click', () => {
    const text = navPrompt.value;
    if (!text.trim()) return;

    if (!classifier.ready) {
        classifierResult.innerText = "Model loading...";
        return;
    }

    const result = classifier.predict(text);

    if (result) {
        finalDestination = result;
        classifierResult.innerText = `Going to ${campusMap.names[result]}`;
        classifierResult.style.color = "var(--success)";
        startNavBtn.disabled = false;
        
        // Auto-start is optional, maybe remove it if user wants to double check
        setTimeout(() => startNavBtn.click(), 800);
    } else {
        classifierResult.innerText = "Unsure. Try again.";
        classifierResult.style.color = "#ef4444";
    }
});

navPrompt.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') classifyBtn.click();
});

// Navigation Logic
function updateNavigationState(detectedBeaconName, rssi) {
    const detectedNode = campusMap.beacons[detectedBeaconName];
    if (!detectedNode) return;

    let strength = Math.max(0, Math.min(100, (rssi + 100) * 2));
    signalBar.style.width = `${strength}%`;

    // --- FIX: HANDLE FIRST LOCATION LOCK ---
    if (currentStep === null) {
        // We found our first beacon!
        currentStep = detectedNode;
        
        // Check if we are already there
        if (currentStep === finalDestination) {
            handleArrival();
            return;
        }

        // Calculate path from this NEW start point
        nextStep = findNextStep(currentStep, finalDestination);
        
        if (nextStep) {
            targetBearing = campusMap.graph[currentStep][nextStep];
            guidanceLabel.innerText = `Located at ${campusMap.names[currentStep]}. Head to ${campusMap.names[nextStep]}`;
            destLabel.innerText = campusMap.names[nextStep];
            navArrow.style.opacity = 1; // Show arrow
        } else {
            guidanceLabel.innerText = "Path unclear.";
        }
        return;
    }

    // Normal Navigation (Moving between nodes)
    if (detectedNode === nextStep && rssi > ARRIVAL_RSSI) {
        currentStep = nextStep;
        const newNext = findNextStep(currentStep, finalDestination);
        
        if (!newNext) {
            handleArrival();
        } else {
            nextStep = newNext;
            targetBearing = campusMap.graph[currentStep][nextStep];
            
            guidanceLabel.innerText = `At ${campusMap.names[currentStep]}. Head to ${campusMap.names[nextStep]}`;
            destLabel.innerText = campusMap.names[nextStep]; 
            
            navArrow.style.fill = "#10b981"; 
            setTimeout(() => navArrow.style.fill = "#3b82f6", 1000);
        }
    } else if (detectedNode === nextStep) {
        debugVal.innerText = `Approaching ${campusMap.names[nextStep]} (${rssi}dBm)`;
    }
}

function handleArrival() {
    guidanceLabel.innerText = "You have arrived.";
    navArrow.style.opacity = 0;
    debugVal.innerText = "Destination Reached";
}

// Sensors & Bluetooth
function handleOrientation(event) {
    if (navArrow.style.opacity === "0") return;

    let currentHeading = event.webkitCompassHeading || Math.abs(event.alpha - 360);
    let rotation = targetBearing - currentHeading;
    
    navArrow.style.transform = `rotate(${rotation}deg)`;
}

startNavBtn.addEventListener('click', async () => {
    if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) {
        alert("Enable 'Experimental Web Platform Features' in brave://flags");
        return;
    }
    
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        try { await DeviceOrientationEvent.requestPermission(); } catch (e) {}
    }
    
    // --- FIX: Reset State to Unknown ---
    currentStep = null; 
    nextStep = null;
    
    // Switch to Nav Screen immediately
    setupScreen.classList.add('hidden');
    navScreen.classList.remove('hidden');
    
    // Show "Scanning" state
    destLabel.innerText = "Locating...";
    guidanceLabel.innerText = "Walk to nearest beacon...";
    navArrow.style.opacity = 0; // Hide arrow until we know where we are
    
    window.addEventListener('deviceorientation', handleOrientation);

    try {
        const scan = await navigator.bluetooth.requestLEScan({
            filters: [{ namePrefix: "ESP32" }],
            keepRepeatedDevices: true,
            acceptAllAdvertisements: false
        });

        scanActive = true;
        navigator.bluetooth.addEventListener('advertisementreceived', (event) => {
            updateNavigationState(event.device.name, event.rssi);
        });

    } catch (error) {
        console.error("Scan Error:", error);
        alert("Scan Failed: " + error.message);
        stopNavigation();
    }
});

function stopNavigation() {
    scanActive = false;
    window.removeEventListener('deviceorientation', handleOrientation);
    navScreen.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    
    navPrompt.value = ""; 
    startNavBtn.disabled = true;
    classifierResult.innerText = "";
    navArrow.style.opacity = 1;
    navArrow.style.fill = "#3b82f6";
}

stopBtn.addEventListener('click', stopNavigation);