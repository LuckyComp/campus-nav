const CACHE_NAME = 'esp32-nav-v3'; // Incremented version
const ASSETS = [
    './',
    './index.html',
    './style.css',     // <--- ADDED THIS LINE
    './app.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request)
            .catch(() => caches.match(e.request))
    );
});