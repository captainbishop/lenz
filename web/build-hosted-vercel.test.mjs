import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,readdir,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {buildHostedVercel} from './build-hosted-vercel.mjs';
import {hostedRoute,hostedIncomingPath} from './hosted-policy.mjs';

function workerFixture(source,name){
 const listeners=new Map(),saved=new Set(),oldURL='https://fixture.invalid/markets-chunks/old-AAAAAAAA.js',oldResponse={oldGraph:true},pending=[],messages=[];
 const pathname=value=>new URL(typeof value==='string'?value:value.url,'https://fixture.invalid').pathname;
 const cache={match:async value=>saved.has(pathname(value))?{}:undefined};
 const context={URL,Request,importScripts(){},self:{location:{origin:'https://fixture.invalid'},addEventListener(type,listener){listeners.set(type,listener);}},caches:{open:async()=>cache,match:async request=>request.url===oldURL?oldResponse:undefined},fetch:async()=>assert.fail('An old immutable Markets chunk must remain available without the network')};
 runInNewContext(source+'\nglobalThis.manifest={paths:PATHS,shell:typeof BRAND_SHELL===\'undefined\'?null:BRAND_SHELL};',context);
 const paths=Array.from(name==='sw.js'?context.manifest.shell:context.manifest.paths,pathname);
 return {paths,saved,async ready(){messages.length=0;pending.length=0;listeners.get('message')({data:{type:name==='sw.js'?'home-status':'offline-status'},ports:[{postMessage:value=>messages.push(value)}],waitUntil:value=>pending.push(value)});await Promise.all(pending);return messages[0]?.complete;},async oldChunk(){let reply;listeners.get('fetch')({request:new Request(oldURL),respondWith:value=>{reply=value;}});assert(reply,'The worker must intercept retained generated chunks from an older graph');assert.equal(await reply,oldResponse);}};
}

test('backend package preserves lazy Markets modules and caches their complete public graph in both offline workers',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'lenz-hosted-build-')),sourceNames=['intent-zcash-route.js','tornado-prover.js','markets.js','markets.html','sw.js','chat-sw.js'],before=new Map(await Promise.all(sourceNames.map(async name=>[name,await readFile(new URL('./public/'+name,import.meta.url),'utf8')])));
 try{
  const result=await buildHostedVercel({destination:join(folder,'package')}),root=result.destination;
  assert.equal(result.backend,'authenticated-loopback-gateway');assert.equal(result.backupRequestLimit,4_000_000);
  const config=JSON.parse(await readFile(join(root,'vercel.json'),'utf8'));assert.equal(config.functions['api/proxy.mjs'].maxDuration,300);assert.match(config.rewrites[0].destination,/__lenz_path/);
  assert.deepEqual(await readdir(join(root,'api')),['proxy.mjs']);assert.deepEqual((await readdir(join(root,'runtime'))).sort(),['hosted-custody.mjs','hosted-policy.mjs','hosted-proxy.mjs','public']);assert.deepEqual((await readdir(join(root,'runtime','public'))).sort(),['chat-access.js','peer-crypto.js','profile-display.js']);
  const native=await readFile(join(root,'public','intent-zcash-route.js'),'utf8');assert.match(native,/import \{hostedFetch\}/);assert.equal((native.match(/fetchImpl=hostedFetch/g)??[]).length,2);
  for(const worker of ['sw.js','chat-sw.js']){const source=await readFile(join(root,'public',worker),'utf8');assert.match(source,/\/hosted-native-fetch\.js/);assert.match(source,/\/hosted-session\.js/);assert.match(source,/\/hosted-bootstrap\.js/);}
  for(const entry of ['money.js','chat.js','account-ui.js'])assert.match(await readFile(join(root,'public',entry),'utf8'),/^import '\.\/hosted-bootstrap\.js';/);assert(!(await readdir(join(root,'public'))).includes('demo-access.html'));
  const markets=await readFile(join(root,'public','markets.js'),'utf8');assert.equal(Buffer.byteLength(markets),result.marketsBundle.bytes);assert.doesNotMatch(markets,/sourceMappingURL|C:[\\/]|Users[\\/]DELL/);assert(!(await readdir(join(root,'public'))).includes('markets.js.map'));
  assert(result.marketsBundle.outputs?.length>1,'The hosted Markets build must preserve lazy imports instead of flattening every screen into the entry');
  const bundle=result.marketsBundle,outputs=new Map(bundle.outputs.map(output=>[output.path,output])),publicRoot=join(root,'public'),contents=[],{build}=createRequire(new URL('./near-connector/package.json',import.meta.url))('esbuild');
  assert.equal(bundle.totalBytes,bundle.outputs.reduce((sum,output)=>sum+output.bytes,0));assert.equal(bundle.sha256,outputs.get('markets.js').sha256);
  for(const output of bundle.outputs){
   assert.match(output.path,/^(?:markets\.js|markets-chunks\/[A-Za-z0-9_-]+-[A-Z0-9]{8}\.js)$/);
   const bytes=await readFile(join(publicRoot,output.path)),text=bytes.toString();contents.push(text);assert.equal(bytes.length,output.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),output.sha256);assert.doesNotMatch(text,/sourceMappingURL|C:[\\/]|Users[\\/]DELL/);
   const parsed=await build({stdin:{contents:text,sourcefile:output.path},bundle:false,write:false,format:'esm',metafile:true,logLevel:'silent'});
   const actual=Object.values(parsed.metafile.outputs).flatMap(output=>output.imports).map(imported=>{assert(imported.path.startsWith('.'),'Compiled imports must remain relative to the public graph');return relative(publicRoot,resolve(dirname(join(publicRoot,output.path)),imported.path)).replaceAll('\\','/');});
   assert.deepEqual([...new Set(actual)].sort(),[...new Set(output.imports.map(imported=>imported.path))].sort());for(const imported of output.imports)assert(outputs.has(imported.path),'Every compiled dependency must ship in the public output graph');
  }
  assert(outputs.get('markets.js').imports.some(imported=>imported.kind==='dynamic-import'),'Selected screens must retain runtime imports');
  const closure=new Set(['markets.js']),staticClosure=new Set(['markets.js']);
  function visit(path,seen,includeDynamic){for(const imported of outputs.get(path).imports){if(!includeDynamic&&imported.kind==='dynamic-import'||seen.has(imported.path))continue;seen.add(imported.path);visit(imported.path,seen,includeDynamic);}}
  visit('markets.js',closure,true);visit('markets.js',staticClosure,false);assert.equal(closure.size,outputs.size);assert.deepEqual(bundle.preloads,[...staticClosure].filter(path=>path!=='markets.js').sort().map(path=>'/'+path));
  const html=await readFile(join(publicRoot,'markets.html'),'utf8'),preloads=[...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(match=>match[1]);assert.deepEqual(preloads,bundle.preloads);assert.equal(createHash('sha256').update(html).digest('hex'),bundle.html.sha256);
  assert.equal(contents.join('').split('proof-u-private-chat-v1').length-1,1,'The compiled graph must share one chat store');assert.equal(contents.join('').split('lenz/hosted-operator-session/v1').length-1,1,'The compiled graph must install one hosted session');assert.doesNotMatch(JSON.stringify(bundle),/C:[\\/]|Users[\\/]DELL/);
  assert.deepEqual(bundle.assetURLs,[{source:'tornado-prover.js',url:'/tornado-vendor/prover-worker.js'}]);
  const proverIndex=contents.findIndex(source=>source.includes('Local prover is disposed'));assert(proverIndex!==-1);const proverOutput=bundle.outputs[proverIndex],workerCalls=[],jobs=[];
  const localProver=await build({stdin:{contents:contents[proverIndex]},bundle:false,write:false,format:'cjs',define:{'import.meta.url':JSON.stringify('https://fixture.invalid/'+proverOutput.path)},logLevel:'silent'}),module={exports:{}};
  class WorkerFixture{constructor(url,options){workerCalls.push({url:url.href,options});}postMessage(job){jobs.push(job);this.onmessage({data:{result:'synthetic worker reply'}});}terminate(){}}
  runInNewContext(localProver.outputFiles[0].text,{module,exports:module.exports,URL,DOMException,location:{href:'https://fixture.invalid/markets.html',origin:'https://fixture.invalid'},Worker:WorkerFixture,addEventListener(){},removeEventListener(){}});
  const createProver=Object.values(module.exports).find(value=>typeof value==='function'),prover=createProver();assert.equal(await prover.generateNote(),'synthetic worker reply');prover.dispose();assert.equal(workerCalls[0].url,'https://fixture.invalid/tornado-vendor/prover-worker.js','Moving a compiled module must preserve its public worker URL');assert.equal(workerCalls[0].options.type,'module');assert.equal(jobs[0].artifactBase,'https://fixture.invalid/api/intent-testnet/private-pool/artifacts/');assert((await stat(join(publicRoot,'tornado-vendor/prover-worker.js'))).isFile());
  const lazy=bundle.outputs.find(output=>output.path!=='markets.js'&&!staticClosure.has(output.path));assert(lazy,'The complete offline graph must include deferred workspaces');
  for(const name of ['sw.js','chat-sw.js']){
   const source=await readFile(join(publicRoot,name),'utf8'),worker=workerFixture(source,name);for(const output of bundle.outputs)assert(worker.paths.includes('/'+output.path),'Offline readiness must include every emitted module');
   worker.paths.forEach(path=>worker.saved.add(path));assert.equal(await worker.ready(),true);worker.saved.delete('/'+lazy.path);assert.equal(await worker.ready(),false,'Missing an unopened lazy chunk must prevent Ready offline');await worker.oldChunk();
   assert.equal(createHash('sha256').update(source).digest('hex'),bundle.workers.find(worker=>worker.path===name).sha256);
  }
  for(const name of sourceNames)assert.equal(await readFile(new URL('./public/'+name,import.meta.url),'utf8'),before.get(name),'Hosted compilation must leave product sources unchanged');
  let fileCount=0,byteCount=0;async function count(folder){for(const entry of await readdir(folder,{withFileTypes:true})){const file=join(folder,entry.name);if(entry.isDirectory())await count(file);else{fileCount++;byteCount+=(await stat(file)).size;}}}await count(publicRoot);assert.equal(result.files,fileCount);assert.equal(result.bytes,byteCount);
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
