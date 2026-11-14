const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function fixture(run){
 const {fixture,managerKey,wallet,owner,now}=await import('./intents-spend-fixture.mjs'),offer=fixture();
 const {confidentialSignedData}=await import('./public/intents-spend.js');
 const signed=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
 const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  if(file==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Private approval courier test</title>');return;}
  res.setHeader('Content-Type','text/javascript');
  // Only this disposable test server trusts the fixture quote manager. The real
  // SDK verifier still authenticates every quote and uses its production key elsewhere.
  if(file==='/intents-vendor/quote.js'){res.end(`import {verifyQuoteSignature as verify} from '/fixture-quote.js';export const verifyQuoteSignature=q=>verify(q,${JSON.stringify(managerKey)});`);return;}
  try{res.end(await fs.readFile(path.join(__dirname,'public',file==='/fixture-quote.js'?'/intents-vendor/quote.js':file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const contexts=await Promise.all([0,1,2].map(()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),profiles=[];
  async function boot(page){await page.goto(base);await page.evaluate(async now=>{
   Date.now=()=>now;window.store=await import('/chat-store.js');window.p=await import('/peer-crypto.js');
   window.courier=await import('/nearby-courier.js');window.outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox;
   window.inbox=await import('/intents-courier.js');
  },now);}
  for(const [i,page]of pages.entries()){await boot(page);profiles.push(await page.evaluate(async name=>{await store.updateState(async s=>{s.identity=await p.createIdentity(name);});return(await store.readState()).identity.profile;},['Owner','Courier','Executor'][i]));}
  for(const page of pages)await page.evaluate(async profiles=>{await store.updateState(s=>{s.contacts=profiles.filter(p=>p.id!==s.identity.profile.id);});await courier.setCourierEnabled(true);},profiles);
  const [sender,carrier,executor]=pages;
  const approval=await sender.evaluate(async x=>{const row=await outbox.queue(x.offer,x.signed,x.executor),packet=await outbox.handoff(row.id);return {row,packet};},{offer,signed,executor:profiles[2]});
  const enable=()=>executor.evaluate(x=>inbox.setConfidentialInboxEnabled(true,[x]),{sender:profiles[0].id,owner});
  const hop=async(from,to,author,recipient)=>{const item=await from.evaluate(id=>courier.courierHandoff(id),recipient.id);assert(item,'Expected queued courier item');await to.evaluate(x=>courier.receiveCourierPacket(x.author,x.packet),{author:author.id,packet:item.packet});return item;};
  await run({contexts,pages,sender,carrier,executor,profiles,approval,offer,signed,owner,enable,hop,boot});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}

test('private approval crosses a restarted courier and returns an authenticated storage receipt without settling funds',()=>fixture(async f=>{
 const {sender,carrier,executor,profiles,approval,enable,hop,boot,contexts}=f;
 await enable();await sender.evaluate(x=>courier.queueCourierItems([x.id],x.via),{id:approval.packet.id,via:profiles[1].id});
 await hop(sender,carrier,profiles[0],profiles[1]);await sender.close();await boot(carrier);
 for(const context of contexts)await context.setOffline(true);
 await hop(carrier,executor,profiles[1],profiles[2]);await hop(carrier,executor,profiles[1],profiles[2]);
 const received=await executor.evaluate(()=>inbox.confidentialInboxSummary());assert.equal(received.requests.length,1);assert.equal(received.requests[0].id,approval.row.id);assert.equal(received.requests[0].settlementVerified,false);
 const carrierState=await carrier.evaluate(()=>store.readState());assert(!JSON.stringify(carrierState).includes(f.signed.signature));assert(!JSON.stringify(carrierState).includes(f.owner));
 await hop(executor,carrier,profiles[2],profiles[1]);
 await contexts[0].setOffline(false);const reopened=await contexts[0].newPage();await boot(reopened);await contexts[0].setOffline(true);
 await hop(carrier,reopened,profiles[1],profiles[0]);
 const after=await reopened.evaluate(()=>outbox.list());assert.equal(after.length,1);assert.equal(after[0].status,'executor-reported-stored');assert.equal(after[0].settlementVerified,false);
 assert.equal((await reopened.evaluate(()=>courier.courierSummary())).outgoing[0].status,'received');
}));

async function prepared(f){
 await f.sender.evaluate(x=>courier.queueCourierItems([x.id],x.via),{id:f.approval.packet.id,via:f.profiles[1].id});
 await f.hop(f.sender,f.carrier,f.profiles[0],f.profiles[1]);
 return f.carrier.evaluate(id=>courier.courierHandoff(id),f.profiles[2].id);
}
const deliver=(f,item)=>f.executor.evaluate(x=>courier.receiveCourierPacket(x.author,x.packet),{author:f.profiles[1].id,packet:item.packet});

test('private request intake requires explicit receiver consent and a previously approved sender-owner pair',()=>fixture(async f=>{
 const item=await prepared(f);
 await assert.rejects(deliver(f,item),/not receiving private approvals/);
 await f.executor.evaluate(x=>inbox.setConfidentialInboxEnabled(true,[x]),{sender:f.profiles[0].id,owner:'0x'+'33'.repeat(20)});
 await assert.rejects(deliver(f,item),/not been approved/);
 await f.enable();await f.executor.evaluate(async()=>{await store.updateState(s=>{s.identity.access='lenz/recovered-chat/v1';});});
 await assert.rejects(deliver(f,item),/Offline funds are not restored/);
 assert.equal((await f.executor.evaluate(()=>inbox.confidentialInboxSummary())).requests.length,0);
 assert.equal((await f.executor.evaluate(()=>courier.courierSummary())).outgoing.length,0);
}));

test('failed inbox commit saves neither the request nor its receipt route; retries admit it once',()=>fixture(async f=>{
 await f.enable();const item=await prepared(f);
 const result=await f.executor.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw Error('Storage full');};let error='';
  try{await courier.receiveCourierPacket(x.author,x.packet);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,received:await inbox.confidentialInboxSummary(),couriers:await courier.courierSummary()};
 },{author:f.profiles[1].id,packet:item.packet});
 assert.match(result.error,/Storage full/);assert.equal(result.received.requests.length,0);assert.equal(result.couriers.outgoing.length,0);
 await deliver(f,item);await deliver(f,item);assert.equal((await f.executor.evaluate(()=>inbox.confidentialInboxSummary())).requests.length,1);
}));

test('a valid second owner signature cannot replace a stored approval using the same nonce',()=>fixture(async f=>{
 await f.enable();const item=await prepared(f);await deliver(f,item);
 const {signQuote,wallet,owner}=await import('./intents-spend-fixture.mjs'),{confidentialSignedData}=await import('./public/intents-spend.js');
 const changed=structuredClone(f.offer),payload=JSON.parse(changed.generated.intent.payload);
 changed.quote.quote.depositAddress='cd'.repeat(32);signQuote(changed.quote);payload.intents[0].receiver_id=changed.quote.quote.depositAddress;changed.generated.intent.payload=JSON.stringify(payload);
 const signed=confidentialSignedData(changed.generated.intent.payload,await wallet.signMessage(changed.generated.intent.payload),owner);
 const inner=await f.sender.evaluate(async x=>{
  const id=await(await import('/intents-spend-outbox.js')).confidentialApprovalId(x.offer.generated.intent.payload),s=await store.readState();
  const packet=await p.sealMessage(s.identity,x.peer,{type:'lenz/private-spend/v1',id,offer:x.offer,signedData:x.signed});
  return(await import('/carrier-protocol.js')).wrapForCarrier(s.identity,packet);
 },{offer:changed,signed,peer:f.profiles[2]});
 const forged=await f.carrier.evaluate(async x=>({packet:await p.sealMessage((await store.readState()).identity,x.peer,{kind:courier.COURIER,operation:'deliver',envelope:x.inner})}),{peer:f.profiles[2],inner});
 await assert.rejects(deliver(f,forged),/Conflicting private nonce/);
 const rows=(await f.executor.evaluate(()=>inbox.confidentialInboxSummary())).requests;assert.equal(rows.length,1);assert.equal(rows[0].id,f.approval.row.id);
}));

test('expiry while saving the request or return route rolls back both records',()=>fixture(async f=>{
 await f.enable();const item=await prepared(f);
 for(const target of ['lenz/private-spend-inbox/v1','lenz/nearby-courier/v1']){
  const result=await f.executor.evaluate(async x=>{
   const encrypt=crypto.subtle.encrypt.bind(crypto.subtle),now=Date.now;let error='';
   crypto.subtle.encrypt=async(...args)=>{const value=await encrypt(...args);if(new TextDecoder().decode(args[0].additionalData).includes(x.target))Date.now=()=>now()+3600001;return value;};
   try{await courier.receiveCourierPacket(x.author,x.packet);}catch(e){error=e.message;}finally{crypto.subtle.encrypt=encrypt;Date.now=now;}
   return {error,requests:(await inbox.confidentialInboxSummary()).requests,routes:(await courier.courierSummary()).outgoing};
  },{author:f.profiles[1].id,packet:item.packet,target});
  assert.match(result.error,/expired/);assert.equal(result.requests.length,0);assert.equal(result.routes.length,0);
 }
}));

test('executor saves its submission attempt before dispatch and never repeats an unknown result after reopening',()=>fixture(async f=>{
 await f.enable();await deliver(f,await prepared(f));
 const first=await f.executor.evaluate(async id=>{
  let calls=0,observed;const result=await inbox.submitConfidentialRequest(id,async(offer,signed)=>{
   calls++;observed=(await inbox.confidentialInboxSummary()).requests[0].status;
   if(signed.payload!==offer.generated.intent.payload)throw Error('Different payload');
   throw Error('Reply lost after dispatch');
  });
  return {result,calls,observed};
 },f.approval.row.id);
 assert.equal(first.calls,1);assert.equal(first.observed,'submission-unknown');assert.equal(first.result.status,'submission-unknown');assert.equal(first.result.settlementVerified,false);
 await f.boot(f.executor);
 await assert.rejects(f.executor.evaluate(id=>inbox.submitConfidentialRequest(id,async()=>{throw Error('Must not dispatch again');}),f.approval.row.id),/already recorded/);
 assert.equal((await f.executor.evaluate(()=>inbox.confidentialInboxSummary())).requests[0].status,'submission-unknown');
}));

test('durable executor submission uses the exact connected adapter and records submission without crediting settlement',()=>fixture(async f=>{
 await f.enable();await deliver(f,await prepared(f));
 const {submitConfidentialSpend}=await import('../integrations/intents-spend.mjs'),{verifier,now}=await import('./intents-spend-fixture.mjs');let requests=0;
 await f.contexts[2].exposeBinding('connectedPrivateSubmit',async(_source,offer,signed)=>submitConfidentialSpend(offer,signed,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async(url,options)=>{
  requests++;assert.equal(url,'https://1click.chaindefuser.com/v0/submit-intent');
  assert.deepEqual(JSON.parse(options.body),{type:'swap_transfer',signedData:f.signed});return Response.json({intentHash:'2'.repeat(44)});
 }}));
 const result=await f.executor.evaluate(id=>inbox.submitConfidentialRequest(id,(offer,signed)=>connectedPrivateSubmit(offer,signed)),f.approval.row.id);
 assert.equal(requests,1);assert.equal(result.status,'submitted');assert.equal(result.intentHash,'2'.repeat(44));assert.equal(result.settlementVerified,false);
 await assert.rejects(f.executor.evaluate(id=>inbox.submitConfidentialRequest(id,()=>connectedPrivateSubmit()),f.approval.row.id),/already recorded/);
 assert.equal(requests,1);
}));

test('failed attempt persistence and cancellation before dispatch cannot send a financial request',()=>fixture(async f=>{
 await f.enable();await deliver(f,await prepared(f));
 const result=await f.executor.evaluate(async id=>{
  let calls=0,error='';const submit=async()=>{calls++;throw Error('Unexpected dispatch');},put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=()=>{throw Error('Storage full');};
  try{await inbox.submitConfidentialRequest(id,submit);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  const before=(await inbox.confidentialInboxSummary()).requests[0];
  const controller=new AbortController();
  IDBObjectStore.prototype.put=function(...args){const tx=this.transaction,complete=tx.oncomplete;tx.oncomplete=(...events)=>{complete.apply(tx,events);controller.abort();};return put.apply(this,args);};
  let cancelled;
  try{cancelled=await inbox.submitConfidentialRequest(id,submit,{signal:controller.signal});}finally{IDBObjectStore.prototype.put=put;}
  return {calls,error,before,cancelled};
 },f.approval.row.id);
 assert.equal(result.calls,0);assert.match(result.error,/Storage full/);assert.equal(result.before.status,'stored');assert.equal(result.cancelled.status,'not-submitted');
}));

test('a failed result save leaves an unknown attempt and cannot allow a second submission',()=>fixture(async f=>{
 await f.enable();await deliver(f,await prepared(f));
 const result=await f.executor.evaluate(async id=>{
  const put=IDBObjectStore.prototype.put;let calls=0,error='';
  try{await inbox.submitConfidentialRequest(id,async offer=>{
   calls++;IDBObjectStore.prototype.put=()=>{throw Error('Result storage full');};
   return {state:'submitted',intentHash:'2'.repeat(44),depositAddress:offer.quote.quote.depositAddress,settlementVerified:false};
  });}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  let blocked=false;try{await inbox.submitConfidentialRequest(id,async()=>{calls++;});}catch{blocked=true;}
  return {calls,error,blocked,rows:(await inbox.confidentialInboxSummary()).requests};
 },f.approval.row.id);
 assert.equal(result.calls,1);assert.match(result.error,/Result storage full/);assert(result.blocked);assert.equal(result.rows[0].status,'submission-unknown');
}));

test('a receipt arriving before final courier dispatch cancels the duplicate quietly',()=>fixture(async f=>{
 await f.enable();const incoming=await prepared(f);
 const pending=await f.sender.evaluate(id=>courier.courierHandoff(id),f.profiles[1].id);
 await deliver(f,incoming);await f.hop(f.executor,f.carrier,f.profiles[2],f.profiles[1]);await f.hop(f.carrier,f.sender,f.profiles[1],f.profiles[0]);
 const result=await f.sender.evaluate(async pending=>{let frames=0;const result=await courier.dispatchCourierItem(pending.id,pending.packet,()=>{frames++;});await result.delivery;return {frames,summary:await courier.courierSummary()};},pending);
 assert.equal(result.frames,0);assert.equal(result.summary.outgoing[0].status,'received');
}));

test('an immediate adapter rejection remains a handled unknown submission',()=>fixture(async f=>{
 await f.enable();await deliver(f,await prepared(f));const errors=[];f.executor.on('pageerror',e=>errors.push(e.message));
 const result=await f.executor.evaluate(id=>inbox.submitConfidentialRequest(id,()=>Promise.reject(Error('Synthetic transport refusal'))),f.approval.row.id);
 await f.executor.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
 assert.equal(result.status,'submission-unknown');assert.deepEqual(errors,[]);
}));
