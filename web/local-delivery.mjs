import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createHash, X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './security-policy.mjs';

const defaultRoot = fileURLToPath(new URL('./public/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4',
  '.zkey': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

async function freezePublic(root) {
  const resolved = path.resolve(root);
  if ((await lstat(resolved)).isSymbolicLink() || path.relative(resolved, await realpath(resolved)) !== '') {
    throw Error('The public directory must not be a link.');
  }
  const assets = new Map();
  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('The public directory contains a link.');
      if (entry.name.startsWith('.')) continue;
      const filename = path.join(directory, entry.name), route = prefix + '/' + entry.name;
      if (entry.isDirectory()) await walk(filename, route);
      else if (entry.isFile() && types[path.extname(entry.name)]) {
        const body = await readFile(filename);
        assets.set(route, { body, type: types[path.extname(entry.name)], sha256: createHash('sha256').update(body).digest('hex') });
      }
    }
  }
  await walk(resolved, '');
  if (!assets.has('/index.html')) throw Error('The selected public directory has no index.html.');
  return assets;
}

function inside(directory, filename) {
  const relative = path.relative(directory, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function readTLS({ certificateFile, privateKeyFile, publicRoot, hostname }) {
  if (!certificateFile || !privateKeyFile) throw Error('Supply a TLS certificate and private key for HTTPS delivery.');
  const root = await realpath(publicRoot), certificatePath = await realpath(certificateFile), keyPath = await realpath(privateKeyFile);
  if (inside(root, certificatePath) || inside(root, keyPath)) throw Error('TLS files must stay outside the public directory.');
  const [cert, key] = await Promise.all([readFile(certificatePath), readFile(keyPath)]);
  const leaf = new X509Certificate(cert), name = hostname.replace(/^\[|\]$/g, '');
  if (!(isIP(name) ? leaf.checkIP(name) : leaf.checkHost(name, { subject: 'never' }))) {
    throw Error('The TLS certificate does not cover the delivery hostname.');
  }
  const now = Date.now();
  if (now < Date.parse(leaf.validFrom) || now >= Date.parse(leaf.validTo)) throw Error('The TLS certificate is outside its validity dates.');
  const expected = leaf.publicKey.export({ type: 'spki', format: 'der' });
  const actual = createPublicKey(createPrivateKey(key)).export({ type: 'spki', format: 'der' });
  if (!expected.equals(actual)) throw Error('The TLS private key does not match the certificate.');
  createSecureContext({ cert, key });
  return { cert, key, minVersion: 'TLSv1.2' };
}

function requestPath(target) {
  if (typeof target !== 'string' || target.length > 4096 || !target.startsWith('/') || target.startsWith('//')) return null;
  let decoded;
  try { decoded = decodeURIComponent(target.split('?')[0]); } catch { return null; }
  if (/[\\\u0000-\u001f\u007f#]/.test(decoded) || decoded.split('/').some(part => part === '.' || part === '..')) return null;
  return decoded === '/' ? '/index.html' : decoded;
}

export async function createLocalDelivery({ publicRoot = defaultRoot, origin, bindAddress = '127.0.0.1', certificateFile, privateKeyFile } = {}) {
  if (typeof origin !== 'string' || !origin) throw Error('Choose the local delivery origin.');
  const selected = new URL(origin);
  if (!['http:', 'https:'].includes(selected.protocol)) throw Error('Use an HTTP or HTTPS origin.');
  if (selected.pathname !== '/' || selected.search || selected.hash || selected.username || selected.password) {
    throw Error('Use an origin without credentials, a path or query.');
  }
  if (!isIP(bindAddress)) throw Error('Choose a numeric local bind address.');
  if (selected.protocol === 'http:' && (!['localhost', '127.0.0.1', '[::1]'].includes(selected.hostname) || !['127.0.0.1', '::1'].includes(bindAddress))) {
    throw Error('HTTPS is required outside loopback.');
  }
  if (selected.protocol === 'http:' && (certificateFile || privateKeyFile)) throw Error('Use an HTTPS origin with TLS files.');
  const tls = selected.protocol === 'https:' ? await readTLS({ certificateFile, privateKeyFile, publicRoot, hostname: selected.hostname }) : null;
  const assets = await freezePublic(publicRoot);
  const manifest = Object.freeze([...assets].map(([route, asset]) => Object.freeze({ path: route, bytes: asset.body.length, sha256: asset.sha256 })));
  let currentOrigin = selected.origin;
  const handle = (req, res) => {
    const respond = (status, message, extra = {}) => {
      const body = Buffer.from(message);
      res.writeHead(status, { ...securityHeaders('/'), 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store', ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    const hostCount = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host').length;
    if (hostCount !== 1 || req.headers.host?.toLowerCase() !== new URL(currentOrigin).host) { respond(403, 'Use the local Lenz delivery address.'); return; }
    const route = requestPath(req.url);
    if (!route) { respond(400, 'Invalid app path.'); return; }
    if (route.startsWith('/api/') || route === '/api') {
      respond(503, JSON.stringify({ error: 'Local delivery serves app files only. Connected services are unavailable here.' }), { 'Content-Type': 'application/json' });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { respond(405, 'App files can only be read.', { Allow: 'GET, HEAD' }); return; }
    const asset = assets.get(route);
    if (!asset) { respond(404, 'App file unavailable.'); return; }
    res.writeHead(200, { ...securityHeaders('/'), 'Content-Type': asset.type, 'Content-Length': asset.body.length, 'Cache-Control': 'no-cache', ETag: '"' + asset.sha256 + '"' });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  };
  const server = tls ? https.createServer(tls, handle) : http.createServer(handle);
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 32;
  return {
    server, manifest,
    get origin() { return currentOrigin; },
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number(selected.port || (tls ? 443 : 80)), bindAddress, () => { server.off('error', reject); resolve(); });
      });
      const actual = new URL(selected);
      actual.port = String(server.address().port);
      currentOrigin = actual.origin;
      return currentOrigin;
    },
    async close() {
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const delivery = await createLocalDelivery({
    publicRoot: process.env.LENZ_DELIVERY_ROOT || defaultRoot,
    origin: process.env.LENZ_DELIVERY_ORIGIN,
    bindAddress: process.env.LENZ_DELIVERY_BIND || '127.0.0.1',
    certificateFile: process.env.LENZ_DELIVERY_CERT,
    privateKeyFile: process.env.LENZ_DELIVERY_KEY,
  });
  await delivery.listen();
  console.log(`Lenz local delivery: ${delivery.origin} (${delivery.manifest.length} public files)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void delivery.close().catch(() => { process.exitCode = 1; }); });
}
