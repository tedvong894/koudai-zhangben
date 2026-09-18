// 口袋账本 Service Worker：缓存 App 外壳，支持离线打开 / 安装到本地
const CACHE = 'xyjz-v44';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './store.js',
  './seed.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// 缓存优先（外壳立即打开），同时后台更新
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase 接口 / 跨域实时请求不缓存，直接走网络
  if (url.hostname.includes('supabase') || url.pathname.startsWith('/rest') || url.pathname.startsWith('/realtime') || url.pathname.startsWith('/auth')) {
    return;
  }
  e.respondWith(
    caches.match(req).then(cached => {
      const net = fetch(req).then(res => {
        if (res && res.status === 200 && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
