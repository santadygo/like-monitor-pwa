const CACHE = 'like-monitor-023e14b75769';
const LEGACY_PREFIX = 'like-monitor-';
const SHELL = ["./","./index.html","./assets/AnalysisPage-CmaRkjRD.js","./assets/OverviewPage-Be6d8Ttp.js","./assets/ReportsPage-D5ve-jwY.js","./assets/SettingsPage-DxPCw8X6.js","./assets/SignalsPage-gB30Oitf.js","./assets/index-nOvN3EMr.js","./assets/metrics-5f5c-Swf.js","./assets/style-DmKniqfV.css","./runtime-config.js","./static-api.js","./manifest.webmanifest","./icon.svg","./icon-192.png","./icon-512.png"];
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const keys = await caches.keys();
  const replaced = keys.some(key => key !== CACHE && key.startsWith(LEGACY_PREFIX));
  await Promise.all(keys.filter(key => key !== CACHE && key.startsWith(LEGACY_PREFIX)).map(key => caches.delete(key)));
  await self.clients.claim();
  if (replaced) {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach(client => client.postMessage({ type: 'APP_UPDATED' }));
  }
})()));
async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  const key = url.pathname.includes('/data/') ? url.origin + url.pathname : request;
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) cache.put(key, response.clone()).catch(() => {});
    return response;
  } catch (error) {
    const hit = await cache.match(key) || (fallback ? await cache.match(fallback) : null);
    return hit || new Response('离线', { status: 503 });
  }
}
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') return event.respondWith(networkFirst(request, './index.html'));
  if (url.pathname.includes('/data/') || url.pathname.endsWith('/runtime-config.js') || url.pathname.endsWith('/static-api.js')) {
    return event.respondWith(networkFirst(request));
  }
  event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone())).catch(() => {});
    return response;
  })));
});
