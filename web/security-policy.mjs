// Applies to the local web server. Production hosting must send equivalent headers.
import { carrierOrigin } from './public/carrier-protocol.js';
import { relayOrigin } from './public/nostr-protocol.js';
export function securityHeaders(pathname, carriers = [], relays = []) {
  carriers.forEach(carrierOrigin);
  relays.forEach(relayOrigin);
  const connectedLab = pathname === '/wallet-lab.html';
  return {
    'Content-Security-Policy': [
      "default-src 'none'", "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
      "font-src 'self'", "media-src 'self'", "manifest-src 'self'", "worker-src 'self' blob:",
      "connect-src 'self'" + (connectedLab ? ' https://test.rpc.fastnear.com' : '') +
        (['/chat.html','/money.html'].includes(pathname) && carriers.length ? ' '+carriers.join(' ') : '') +
        (['/chat.html','/money.html'].includes(pathname) && relays.length ? ' '+relays.join(' ') : ''),
      "frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'",
      "base-uri 'none'", "form-action 'self'",
    ].join('; '),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}
