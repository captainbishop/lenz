const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function harness(run){
 const {fixture,managerKey,wallet,owner,now}=await import('./intents-spend-fixture.mjs');
 const {confidentialSignedData}=await import('./public/intents-spend.js'),offer=fixture();
 const signed=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
 const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Private approval outbox test</title>');return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(__dirname,'public',pathname)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),base='http://127.0.0.1:'+server.address().port;
  async function boot(p){await p.goto(base);await p.evaluate(async({managerKey,now,offer,signed})=>{
   window.store=await import('/chat-store.js');window.protocol=await import('/peer-crypto.js');
   const {createConfidentialSpendOutbox}=await import('/intents-spend-outbox.js'),{verifyQuoteSignature}=await import('/intents-vendor/quote.js');
   window.testNow=now;window.fixtureManagerKey=managerKey;window.outbox=createConfidentialSpendOutbox({now:()=>testNow,verifySignature:q=>verifyQuoteSignature(q,managerKey)});
   window.offer=offer;window.signed=signed;
  },{managerKey,now,offer,signed});}
  await boot(page);await page.evaluate(async()=>{
   window.executor=await protocol.createIdentity('Selected executor');
   await store.updateState(async s=>{s.identity=await protocol.createIdentity('Offline owner');s.contacts=[executor.profile];s.messages=[{text:'Keep existing history'}];});
  });
  await run({page,context,boot,offer,signed,now});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}

test('private approval is durable and encrypted before offline handoff, and reopening retains the exact envelope',()=>harness(async({page,context,boot,signed})=>{
 const before=await page.evaluate(async()=>JSON.stringify(await store.readState()));
 await context.setOffline(true);
 const result=await page.evaluate(async()=>{
  const row=await outbox.queue(offer,signed,executor.profile),envelope=await outbox.handoff(row.id);
  const plaintext=await protocol.openMessage(executor,(await store.readState()).identity.profile,envelope);
  const s=await store.readState();return {row,envelope,plaintext,encrypted:JSON.stringify(s),extractable:s.privateSpendKey.extractable};
 });
 assert.equal(result.row.status,'queued');assert.equal(result.row.settlementVerified,false);
 assert.equal(result.plaintext.type,'lenz/private-spend/v1');assert.deepEqual(result.plaintext.signedData,signed);
 assert.equal(result.extractable,false);assert(!result.encrypted.includes(signed.signature));assert(!result.encrypted.includes('minAmountOut'));
 await context.setOffline(false);await boot(page);
 assert.deepEqual(await page.evaluate(id=>outbox.handoff(id),result.row.id),result.envelope);
 const rows=await page.evaluate(()=>outbox.list());assert.equal(rows.length,1);assert.equal(rows[0].status,'shared-unresolved');
 assert.equal(await page.evaluate(async()=>{const s=await store.readState();delete s.privateSpendBox;delete s.privateSpendKey;return JSON.stringify(s);}),before);
}));

test('every admitted approval can be shared at the storage boundary',()=>harness(async({page,offer})=>{
 const {wallet,owner}=await import('./intents-spend-fixture.mjs'),{confidentialSignedData}=await import('./public/intents-spend.js'),rows=[];
 for(let i=1;i<=10;i++){
  const input=structuredClone(offer),payload=JSON.parse(input.generated.intent.payload),nonce=Buffer.from(payload.nonce,'base64');
  nonce[31]=i;payload.nonce=nonce.toString('base64');input.generated.intent.payload=JSON.stringify(payload);
  // This final metadata length previously admitted a row one byte below the cap.
  input.quote.metadata='x'.repeat(i===10?2303:60000);
  const approval=confidentialSignedData(input.generated.intent.payload,await wallet.signMessage(input.generated.intent.payload),owner);
  try{rows.push(await page.evaluate(x=>outbox.queue(x.input,x.approval,executor.profile),{input,approval}));}
  catch(error){assert.equal(i,10);assert.match(error.message,/storage is full/);}
 }
 assert(rows.length>=9);
 for(const row of rows)assert(await page.evaluate(id=>outbox.handoff(id),row.id));
}));

test('expiry or cancellation during the durable commit prevents disclosure and retains the approval',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const row=await outbox.queue(offer,signed,executor.profile),put=IDBObjectStore.prototype.put,clock=testNow,errors=[];
  for(const mode of ['expired','aborted']){
   testNow=clock;const controller=new AbortController();
   IDBObjectStore.prototype.put=function(...args){
    const tx=this.transaction,complete=tx.oncomplete;
    tx.oncomplete=(...events)=>{complete.apply(tx,events);if(mode==='expired')testNow=Date.parse(offer.terms.refundDeadline);else controller.abort();};
    return put.apply(this,args);
   };
   try{await outbox.handoff(row.id,{signal:controller.signal});errors.push('exposed');}catch{errors.push('blocked');}
   finally{IDBObjectStore.prototype.put=put;}
  }
  return {errors,rows:await outbox.list()};
 });
 assert.deepEqual(result.errors,['blocked','blocked']);assert.equal(result.rows.length,1);
}));

test('a backward clock adjustment cannot corrupt the approval journal',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const row=await outbox.queue(offer,signed,executor.profile);testNow-=1000;
  const first=await outbox.handoff(row.id),rows=await outbox.list(),retry=await outbox.handoff(row.id);
  return {first,rows,retry};
 });
 assert.equal(result.rows.length,1);assert.deepEqual(result.first,result.retry);
}));

test('failed storage writes release no approval and leave existing history available for retry',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const put=IDBObjectStore.prototype.put,fail=()=>{throw new DOMException('Storage full','QuotaExceededError');};let queueError='',handoffError='',released=false;
  IDBObjectStore.prototype.put=fail;
  try{await outbox.queue(offer,signed,executor.profile);}catch(e){queueError=e.message;}finally{IDBObjectStore.prototype.put=put;}
  const empty=await outbox.list(),row=await outbox.queue(offer,signed,executor.profile);
  IDBObjectStore.prototype.put=fail;
  try{await outbox.handoff(row.id);released=true;}catch(e){handoffError=e.message;}finally{IDBObjectStore.prototype.put=put;}
  const queued=await outbox.list(),first=await outbox.handoff(row.id),retry=await outbox.handoff(row.id);
  return {queueError,handoffError,released,empty,queued,first,retry};
 });
 assert.match(result.queueError,/Storage full/);assert.match(result.handoffError,/Storage full/);assert.equal(result.released,false);
 assert.deepEqual(result.empty,[]);assert.equal(result.queued[0].status,'queued');assert.deepEqual(result.first,result.retry);
}));

test('conflicting approvals across tabs preserve one nonce and its selected executor',()=>harness(async({page,context,boot,offer,signed})=>{
 const {signQuote,wallet,owner}=await import('./intents-spend-fixture.mjs'),{confidentialSignedData}=await import('./public/intents-spend.js');
 const alternative=structuredClone(offer),payload=JSON.parse(alternative.generated.intent.payload);
 alternative.quote.quote.depositAddress='cd'.repeat(32);signQuote(alternative.quote);payload.intents[0].receiver_id=alternative.quote.quote.depositAddress;
 alternative.generated.intent.payload=JSON.stringify(payload);
 const alternativeSigned=confidentialSignedData(alternative.generated.intent.payload,await wallet.signMessage(alternative.generated.intent.payload),owner);
 const other=await context.newPage();await boot(other);const executor=await page.evaluate(()=>window.executor.profile);
 const queue=(p,offer,signed)=>p.evaluate(x=>outbox.queue(x.offer,x.signed,x.executor),{offer,signed,executor});
 const outcomes=await Promise.allSettled([queue(page,offer,signed),queue(other,alternative,alternativeSigned)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.match(outcomes.find(r=>r.status==='rejected').reason.message,/nonce already/);
 const winning=outcomes[0].status==='fulfilled'?{offer,signed}:{offer:alternative,signed:alternativeSigned};
 assert.equal((await queue(other,winning.offer,winning.signed)).id,(await page.evaluate(()=>outbox.list()))[0].id);
 const changedExecutor=await page.evaluate(async()=>{const p=(await protocol.createIdentity('Other executor')).profile;await store.updateState(s=>s.contacts.push(p));return p;});
 await assert.rejects(page.evaluate(x=>outbox.queue(x.offer,x.signed,x.executor),{...winning,executor:changedExecutor}),/different delivery terms/);
}));

test('ended review and expired signature retain evidence without releasing a fresh handoff',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const row=await outbox.queue(offer,signed,executor.profile),errors=[];
  testNow=Date.parse(offer.terms.refundDeadline);const reviewEnded=(await outbox.list())[0];
  try{await outbox.handoff(row.id);}catch(e){errors.push(e.message);}
  testNow=Date.parse(offer.terms.signingDeadline)+1;const expired=(await outbox.list())[0];
  try{await outbox.handoff(row.id);}catch(e){errors.push(e.message);}
  return {reviewEnded,expired,errors};
 });
 assert.equal(result.reviewEnded.status,'review-window-ended');assert.equal(result.expired.status,'expired-unresolved');
 assert.equal(result.errors.length,2);assert.equal(result.expired.settlementVerified,false);
}));

test('altered signatures, unverified executors, cancellation and corrupted storage cannot expose handoff',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const errors=[],controller=new AbortController();controller.abort();
  for(const execute of [()=>outbox.queue(offer,{...signed,payload:signed.payload+' '},executor.profile),async()=>outbox.queue(offer,signed,(await protocol.createIdentity('Unknown executor')).profile),()=>outbox.queue(offer,signed,executor.profile,{signal:controller.signal})]){
   try{await execute();}catch(e){errors.push(e.message);}
  }
  const empty=await outbox.list(),row=await outbox.queue(offer,signed,executor.profile);
  await store.updateState(s=>{const value=s.privateSpendBox.ciphertext;s.privateSpendBox.ciphertext=(value[0]==='0'?'1':'0')+value.slice(1);});
  let disclosed=false;try{await outbox.handoff(row.id);disclosed=true;}catch{}
  return {errors,empty,disclosed};
 });
 assert.equal(result.errors.length,3);assert.deepEqual(result.empty,[]);assert.equal(result.disclosed,false);
}));

test('an account change while an approval waits for storage cannot attach it to the new account',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const next=await protocol.createIdentity('Replacement account'),{createConfidentialSpendOutbox}=await import('/intents-spend-outbox.js');
  const {verifyQuoteSignature}=await import('/intents-vendor/quote.js');
  let replacement,first=true;
  // The external verifier finishes while another tab's account change is queued.
  const guarded=createConfidentialSpendOutbox({now:()=>testNow,verifySignature:quote=>{
   if(first){first=false;replacement=store.updateState(s=>{s.identity=next;s.contacts=[];});}
   return verifyQuoteSignature(quote,window.fixtureManagerKey);
  }});
  let error='';try{await guarded.queue(offer,signed,executor.profile);}catch(e){error=e.message;}
  await replacement;return {error,rows:await outbox.list(),identity:(await store.readState()).identity.profile.id,expected:next.profile.id};
 });
 assert.match(result.error,/account changed/);assert.deepEqual(result.rows,[]);assert.equal(result.identity,result.expected);
}));

test('chat-only account recovery cannot queue or disclose a spending approval',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const {RECOVERED_CHAT}=await import('/chat-access.js'),errors=[];
  await store.updateState(s=>{s.identity.access=RECOVERED_CHAT;});
  try{await outbox.queue(offer,signed,executor.profile);}catch(e){errors.push(e.message);}
  await store.updateState(s=>{delete s.identity.access;});
  const row=await outbox.queue(offer,signed,executor.profile);
  await store.updateState(s=>{s.identity.access=RECOVERED_CHAT;});
  try{await outbox.handoff(row.id);}catch(e){errors.push(e.message);}
  return {errors,rows:await outbox.list()};
 });
 assert.equal(result.errors.length,2);assert(result.errors.every(e=>e.includes('Offline funds are not restored')));
 assert.equal(result.rows.length,1);
}));
