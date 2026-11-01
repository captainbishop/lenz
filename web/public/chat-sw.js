const CACHE = 'proof-u-chat-v27-pending-confirmation';
const PATHS = ['/app-theme.js', '/app-theme.css', '/zcash-lab.html', '/zcash-lab.css', '/zcash-lab.js', '/near-payment-status.js', '/near-payment-service.js', '/near-chat.js', '/wallet-lab.html', '/wallet-feedback.js', '/swap-tools.html', '/swap-tools.js', '/near-signer.js', '/near-deposit.js', '/rhea-wallet.js', '/rhea-protocol.js', '/rhea-config.json', '/near-wallet.js', '/near-wallet.css', '/near-protocol.js', '/near-config.json', '/money.html', '/money.css', '/money.js', '/profile-panels.js', '/receive-packet.js', '/save-offline.js', '/chat.html', '/chat.css', '/chat-layout.css', '/chat.js', '/chat-store.js', '/contact-card.js', '/contact-ui.js', '/profile-display.js', '/profile-ui.js', '/qr-vendor/qrcode-generator.js', '/qr-vendor/jsqr.js', '/peer-crypto.js', '/peer-exchange.js', '/exchange-reservations.js', '/trade-model.js', '/trade-service.js', '/trade-ui.js', '/peer-scenario.js', '/brand/mark.svg', '/brand/icon-32.png'];
// Install the whole new app before taking over. A failed update leaves the old
// worker/cache usable offline. IndexedDB identity and message data are untouched.
self.addEventListener('install', event => event.waitUntil((async () => {
  await (await caches.open(CACHE)).addAll(PATHS.map(path => new Request(path, { cache: 'reload' })));
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  for (const name of await caches.keys()) if (name.startsWith('proof-u-chat-') && name !== CACHE) await caches.delete(name);
})()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'prepare') return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      await cache.addAll(PATHS.map(path => new Request(path, { cache: 'reload' })));
      event.ports[0]?.postMessage({ ok: true, files: PATHS.length });
    } catch (error) { event.ports[0]?.postMessage({ ok: false, error: error.message }); }
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !PATHS.includes(url.pathname)) return;
  event.respondWith((async () => (await (await caches.open(CACHE)).match(event.request, { ignoreSearch: true })) ?? fetch(event.request))());
});
