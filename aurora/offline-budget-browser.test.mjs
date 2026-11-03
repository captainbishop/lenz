import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {budgetFixture} from './offline-budget-fixture.mjs';
import {createIdentity,sealMessage,openMessage} from '../web/public/peer-crypto.js';
import {openBudgetPacket,budgetDigest} from '../web/public/offline-budget.js';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
test('offline browser signs and seals an instruction; independent executor runs the funded budget and returns a checked encrypted result',async()=>{
 const f=await budgetFixture(),executor=await createIdentity('Executor'),browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext(),page=await context.newPage(),requests=[],responses=new Map(),errors=[];page.on('request',r=>requests.push(r.url()));page.on('response',r=>responses.set(r.url(),r.fromServiceWorker()));page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.route('**/api/**',r=>r.abort());await page.goto('http://127.0.0.1:4173/money.html');await page.locator('#evm-connect').waitFor();
  await page.locator('.wallet-settings summary').click();await page.locator('#prepare-money-offline').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('files saved'));
  const sender=await page.evaluate(async()=>{
   const {createIdentity}=await import('/peer-crypto.js'),{offlineSignerAddress}=await import('/offline-budget.js');
   const key=crypto.getRandomValues(new Uint8Array(32)),identity=await createIdentity('Offline user');
   // Test-only ephemeral keys in an isolated database; never the user's chat store.
   const r=indexedDB.open('lenz-budget-browser-fixture',1);await new Promise((resolve,reject)=>{r.onupgradeneeded=()=>r.result.createObjectStore('fixture');r.onsuccess=resolve;r.onerror=()=>reject(r.error);});
   const tx=r.result.transaction('fixture','readwrite');tx.objectStore('fixture').put({key,identity},'signer');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});r.result.close();
   return {signer:offlineSignerAddress(key),profile:identity.profile};
  });
  f.policy.signer=sender.signer;assert.equal((await f.fund()).result.receipt.status,1);
  const initial=await f.order(),expected={domain:f.domain,signer:sender.signer,budgetId:'1',privacyPolicy:f.policy.privacyPolicy};
  await context.setOffline(true);await page.reload();await page.locator('#evm-connect').waitFor();
  await page.evaluate(()=>import('/offline-budget.js'));
  for(const path of ['/offline-budget.js','/evm-vendor/offline-budget.js'])assert.equal(responses.get('http://127.0.0.1:4173'+path),true,'Signing module must load from offline cache');
  const count=requests.length;
  const packet=await page.evaluate(async({base,executor,expected})=>{
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('lenz-budget-browser-fixture',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   const saved=await new Promise((resolve,reject)=>{const q=db.transaction('fixture').objectStore('fixture').get('signer');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
   const {signBudgetOrder,sealBudgetPacket,budgetDigest}=await import('/offline-budget.js');
   const packet={...base,signature:signBudgetOrder(saved.key,base.domain,base.order)},envelope=await sealBudgetPacket(saved.identity,executor,packet,expected);
   // Persistence precedes handing ciphertext to the executor. Read back after a reload.
   const tx=db.transaction('fixture','readwrite');tx.objectStore('fixture').put(envelope,'queued');await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
   return {envelope,digest:budgetDigest(base.domain,base.order)};
  },{base:initial,executor:executor.profile,expected});
  assert.equal(requests.length,count,'Offline signing requests: '+JSON.stringify(requests.slice(count)));
  assert(!JSON.stringify(packet.envelope).includes(initial.order.dataHash));assert(!JSON.stringify(packet.envelope).includes(f.policy.beneficiary));
  await page.reload();await page.locator('#evm-connect').waitFor();
  const queued=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('lenz-budget-browser-fixture',1);q.onsuccess=()=>r(q.result);});const value=await new Promise(r=>{const q=db.transaction('fixture').objectStore('fixture').get('queued');q.onsuccess=()=>r(q.result);});db.close();return value;});assert.deepEqual(queued,packet.envelope);
  const opened=await openBudgetPacket(executor,sender.profile,queued,expected);assert.equal(budgetDigest(opened.domain,opened.order),packet.digest);
  const wrong={...expected,signer:f.actors.attacker.address.toString()};await assert.rejects(openBudgetPacket(executor,sender.profile,queued,wrong),/signer differs/);
  const altered=structuredClone(queued);altered.ciphertext=altered.ciphertext.slice(0,-2)+(altered.ciphertext.endsWith('00')?'01':'00');await assert.rejects(openBudgetPacket(executor,sender.profile,altered,expected));
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
  const sources={};for(const file of ['aurora/contracts/OfflineBudget.sol','aurora/offline-budget-fixture.mjs','aurora/offline-budget-browser.test.mjs','web/public/offline-budget.js','web/public/evm-vendor/offline-budget.js','web/public/peer-crypto.js','web/public/chat-sw.js'])sources[file]=createHash('sha256').update(await readFile(file)).digest('hex');
  await writeFile('aurora/offline-budget-browser-results.json',JSON.stringify({checkedAt:new Date().toISOString(),passed:1,sources,evidence:{offlineReload:true,noSigningNetworkRequests:true,queuedCiphertextSurvivedReload:true,recipientOutput:'800000000000000000',recoveredRemainder:remainder.toString(),replayRejected:true},scope:'Disposable Edge offline signing/encryption/storage and actual isolated EthereumJS execution with a synthetic venue. Handoff is in-process test transfer of ciphertext; no real mesh/carrier, provider, private settlement, external chain/finality or production recovery.'},null,2)+'\n');
 }finally{await browser.close();}
});
