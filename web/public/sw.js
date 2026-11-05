// Preview recording revision: f163cd3a4cba36be88b3dadd938a578c5aa7d9e42a67a5aa6909808dc8ff21da
// Market shell revision: degen-loading-20261105
importScripts('/media-range.js');
const CACHE = 'proof-u-web-demo-v1';
const PATHS = ['/workspace-layout.css', './previews/timelines.json', './media-range.js', './vendor/ffjavascript-worker.js', './', './index.html', './home.css', './home.js', './home-interactive.js', './home-videos.js', './home-defi.js', './home-defi.css', './routes.html', './routes.css', './routes.js', './route-draft-ui.js', './route-draft-form.js', './defi-route-drafts.js', './defi-route-quote.js', './defi-route-plan.js', './chat-store.js', './peer-crypto.js', './profile-display.js', './markets.html', './markets.css', './markets.js', './oracle-feeds.js', './oracle-prices-ui.js', './oracle-prices.css', './market-live.js', './pool-price.js', './pool-price-ui.js', './theme-icon.js', './perp-terminal.js', './market-tape.js', './terminal.css', './defi-surfaces.css', './defi-surfaces.js', './evm-markets.js', './market-snapshot.js', './market-quote.js', './market-quote-ui.js', './defi-catalog.js', './app-theme.js', './previews/defi-light.mp4', './previews/defi-light.webp', './previews/defi-dark.mp4', './previews/defi-dark.webp', './previews/chat-light.mp4', './previews/chat-light.webp', './previews/chat-dark.mp4', './previews/chat-dark.webp', './previews/wallet-light.mp4', './previews/wallet-light.webp', './previews/wallet-dark.mp4', './previews/wallet-dark.webp', './previews/profile-light.mp4', './previews/profile-light.webp', './previews/profile-dark.mp4', './previews/profile-dark.webp', './payment-demo.html', './style.css', './app.js', './wallet.js', './protocol.js', './prover.js', './proof-worker.js', './capsule.js', './config.js', './vendor/ffjavascript.js', './vendor/snarkjs.js', './vendor/poseidon.js', './vendor/poseidon_constants_opt.js', './assets/step.wasm', './assets/step.zkey', './tests.html', './browser-tests.js', './manifest.webmanifest', './brand/mark.svg', './brand/mark-reverse.svg', './brand/mark-black.svg', './brand/mark-white.svg', './brand/icon.svg', './brand/icon-32.png', './brand/icon-180.png', './brand/icon-192.png', './brand/icon-512.png', './brand/icon-1024.png', './brand/logo.svg', './brand/logo-reverse.svg', './brand/logo.png', './brand/brand-card.svg', './brand/brand-card.png', './brand/index.html', './brand/preview.css'];
// Refresh only the changed brand shell atomically. Keep the already cached proof
// assets and wallet storage; the explicit prepare action still loads the full demo.
const BRAND_SHELL = ['./previews/timelines.json', './media-range.js', './', './index.html', './home.css', './home.js', './home-interactive.js', './home-videos.js', './home-defi.js', './home-defi.css', './routes.html', './routes.css', './routes.js', './route-draft-ui.js', './route-draft-form.js', './defi-route-drafts.js', './defi-route-quote.js', './defi-route-plan.js', './chat-store.js', './peer-crypto.js', './profile-display.js', './markets.html', './markets.css', './markets.js', './oracle-feeds.js', './oracle-prices-ui.js', './oracle-prices.css', './market-live.js', './pool-price.js', './pool-price-ui.js', './theme-icon.js', './perp-terminal.js', './market-tape.js', './terminal.css', './defi-surfaces.css', './defi-surfaces.js', './evm-markets.js', './market-snapshot.js', './market-quote.js', './market-quote-ui.js', './defi-catalog.js', './app-theme.js', './previews/defi-light.mp4', './previews/defi-light.webp', './previews/defi-dark.mp4', './previews/defi-dark.webp', './previews/chat-light.mp4', './previews/chat-light.webp', './previews/chat-dark.mp4', './previews/chat-dark.webp', './previews/wallet-light.mp4', './previews/wallet-light.webp', './previews/wallet-dark.mp4', './previews/wallet-dark.webp', './previews/profile-light.mp4', './previews/profile-light.webp', './previews/profile-dark.mp4', './previews/profile-dark.webp', './payment-demo.html', './manifest.webmanifest', './brand/mark.svg', './brand/mark-reverse.svg', './brand/mark-black.svg', './brand/mark-white.svg', './brand/icon.svg', './brand/icon-32.png', './brand/icon-180.png', './brand/icon-192.png', './brand/icon-512.png', './brand/icon-1024.png', './brand/logo.svg', './brand/logo-reverse.svg', './brand/logo.png', './brand/brand-card.svg', './brand/brand-card.png', './brand/index.html', './brand/preview.css'];
PATHS.push('./market-picker.js','./market-picker.css','./form-controls.js','./form-controls.css');
const RECOVERY_PATHS=['./recovery.html','./recovery.css','./recovery-ui.js','./recovery-service.js','./identity-recovery.js','./legacy-recovery.js','./evm-vendor/identity-recovery.js','./save-offline.js'];
PATHS.push(...RECOVERY_PATHS);BRAND_SHELL.push(...RECOVERY_PATHS);
PATHS.push('./chat-access.js','./chat-restore.js','./contact-recovery.js');BRAND_SHELL.push('./chat-access.js','./chat-restore.js','./contact-recovery.js');
BRAND_SHELL.push('./workspace-layout.css','./market-picker.js','./market-picker.css','./form-controls.js','./form-controls.css');
PATHS.push('./account.html','./account.css','./account-ui.js','./account-keys.js','./account-backup.js','./account-sync.js');BRAND_SHELL.push('./account.html','./account.css','./account-ui.js','./account-keys.js','./account-backup.js','./account-sync.js');
PATHS.push('./degen-model.js','./degen-ui.js','./degen-chart.js','./chart-indicators.js','./market-tape-cache.js','./degen-trades.js','./degen-http.js','./chart-vendor/lightweight-charts.js','./degen.css');BRAND_SHELL.push('./degen-model.js','./degen-ui.js','./degen-chart.js','./chart-indicators.js','./market-tape-cache.js','./degen-trades.js','./degen-http.js','./chart-vendor/lightweight-charts.js','./degen.css');
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
    const cached = await (await caches.open(CACHE)).match(event.request, { ignoreSearch: event.request.mode === 'navigate' && new URL(event.request.url).pathname === '/markets.html' });
    return cached ? cachedMediaResponse(event.request, cached) : fetch(event.request);
  })());
});
