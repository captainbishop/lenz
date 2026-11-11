import { mediaRange } from './public/media-range.js';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { testnetRoute } from './testnet-relay.mjs';
import { defiRoute } from './defi-relay.mjs';
import { marketRoute } from './market-relay.mjs';
import { degenRoute } from './degen-relay.mjs';
import { tokenRoute } from './token-relay.mjs';
import { nameRoute } from './name-relay.mjs';
import { rheaRoute } from './rhea-relay.mjs';
import { zcashRoute } from './zcash-relay.mjs';
import { securityHeaders } from './security-policy.mjs';
import { carrierConfig } from './public/carrier-protocol.js';
import { nostrConfig } from './public/nostr-protocol.js';
import {AccountStore} from './account-store.mjs';
import {createAccountRoute} from './account-relay.mjs';
import {createAIRoute} from './ai-relay.mjs';
import {AIUsageStore,aiConfigured,runAIWorker} from './ai-service.mjs';
import {receiveRoute} from './receive-relay.mjs';
import {createPrivateSpendRoute} from './private-spend-relay.mjs';
const privateSpendRoute=createPrivateSpendRoute({apiKey:process.env.LENZ_PRIVATE_INTENTS_KEY});
const accountOrigin=process.env.LENZ_ACCOUNT_ORIGIN??'http://localhost:4173';
let accountRoute;
const aiConfig={apiKey:process.env.NEARAI_API_KEY,model:process.env.LENZ_AI_MODEL};
const aiIds=(process.env.LENZ_AI_ACCOUNTS??'').split(',').filter(Boolean);
let aiStore;
const aiRoute=createAIRoute({enabled:aiConfigured(aiConfig,aiIds),allowedIds:aiIds,consume:(id,now)=>{aiStore??=new AIUsageStore(resolve('ai-usage.sqlite'));aiStore.consume(id,now);},ask:(input,options)=>runAIWorker(aiConfig,input,options)});
const carriers = carrierConfig({version:1,carriers:JSON.parse(process.env.LENZ_CARRIERS ?? '[]')});
const relays = nostrConfig(JSON.parse(await readFile(new URL('./public/nostr-config.json', import.meta.url), 'utf8')));
const root = resolve('public');
const types = { '.mp4': 'video/mp4', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.zkey': 'application/octet-stream' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    for (const [name, value] of Object.entries(securityHeaders(pathname, carriers, relays))) res.setHeader(name, value);
    // Keep the local sponsor and browser identity on the documented loopback origin.
    if (!['127.0.0.1:4173',new URL(accountOrigin).host].includes(req.headers.host)) { res.writeHead(403); res.end('Use the Lenz app address'); return; }
    if(pathname.startsWith('/api/accounts/')){accountRoute??=createAccountRoute({origin:accountOrigin,store:new AccountStore(resolve(process.env.LENZ_ACCOUNT_DATA??'.account-data'))});await accountRoute(req,res);return;}
    if(pathname==='/carrier-config.json' && req.method==='GET') { res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({version:1,carriers}));return; }
    if (await privateSpendRoute(req, res)) return;
    if (await nameRoute(req, res)) return;
    if (await aiRoute(req, res)) return;
    if (await receiveRoute(req, res)) return;
    if (await zcashRoute(req, res)) return;
    if (await rheaRoute(req, res)) return;
    if (await defiRoute(req, res)) return;
    if (await degenRoute(req, res)) return;
    if (await marketRoute(req, res)) return;
    if (await tokenRoute(req, res)) return;
    if (await testnetRoute(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('missing');
    const size = (await stat(file)).size;
    const headers = { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(size) };
    if (extname(file) === '.mp4') {
      headers['Accept-Ranges'] = 'bytes';
      if (req.headers.range) {
        const range = mediaRange(req.headers.range, size);
        if (!range) { res.writeHead(416, { ...headers, 'Content-Length': '0', 'Content-Range': `bytes */${size}` }); res.end(); return; }
        res.writeHead(206, { ...headers, 'Content-Length': String(range.end-range.start+1), 'Content-Range': `bytes ${range.start}-${range.end}/${size}` });
        res.end(req.method === 'HEAD' ? undefined : (await readFile(file)).subarray(range.start, range.end+1)); return;
      }
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(4173, '127.0.0.1', () => console.log('Proof of U web demo: http://127.0.0.1:4173'));
