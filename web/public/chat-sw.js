// wallet-transfer-20261104
const CACHE = 'proof-u-chat-v100-market-stream';
const PATHS = ['/workspace-layout.css', '/routes.html', '/routes.css', '/routes.js', '/route-draft-ui.js', '/route-draft-form.js', '/defi-route-drafts.js', '/defi-route-quote.js', '/defi-route-plan.js', '/markets.html', '/markets.css', '/markets.js', '/oracle-feeds.js', '/oracle-prices-ui.js', '/oracle-prices.css', '/market-live.js', '/pool-price.js', '/pool-price-ui.js', '/theme-icon.js', '/perp-terminal.js', '/market-tape.js', '/terminal.css', '/defi-surfaces.css', '/defi-surfaces.js', '/evm-markets.js', '/market-snapshot.js', '/market-quote-ui.js', '/market-quote.js', '/defi-catalog.js', '/defi-workspace.js', '/defi-wallet.js', '/defi-request.js', '/defi-delivery.js', '/defi-wallet-ui.js', '/wallet-visibility.js', '/nearby-ui.js', '/nearby-client.js', '/nearby-connection.js', '/nearby-protocol.js', '/nearby.css', '/nostr-client.js', '/nostr-protocol.js', '/nostr-socket.js', '/nostr-config.json', '/nostr-vendor/nostr.js', '/delivery-mode.js', '/brand/chat-pattern.svg', '/name-lab.html', '/name-lab.css', '/name-lab.js', '/name-results.js', '/carrier-ui.js', '/carrier-client.js', '/carrier-protocol.js', '/carrier-config.json', '/delivery-receipts.js', '/app-theme.js', '/app-theme.css', '/zcash-lab.html', '/zcash-lab.css', '/zcash-lab.js', '/near-payment-status.js', '/near-payment-service.js', '/near-chat.js', '/wallet-lab.html', '/wallet-feedback.js', '/swap-tools.html', '/swap-tools.js', '/near-signer.js', '/near-deposit.js', '/rhea-wallet.js', '/rhea-protocol.js', '/rhea-config.json', '/near-wallet.js', '/near-wallet.css', '/near-protocol.js', '/near-config.json', '/money.html', '/money.css', '/money.js', '/wallet-actions.js', '/wallet-tokens.js', '/wallet-portfolio.js', '/wallet-portfolio.css', '/token-watch.js', '/profile-panels.js', '/receive-packet.js', '/save-offline.js', '/chat.html', '/chat.css', '/chat-layout.css', '/chat.js', '/chat-store.js', '/contact-card.js', '/contact-ui.js', '/profile-display.js', '/profile-ui.js', '/qr-vendor/qrcode-generator.js', '/qr-vendor/jsqr.js', '/peer-crypto.js', '/peer-exchange.js', '/exchange-reservations.js', '/trade-model.js', '/trade-service.js', '/trade-ui.js', '/peer-scenario.js', '/brand/mark.svg', '/brand/icon-32.png'];
PATHS.push('/evm-wallet.js', '/evm-wallet-ui.js', '/evm-networks.js', '/evm-network-ui.js', '/evm-transfer.js', '/evm-transfer-store.js', '/evm-transfer-service.js', '/evm-transfer-ui.js', '/evm-vendor/address.js');
PATHS.push('/offline-budget.js', '/evm-vendor/offline-budget.js');
PATHS.push('/market-picker.js','/market-picker.css','/form-controls.js','/form-controls.css');
PATHS.push('/recovery.html','/recovery.css','/recovery-ui.js','/recovery-service.js','/identity-recovery.js','/legacy-recovery.js','/evm-vendor/identity-recovery.js');
PATHS.push('/chat-access.js','/chat-restore.js','/contact-recovery.js');
// Install the whole new app before taking over. A failed update leaves the old
// worker/cache usable offline. IndexedDB identity and message data are untouched.
PATHS.push('/account.html','/account.css','/account-ui.js','/account-keys.js','/account-backup.js','/account-sync.js');
PATHS.push('/degen-model.js','/degen-ui.js','/degen-chart.js','/chart-indicators.js','/market-tape-cache.js','/market-stream.js','/market-stream-data.js','/degen-trades.js','/degen-http.js','/chart-vendor/lightweight-charts.js','/degen.css');
PATHS.push('/ai-chat.css','/ai-chat-ui.js','/ai-conversation.js','/receive-assets.js');
PATHS.push('/receiving-instructions.js','/receiving-link-ui.js','/payment-recipient.js');
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
