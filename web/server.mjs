import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { testnetRoute } from './testnet-relay.mjs';
import { defiRoute } from './defi-relay.mjs';
import { nameRoute } from './name-relay.mjs';
import { rheaRoute } from './rhea-relay.mjs';
import { zcashRoute } from './zcash-relay.mjs';
import { securityHeaders } from './security-policy.mjs';
import { carrierConfig } from './public/carrier-protocol.js';
const carriers = carrierConfig({version:1,carriers:JSON.parse(process.env.LENZ_CARRIERS ?? '[]')});
const root = resolve('public');
const types = { '.mp4': 'video/mp4', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.zkey': 'application/octet-stream' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    for (const [name, value] of Object.entries(securityHeaders(pathname, carriers))) res.setHeader(name, value);
    // Keep the local sponsor and browser identity on the documented loopback origin.
    if (req.headers.host !== '127.0.0.1:4173') { res.writeHead(403); res.end('Use http://127.0.0.1:4173'); return; }
    if(pathname==='/carrier-config.json' && req.method==='GET') { res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({version:1,carriers}));return; }
    if (await nameRoute(req, res)) return;
    if (await zcashRoute(req, res)) return;
    if (await rheaRoute(req, res)) return;
    if (await defiRoute(req, res)) return;
    if (await testnetRoute(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('missing');
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Proof of U web demo: http://127.0.0.1:4173'));
