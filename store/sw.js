// Service Worker: يخزّن واجهة الموقع فقط. بيانات التطبيقات تُجلب دائماً من الـ API (ولها نسخة محلية في localStorage).
const V = 'abdosit-static-v2';
const SHELL = ['./', 'css/style.css', 'js/app.js', 'config.js', 'icons/icon.svg', 'manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // لا نتدخل في طلبات الـ API والصور الخارجية
  // شبكة أولاً ثم المخزّن، حتى تظهر تعديلاتك (config.js وغيره) فور نشرها
  e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(V).then((c) => c.put(req, cp)); } return r; }).catch(() => caches.match(req)));
});
