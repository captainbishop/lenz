const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');

async function fixture(run){
 let offline=false;const offlineRequests=[];
 const server=http.createServer(async(req,res)=>{const file=new URL(req.url,'http://localhost').pathname;
  if(offline){offlineRequests.push(file);res.writeHead(503);res.end();return;}
  for(const[k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  if(file==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Budget courier test</title>');return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(await fs.readFile(file==='/budget-courier.js'&&process.env.LENZ_BUDGET_COURIER_SOURCE?process.env.LENZ_BUDGET_COURIER_SOURCE:path.join(__dirname,'public',file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const contexts=await Promise.all([0,1,2,3].map(()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),profiles=[];
  const init=page=>page.evaluate(async()=>{window.store=await import('/chat-store.js');window.p=await import('/peer-crypto.js');window.budget=await import('/offline-budget.js');window.outbox=await import('/offline-budget-outbox.js');window.courier=await import('/nearby-courier.js');window.inbox=await import('/budget-courier.js');});
  async function boot(page){await page.goto(base);await init(page);}
  for(const[i,page]of pages.entries()){await boot(page);profiles.push(await page.evaluate(async name=>{await store.updateState(async s=>{s.identity=await p.createIdentity(name);});return(await store.readState()).identity.profile;},['Sender','Courier','Executor','Replacement'][i]));}
  for(const page of pages)await page.evaluate(async profiles=>{await store.updateState(s=>{s.contacts=profiles.filter(p=>p.id!==s.identity.profile.id);});await courier.setCourierEnabled(true);},profiles);
  const[sender,carrier,executor,replacement]=pages;
  const approval=await sender.evaluate(async executor=>{
   const secret=crypto.getRandomValues(new Uint8Array(32)),domain={name:'LenzOfflineBudget',version:'1',chainId:'31337',verifyingContract:'0x'+'12'.repeat(20)},data='0x12345678';
   const order={budgetId:'1',nonce:'0',amount:'123',minOutput:'100',fee:'1',feeRecipient:'0x'+'34'.repeat(20),deadline:String(Math.floor(Date.now()/1000)+3600),dataHash:budget.budgetCallHash(data),privacyPolicy:budget.PUBLIC_BUDGET_REHEARSAL};
   window.fixture={secret,packet:{type:'lenz/offline-budget/v1',domain,order,data,signature:budget.signBudgetOrder(secret,domain,order)},expected:{domain,signer:budget.offlineSignerAddress(secret),budgetId:'1',privacyPolicy:budget.PUBLIC_BUDGET_REHEARSAL}};
   const row=await outbox.queueOfflineBudget(fixture.packet,fixture.expected,executor,{publicRehearsalConsent:true}),envelope=await outbox.offlineBudgetHandoff(row.id);return{row,envelope,expected:fixture.expected};
  },profiles[2]);
  const enable=()=>executor.evaluate(x=>inbox.setBudgetInboxEnabled(true,[{sender:x.sender,expected:x.expected}],{publicRehearsalConsent:true}),{sender:profiles[0].id,expected:approval.expected});
  const hop=async(from,to,author,recipient,exclude=[])=>{const handoff=await from.evaluate(x=>courier.courierHandoff(x.id,{exclude:x.exclude}),{id:recipient.id,exclude});assert(handoff,'Expected saved courier item');await to.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet),{from:author.id,packet:handoff.packet});return handoff;};
  await run({sender,carrier,executor,replacement,profiles,approval,contexts,boot,enable,hop,base,init,goOffline:()=>{offline=true;},offlineRequests});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}

test('bounded approval survives courier restart and returns a storage receipt without releasing its nonce',()=>fixture(async f=>{
 const{sender,carrier,executor,profiles,approval,contexts,boot,enable,hop}=f;
 await enable();const before=await sender.evaluate(()=>outbox.listOfflineBudgets());
 await sender.evaluate(x=>courier.queueCourierItems([x.id],x.via),{id:approval.envelope.packet.id,via:profiles[1].id});
 await hop(sender,carrier,profiles[0],profiles[1]);await sender.close();await boot(carrier);
 await hop(carrier,executor,profiles[1],profiles[2]);await hop(carrier,executor,profiles[1],profiles[2]);
 const received=await executor.evaluate(()=>inbox.budgetInboxSummary());assert.equal(received.requests.length,1);assert.equal(received.requests[0].id,approval.row.id);assert.equal(received.requests[0].status,'stored');
 const carrierState=await carrier.evaluate(()=>store.readState());assert(!JSON.stringify(carrierState).includes('minOutput'));assert(!JSON.stringify(carrierState).includes(approval.expected.signer));assert.equal(carrierState.offlineBudgetBox,undefined);
 await hop(executor,carrier,profiles[2],profiles[1]);const reopened=await contexts[0].newPage();await boot(reopened);await hop(carrier,reopened,profiles[1],profiles[0]);
 const after=await reopened.evaluate(()=>outbox.listOfflineBudgets());assert.deepEqual(after,[{...before[0],status:'executor-stored'}]);assert.equal(after[0].debit,'124');assert.equal(after[0].executable,false);
 assert.equal((await reopened.evaluate(()=>courier.courierSummary())).outgoing[0].status,'received');
 assert.equal((await executor.evaluate(()=>store.readState())).nearBox,undefined);
}));

async function prepared(f){
 await f.enable();await f.sender.evaluate(x=>courier.queueCourierItems([x.id],x.via),{id:f.approval.envelope.packet.id,via:f.profiles[1].id});
 await f.hop(f.sender,f.carrier,f.profiles[0],f.profiles[1]);
 return f.carrier.evaluate(id=>courier.courierHandoff(id),f.profiles[2].id);
}
async function deliver(f,next){return f.executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet),{from:f.profiles[1].id,packet:next.packet});}
async function forgedDelivery(f,change){
 const envelope=await f.sender.evaluate(async({peer,change})=>{const s=await store.readState(),packet=structuredClone(fixture.packet);Object.assign(packet.order,change);packet.signature=budget.signBudgetOrder(fixture.secret,packet.domain,packet.order);return(await import('/carrier-protocol.js')).wrapForCarrier(s.identity,await p.sealMessage(s.identity,peer,packet));},{peer:f.profiles[2],change});
 return f.carrier.evaluate(async x=>({packet:await p.sealMessage((await store.readState()).identity,x.peer,{kind:courier.COURIER,operation:'deliver',envelope:x.envelope})}),{peer:f.profiles[2],envelope});
}

test('recipient opt-in and independent signer policy cannot be supplied or bypassed by a courier',()=>fixture(async f=>{
 const next=await prepared(f),{executor,approval,profiles}=f;
 await executor.evaluate(()=>inbox.setBudgetInboxEnabled(false));await assert.rejects(deliver(f,next),/not receiving/);
 await assert.rejects(executor.evaluate(x=>inbox.setBudgetInboxEnabled(true,x),[{sender:profiles[0].id,expected:approval.expected}]),/explicit public/);
 await assert.rejects(executor.evaluate(x=>inbox.setBudgetInboxEnabled(true,x,{publicRehearsalConsent:true}),[{sender:profiles[0].id,expected:{...approval.expected,privacyPolicy:'0x'+'ab'.repeat(32)}}]),/Private/);
 await executor.evaluate(x=>inbox.setBudgetInboxEnabled(true,[{sender:x.sender,expected:x.expected}],{publicRehearsalConsent:true}),{sender:profiles[3].id,expected:approval.expected});
 await assert.rejects(deliver(f,next),/not been approved/);
 await executor.evaluate(x=>inbox.setBudgetInboxEnabled(true,[{sender:x.sender,expected:x.expected}],{publicRehearsalConsent:true}),{sender:profiles[0].id,expected:{...approval.expected,signer:'0x'+'56'.repeat(20)}});
 await assert.rejects(deliver(f,next),/signer differs/);
 assert.equal((await executor.evaluate(()=>inbox.budgetInboxSummary())).requests.length,0);assert.equal((await executor.evaluate(()=>courier.courierSummary())).outgoing.length,0);
}));

test('failed inbox commit rolls back the request and its return receipt; retry admits once',()=>fixture(async f=>{
 const next=await prepared(f);
 const result=await f.executor.evaluate(async x=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw Error('Disk full');};let error='';try{await courier.receiveCourierPacket(x.from,x.packet);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}return{error,inbox:await inbox.budgetInboxSummary(),couriers:await courier.courierSummary()};},{from:f.profiles[1].id,packet:next.packet});
 assert.match(result.error,/Disk full/);assert.equal(result.inbox.requests.length,0);assert.equal(result.couriers.outgoing.length,0);
 await deliver(f,next);await deliver(f,next);assert.equal((await f.executor.evaluate(()=>inbox.budgetInboxSummary())).requests.length,1);
}));

test('a fresh signature for the same economic nonce cannot replace the accepted request',()=>fixture(async f=>{
 const next=await prepared(f);await deliver(f,next);
 const before=await f.executor.evaluate(async()=>JSON.stringify((await store.readState()).budgetInboxBox));
 await assert.rejects(deliver(f,await forgedDelivery(f,{amount:'124'})),/Conflicting budget nonce/);
 assert.equal(await f.executor.evaluate(async()=>JSON.stringify((await store.readState()).budgetInboxBox)),before);
}));

test('expiry during inbox encryption or return-route sealing commits neither request nor receipt',()=>fixture(async f=>{
 const next=await prepared(f);
 for(const target of ['lenz/budget-device-inbox/v1','lenz/nearby-courier/v1']){
  const result=await f.executor.evaluate(async x=>{const encrypt=crypto.subtle.encrypt.bind(crypto.subtle),now=Date.now;let error='';crypto.subtle.encrypt=async(...args)=>{const result=await encrypt(...args);if(new TextDecoder().decode(args[0].additionalData).includes(x.target))Date.now=()=>now()+3600001;return result;};try{await courier.receiveCourierPacket(x.from,x.packet);}catch(e){error=e.message;}finally{crypto.subtle.encrypt=encrypt;Date.now=now;}return{error,inbox:await inbox.budgetInboxSummary(),couriers:await courier.courierSummary()};},{from:f.profiles[1].id,packet:next.packet,target});
  assert.match(result.error,/expired/);assert.equal(result.inbox.requests.length,0);assert.equal(result.couriers.outgoing.length,0);
 }
}));

test('expiry and pause block final dispatch while preserving the signed authorization',()=>fixture(async f=>{
 const{sender,profiles,approval}=f;
 await sender.evaluate(x=>courier.queueCourierItems([x.id],x.via),{id:approval.envelope.packet.id,via:profiles[1].id});
 const next=await sender.evaluate(id=>courier.courierHandoff(id),profiles[1].id);
 const result=await sender.evaluate(async next=>{const before=JSON.stringify((await store.readState()).offlineBudgetBox),now=Date.now;Date.now=()=>now()+3600001;let expired='',paused='',sent=0;try{await courier.dispatchCourierItem(next.id,next.packet,()=>sent++);}catch(e){expired=e.message;}finally{Date.now=now;}await courier.setCourierEnabled(false);try{await courier.dispatchCourierItem(next.id,next.packet,()=>sent++);}catch(e){paused=e.message;}return{expired,paused,sent,before,after:JSON.stringify((await store.readState()).offlineBudgetBox)};},next);
 assert.equal(result.sent,0);assert.match(result.expired,/stopped/);assert.match(result.paused,/stopped/);assert.equal(result.after,result.before);
}));

test('replacement courier returns the original receipt after expiry without settling or freeing the nonce',()=>fixture(async f=>{
 const next=await prepared(f);await deliver(f,next);await f.sender.close();
 const receipt=await f.executor.evaluate(async()=>{const s=await store.readState();return(await inbox.budgetCourierItems(s)).find(r=>r.kind==='budget-receipt').packet;});
 await f.executor.evaluate(async peer=>{const summary=await courier.courierSummary();await courier.forgetCourierItem(summary.outgoing[0].id);const future=Date.now()+3600001;Date.now=()=>future;const candidates=await courier.courierCandidates(peer);await courier.queueCourierItems(candidates[0].messageIds,peer);},f.profiles[3].id);
 await f.replacement.evaluate(()=>{const future=Date.now()+3600001;Date.now=()=>future;});await f.hop(f.executor,f.replacement,f.profiles[2],f.profiles[3]);
 const reopened=await f.contexts[0].newPage();await f.boot(reopened);await reopened.evaluate(()=>{const future=Date.now()+3600001;Date.now=()=>future;});await f.hop(f.replacement,reopened,f.profiles[3],f.profiles[0]);
 const rows=await reopened.evaluate(()=>outbox.listOfflineBudgets());assert.equal(rows.length,1);assert.equal(rows[0].status,'expired-unresolved');assert.equal(rows[0].debit,'124');assert.equal(rows[0].executable,false);
 assert.deepEqual(await f.executor.evaluate(async()=>{const s=await store.readState();return(await inbox.budgetCourierItems(s)).find(r=>r.kind==='budget-receipt').packet;}),receipt);
}));

test('per-sender inbox quota retains existing requests and refuses additional valid signatures',()=>fixture(async f=>{
 const next=await prepared(f);await deliver(f,next);
 for(let nonce=1;nonce<8;nonce++)await deliver(f,await forgedDelivery(f,{nonce:String(nonce)}));
 const before=await f.executor.evaluate(async()=>JSON.stringify((await store.readState()).budgetInboxBox));
 await assert.rejects(deliver(f,await forgedDelivery(f,{nonce:'8'})),/inbox is full/);
 assert.equal((await f.executor.evaluate(()=>inbox.budgetInboxSummary())).requests.length,8);assert.equal(await f.executor.evaluate(async()=>JSON.stringify((await store.readState()).budgetInboxBox)),before);
}));

test('a courier-signed fake receipt cannot acknowledge the selected executor or release its nonce',()=>fixture(async f=>{
 const{sender,carrier,profiles,approval}=f;
 const fake=await carrier.evaluate(async x=>{const s=await store.readState(),packet=await p.sealMessage(s.identity,x.peer,{type:'lenz/budget-ack/v1',digest:x.id,acceptedAt:Date.now()});return(await import('/carrier-protocol.js')).wrapForCarrier(s.identity,packet);},{peer:profiles[0],id:approval.row.id});
 await assert.rejects(sender.evaluate(envelope=>store.updateState(s=>inbox.acceptBudgetCourierEnvelope(s,envelope)),fake),/not found|direction/);
 assert.equal((await sender.evaluate(()=>outbox.listOfflineBudgets()))[0].status,'queued');
 const duplicate=await sender.evaluate(async peer=>{const changed=structuredClone(fixture.packet);changed.order.amount='124';changed.signature=budget.signBudgetOrder(fixture.secret,changed.domain,changed.order);try{await outbox.queueOfflineBudget(changed,fixture.expected,peer,{publicRehearsalConsent:true});return '';}catch(e){return e.message;}},profiles[2]);assert.match(duplicate,/nonce is already reserved/);
}));

async function until(page,predicate,arg){const end=Date.now()+30000;while(Date.now()<end){if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(50);}throw Error('Offline courier state did not arrive.');}
async function connect(a,b,ap,bp){
 await a.evaluate(async peer=>{window.budgetLink?.close();const errors=[];window.budgetErrors=errors;window.budgetLink=await(await import('/nearby-client.js')).nearbySession(peer,{onError:e=>errors.push(e.message)});},bp.id);
 await b.evaluate(async peer=>{window.budgetLink?.close();const errors=[];window.budgetErrors=errors;window.budgetLink=await(await import('/nearby-client.js')).nearbySession(peer,{onError:e=>errors.push(e.message)});},ap.id);
 const offer=await a.evaluate(()=>budgetLink.offer()),answer=await b.evaluate(code=>budgetLink.answer(code),offer);await a.evaluate(code=>budgetLink.finish(code),answer);
 for(const page of[a,b])await until(page,()=>budgetLink.connected);
}

test('real local connection carries the approval offline after sender departure and courier restart',()=>fixture(async f=>{
 let{sender,carrier,executor,profiles,approval,contexts,base,init}=f;const attempts=[];
 await f.enable();
 for(const page of[sender,carrier,executor]){await page.goto(base+'/money.html');await init(page);await page.evaluate(async()=>{await import('/nearby-client.js');await(await import('/save-offline.js')).saveOffline();});}
 for(const context of contexts.slice(0,3)){await context.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));await context.route('**/*',route=>{attempts.push(new URL(route.request().url()).pathname);return route.abort();});}
 f.goOffline();
 for(const page of[sender,carrier,executor]){assert((await page.reload()).fromServiceWorker());await init(page);}
 const before=await sender.evaluate(()=>outbox.listOfflineBudgets());
 await sender.evaluate(x=>courier.queueCourierItems([x.id],x.via),{id:approval.envelope.packet.id,via:profiles[1].id});
 await connect(sender,carrier,profiles[0],profiles[1]);await until(carrier,async()=>(await courier.courierSummary()).carried.length===1);
 await sender.close();assert((await carrier.reload()).fromServiceWorker());await init(carrier);
 assert.equal((await carrier.evaluate(()=>courier.courierSummary())).carried.length,1);
 await connect(carrier,executor,profiles[1],profiles[2]);await until(executor,async()=>(await inbox.budgetInboxSummary()).requests.length===1);await until(carrier,async()=>(await courier.courierSummary()).carried.length===2);
 const received=await executor.evaluate(async()=>JSON.stringify((await store.readState()).budgetInboxBox));
 await connect(carrier,executor,profiles[1],profiles[2]);await executor.evaluate(()=>budgetLink.sendCouriers());await carrier.evaluate(()=>budgetLink.sendCouriers());
 assert.equal(await executor.evaluate(async()=>JSON.stringify((await store.readState()).budgetInboxBox)),received);
 await carrier.evaluate(()=>budgetLink.close());await executor.evaluate(()=>budgetLink.close());
 sender=await contexts[0].newPage();assert((await sender.goto(base+'/money.html')).fromServiceWorker());await init(sender);
 await connect(carrier,sender,profiles[1],profiles[0]);await until(sender,async()=>(await outbox.listOfflineBudgets())[0]?.status==='executor-stored');
 assert.deepEqual(await sender.evaluate(()=>outbox.listOfflineBudgets()),[{...before[0],status:'executor-stored'}]);
 const summary=await sender.evaluate(()=>courier.courierSummary());assert.equal(summary.outgoing[0].purpose,'budget-approval');assert.equal(summary.outgoing[0].status,'received');
 for(const page of[sender,carrier])assert.deepEqual(await page.evaluate(()=>budgetErrors),[]);
 // The intentionally disconnected recipient may observe the remote channel closing.
 assert((await executor.evaluate(()=>budgetErrors)).every(message=>message==='Nearby connection failed. Your files stay saved.'));
 // Browsers may check either registered worker for updates after cold opening.
 // Every such request is blocked; application data and settlement stay offline.
 assert([...attempts,...f.offlineRequests].every(path=>['/chat-sw.js','/sw.js'].includes(path)),'Unexpected HTTP while offline: '+JSON.stringify([...attempts,...f.offlineRequests]));
}));
