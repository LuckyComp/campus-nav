// 1. PWA Service Worker Registration
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service Worker registered', reg))
        .catch(err => console.warn('Service Worker failed (expected in preview):', err));
}

const scanBtn = document.getElementById('scanBtn');
const stopBtn = document.getElementById('stopBtn');
const resultUi = document.getElementById('result-ui');
const scanUi = document.getElementById('scan-ui');
const rssiMeter = document.getElementById('rssi-meter');
const nameLabel = document.getElementById('device-name');
const statusLabel = document.getElementById('status');
const simWarning = document.getElementById('sim-warning');

let currentDevice;
let abortController;
let simInterval;

function updateRssiDisplay(rssi) {
    rssiMeter.innerText = rssi;
    if (rssi > -50) rssiMeter.style.color = "#28a745"; // Green
    else if (rssi > -70) rssiMeter.style.color = "#ffc107"; // Yellow
    else rssiMeter.style.color = "#dc3545"; // Red
}

scanBtn.addEventListener('click', async () => {
    // Check if browser even supports Bluetooth
    if (!navigator.bluetooth) {
        statusLabel.innerText = "Bluetooth API not supported in this browser.";
        startSimulation(); // Fallback for testing
        return;
    }

    try {
        statusLabel.innerText = "Requesting Bluetooth Access...";
        
        const device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [] 
        });

        currentDevice = device;
        abortController = new AbortController();

        scanUi.classList.add('hidden');
        resultUi.classList.remove('hidden');
        nameLabel.innerText = device.name || "Unknown Device";
        statusLabel.innerText = "Connecting to stream...";

        device.addEventListener('advertisementreceived', (event) => {
            updateRssiDisplay(event.rssi);
        });

        await device.watchAdvertisements({ signal: abortController.signal });
        statusLabel.innerText = "Tracking Signal...";

    } catch (error) {
        console.log("Full Error:", error);
        
        // Handle the specific "SecurityError" that happens in iframes/previews
        if (error.name === 'SecurityError' || error.name === 'NotFoundError') {
            statusLabel.innerText = "Bluetooth Blocked by Browser Preview.";
            // Launch simulation so user can see how UI works
            startSimulation();
        } else {
            statusLabel.innerText = "Scan failed: " + error.message;
        }
    }
});

stopBtn.addEventListener('click', () => {
    if (abortController) abortController.abort();
    stopSimulation();
    scanUi.classList.remove('hidden');
    resultUi.classList.add('hidden');
    rssiMeter.innerText = "--";
    statusLabel.innerText = "Ready to scan";
});