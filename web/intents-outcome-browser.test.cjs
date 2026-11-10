const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');

async function fixture(run,{intake=true}={}){
 const {fixture,managerKey,wallet,owner,now}=await import('./intents-spend-fixture.mjs'),offer=fixture();
 const {confidentialSignedData}=await import('./public/intents-spend.js');
 const signed=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
 const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  if(file==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Private outcome fixture</title>');return;}
  res.setHeader('Content-Type','text/javascript');
  if(file==='/intents-vendor/quote.js'){res.end(`import {verifyQuoteSignature as verify} from '/fixture-quote.js';export const verifyQuoteSignature=q=>verify(q,${JSON.stringify(managerKey)});`);return;}
  try{res.end(await fs.readFile(path.join(__dirname,'public',file==='/fixture-quote.js'?'/intents-vendor/quote.js':file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const contexts=await Promise.all([0,1].map(()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),profiles=[];
  const base='http://127.0.0.1:'+server.address().port;
  async function boot(page){await page.goto(base);await page.evaluate(async time=>{
   window.testNow=time;Date.now=()=>window.testNow;window.store=await import('/chat-store.js');window.p=await import('/peer-crypto.js');window.transport=await import('/carrier-protocol.js');
   window.outbox=(await import('/intents-spend-outbox.js')).confidentialSpendOutbox;window.inbox=await import('/intents-courier.js');
  },now);}
  for(const [i,page]of pages.entries()){await boot(page);profiles.push(await page.evaluate(async name=>{await store.updateState(async s=>{s.identity=await p.createIdentity(name);});return(await store.readState()).identity.profile;},['Owner','Executor'][i]));}
  for(const page of pages)await page.evaluate(profiles=>store.updateState(s=>{s.contacts=profiles.filter(p=>p.id!==s.identity.profile.id);}),profiles);
  const [sender,executor]=pages;
  await executor.evaluate(policy=>inbox.setConfidentialInboxEnabled(true,[policy]),{sender:profiles[0].id,owner});
  const approval=await sender.evaluate(async x=>{const row=await outbox.queue(x.offer,x.signed,x.executor),packet=await outbox.handoff(row.id),envelope=await transport.wrapForCarrier((await store.readState()).identity,packet);return {row,envelope};},{offer,signed,executor:profiles[1]});
  if(intake){
   const receipt=await executor.evaluate(e=>store.updateState(s=>inbox.acceptConfidentialCourierEnvelope(s,e)),approval.envelope);
   await sender.evaluate(packet=>store.updateState(s=>outbox.acceptAcknowledgement(s,packet)),receipt.receipt);
  }
  const observation=(changes={})=>({type:'lenz/private-status/v1',depositAddress:offer.quote.quote.depositAddress,status:'SUCCESS',updatedAt:new Date(now+1000).toISOString(),observedAt:now+1000,amountIn:offer.terms.amount,amountOut:offer.terms.amount,refundedAmount:null,withdrawFee:'0',settlementVerified:false,providerReportSigned:false,...changes});
  const report=async(value=observation())=>executor.evaluate(x=>inbox.observeConfidentialRequest(x.id,async()=>x.value),{id:approval.row.id,value});
  const items=()=>executor.evaluate(async()=>inbox.confidentialCourierItems(await store.readState()));
  const envelope=async(page,packet)=>page.evaluate(async packet=>transport.wrapForCarrier((await store.readState()).identity,packet),packet);
  const accept=async(page,packet)=>page.evaluate(e=>store.updateState(s=>inbox.acceptConfidentialCourierEnvelope(s,e)),packet);
  await run({sender,executor,contexts,profiles,approval,offer,signed,now,observation,report,items,envelope,accept,boot});
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('encrypted provider reports and storage receipts survive reopening without crediting settlement',()=>fixture(async f=>{
 const result=await f.report();assert.equal(result.observation.status,'SUCCESS');assert.equal(result.settlementVerified,false);
 const packet=(await f.items()).find(item=>item.kind==='private-report').packet;
 assert(!JSON.stringify(packet).includes(f.offer.terms.owner));assert(!JSON.stringify(packet).includes('SUCCESS'));
 await f.boot(f.executor);assert.deepEqual((await f.items()).find(item=>item.kind==='private-report').packet,packet);
 const received=await f.accept(f.sender,await f.envelope(f.executor,packet));assert(received.receipt);
 await f.boot(f.sender);const rows=await f.sender.evaluate(()=>outbox.list());
 assert.equal(rows[0].status,'provider-reported');assert.equal(rows[0].observation.status,'SUCCESS');assert.equal(rows[0].settlementVerified,false);
 await f.accept(f.executor,await f.envelope(f.sender,received.receipt));await f.boot(f.executor);
 const item=(await f.items()).find(item=>item.kind==='private-report');assert.equal(item.acknowledged,true);assert.equal(item.sendable,false);
 const duplicate=await f.accept(f.sender,await f.envelope(f.executor,packet));assert.deepEqual(duplicate.receipt,received.receipt);
}));

test('account replacement and policy removal during a read discard its late result',()=>fixture(async f=>{
 for(const mode of ['policy','account']){
  const result=await f.executor.evaluate(async x=>{
   let release,ready;const started=new Promise(resolve=>ready=resolve);
   const pending=inbox.observeConfidentialRequest(x.id,()=>{ready();return new Promise(resolve=>release=resolve);});
   const finished=pending.then(()=>'',e=>e.message);await started;
   if(x.mode==='policy')await inbox.setConfidentialInboxEnabled(false);
   else await store.updateState(async s=>{s.identity=await p.createIdentity('Replacement');delete s.privateInboxKey;delete s.privateInboxBox;});
   release(x.value);return {error:await finished,summary:await inbox.confidentialInboxSummary()};
  },{id:f.approval.row.id,value:f.observation(),mode});
  assert.match(result.error,/account changed|not enabled/);
  assert(result.summary.requests.every(row=>row.observation===null));
  if(mode==='policy')await f.executor.evaluate(policy=>inbox.setConfidentialInboxEnabled(true,[policy]),{sender:f.profiles[0].id,owner:f.offer.terms.owner});
 }
}));

test('cancellation during a report write aborts durable storage and preserves retry',()=>fixture(async f=>{
 const result=await f.executor.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put,controller=new AbortController();let error='',read=false;
  IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(read)controller.abort();return request;};
  try{await inbox.observeConfidentialRequest(x.id,async()=>{read=true;return x.value;},{signal:controller.signal});}catch(e){error=e.name;}finally{IDBObjectStore.prototype.put=put;}
  return {error,summary:await inbox.confidentialInboxSummary()};
 },{id:f.approval.row.id,value:f.observation()});
 assert.equal(result.error,'AbortError');assert.equal(result.summary.requests[0].observation,null);
 await f.report();assert((await f.items()).some(item=>item.kind==='private-report'));
}));

test('an old receipt cannot suppress a newer report and reader failure preserves it',()=>fixture(async f=>{
 await f.report(f.observation({status:'PROCESSING',amountIn:null,amountOut:null}));
 const old=(await f.items()).find(item=>item.kind==='private-report').packet;
 const received=await f.accept(f.sender,await f.envelope(f.executor,old));
 await f.report(f.observation({observedAt:f.now+2000,updatedAt:new Date(f.now+2000).toISOString()}));
 const latest=(await f.items()).find(item=>item.kind==='private-report').packet;
 await f.accept(f.executor,await f.envelope(f.sender,received.receipt));
 await assert.rejects(f.executor.evaluate(id=>inbox.observeConfidentialRequest(id,()=>Promise.reject(Error('Reader unavailable'))),f.approval.row.id),/unavailable/);
 const item=(await f.items()).find(item=>item.kind==='private-report');assert.equal(item.acknowledged,false);assert.deepEqual(item.packet,latest);
}));

test('report and receipt expiry during encryption roll back the whole transaction',()=>fixture(async f=>{
 await f.report();const packet=(await f.items()).find(item=>item.kind==='private-report').packet;
 async function expire(page,envelope,domain){return page.evaluate(async x=>{
  const encrypt=crypto.subtle.encrypt.bind(crypto.subtle),before=testNow;let error='';
  crypto.subtle.encrypt=async(...args)=>{const result=await encrypt(...args);if(new TextDecoder().decode(args[0].additionalData).includes(x.domain))testNow=x.envelope.expiresAt;return result;};
  try{await store.updateState(s=>inbox.acceptConfidentialCourierEnvelope(s,x.envelope));}catch(e){error=e.message;}finally{crypto.subtle.encrypt=encrypt;testNow=before;}
  return error;
 },{envelope,domain});}
 const envelope=await f.envelope(f.executor,packet);
 assert.match(await expire(f.sender,envelope,'lenz/private-spend-outbox/v1'),/expired/);
 assert.equal((await f.sender.evaluate(()=>outbox.list()))[0].observation,null);
 const receipt=(await f.accept(f.sender,envelope)).receipt;
 assert.match(await expire(f.executor,await f.envelope(f.sender,receipt),'lenz/private-spend-inbox/v1'),/expired/);
 assert.equal((await f.items()).find(item=>item.kind==='private-report').acknowledged,false);
}));

test('intake enforces opt-in and owner policy, persists once and retries after storage failure',()=>fixture(async f=>{
 await f.executor.evaluate(()=>inbox.setConfidentialInboxEnabled(false));
 await assert.rejects(f.accept(f.executor,f.approval.envelope),/not receiving/);
 await f.executor.evaluate(policy=>inbox.setConfidentialInboxEnabled(true,[policy]),{sender:f.profiles[0].id,owner:'0x'+'33'.repeat(20)});
 await assert.rejects(f.accept(f.executor,f.approval.envelope),/not been approved/);
 await f.executor.evaluate(policy=>inbox.setConfidentialInboxEnabled(true,[policy]),{sender:f.profiles[0].id,owner:f.offer.terms.owner});
 const failed=await f.executor.evaluate(async envelope=>{
  const put=IDBObjectStore.prototype.put;let error='';IDBObjectStore.prototype.put=()=>{throw Error('Intake storage full');};
  try{await store.updateState(s=>inbox.acceptConfidentialCourierEnvelope(s,envelope));}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,summary:await inbox.confidentialInboxSummary()};
 },f.approval.envelope);
 assert.match(failed.error,/storage full/);assert.equal(failed.summary.requests.length,0);
 const receipt=await f.accept(f.executor,f.approval.envelope);await f.boot(f.executor);
 assert.deepEqual((await f.accept(f.executor,f.approval.envelope)).receipt,receipt.receipt);
 assert.equal((await f.executor.evaluate(()=>inbox.confidentialInboxSummary())).requests.length,1);
},{intake:false}));

test('a changed signed approval cannot reuse an admitted nonce',()=>fixture(async f=>{
 const {signQuote,wallet,owner}=await import('./intents-spend-fixture.mjs'),{confidentialSignedData}=await import('./public/intents-spend.js');
 const offer=structuredClone(f.offer),payload=JSON.parse(offer.generated.intent.payload);
 offer.quote.quote.depositAddress='cd'.repeat(32);signQuote(offer.quote);payload.intents[0].receiver_id=offer.quote.quote.depositAddress;offer.generated.intent.payload=JSON.stringify(payload);
 const signed=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
 const packet=await f.sender.evaluate(async x=>{
  const id=await(await import('/intents-spend-outbox.js')).confidentialApprovalId(x.offer.generated.intent.payload);
  return p.sealMessage((await store.readState()).identity,x.peer,{type:'lenz/private-spend/v1',id,offer:x.offer,signedData:x.signed});
 },{offer,signed,peer:f.profiles[1]});
 await assert.rejects(f.accept(f.executor,await f.envelope(f.sender,packet)),/Conflicting private nonce/);
 assert.equal((await f.executor.evaluate(()=>inbox.confidentialInboxSummary())).requests[0].id,f.approval.row.id);
}));

test('submission persists before dispatch and a lost reply cannot be retried after restart',()=>fixture(async f=>{
 const result=await f.executor.evaluate(async id=>{
  let calls=0,atDispatch;const row=await inbox.submitConfidentialRequest(id,async()=>{calls++;atDispatch=(await inbox.confidentialInboxSummary()).requests[0].status;throw Error('Lost reply');});
  return {calls,atDispatch,row};
 },f.approval.row.id);
 assert.equal(result.calls,1);assert.equal(result.atDispatch,'submission-unknown');assert.equal(result.row.status,'submission-unknown');assert.equal(result.row.settlementVerified,false);
 await f.boot(f.executor);
 await assert.rejects(f.executor.evaluate(id=>inbox.submitConfidentialRequest(id,()=>{throw Error('Unexpected dispatch');}),f.approval.row.id),/already recorded/);
}));

test('failed attempt storage prevents dispatch and failed result storage retains an unknown attempt',()=>fixture(async f=>{
 const result=await f.executor.evaluate(async id=>{
  const put=IDBObjectStore.prototype.put;let calls=0,first='',second='';
  IDBObjectStore.prototype.put=()=>{throw Error('Attempt storage full');};
  try{await inbox.submitConfidentialRequest(id,()=>{calls++;});}catch(e){first=e.message;}finally{IDBObjectStore.prototype.put=put;}
  const before=(await inbox.confidentialInboxSummary()).requests[0];
  try{await inbox.submitConfidentialRequest(id,async offer=>{calls++;IDBObjectStore.prototype.put=()=>{throw Error('Result storage full');};return {state:'submitted',intentHash:'2'.repeat(44),depositAddress:offer.quote.quote.depositAddress,settlementVerified:false};});}catch(e){second=e.message;}finally{IDBObjectStore.prototype.put=put;}
  let blocked=false;try{await inbox.submitConfidentialRequest(id,()=>{calls++;});}catch{blocked=true;}
  return {calls,first,second,before,blocked,after:(await inbox.confidentialInboxSummary()).requests[0]};
 },f.approval.row.id);
 assert.equal(result.calls,1);assert.match(result.first,/Attempt storage full/);assert.equal(result.before.status,'stored');assert.match(result.second,/Result storage full/);assert(result.blocked);assert.equal(result.after.status,'submission-unknown');
}));

test('a reported deposit cannot trigger a fresh submission',()=>fixture(async f=>{
 await f.report();
 await f.report(f.observation({status:'PENDING_DEPOSIT',amountIn:null,amountOut:null,observedAt:f.now+2000,updatedAt:new Date(f.now+2000).toISOString()}));
 await f.boot(f.executor);
 const result=await f.executor.evaluate(async id=>{let calls=0,error='';try{await inbox.submitConfidentialRequest(id,async()=>{calls++;return {};});}catch(e){error=e.message;}return {calls,error};},f.approval.row.id);
 assert.equal(result.calls,0);assert.match(result.error,/report|deposit|reconcil/i);
}));

test('expired transport wrappers cannot deliver an otherwise valid report',()=>fixture(async f=>{
 await f.report();const packet=(await f.items()).find(item=>item.kind==='private-report').packet,old=await f.envelope(f.executor,packet);
 await f.sender.evaluate(time=>{window.testNow=time;},f.now+86400001);
 await assert.rejects(f.accept(f.sender,old),/expired|retention/i);
 assert.equal((await f.sender.evaluate(()=>outbox.list()))[0].observation,null);
}));

test('a delayed activity report still blocks submission when the newest status is pending',()=>fixture(async f=>{
 await f.report(f.observation({status:'PENDING_DEPOSIT',amountIn:null,amountOut:null,observedAt:f.now+2000,updatedAt:new Date(f.now+2000).toISOString()}));
 await f.report();await f.boot(f.executor);
 const result=await f.executor.evaluate(async id=>{let calls=0,error='';try{await inbox.submitConfidentialRequest(id,()=>{calls++;});}catch(e){error=e.message;}return {calls,error,summary:await inbox.confidentialInboxSummary()};},f.approval.row.id);
 assert.equal(result.calls,0);assert.match(result.error,/reported activity/);assert.equal(result.summary.requests[0].observation.status,'PENDING_DEPOSIT');
}));

test('conflicting activity blocks submission after reopening without replacing the saved report',()=>fixture(async f=>{
 await f.report(f.observation({status:'PENDING_DEPOSIT',amountIn:null,amountOut:null,withdrawFee:null}));
 const packet=(await f.items()).find(item=>item.kind==='private-report').packet;
 await assert.rejects(f.report(f.observation({observedAt:f.now+2000})),/Conflicting/);
 await f.boot(f.executor);
 assert.deepEqual((await f.items()).find(item=>item.kind==='private-report').packet,packet);
 const result=await f.executor.evaluate(async id=>{let calls=0,error='';try{await inbox.submitConfidentialRequest(id,()=>{calls++;});}catch(e){error=e.message;}return {calls,error};},f.approval.row.id);
 assert.equal(result.calls,0);assert.match(result.error,/reported activity/);
}));

test('repeated reads keep one packet and delayed reports cannot replace newer results',()=>fixture(async f=>{
 const first=f.observation({status:'PROCESSING',amountIn:null,amountOut:null,withdrawFee:null});await f.report(first);
 const old=(await f.items()).find(item=>item.kind==='private-report').packet;
 await f.report({...first,observedAt:first.observedAt+1000});assert.deepEqual((await f.items()).find(item=>item.kind==='private-report').packet,old);
 await f.report(f.observation({updatedAt:new Date(f.now+2000).toISOString(),observedAt:f.now+2000}));
 const latest=(await f.items()).find(item=>item.kind==='private-report').packet;
 await f.report(first);assert.deepEqual((await f.items()).find(item=>item.kind==='private-report').packet,latest);
 await assert.rejects(f.report(f.observation({status:'FAILED',updatedAt:new Date(f.now+2000).toISOString(),observedAt:f.now+3000})),/Conflicting/);
 const receipt=await f.accept(f.sender,await f.envelope(f.executor,latest));
 const stale=await f.accept(f.sender,await f.envelope(f.executor,old));assert.equal(stale.receipt,null);
 assert.equal((await f.sender.evaluate(()=>outbox.list()))[0].observation.status,'SUCCESS');
 assert.deepEqual((await f.accept(f.sender,await f.envelope(f.executor,latest))).receipt,receipt.receipt);
}));

test('reports and acknowledgements reject changed approval, deposit, evidence and timestamps',()=>fixture(async f=>{
 const report=await f.report(),base={type:'lenz/private-spend-report/v1',id:f.approval.row.id,observation:report.observation};
 for(const change of [{id:'cd'.repeat(32)},{extra:true},{observation:{...base.observation,depositAddress:'cd'.repeat(32)}},{observation:{...base.observation,settlementVerified:true}},{observation:{...base.observation,providerReportSigned:true}}]){
  const forged=await f.executor.evaluate(async x=>p.sealMessage((await store.readState()).identity,x.peer,x.value),{peer:f.profiles[0],value:{...base,...change}});
  await assert.rejects(f.accept(f.sender,await f.envelope(f.executor,forged)));
 }
 assert.equal((await f.sender.evaluate(()=>outbox.list()))[0].observation,null);
 const packet=(await f.items()).find(item=>item.kind==='private-report').packet,received=await f.accept(f.sender,await f.envelope(f.executor,packet));
 const badAck=await f.sender.evaluate(async x=>{
  const s=await store.readState(),value=await p.openMessage(s.identity,x.peer,x.receipt);value.acceptedAt=Date.now()+60001;return p.sealMessage(s.identity,x.peer,value);
 },{peer:f.profiles[1],receipt:received.receipt});
 await assert.rejects(f.accept(f.executor,await f.envelope(f.sender,badAck)),/receipt/);
 assert.equal((await f.items()).find(item=>item.kind==='private-report').acknowledged,false);
 await f.accept(f.executor,await f.envelope(f.sender,received.receipt));
 assert.equal((await f.items()).find(item=>item.kind==='private-report').acknowledged,true);
}));

test('failed report or receipt persistence releases no new packet and can be retried',()=>fixture(async f=>{
 const failed=await f.executor.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put;let error='';IDBObjectStore.prototype.put=()=>{throw Error('Report storage full');};
  try{await inbox.observeConfidentialRequest(x.id,async()=>x.value);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,items:await inbox.confidentialCourierItems(await store.readState())};
 },{id:f.approval.row.id,value:f.observation()});
 assert.match(failed.error,/storage full/);assert(!failed.items.some(item=>item.kind==='private-report'));
 await f.report();const packet=(await f.items()).find(item=>item.kind==='private-report').packet,envelope=await f.envelope(f.executor,packet);
 const failedReceipt=await f.sender.evaluate(async envelope=>{
  const put=IDBObjectStore.prototype.put;let error='';IDBObjectStore.prototype.put=()=>{throw Error('Receipt storage full');};
  try{await store.updateState(s=>inbox.acceptConfidentialCourierEnvelope(s,envelope));}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,rows:await outbox.list(),items:await outbox.courierItems(await store.readState())};
 },envelope);
 assert.match(failedReceipt.error,/storage full/);assert.equal(failedReceipt.rows[0].observation,null);assert(!failedReceipt.items.some(item=>item.kind==='private-report-receipt'));
 const received=await f.accept(f.sender,envelope);assert(received.receipt);assert.equal((await f.sender.evaluate(()=>outbox.list()))[0].observation.status,'SUCCESS');
}));

test('failed report persistence keeps submission blocked after reopening until reconciliation',()=>fixture(async f=>{
 const failed=await f.executor.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put;let read=false,error='';
  IDBObjectStore.prototype.put=function(...args){if(read)throw Error('Report storage full');return put.apply(this,args);};
  try{await inbox.observeConfidentialRequest(x.id,async()=>{read=true;return x.value;});}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {read,error};
 },{id:f.approval.row.id,value:f.observation()});
 assert(failed.read);assert.match(failed.error,/storage full/);await f.boot(f.executor);
 const blocked=await f.executor.evaluate(async id=>{let calls=0,error='';try{await inbox.submitConfidentialRequest(id,()=>{calls++;});}catch(e){error=e.message;}return {calls,error};},f.approval.row.id);
 assert.equal(blocked.calls,0);assert.match(blocked.error,/status check.*reconciliation/);
 await f.report();assert.equal((await f.executor.evaluate(()=>inbox.confidentialInboxSummary())).requests[0].statusCheckPending,false);
}));

test('cancelled and disabled status reads cannot publish a late provider result',()=>fixture(async f=>{
 const result=await f.executor.evaluate(async x=>{
  let calls=0;const already=new AbortController();already.abort();
  try{await inbox.observeConfidentialRequest(x.id,async()=>{calls++;return x.value;},{signal:already.signal});}catch{}
  const controller=new AbortController();let release,ready;const started=new Promise(resolve=>ready=resolve);
  const pending=inbox.observeConfidentialRequest(x.id,async()=>{calls++;ready();return new Promise(resolve=>release=resolve);},{signal:controller.signal});
  const stopped=pending.then(()=>false,()=>true);await started;controller.abort();release(x.value);
  const cancelled=await stopped;
  await inbox.setConfidentialInboxEnabled(false);let blocked=false;
  try{await inbox.observeConfidentialRequest(x.id,async()=>{calls++;return x.value;});}catch{blocked=true;}
  return {calls,cancelled,blocked,items:await inbox.confidentialCourierItems(await store.readState())};
 },{id:f.approval.row.id,value:f.observation()});
 assert.equal(result.calls,1);assert(result.cancelled);assert(result.blocked);assert(!result.items.some(item=>item.kind==='private-report'));
}));

test('concurrent reads serialize per approval and retain the newer provider update',()=>fixture(async f=>{
 const result=await f.executor.evaluate(async x=>{
  let release,ready;const started=new Promise(resolve=>ready=resolve),calls=[];
  const slow=inbox.observeConfidentialRequest(x.id,async()=>{ready();return new Promise(resolve=>release=resolve);});
  await started;const queued=inbox.observeConfidentialRequest(x.id,async()=>{calls.push('second');return x.newer;});
  const locks=await navigator.locks.query();const waiting=locks.pending.some(lock=>lock.name==='lenz/private-status/'+x.id);
  const early=calls.length;release(x.older);await slow;await queued;
  return {summary:await inbox.confidentialInboxSummary(),waiting,early,calls};
 },{id:f.approval.row.id,older:f.observation({status:'PROCESSING',amountIn:null,amountOut:null,withdrawFee:null}),newer:f.observation({observedAt:f.now+2000,updatedAt:new Date(f.now+2000).toISOString()})});
 assert(result.waiting);assert.equal(result.early,0);assert.deepEqual(result.calls,['second']);
 assert.equal(result.summary.requests[0].observation.status,'SUCCESS');
 assert.equal(result.summary.requests[0].observation.updatedAt,new Date(f.now+2000).toISOString());
}));

test('expired approvals can return reports and saved observations survive a backward clock change',()=>fixture(async f=>{
 const later=f.now+5*86400000;
 for(const page of [f.sender,f.executor])await page.evaluate(time=>{window.testNow=time;},later);
 await f.report(f.observation({observedAt:later,updatedAt:new Date(later).toISOString()}));
 const packet=(await f.items()).find(item=>item.kind==='private-report').packet;
 const received=await f.accept(f.sender,await f.envelope(f.executor,packet));await f.accept(f.executor,await f.envelope(f.sender,received.receipt));
 await f.boot(f.sender);await f.boot(f.executor);
 assert.equal((await f.sender.evaluate(()=>outbox.list()))[0].observation.observedAt,later);
 assert.equal((await f.items()).find(item=>item.kind==='private-report').acknowledged,true);
 assert.equal((await f.sender.evaluate(()=>outbox.list()))[0].settlementVerified,false);
}));

test('a full approval journal retains room for every admitted report and receipt',()=>fixture(async f=>{
 const {wallet,owner}=await import('./intents-spend-fixture.mjs'),{confidentialSignedData}=await import('./public/intents-spend.js');
 const rows=[f.approval.row];let full='';
 for(let i=1;i<=32;i++){
  const offer=structuredClone(f.offer),payload=JSON.parse(offer.generated.intent.payload),nonce=Buffer.from(payload.nonce,'base64');
  nonce[31]=i;payload.nonce=nonce.toString('base64');offer.generated.intent.payload=JSON.stringify(payload);
  const signed=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
  // Smaller valid metadata fills the space left after a large request is refused.
  let admitted=false;
  for(const size of [60000,30000,10000,1000,0]){
   offer.quote.metadata='x'.repeat(size);
   try{rows.push(await f.sender.evaluate(x=>outbox.queue(x.offer,x.signed,x.peer),{offer,signed,peer:f.profiles[1]}));admitted=true;break;}catch(e){full=e.message;}
  }
  if(!admitted)break;
 }
 assert.match(full,/storage is full/);assert(rows.length>1&&rows.length<32);
 for(const row of rows){
  const packet=await f.executor.evaluate(async x=>p.sealMessage((await store.readState()).identity,x.peer,{type:'lenz/private-spend-report/v1',id:x.id,observation:x.value}),{peer:f.profiles[0],id:row.id,value:f.observation()});
  assert((await f.accept(f.sender,await f.envelope(f.executor,packet))).receipt);
 }
 await f.boot(f.sender);
 const saved=await f.sender.evaluate(()=>outbox.list());assert.equal(saved.length,rows.length);assert(saved.every(row=>row.observation?.status==='SUCCESS'&&row.settlementVerified===false));
 const receipts=await f.sender.evaluate(async()=>(await outbox.courierItems(await store.readState())).filter(item=>item.kind==='private-report-receipt'));
 assert.equal(receipts.length,rows.length);
}));
