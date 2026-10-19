// Service Worker: الصدفة تُخزَّن مؤقتاً، بيانات الـ API شبكة-أولاً مع بديل مخزّن
const V = 'abdosit-v1';
const SHELL = ['/', '/css/style.css', '/js/app.js', '/icons/icon.svg', '/manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // لا نخزّن التنزيلات ولا خدمة الرفع
  if (url.pathname.startsWith('/upload/') || url.pathname.startsWith('/f/')) return;
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).then((r) => { const cp = r.clone(); if (r.ok) caches.open(V).then((c) => c.put(req, cp)); return r; })
      .catch(() => caches.match(req).then((m) => m || new Response('{"error":"offline"}', { status: 503, headers: { 'content-type': 'application/json' } }))));
    return;
  }
  e.respondWith(caches.match(req).then((m) => {
    const net = fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); } return r; }).catch(() => m);
    return m || net;
  }));
});
