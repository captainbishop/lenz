// Disposable browser state; real IndexedDB, Web Locks and WebCrypto.
const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');

async function harness(fn){
 const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  for(const [k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  res.setHeader('Content-Type',file==='/'?'text/html':'text/javascript');
  if(file==='/'){res.end('<!doctype html><title>Offline budget test</title>');return;}
  try{res.end(await fs.readFile(file==='/offline-budget-outbox.js'&&process.env.LENZ_BUDGET_OUTBOX_SOURCE?process.env.LENZ_BUDGET_OUTBOX_SOURCE:path.join(__dirname,'public',file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const context=await browser.newContext(),page=await context.newPage(),base='http://127.0.0.1:'+server.address().port;
  async function boot(p){await p.goto(base);await p.evaluate(async()=>{
   window.store=await import('/chat-store.js');window.cryptoProtocol=await import('/peer-crypto.js');
   window.budget=await import('/offline-budget.js');window.outbox=await import('/offline-budget-outbox.js');
   window.carrier=await import('/carrier-protocol.js');
  });}
  await boot(page);
  await page.evaluate(async()=>{
   const secret=crypto.getRandomValues(new Uint8Array(32)),executor=await cryptoProtocol.createIdentity('Executor');
   const domain={name:'LenzOfflineBudget',version:'1',chainId:'31337',verifyingContract:'0x'+'12'.repeat(20)},data='0x12345678';
   const order={budgetId:'1',nonce:'0',amount:'123',minOutput:'100',fee:'1',feeRecipient:'0x'+'34'.repeat(20),deadline:String(Math.floor(Date.now()/1000)+3600),dataHash:budget.budgetCallHash(data),privacyPolicy:budget.PUBLIC_BUDGET_REHEARSAL};
   window.fixture={secret,executor,packet:{type:'lenz/offline-budget/v1',domain,order,data,signature:budget.signBudgetOrder(secret,domain,order)},expected:{domain,signer:budget.offlineSignerAddress(secret),budgetId:'1',privacyPolicy:budget.PUBLIC_BUDGET_REHEARSAL}};
   await store.updateState(async s=>{s.identity=await cryptoProtocol.createIdentity('Offline user');s.carrier={enabled:true};s.contacts=[executor.profile];s.messages=[{text:'Keep this history'}];});
   window.queue=()=>outbox.queueOfflineBudget(fixture.packet,fixture.expected,executor.profile,{publicRehearsalConsent:true});
  });
  await fn({page,context,boot});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}

test('offline queue survives reload, keeps ciphertext and never changes wallet funds',()=>harness(async({page,context,boot})=>{
 const requests=[];page.on('request',r=>requests.push(r.url()));await context.setOffline(true);
 const before=await page.evaluate(async()=>JSON.stringify(await store.readState()));
 const row=await page.evaluate(()=>queue());assert.equal(row.debit,'124');assert.equal(row.status,'queued');assert.equal(row.executable,false);
 const envelope=await page.evaluate(id=>outbox.offlineBudgetHandoff(id),row.id);
 assert.equal(requests.length,0);assert(!JSON.stringify(envelope).includes('minOutput'));
 const stored=await page.evaluate(async()=>{const s=await store.readState();return {encrypted:JSON.stringify(s),extractable:s.offlineBudgetKey.extractable};});
 assert.equal(stored.extractable,false);assert(!stored.encrypted.includes('minOutput'));assert(!stored.encrypted.includes('feeRecipient'));
 await context.setOffline(false);await boot(page);
 assert.deepEqual(await page.evaluate(()=>outbox.listOfflineBudgets()),[row]);
 assert.deepEqual(await page.evaluate(id=>outbox.offlineBudgetHandoff(id),row.id),envelope);
 const after=await page.evaluate(async()=>{const s=await store.readState();delete s.offlineBudgetBox;delete s.offlineBudgetKey;return JSON.stringify(s);});
 assert.equal(after,before);
}));

test('additional carrier destinations cannot corrupt a saved authorization',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const row=await queue(),post=async(origin,route,e)=>({type:carrier.CARRIER_DOMAIN,id:e.id,status:'stored',expiresAt:e.expiresAt});
  await outbox.sendOfflineBudget(row.id,{version:1,carriers:[1,2,3,4].map(n=>'https://carrier'+n+'.example')},{post});
  let error='';try{await outbox.sendOfflineBudget(row.id,{version:1,carriers:['https://carrier5.example']},{post});}catch(e){error=e.message;}
  return {error,rows:await outbox.listOfflineBudgets()};
 });
 assert.match(result.error,/four|4|carrier/i);assert.equal(result.rows.length,1);assert.equal(result.rows[0].status,'carrier-stored');
}));

test('concurrent conflicting authorizations reserve one nonce and retries keep original terms',()=>harness(async({page,context,boot})=>{
 const other=await context.newPage();await boot(other);
 const shared=await page.evaluate(()=>({packet:fixture.packet,expected:fixture.expected,peer:fixture.executor.profile}));
 const alternative=await page.evaluate(()=>{const p=structuredClone(fixture.packet);p.order.amount='124';p.signature=budget.signBudgetOrder(fixture.secret,p.domain,p.order);return p;});
 const queue=(p,packet)=>p.evaluate(x=>outbox.queueOfflineBudget(x.packet,x.expected,x.peer,{publicRehearsalConsent:true}),{...shared,packet});
 const outcomes=await Promise.allSettled([queue(page,shared.packet),queue(other,alternative)]);
 assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.match(outcomes.find(x=>x.status==='rejected').reason.message,/nonce is already reserved/);
 const rows=await page.evaluate(()=>outbox.listOfflineBudgets());assert.equal(rows.length,1);
 const winner=outcomes[0].status==='fulfilled'?shared.packet:alternative;
 assert.deepEqual(await queue(other,winner),rows[0]);
 await assert.rejects(page.evaluate(async x=>outbox.queueOfflineBudget(x.packet,x.expected,(await cryptoProtocol.createIdentity('Different executor')).profile,{publicRehearsalConsent:true}),{packet:winner,expected:shared.expected}),/different delivery terms/);
}));

test('private policy, changed terms and missing delivery consent fail before disclosure',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const errors=[];
  for(const attempt of [()=>outbox.queueOfflineBudget(fixture.packet,fixture.expected,fixture.executor.profile),()=>outbox.queueOfflineBudget(fixture.packet,{...fixture.expected,privacyPolicy:'0x'+'ab'.repeat(32)},fixture.executor.profile,{publicRehearsalConsent:true}),()=>outbox.queueOfflineBudget({...fixture.packet,order:{...fixture.packet.order,amount:'999'}},fixture.expected,fixture.executor.profile,{publicRehearsalConsent:true})]){
   try{await attempt();}catch(e){errors.push(e.message);}
  }
  const row=await queue();await store.updateState(s=>{s.carrier.enabled=false;});let posts=0;
  try{await outbox.sendOfflineBudget(row.id,{version:1,carriers:['https://carrier.example']},{post:async()=>{posts++;}});}catch(e){errors.push(e.message);}
  return {errors,posts,rows:await outbox.listOfflineBudgets()};
 });
 assert.equal(result.errors.length,4);assert.equal(result.posts,0);assert.equal(result.rows[0].status,'queued');
}));

test('failed durable saves expose no handoff and retries preserve the same envelope',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const original=IDBObjectStore.prototype.put;let failure='';
  IDBObjectStore.prototype.put=function(){throw new DOMException('Storage full','QuotaExceededError');};
  try{await queue();}catch(e){failure=e.message;}finally{IDBObjectStore.prototype.put=original;}
  const empty=await outbox.listOfflineBudgets(),row=await queue();let posts=0,deliveryError='';
  IDBObjectStore.prototype.put=function(){throw new DOMException('Storage full','QuotaExceededError');};
  try{await outbox.sendOfflineBudget(row.id,{version:1,carriers:['https://carrier.example']},{post:async()=>{posts++;}});}catch(e){deliveryError=e.message;}finally{IDBObjectStore.prototype.put=original;}
  const first=await outbox.offlineBudgetHandoff(row.id),retry=await outbox.offlineBudgetHandoff(row.id);
  return {failure,empty,posts,deliveryError,first,retry};
 });
 assert.match(result.failure,/Storage full/);assert.deepEqual(result.empty,[]);assert.equal(result.posts,0);assert.match(result.deliveryError,/Storage full/);assert.deepEqual(result.first,result.retry);
}));

test('executor acknowledgements authenticate storage only and never settle funds',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const row=await queue(),s=await store.readState(),before={identity:s.identity.profile,contacts:s.contacts,messages:s.messages},errors=[];
  const ack={type:'lenz/budget-ack/v1',digest:row.id,acceptedAt:Date.now()};
  const forged=await cryptoProtocol.createIdentity('Unchosen executor');
  for(const [peer,payload]of [[forged,ack],[fixture.executor,{...ack,digest:'0x'+'00'.repeat(32)}],[fixture.executor,{...ack,type:'settled'}],[fixture.executor,{...ack,credit:'100'}],[fixture.executor,{...ack,acceptedAt:Date.now()+120000}]]){
   try{await outbox.recordOfflineBudgetAck(row.id,await cryptoProtocol.sealMessage(peer,s.identity.profile,payload));}catch(e){errors.push(e.message);}
  }
  const confirmed=await outbox.recordOfflineBudgetAck(row.id,await cryptoProtocol.sealMessage(fixture.executor,s.identity.profile,ack));
  const state=await store.readState(),after={identity:state.identity.profile,contacts:state.contacts,messages:state.messages};
  return {errors,confirmed,before,after,keys:Object.keys(state).sort()};
 });
 assert.equal(result.errors.length,5);assert.equal(result.confirmed.status,'executor-stored');assert.equal(result.confirmed.executable,false);assert.deepEqual(result.before,result.after);
 assert.deepEqual(result.keys,['carrier','contacts','identity','messages','offlineBudgetBox','offlineBudgetKey']);
}));

test('expired authorizations remain unresolved and block conflicting replacements',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  const row=await queue(),realNow=Date.now,errors=[];Date.now=()=>Number(fixture.packet.order.deadline)*1000+1;
  try{
   const expired=await outbox.listOfflineBudgets();
   try{await outbox.offlineBudgetHandoff(row.id);}catch(e){errors.push(e.message);}
   const replacement=structuredClone(fixture.packet);replacement.order.deadline=String(Number(replacement.order.deadline)+3600);replacement.signature=budget.signBudgetOrder(fixture.secret,replacement.domain,replacement.order);
   try{await outbox.queueOfflineBudget(replacement,fixture.expected,fixture.executor.profile,{publicRehearsalConsent:true});}catch(e){errors.push(e.message);}
   return {expired,errors};
  }finally{Date.now=realNow;}
 });
 assert.equal(result.expired[0].status,'expired-unresolved');assert.equal(result.expired[0].executable,false);assert.match(result.errors[0],/expired/);assert.match(result.errors[1],/nonce is already reserved/);
}));

test('storage capacity refuses new packets before existing history becomes unreadable',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  let accepted=0,error='';
  const queueSized=async size=>{
   const packet=structuredClone(fixture.packet);packet.data='0x'+'12'.repeat(size);packet.order.dataHash=budget.budgetCallHash(packet.data);packet.order.nonce=String(accepted);packet.signature=budget.signBudgetOrder(fixture.secret,packet.domain,packet.order);
   await outbox.queueOfflineBudget(packet,fixture.expected,fixture.executor.profile,{publicRehearsalConsent:true});accepted++;
  };
  const size=async()=>(await store.readState()).offlineBudgetBox.ciphertext.length/2;
  await queueSized(4);const firstSize=await size();await queueSized(4);const overhead=await size()-firstSize-40;
  for(let i=0;i<25;i++){try{await queueSized(16384);}catch(e){error=e.message;break;}}
  // Adversarial capacity probe: call bytes occur in the packet and both copies
  // of its encrypted envelope. Try to leave only 20 bytes for later receipts.
  const tailSize=Math.min(16384,Math.floor((2000000-await size()-overhead-20)/10));
  if(tailSize>=4){try{await queueSized(tailSize);}catch(e){if(!/storage is full/.test(e.message))throw e;}}
  const rows=await outbox.listOfflineBudgets(),state=await store.readState(),origins=[1,2,3,4].map(n=>'https://'+String(n).repeat(63)+'.'+'a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(52)+'.com');
  const post=async(origin,route,e)=>({type:carrier.CARRIER_DOMAIN,id:e.id,status:'stored',expiresAt:e.expiresAt});
  for(const row of rows.slice(0,1)){
   await outbox.sendOfflineBudget(row.id,{version:1,carriers:origins},{post});
   await outbox.recordOfflineBudgetAck(row.id,await cryptoProtocol.sealMessage(fixture.executor,state.identity.profile,{type:'lenz/budget-ack/v1',digest:row.id,acceptedAt:Date.now()}));
  }
  return {accepted,error,count:rows.length,statuses:(await outbox.listOfflineBudgets()).map(r=>r.status)};
 });
 assert(result.accepted>0);assert.match(result.error,/full|large|capacity/);assert.equal(result.count,result.accepted);
 assert.equal(result.statuses[0],'executor-stored');
}));

test('carrier retention expiry does not strand a still-valid offline authorization',()=>harness(async({page})=>{
 const result=await page.evaluate(async()=>{
  fixture.packet.order.deadline=String(Math.floor(Date.now()/1000)+48*3600);fixture.packet.signature=budget.signBudgetOrder(fixture.secret,fixture.packet.domain,fixture.packet.order);
  const row=await queue(),first=await outbox.offlineBudgetHandoff(row.id),realNow=Date.now;
  const delivery={version:1,carriers:['https://carrier.example']},post=async(origin,route,e)=>({type:carrier.CARRIER_DOMAIN,id:e.id,status:'stored',expiresAt:e.expiresAt});
  await outbox.sendOfflineBudget(row.id,delivery,{post});
  Date.now=()=>first.createdAt+25*3600000;
  try{
   const expiredCustody=(await outbox.listOfflineBudgets())[0].status,before=(await store.readState()).offlineBudgetBox,put=IDBObjectStore.prototype.put;let failure='',posts=0;
   IDBObjectStore.prototype.put=function(){throw new DOMException('Storage full','QuotaExceededError');};
   try{await outbox.sendOfflineBudget(row.id,delivery,{post:async()=>{posts++;}});}catch(e){failure=e.message;}finally{IDBObjectStore.prototype.put=put;}
   const after=(await store.readState()).offlineBudgetBox;
   const retry=await outbox.offlineBudgetHandoff(row.id),later=await outbox.offlineBudgetHandoff(row.id);
   await carrier.validateEnvelope(retry);return {first,retry,later,rows:await outbox.listOfflineBudgets(),expiredCustody,before,after,failure,posts};
  }finally{Date.now=realNow;}
 });
 assert.deepEqual(result.retry.packet,result.first.packet);assert.equal(result.retry.id,result.first.id);assert(result.retry.expiresAt>result.first.expiresAt);assert.deepEqual(result.retry,result.later);assert.equal(result.rows.length,1);
 assert.equal(result.expiredCustody,'queued');assert.match(result.failure,/Storage full/);assert.equal(result.posts,0);assert.deepEqual(result.before,result.after);
}));
