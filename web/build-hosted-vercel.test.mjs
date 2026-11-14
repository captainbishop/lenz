import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildHostedVercel} from './build-hosted-vercel.mjs';
import {hostedRoute,hostedIncomingPath} from './hosted-policy.mjs';

test('backend package ships only public assets and proxy code, with polled native transport cached in both offline workers',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-build-')),before=await readFile(new URL('./public/intent-zcash-route.js',import.meta.url),'utf8');
 try{
  const result=await buildHostedVercel({destination:join(folder,'package')}),root=result.destination;
  assert.equal(result.backend,'authenticated-loopback-gateway');assert.equal(result.backupRequestLimit,4_000_000);
  const config=JSON.parse(await readFile(join(root,'vercel.json'),'utf8'));assert.equal(config.functions['api/proxy.mjs'].maxDuration,300);assert.match(config.rewrites[0].destination,/__lenz_path/);
  assert.deepEqual(await readdir(join(root,'api')),['proxy.mjs']);assert.deepEqual((await readdir(join(root,'runtime'))).sort(),['hosted-custody.mjs','hosted-policy.mjs','hosted-proxy.mjs','public']);assert.deepEqual((await readdir(join(root,'runtime','public'))).sort(),['chat-access.js','peer-crypto.js','profile-display.js']);
  const native=await readFile(join(root,'public','intent-zcash-route.js'),'utf8');assert.match(native,/import \{hostedFetch\}/);assert.equal((native.match(/fetchImpl=hostedFetch/g)??[]).length,2);assert.equal(await readFile(new URL('./public/intent-zcash-route.js',import.meta.url),'utf8'),before);
  for(const worker of ['sw.js','chat-sw.js']){const source=await readFile(join(root,'public',worker),'utf8');assert.match(source,/\/hosted-native-fetch\.js/);assert.match(source,/\/hosted-session\.js/);assert.match(source,/\/hosted-bootstrap\.js/);}
  for(const entry of ['money.js','chat.js','account-ui.js'])assert.match(await readFile(join(root,'public',entry),'utf8'),/^import '\.\/hosted-bootstrap\.js';/);assert(!(await readdir(join(root,'public'))).includes('demo-access.html'));
  const markets=await readFile(join(root,'public','markets.js'),'utf8');assert.equal(Buffer.byteLength(markets),result.marketsBundle.bytes);assert.doesNotMatch(markets,/sourceMappingURL|C:[\\/]|Users[\\/]DELL/);assert(!(await readdir(join(root,'public'))).includes('markets.js.map'));
  for(const name of ['hosted-policy.mjs','hosted-proxy.mjs'])assert.doesNotMatch(await readFile(join(root,'runtime',name),'utf8'),/LENZ_NEAR_INTENT_RELAYER_KEY|LENZ_ZCASH_INTENT_BACKEND|keyFile|backendConfigFile/);
 }finally{await rm(folder,{recursive:true,force:true});}
});

test('supported methods and ordinary image queries match exact routes, without permitting path escapes or endpoint substitution',()=>{
 for(const [path,method] of [['/api/markets/assets','POST'],['/api/intents/lending/supply/config','POST'],['/api/intent-zcash/config','POST'],['/api/hyperliquid-testnet/funding','GET'],['/api/hyperliquid-testnet/funding/request','POST'],['/api/asset-image?url=https%3A%2F%2Fassets.coingecko.com%2Fa.png','GET'],['/api/markets/prediction-image?event=kalshi%3AKXTEST','GET'],['/api/intent-testnet/private-pool/artifacts/withdraw_proving_key.bin','HEAD']])assert(hostedRoute(path,method),path);
 for(const [path,method] of [['/api/intent-zcash/config','GET'],['/api/hyperliquid-testnet/funding','POST'],['/api/intent-zcash/%2e%2e/config','POST'],['/api/markets/assets?url=https://other','POST'],['/api/asset-image?url=x&url=y','GET'],['//other/api/markets/assets','POST'],['/api/intent-zcash/config#x','POST']])assert.equal(hostedRoute(path,method),null,path);
});

test('Vercel catch-all rewrite reaches the exact API and retains ordinary image query values',()=>{
 const path=hostedIncomingPath('/api/proxy?__lenz_path=/api/testnet/status&path=testnet/status');
 assert.equal(path,'/api/testnet/status');assert(hostedRoute(path,'GET'));
 const image=hostedIncomingPath('/api/proxy?__lenz_path=/api/asset-image&path=asset-image&url=https%3A%2F%2Fassets.example%2Fx.png');
 assert.equal(image,'/api/asset-image?url=https%3A%2F%2Fassets.example%2Fx.png');assert(hostedRoute(image,'GET'));
 assert.equal(hostedIncomingPath('/api/proxy'),null);
 assert.equal(hostedIncomingPath('/api/proxy?__lenz_path=/api/testnet/status&__lenz_path=/api/intent-zcash/config'),null);
 assert.equal(hostedRoute(hostedIncomingPath('/api/proxy?__lenz_path=//external/api&path=ignored'),'GET'),null);
});
