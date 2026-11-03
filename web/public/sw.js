// Preview recording revision: db5eee9254db9678d8f27e15f225928a4016768942ea4c805c3a699b930a3d5c
// Market shell revision: public-quotes-controls-20261103
importScripts('/media-range.js');
const CACHE = 'proof-u-web-demo-v1';
const PATHS = ['./previews/timelines.json', './media-range.js', './vendor/ffjavascript-worker.js', './', './index.html', './home.css', './home.js', './home-interactive.js', './home-videos.js', './home-defi.js', './home-defi.css', './markets.html', './markets.css', './markets.js', './market-snapshot.js', './market-quote.js', './market-quote-ui.js', './defi-catalog.js', './app-theme.js', './previews/defi-light.mp4', './previews/defi-light.webp', './previews/defi-dark.mp4', './previews/defi-dark.webp', './previews/chat-light.mp4', './previews/chat-light.webp', './previews/chat-dark.mp4', './previews/chat-dark.webp', './previews/wallet-light.mp4', './previews/wallet-light.webp', './previews/wallet-dark.mp4', './previews/wallet-dark.webp', './previews/profile-light.mp4', './previews/profile-light.webp', './previews/profile-dark.mp4', './previews/profile-dark.webp', './payment-demo.html', './style.css', './app.js', './wallet.js', './protocol.js', './prover.js', './proof-worker.js', './capsule.js', './config.js', './vendor/ffjavascript.js', './vendor/snarkjs.js', './vendor/poseidon.js', './vendor/poseidon_constants_opt.js', './assets/step.wasm', './assets/step.zkey', './tests.html', './browser-tests.js', './manifest.webmanifest', './brand/mark.svg', './brand/mark-reverse.svg', './brand/mark-black.svg', './brand/mark-white.svg', './brand/icon.svg', './brand/icon-32.png', './brand/icon-180.png', './brand/icon-192.png', './brand/icon-512.png', './brand/icon-1024.png', './brand/logo.svg', './brand/logo-reverse.svg', './brand/logo.png', './brand/brand-card.svg', './brand/brand-card.png', './brand/index.html', './brand/preview.css'];
// Refresh only the changed brand shell atomically. Keep the already cached proof
// assets and wallet storage; the explicit prepare action still loads the full demo.
const BRAND_SHELL = ['./previews/timelines.json', './media-range.js', './', './index.html', './home.css', './home.js', './home-interactive.js', './home-videos.js', './home-defi.js', './home-defi.css', './markets.html', './markets.css', './markets.js', './market-snapshot.js', './market-quote.js', './market-quote-ui.js', './defi-catalog.js', './app-theme.js', './previews/defi-light.mp4', './previews/defi-light.webp', './previews/defi-dark.mp4', './previews/defi-dark.webp', './previews/chat-light.mp4', './previews/chat-light.webp', './previews/chat-dark.mp4', './previews/chat-dark.webp', './previews/wallet-light.mp4', './previews/wallet-light.webp', './previews/wallet-dark.mp4', './previews/wallet-dark.webp', './previews/profile-light.mp4', './previews/profile-light.webp', './previews/profile-dark.mp4', './previews/profile-dark.webp', './payment-demo.html', './manifest.webmanifest', './brand/mark.svg', './brand/mark-reverse.svg', './brand/mark-black.svg', './brand/mark-white.svg', './brand/icon.svg', './brand/icon-32.png', './brand/icon-180.png', './brand/icon-192.png', './brand/icon-512.png', './brand/icon-1024.png', './brand/logo.svg', './brand/logo-reverse.svg', './brand/logo.png', './brand/brand-card.svg', './brand/brand-card.png', './brand/index.html', './brand/preview.css'];
self.addEventListener('install', event => event.waitUntil((async () => {
  // Refresh cached document/worker policies while retaining already prepared proof assets.
  await (await caches.open(CACHE)).addAll([...BRAND_SHELL, './tests.html', './prover.js', './vendor/ffjavascript.js', './vendor/ffjavascript-worker.js'].map(path => new Request(path, { cache: 'reload' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('message', event => {
  if (event.data?.type === 'home-status') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(BRAND_SHELL.map(path => cache.match(path)));
      event.ports[0]?.postMessage({ complete: entries.every(Boolean) });
    })());
    return;
  }
  if (event.data?.type === 'status') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(PATHS.map(path => cache.match(path)));
      event.source?.postMessage({ type: 'cached', complete: entries.every(Boolean) });
    })());
    return;
  }
  if (event.data?.type !== 'prepare') return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      let done = 0;
      for (const path of PATHS) {
        const response = await fetch(path, { cache: 'reload' });
        if (!response.ok) throw new Error(`Could not save ${path}`);
        await cache.put(path, response);
        event.source?.postMessage({ type: 'progress', done: ++done, total: PATHS.length });
      }
      for (const path of PATHS) if (!(await cache.match(path))) throw new Error('An offline resource is missing');
      event.source?.postMessage({ type: 'ready' });
    } catch (error) { event.source?.postMessage({ type: 'error', message: error.message }); }
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await (await caches.open(CACHE)).match(event.request);
    return cached ? cachedMediaResponse(event.request, cached) : fetch(event.request);
  })());
});
