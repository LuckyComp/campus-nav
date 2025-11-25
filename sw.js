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

/*
self.addEventListener('fetch', (e) => {
    e.respondWith(
        caches.match(e.request).then((response) => response || fetch(e.request))
    );
});
*/

self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .catch(() => caches.match(e.request))
    );
});