const CACHE_NAME = 'esp32-scanner-v2';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './manifest.json'
];

// Install Event: Cache all files
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

// Fetch Event: Serve from cache first, fall back to network
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});