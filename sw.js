/* Geräte Laufzettel – offline app shell (scan + fill) */
const CACHE = 'geraete-laufzettel-v92';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/sn.js',
  './js/scan.js',
  './js/catalog.js',
  './js/fill.js',
  './js/fields.js',
  './js/field-fill.js',
  './js/grid.js',
  './data/template-200.432.json',
  './data/template-200.433.json',
  './data/template-200.412.json',
  './data/template-200.413.json',
  './data/template-200.414.json',
  './data/template-200.419.json',
  './data/template-200.420.json',
  './data/template-200.483.json',
  './data/template-200.490.json',
  './data/template-200.492.json',
  './data/template-200.499.json',
  './data/template-200.481.json',
  './data/template-200.001.json',
  './data/template-200.434.json',
  './data/template-200.436.json',
  './data/template-200.447.json',
  './data/template-200.455.json',
  './data/template-200.461.json',
  './data/template-200.463.json',
  './data/template-200.464.json',
  './data/template-200.465.json',
  './data/template-200.467.json',
  './data/template-200.468.json',
  './data/template-200.469.json',
  './js/settings.js',
  './js/parse.js',
  './js/pdf.js',
  './js/split.js',
  './js/manipulator.js',
  './js/xps2pdf.js',
  './manifest.webmanifest',
  './vendor/pdf-lib.min.js',
  './vendor/fontkit.umd.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/zxing-library.min.js',
  './vendor/jszip.min.js',
  './vendor/FileSaver.min.js',
  './fonts/Calibri.subset.ttf',
  './fonts/Calibri-Bold.subset.ttf',
  './fonts/Aeonis.subset.ttf',
  './fonts/Constantia-Bold.subset.ttf',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/icon-180-v18.png',
  './icons/icon-192-v18.png',
  './icons/icon-512-v18.png',
  './icons/apple-touch-icon.png',
  './icons/bg-home-180.png',
  './icons/bg-home-192.png',
  './icons/bg-home-512.png',
  './icons/send_btn.png',
  './icons/send_btn_hover.png',
  './icons/settings_btn.png',
  './icons/list_btn.png',
  './icons/settings_btn_hover.png',
  './icons/beak-logo.png',
  './apple-touch-icon.png',
  './icons/icon-512-v26.png',
  './icons/icon-192-v26.png',
  './icons/icon-180-v26.png',
  './favicon.png',
  './apple-touch-icon-precomposed.png',
  './apple-touch-icon-167.png',
  './apple-touch-icon-152.png',
  './apple-touch-icon-120.png',
  './apple-touch-icon-v18.png',
  './samples/index.json',
  './samples/datamatrix-demo.png',
];

function isNavigationRequest(request) {
  if (request.mode === 'navigate') return true;
  if (request.destination === 'document') return true;
  // Avoid treating CSS/font/script as HTML just because Accept lists text/html.
  if (request.destination && request.destination !== '') return false;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}


function isIconOrTouchAsset(url) {
  const p = url.pathname || '';
  return (
    /apple-touch-icon/i.test(p) ||
    /\/favicon\.png$/i.test(p) ||
    /\/icons\/icon-\d+/i.test(p) ||
    /\/icons\/bg-home-/i.test(p) ||
    /\/icons\/apple-touch/i.test(p)
  );
}

function isCodeAsset(url) {
  return /\.(m?js|css|json|webmanifest)$/i.test(url.pathname || '');
}

function isServiceWorkerScript(url) {
  return /\/sw\.js$/i.test(url.pathname);
}

/** Cache match that ignores ?v= cache-bust query strings. */
function matchCache(request) {
  return caches.match(request, { ignoreSearch: true });
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Add individually so one 404 does not abort the whole install.
      await Promise.all(
        ASSETS.map(async (url) => {
          try {
            const res = await fetch(url, { cache: 'reload' });
            if (!res.ok) {
              console.warn('[SW] skip asset (HTTP ' + res.status + '):', url);
              return;
            }
            await cache.put(url, res);
          } catch (err) {
            console.warn('[SW] skip missing asset:', url, err);
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Never intercept Home Screen / PWA icons — iOS Safari must hit the network/CDN.
  if (isIconOrTouchAsset(url)) return;

  // Navigation + SW script: network-first; HTML shell fallback only for navigations.
  if (isNavigationRequest(req) || isServiceWorkerScript(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && isNavigationRequest(req)) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => {
              cache.put('./index.html', clone);
              cache.put('./', clone.clone());
            });
          }
          return res;
        })
        .catch(async () => {
          if (isNavigationRequest(req)) {
            const shell = (await matchCache('./index.html')) || (await matchCache('./'));
            if (shell) return shell;
          }
          return new Response('', { status: 503, statusText: 'Offline' });
        })
    );
    return;
  }

  // Code/data (JS, MJS, CSS, JSON, manifest): network-first (revalidated), cache fallback offline.
  // Prevents new index.html + stale cached JS after a deploy (v1.34 fix).
  if (isCodeAsset(url)) {
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(async () => (await matchCache(req)) || new Response('', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  // Other same-origin assets (fonts, images): cache-first (ignoreSearch for ?v=), then network.
  // Never fall back to index.html for CSS/JS/fonts/images.
  event.respondWith(
    matchCache(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          new Response('', {
            status: 503,
            statusText: 'Offline',
            headers: { 'Content-Type': 'text/plain' },
          })
        );
    })
  );
});
