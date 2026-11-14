const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');

(async()=>{
 const publicRoot=path.join(__dirname,'public');let requests=0;
 const server=http.createServer(async(request,response)=>{try{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){requests++;response.writeHead(500);response.end();return;}
  if(pathname==='/'){response.setHeader('content-type','text/html');response.end('<!doctype html><title>Isolated NEAR source check</title>');return;}
  const file=path.resolve(publicRoot,'.'+pathname);if(!file.startsWith(publicRoot+path.sep)){response.writeHead(403);response.end();return;}
  response.setHeader('content-type',path.extname(file)==='.js'?'text/javascript':'application/octet-stream');response.end(await fs.readFile(file));
 }catch{response.writeHead(404);response.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage(),base='http://127.0.0.1:'+server.address().port;await page.goto(base);
  const first=await page.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js'),{readState,updateState}=await import('/chat-store.js'),{createNearIntentSource}=await import('/intent-near-route.js');
   const identity=await createIdentity('Isolated real NEAR source');await updateState(state=>{state.identity=identity;});globalThis.nearSource=createNearIntentSource(identity.profile.id);
   let signingCalls=0;const originalSign=crypto.subtle.sign.bind(crypto.subtle);crypto.subtle.sign=(...args)=>{signingCalls++;return originalSign(...args);};
   const connection=await nearSource.connect(),state=await readState();crypto.subtle.sign=originalSign;
   return {connection,signingCalls,encrypted:state.nearIntentSource.ciphertext,wrappingExtractable:state.nearIntentSource.wrappingKey.extractable,recordFields:Object.keys(state.nearIntentSource).sort()};
  });
  assert.equal(requests,0);assert.equal(first.signingCalls,0);assert.equal(first.wrappingExtractable,false);assert(!first.recordFields.includes('privateKey'));assert(first.encrypted.length>50);assert(!first.encrypted.includes(first.connection.publicKey));assert.match(first.connection.accountId,/^[0-9a-f]{64}$/);
  const signed=await page.evaluate(async()=>nearSource.capture().signNep413({message:'Independent real browser signature',nonce:btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),recipient:'verifierif13a.lenz-dev-1794582631653.testnet'}));
  const {verifyNep413}=await import('./../integrations/intent-testnet/swap.mjs');assert.equal(verifyNep413(signed),true);assert.equal(requests,0);
  await page.reload();const restored=await page.evaluate(async()=>{const {readState}=await import('/chat-store.js'),{createNearIntentSource}=await import('/intent-near-route.js');const state=await readState();globalThis.nearSource=createNearIntentSource(state.identity.profile.id);return nearSource.connect();});assert.equal(restored.publicKey,first.connection.publicKey);
  const boundary=await page.evaluate(async()=>{const lease=nearSource.capture();dispatchEvent(new Event('lenz-account-identity'));try{await lease.signNep413({message:'Must never sign',nonce:btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),recipient:'test.testnet'});return false;}catch{return true;}});assert.equal(boundary,true);
  const tamper=await page.evaluate(async()=>{const {readState,updateState}=await import('/chat-store.js'),{createNearIntentSource}=await import('/intent-near-route.js');await updateState(state=>{state.nearIntentSource.ciphertext='A'+state.nearIntentSource.ciphertext.slice(1);});const identity=(await readState()).identity;try{await createNearIntentSource(identity.profile.id).connect();return false;}catch{return true;}});assert.equal(tamper,true);
  console.log(JSON.stringify({passed:5,failed:0,checks:['Connection performs no network call, signature or funding','Real key encrypted in IndexedDB with nonextractable wrapping key','Browser NEP-413 signature independently verified by Node Ed25519','Reload restores exact original encrypted public key','Account invalidation and ciphertext tampering prevent signing'],scope:'Disposable Edge context, real WebCrypto/IndexedDB/Web Locks; no NEAR RPC, mint, deposit or settlement.'},null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
