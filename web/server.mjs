import { mediaRange } from './public/media-range.js';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { testnetRoute } from './testnet-relay.mjs';
import { defiRoute } from './defi-relay.mjs';
import { marketRoute } from './market-relay.mjs';
import { degenRoute } from './degen-relay.mjs';
import { degenQuoteRoute } from './degen-quote-relay.mjs';
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
import {createPrivateExecutorRoute} from './private-executor-relay.mjs';
import {createNearIntentHttpRoute} from './intent-near-http.mjs';
import {createTornadoArtifactRoute} from './tornado-artifact-http.mjs';
import {createHyperliquidTestnetFundingHttpRoute} from './hyperliquid-testnet-funding-http.mjs';
import {createAuroraFundingHttpRoute} from './intent-aurora-funding-http.mjs';
import {createAuroraIntentHttpRoute} from './intent-aurora-http.mjs';
import {createAuroraSwapHttpRoute} from './intent-aurora-swap-http.mjs';
import {createLendingHttpRoute} from './intent-lending-http.mjs';
import {createLendingExecutionHttpRoute} from './intent-lending-execution-http.mjs';
import {createLendingReader} from './intent-lending-read.mjs';
import {createLendingSupplyReader} from './intent-lending-supply-read.mjs';
import {LENDING_DEPLOYMENT} from './public/intent-lending-deployment.js';
import {createZcashIntentHttpRoute} from './intent-zcash-http.mjs';
const privateSpendRoute=createPrivateSpendRoute({apiKey:process.env.LENZ_PRIVATE_INTENTS_KEY});
const privateExecutorRoute=createPrivateExecutorRoute({apiKey:process.env.LENZ_PRIVATE_INTENTS_KEY});
const port=Number(process.env.LENZ_PORT??4173);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Use a valid local app port.');
const accountOrigin=process.env.LENZ_ACCOUNT_ORIGIN??'http://localhost:'+port;
const appOrigin=new URL(accountOrigin);
if(appOrigin.protocol!=='http:'||!['localhost','127.0.0.1'].includes(appOrigin.hostname)||Number(appOrigin.port||80)!==port)throw Error('Use the same loopback origin and app port.');
const nearIntentRoute=createNearIntentHttpRoute({origin:accountOrigin,stateDir:process.env.LENZ_NEAR_INTENT_DATA,deployerKeyFile:process.env.LENZ_NEAR_INTENT_RELAYER_KEY,deploymentStateFile:process.env.LENZ_NEAR_INTENT_DEPLOYMENT});
const hyperliquidFundingRoute=createHyperliquidTestnetFundingHttpRoute({origin:accountOrigin});
const auroraFundingRoute=createAuroraFundingHttpRoute({origin:accountOrigin,stateDir:process.env.LENZ_AURORA_FUNDING_DATA,deployerKeyFile:process.env.LENZ_AURORA_FUNDING_KEY,operatorId:process.env.LENZ_AURORA_FUNDING_OPERATOR,engineCodeHash:process.env.LENZ_AURORA_ENGINE_CODE_HASH});
const auroraIntentRoute=createAuroraIntentHttpRoute({origin:accountOrigin});
const auroraSwapRoute=createAuroraSwapHttpRoute({origin:accountOrigin,stateDir:process.env.LENZ_AURORA_SWAP_DATA,deployerKeyFile:process.env.LENZ_AURORA_FUNDING_KEY,operatorId:process.env.LENZ_AURORA_FUNDING_OPERATOR,engineCodeHash:process.env.LENZ_AURORA_ENGINE_CODE_HASH});
const lendingDeployment=Object.fromEntries(Object.entries(LENDING_DEPLOYMENT).filter(([key])=>key!=='privacyPoolDeploymentBlock'));
const lendingReader=createLendingReader({deployment:lendingDeployment});
const lendingReadRoute=createLendingHttpRoute({origin:accountOrigin,reader:lendingReader,supplyReader:createLendingSupplyReader({deployment:LENDING_DEPLOYMENT,readSnapshot:lendingReader.snapshot})});
const lendingExecutionRoute=createLendingExecutionHttpRoute({origin:accountOrigin,serviceOptions:process.env.LENZ_LENDING_DATA&&process.env.LENZ_LENDING_KEY?{stateDir:process.env.LENZ_LENDING_DATA,keyFile:process.env.LENZ_LENDING_KEY}:undefined});
const zcashIntentRoute=createZcashIntentHttpRoute({origin:accountOrigin,stateDir:process.env.LENZ_ZCASH_INTENT_DATA,backendConfigFile:process.env.LENZ_ZCASH_INTENT_BACKEND});
const tornadoArtifactRoute=createTornadoArtifactRoute({artifactDir:process.env.LENZ_TORNADO_ARTIFACTS});
let accountRoute;
const aiConfig={apiKey:process.env.NEARAI_API_KEY,model:process.env.LENZ_AI_MODEL};
const aiIds=(process.env.LENZ_AI_ACCOUNTS??'').split(',').filter(Boolean);
let aiStore;
const aiRoute=createAIRoute({enabled:aiConfigured(aiConfig,aiIds),allowedIds:aiIds,consume:(id,now)=>{aiStore??=new AIUsageStore(resolve('ai-usage.sqlite'));aiStore.consume(id,now);},ask:(input,options)=>runAIWorker(aiConfig,input,options)});
const carriers = carrierConfig({version:1,carriers:JSON.parse(process.env.LENZ_CARRIERS ?? '[]')});
const relays = nostrConfig(JSON.parse(await readFile(new URL('./public/nostr-config.json', import.meta.url), 'utf8')));
const root = resolve('public');
const types = { '.mp4': 'video/mp4', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.zkey': 'application/octet-stream' };
const server=http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    for (const [name, value] of Object.entries(securityHeaders(pathname, carriers, relays))) res.setHeader(name, value);
    // Keep the local sponsor and browser identity on the documented loopback origin.
    if (!['127.0.0.1:'+port,appOrigin.host].includes(req.headers.host)) { res.writeHead(403); res.end('Use the Lenz app address'); return; }
    if(pathname.startsWith('/api/accounts/')){accountRoute??=createAccountRoute({origin:accountOrigin,store:new AccountStore(resolve(process.env.LENZ_ACCOUNT_DATA??'.account-data'))});await accountRoute(req,res);return;}
    if(pathname==='/carrier-config.json' && req.method==='GET') { res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({version:1,carriers}));return; }
    if (await nameRoute(req, res)) return;
    if (await aiRoute(req, res)) return;
    if (await receiveRoute(req, res)) return;
    if (await privateSpendRoute(req, res)) return;
    if (await privateExecutorRoute(req, res)) return;
    if (await nearIntentRoute(req, res)) return;
    if (await hyperliquidFundingRoute(req, res)) return;
    if (await auroraFundingRoute(req, res)) return;
    if (await auroraIntentRoute(req, res)) return;
    if (await auroraSwapRoute(req, res)) return;
    if (await lendingExecutionRoute(req, res)) return;
    if (['/api/intents/lending/snapshot','/api/intents/lending/supply/snapshot'].includes(pathname) && await lendingReadRoute(req, res)) return;
    if (await tornadoArtifactRoute(req, res)) return;
    if (await zcashIntentRoute(req, res)) return;
    if (await zcashRoute(req, res)) return;
    if (await rheaRoute(req, res)) return;
    if (await defiRoute(req, res)) return;
    if (await degenQuoteRoute(req, res)) return;
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
}).listen(port, '127.0.0.1', () => console.log('Lenz app: http://127.0.0.1:'+port));
let stopping=false;
async function stop(){
  if(stopping)return;stopping=true;
  server.close();
  try{await lendingExecutionRoute.close();}catch{process.exitCode=1;}
  try{await zcashIntentRoute.close();}catch{process.exitCode=1;}
  try{await auroraSwapRoute.close();}catch{process.exitCode=1;}
  try{await auroraFundingRoute.close();}catch{process.exitCode=1;}
}
process.once('SIGINT',stop);
process.once('SIGTERM',stop);
