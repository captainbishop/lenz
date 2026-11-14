import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {budgetFixture} from './offline-budget-fixture.mjs';
import {createIdentity,sealMessage,openMessage} from '../web/public/peer-crypto.js';
import {openBudgetPacket,budgetDigest} from '../web/public/offline-budget.js';
import {carrierPost,inboxRequest,wrapForCarrier} from '../web/public/carrier-protocol.js';
import {createCarrier} from '../carrier/server.mjs';
import {securityHeaders} from '../web/security-policy.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
test('offline authorization survives reload and carrier restart; local execution and storage acknowledgement remain separate',async()=>{
 const f=await budgetFixture(),executor=await createIdentity('Executor'),browser=await chromium.launch({channel:'msedge',headless:true});
 const portServer=createServer();await new Promise(r=>portServer.listen(0,'127.0.0.1',r));const carrierOrigin='http://127.0.0.1:'+portServer.address().port;await new Promise(r=>portServer.close(r));
 const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname,file=pathname==='/'?'/index.html':pathname;
  for(const [key,value]of Object.entries(securityHeaders(file,[carrierOrigin])))res.setHeader(key,value);
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');
  try{res.end(await readFile(new URL('../web/public'+file,import.meta.url)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const carrierOptions={origin:carrierOrigin,directory:await mkdtemp(join(tmpdir(),'lenz-budget-carrier-')),allowedOrigins:[base]};
 let carrier=createCarrier(carrierOptions);await carrier.listen();
 const context=await browser.newContext(),page=await context.newPage(),requests=[],responses=new Map(),errors=[];page.on('request',r=>requests.push(r.url()));page.on('response',r=>responses.set(r.url(),r.fromServiceWorker()));page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/api/**',r=>r.abort());await page.goto(base+'/money.html');await page.locator('#evm-connect').waitFor({state:'attached'});
  await page.locator('.wallet-settings summary').click();await page.locator('#prepare-money-offline').click();
  try{await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));}
  catch(error){console.error('Offline preparation timed out:',await page.evaluate(()=>({status:document.querySelector('#status')?.textContent,readiness:document.querySelector('[data-offline-state]')?.dataset.offlineState})),errors);throw error;}
  const sender=await page.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js'),{offlineSignerAddress}=await import('/offline-budget.js');
   const key=crypto.getRandomValues(new Uint8Array(32)),identity=await createIdentity('Offline user');
   const {updateState}=await import('/chat-store.js');await updateState(s=>{s.identity=identity;s.carrier={enabled:true};});
   // Test-only ephemeral keys in an isolated database; never the user's chat store.
   const r=indexedDB.open('lenz-budget-browser-fixture',1);await new Promise((resolve,reject)=>{r.onupgradeneeded=()=>r.result.createObjectStore('fixture');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
   const tx=r.result.transaction('fixture','readwrite');tx.objectStore('fixture').put({key,identity},'signer');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});r.result.close();
   return {signer:offlineSignerAddress(key),profile:identity.profile};
  });
  f.policy.signer=sender.signer;assert.equal((await f.fund()).result.receipt.status,1);
  const initial=await f.order(),expected={domain:f.domain,signer:sender.signer,budgetId:'1',privacyPolicy:f.policy.privacyPolicy};
  await context.setOffline(true);await page.reload();await page.locator('#evm-connect').waitFor({state:'attached'});
  await page.evaluate(()=>import('/offline-budget-outbox.js'));
  for(const path of ['/offline-budget-outbox.js','/offline-budget.js','/evm-vendor/offline-budget.js'])assert.equal(responses.get(base+path),true,'Signing/outbox module must load from offline cache');
  await page.waitForLoadState('networkidle');const count=requests.length;
  const packet=await page.evaluate(async({base,executor,expected})=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-budget-browser-fixture',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const saved=await new Promise((resolve,reject)=>{const q=db.transaction('fixture').objectStore('fixture').get('signer');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
   const {signBudgetOrder}=await import('/offline-budget.js'),{queueOfflineBudget,offlineBudgetHandoff}=await import('/offline-budget-outbox.js');
   const packet={...base,signature:signBudgetOrder(saved.key,base.domain,base.order)};db.close();
   const queued=await queueOfflineBudget(packet,expected,executor,{publicRehearsalConsent:true});
   return {envelope:await offlineBudgetHandoff(queued.id),digest:queued.id};
  },{base:initial,executor:executor.profile,expected});
  await page.waitForLoadState('networkidle');
  for(const url of requests.slice(count))assert(url.startsWith(base+'/')&&responses.get(url)===true,'Signing attempted network access: '+url);
  assert(!JSON.stringify(packet.envelope).includes(initial.order.dataHash));assert(!JSON.stringify(packet.envelope).includes(f.policy.beneficiary));
  await page.reload();await page.locator('#evm-connect').waitFor({state:'attached'});
  const queued=await page.evaluate(async id=>(await import('/offline-budget-outbox.js')).offlineBudgetHandoff(id),packet.digest);assert.deepEqual(queued,packet.envelope);
  await context.setOffline(false);
  const lost=await page.evaluate(async({id,origin})=>{
   const {sendOfflineBudget,listOfflineBudgets}=await import('/offline-budget-outbox.js'),{carrierPost}=await import('/carrier-protocol.js');let error='';
   try{await sendOfflineBudget(id,{version:1,carriers:[origin]},{post:async(...args)=>{await carrierPost(...args);throw Error('Reply lost after carrier commit');}});}catch(e){error=e.message;}
   return {error,rows:await listOfflineBudgets()};
  },{id:packet.digest,origin:carrierOrigin});
  assert.match(lost.error,/Reply lost/);assert.equal(lost.rows[0].status,'queued');
  await carrier.close();carrier=createCarrier(carrierOptions);await carrier.listen();
  await page.reload();await page.locator('#evm-connect').waitFor({state:'attached'});
  const retry=await page.evaluate(async({id,origin})=>(await import('/offline-budget-outbox.js')).sendOfflineBudget(id,{version:1,carriers:[origin]}),{id:packet.digest,origin:carrierOrigin});assert.equal(retry.state,'carrier-stored');
  const inbox=await carrierPost(carrierOrigin,'/v1/inbox',await inboxRequest(executor,carrierOrigin));assert.equal(inbox.envelopes.length,1);assert.deepEqual(inbox.envelopes[0],queued);
  const opened=await openBudgetPacket(executor,sender.profile,inbox.envelopes[0].packet,expected);assert.equal(budgetDigest(opened.domain,opened.order),packet.digest);
  const wrong={...expected,signer:f.actors.attacker.address.toString()};await assert.rejects(openBudgetPacket(executor,sender.profile,queued.packet,wrong),/signer differs/);
  const altered=structuredClone(queued.packet);altered.ciphertext=altered.ciphertext.slice(0,-2)+(altered.ciphertext.endsWith('00')?'01':'00');await assert.rejects(openBudgetPacket(executor,sender.profile,altered,expected));
  const ack=await sealMessage(executor,sender.profile,{type:'lenz/budget-ack/v1',digest:packet.digest,acceptedAt:Date.now()});
  await carrierPost(carrierOrigin,'/v1/store',await wrapForCarrier(executor,ack));
  const stored=await page.evaluate(async({id,origin})=>{
   const s=await(await import('/chat-store.js')).readState(),{carrierPost,inboxRequest}=await import('/carrier-protocol.js');
   const inbox=await carrierPost(origin,'/v1/inbox',await inboxRequest(s.identity,origin));
   return (await import('/offline-budget-outbox.js')).recordOfflineBudgetAck(id,inbox.envelopes[0].packet);
  },{id:packet.digest,origin:carrierOrigin});assert.equal(stored.status,'executor-stored');assert.equal(stored.executable,false);assert.equal(await f.output(),0n);
  const execution=await f.execute(opened);assert.equal(execution.receipt.status,1);assert.equal(await f.output(),800000000000000000n);f.expectFail(await f.execute(opened),'InvalidOrder');
  const receipt={type:'lenz/budget-local-result/v1',digest:packet.digest,state:'executed-in-local-evm',nonce:(await f.state()).nonce.toString(),remaining:(await f.state()).remaining.toString(),output:(await f.output()).toString()};
  const sealedReceipt=await sealMessage(executor,sender.profile,receipt);
  const decoded=await page.evaluate(async({envelope,executor,digest})=>{
   const db=await new Promise(r=>{const q=indexedDB.open('lenz-budget-browser-fixture',1);q.onsuccess=()=>r(q.result);});const {identity}=await new Promise(r=>{const q=db.transaction('fixture').objectStore('fixture').get('signer');q.onsuccess=()=>r(q.result);});db.close();
   const {openMessage}=await import('/peer-crypto.js');const receipt=await openMessage(identity,executor,envelope);if(receipt.digest!==digest)throw Error('Wrong result');return receipt;
  },{envelope:sealedReceipt,executor:executor.profile,digest:packet.digest});assert.deepEqual(decoded,receipt);
  // Authentic executor communication is not an independent chain finality proof.
  const remainder=(await f.state()).remaining;assert.equal(remainder,1599000000000000000n);assert.equal((await f.send('owner',f.budget.address,f.budget.iface.encodeFunctionData('withdraw',[1]))).receipt.status,1);assert.equal(await f.balance(f.budget.address),0n);
  assert.deepEqual(errors,[]);
  const sources={};for(const file of ['aurora/contracts/OfflineBudget.sol','aurora/offline-budget-fixture.mjs','aurora/offline-budget-browser.test.mjs','web/public/offline-budget.js','web/public/offline-budget-outbox.js','web/public/evm-vendor/offline-budget.js','web/public/peer-crypto.js','web/public/chat-sw.js','carrier/server.mjs','carrier/store.mjs'])sources[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  if(process.env.LENZ_BUDGET_BROWSER_REPORT)await writeFile(process.env.LENZ_BUDGET_BROWSER_REPORT,JSON.stringify({checkedAt:new Date().toISOString(),passed:1,sources,evidence:{offlineReload:true,noSigningNetworkRequests:true,queuedCiphertextSurvivedReload:true,httpSqliteHandoff:true,carrierRestart:true,retryAfterDiscardedReply:true,noDuplicateEnvelope:true,ackDoesNotCredit:true,recipientOutput:'800000000000000000',recoveredRemainder:remainder.toString(),replayRejected:true},scope:'Disposable Edge offline signing and encrypted product outbox, real loopback HTTP/SQLite carrier with discarded reply and restart, isolated EthereumJS execution with a synthetic venue. No physical mesh, provider, private settlement, external chain/finality or production signer recovery.'},null,2)+'\n');
 }finally{await browser.close();await carrier.close();await new Promise(r=>server.close(r));}
});
