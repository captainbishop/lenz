const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
const config={network:'testnet',ready:true,adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
async function fixture(run){
 const server=http.createServer(async(req,res)=>{const file=new URL(req.url,'http://localhost').pathname;
  for(const [key,value]of Object.entries(securityHeaders(file)))res.setHeader(key,value);
  if(file==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>DeFi courier test</title>');return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(__dirname,'public',file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const contexts=await Promise.all([0,1,2,3].map(()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),profiles=[];
  async function boot(page){await page.goto(base);await page.evaluate(async config=>{window.config=config;window.store=await import('/chat-store.js');window.p=await import('/peer-crypto.js');window.n=await import('/near-protocol.js');window.courier=await import('/nearby-courier.js');window.wallet=await import('/defi-wallet.js');},config);}
  for(const [i,page]of pages.entries()){await boot(page);profiles.push(await page.evaluate(async name=>{await store.updateState(async s=>{s.identity=await p.createIdentity(name);});return (await store.readState()).identity.profile;},['Sender','Courier','Executor','Replacement'][i]));}
  for(const page of pages)await page.evaluate(async profiles=>{await store.updateState(s=>{s.contacts=profiles.filter(p=>p.id!==s.identity.profile.id);});await courier.setCourierEnabled(true);},profiles);
  const [sender,carrier,executor,replacement]=pages;
  const approval=await sender.evaluate(async peer=>{
   await store.updateState(async s=>{const v=n.emptyNearVault(config.reserve),root=await n.fundingRequest(s.identity,config.reserve,'10');v.roots.push({id:root.id,owner:root.owner,amount:root.amount});await n.saveNearVault(s,v);});
   const deadlineMs=Date.now()+3600000,ref=await wallet.approveDefiSwap(config,peer,{text:'4',minOutput:'250000000000000000000000',receiver:'receiver.testnet',deadlineMs},{approvalId:p.randomId(),disclosure:(await import('/defi-request.js')).PUBLIC_TESTNET_DISCLOSURE,expiresAt:deadlineMs});
   const packet=await wallet.defiHandoff(config,ref.requestId);return {...ref,packet};
  },profiles[2]);
  const hop=async(from,to,author,recipient,exclude=[])=>{
   const handoff=await from.evaluate(x=>courier.courierHandoff(x.to,{contract:config.reserve,defiConfig:config,exclude:x.exclude}),{to:recipient.id,exclude});assert(handoff,'Expected a saved handoff');
   await to.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{contract:config.reserve,defiConfig:config}),{from:author.id,packet:handoff.packet});return handoff;
  };
  await run({sender,carrier,executor,replacement,profiles,approval,contexts,boot,hop});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}
test('DeFi intake waits for configuration before the user can enable receiving',()=>fixture(async({executor})=>{
 await executor.evaluate(async()=>{
  const dialog=document.createElement('dialog');dialog.innerHTML='<div id="nearby-courier"></div>';document.body.append(dialog);dialog.showModal();
  window.inboxConfig=null;window.inboxControls=(await import('/defi-courier-ui.js')).mountDefiInboxControls(dialog,{getConfig:()=>inboxConfig});
  dialog.querySelector('details').open=true;
 });
 assert(await executor.locator('#defi-inbox-enabled').isDisabled());
 await executor.evaluate(async()=>{inboxConfig=config;await inboxControls.refresh();});
 await executor.locator('#defi-inbox-enabled').check();
 await executor.waitForFunction(()=>document.querySelector('#defi-inbox-feedback').textContent==='Ready to receive swap requests.');
 assert.equal(await executor.evaluate(async()=>(await import('/defi-courier.js')).defiInboxSummary().then(s=>s.enabled)),true);
}));

test('saved DeFi approval crosses a restarted courier and returns storage proof without spending or releasing funds',()=>fixture(async({sender,carrier,executor,profiles,approval,contexts,boot,hop})=>{
 await sender.evaluate(x=>courier.queueCourierItems([x.id],x.peer,{contract:config.reserve,defiConfig:config}),{id:approval.packet.id,peer:profiles[1].id});
 await executor.evaluate(async()=>{window.inbox=await import('/defi-courier.js');await inbox.setDefiInboxEnabled(true,config);});
 const before=await sender.evaluate(async()=>n.readNearVault(await store.readState(),config.reserve));
 await hop(sender,carrier,profiles[0],profiles[1]);await sender.close();await boot(carrier);
 await hop(carrier,executor,profiles[1],profiles[2]);await hop(carrier,executor,profiles[1],profiles[2]);
 const received=await executor.evaluate(()=>inbox.defiInboxSummary());assert.equal(received.requests.length,1);assert.equal(received.requests[0].id,approval.requestId);assert.equal(received.requests[0].status,'stored');
 assert.equal((await executor.evaluate(()=>store.readState())).nearBox,undefined);
 await hop(executor,carrier,profiles[2],profiles[1]);
 const reopened=await contexts[0].newPage();await boot(reopened);await hop(carrier,reopened,profiles[1],profiles[0]);
 const after=await reopened.evaluate(async()=>n.readNearVault(await store.readState(),config.reserve));assert.equal(after.rheaOrders[0].defi.storageReceipt.requestId,approval.requestId);
 const withoutReceipt=structuredClone(after);withoutReceipt.rheaOrders[0].defi.storageReceipt=null;assert.deepEqual(withoutReceipt,before);
 assert.equal(after.rheaOrders[0].status,null);assert.equal((await reopened.evaluate(()=>courier.courierSummary({defiConfig:config}))).outgoing[0].status,'received');
}));
test('a changed DeFi route does not block unrelated saved chats',()=>fixture(async({sender,profiles})=>{
 const chat=await sender.evaluate(async peer=>store.updateState(async s=>{const packet=await p.sealMessage(s.identity,peer,{kind:'chat',text:'Independent offline message'});s.messages.push({packet});return packet.id;}),profiles[2]);
 const result=await sender.evaluate(async x=>{
  const options={defiConfig:{...config,poolId:config.poolId+1}};
  await courier.queueCourierItems([x.id],x.peer,options);return courier.courierSummary(options);
 },{id:chat,peer:profiles[1].id});assert.equal(result.outgoing.length,1);assert.equal(result.outgoing[0].messageId,chat);
}));

async function prepared(f){
 const {sender,carrier,executor,profiles,approval,hop}=f;
 await sender.evaluate(x=>courier.queueCourierItems([x.id],x.peer,{contract:config.reserve,defiConfig:config}),{id:approval.packet.id,peer:profiles[1].id});
 await executor.evaluate(async()=>{window.inbox=await import('/defi-courier.js');await inbox.setDefiInboxEnabled(true,config);});
 await hop(sender,carrier,profiles[0],profiles[1]);
 return carrier.evaluate(peer=>courier.courierHandoff(peer,{contract:config.reserve,defiConfig:config}),profiles[2].id);
}
test('recipient opt-in, wrong current route, and failed write preserve an empty inbox',()=>fixture(async f=>{
 const next=await prepared(f),{executor,profiles}=f,x={from:profiles[1].id,packet:next.packet};
 await executor.evaluate(()=>inbox.setDefiInboxEnabled(false));
 await assert.rejects(executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),x),/not receiving/);
 await executor.evaluate(()=>inbox.setDefiInboxEnabled(true,config));
 await assert.rejects(executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:{...config,poolId:config.poolId+1}}),x),/route changed/);
 const r=await executor.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw Error('Disk full');};let error='';
  try{await courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config});}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,inbox:await inbox.defiInboxSummary(),couriers:await courier.courierSummary({defiConfig:config}),box:(await store.readState()).nearBox};
 },x);
 assert.match(r.error,/Disk full/);assert.equal(r.inbox.requests.length,0);assert.equal(r.couriers.outgoing.length,0);assert.equal(r.box,undefined);
}));
test('approval expiry during inbox encryption rolls back inbox and return receipt',()=>fixture(async f=>{
 const next=await prepared(f),{executor,profiles}=f;
 const r=await executor.evaluate(async x=>{
  const encrypt=crypto.subtle.encrypt.bind(crypto.subtle),now=Date.now;let error='';
  crypto.subtle.encrypt=async(...args)=>{const out=await encrypt(...args);if(new TextDecoder().decode(args[0].additionalData).includes('lenz/defi-device-inbox/v1'))Date.now=()=>now()+3600001;return out;};
  try{await courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config});}catch(e){error=e.message;}finally{crypto.subtle.encrypt=encrypt;Date.now=now;}
  return {error,inbox:await inbox.defiInboxSummary(),couriers:await courier.courierSummary({defiConfig:config})};
 },{from:profiles[1].id,packet:next.packet});
 assert.match(r.error,/expired/);assert.equal(r.inbox.requests.length,0);assert.equal(r.couriers.outgoing.length,0);
}));
test('same economic input with a fresh signed request is rejected and original receipt retained',()=>fixture(async f=>{
 const next=await prepared(f),{sender,carrier,executor,profiles}=f;
 await executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),{from:profiles[1].id,packet:next.packet});
 const original=await executor.evaluate(async()=>JSON.stringify((await store.readState()).defiInboxBox));
 const envelope=await sender.evaluate(async()=>{
  const d=await import('/defi-request.js'),cp=await import('/carrier-protocol.js'),s=await store.readState(),v=await n.readNearVault(s,config.reserve),a=v.rheaOrders[0].defi;
  const request=await d.createDefiRequest(s.identity,a.executor,config,a.request.operation,{disclosure:a.request.disclosure,expiresAt:a.request.expiresAt-1});
  return cp.wrapForCarrier(s.identity,await d.sealDefiRequest(s.identity,a.executor,config,request));
 });
 const modified=await carrier.evaluate(async x=>{const s=await store.readState();return p.sealMessage(s.identity,x.peer,{kind:courier.COURIER,operation:'deliver',envelope:x.envelope});},{peer:profiles[2],envelope});
 await assert.rejects(executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),{from:profiles[1].id,packet:modified}),/Conflicting DeFi/);
 assert.equal(await executor.evaluate(async()=>JSON.stringify((await store.readState()).defiInboxBox)),original);
}));
test('replacement courier carries the exact stored receipt after approval expiry and sender departure',()=>fixture(async f=>{
 const next=await prepared(f),{sender,carrier,executor,replacement,profiles,contexts,boot,hop}=f;
 await executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),{from:profiles[1].id,packet:next.packet});
 const saved=await executor.evaluate(async()=>{const s=await store.readState();return (await (await import('/defi-courier.js')).defiCourierItems(s,config)).find(i=>i.kind==='defi-receipt').packet;});
 await sender.close();
 await executor.evaluate(async peer=>{const summary=await courier.courierSummary({defiConfig:config});await courier.forgetCourierItem(summary.outgoing[0].id);const future=Date.now()+3600001;Date.now=()=>future;const groups=await courier.courierCandidates(peer,{defiConfig:config});await courier.queueCourierItems(groups[0].messageIds,peer,{defiConfig:config});},profiles[3].id);
 await replacement.evaluate(()=>{const future=Date.now()+3600001;Date.now=()=>future;});
 await hop(executor,replacement,profiles[2],profiles[3]);const reopened=await contexts[0].newPage();await boot(reopened);
 await reopened.evaluate(()=>{const future=Date.now()+3600001;Date.now=()=>future;});await hop(replacement,reopened,profiles[3],profiles[0]);
 const received=await reopened.evaluate(async()=>{const v=await n.readNearVault(await store.readState(),config.reserve);return {receipt:v.rheaOrders[0].defi.storageReceipt,status:v.rheaOrders[0].status};});
 assert.equal(received.receipt.requestId,f.approval.requestId);assert.equal(received.status,null);
 const current=await executor.evaluate(async()=>{const s=await store.readState();return (await (await import('/defi-courier.js')).defiCourierItems(s,config)).find(i=>i.kind==='defi-receipt').packet;});assert.deepEqual(saved,current);
}));
test('known source conflict blocks queue and dispatch without releasing reservation',()=>fixture(async f=>{
 const {sender,profiles,approval}=f;
 await sender.evaluate(x=>courier.queueCourierItems([x.id],x.peer,{defiConfig:config}),{id:approval.packet.id,peer:profiles[1].id});
 const next=await sender.evaluate(peer=>courier.courierHandoff(peer,{defiConfig:config}),profiles[1].id);
 const r=await sender.evaluate(async next=>{
  await store.updateState(async s=>{const v=await n.readNearVault(s,config.reserve);v.chainConsumed={[v.rheaOrders[0].packet.instruction.input]:'f'.repeat(64)};await n.saveNearVault(s,v);});
  let dispatched=0,error='';try{await courier.dispatchCourierItem(next.id,next.packet,()=>{dispatched++;},{defiConfig:config});}catch(e){error=e.message;}
  const v=await n.readNearVault(await store.readState(),config.reserve);return {dispatched,error,reserved:(await n.nearLedger(v)).reserved.size};
 },next);assert.equal(r.dispatched,0);assert.match(r.error,/stopped/);assert.equal(r.reserved,1);
}));
test('approval expiry while sealing the return route rolls back inbox and receipt together',()=>fixture(async f=>{
 const next=await prepared(f),{executor,profiles}=f;
 const result=await executor.evaluate(async x=>{
  const encrypt=crypto.subtle.encrypt.bind(crypto.subtle),now=Date.now;let error='';
  crypto.subtle.encrypt=async(...args)=>{const out=await encrypt(...args);if(new TextDecoder().decode(args[0].additionalData).includes('lenz/nearby-courier/v1'))Date.now=()=>now()+3600001;return out;};
  try{await courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config});}catch(e){error=e.message;}finally{crypto.subtle.encrypt=encrypt;Date.now=now;}
  return {error,inbox:await inbox.defiInboxSummary(),couriers:await courier.courierSummary({defiConfig:config})};
 },{from:profiles[1].id,packet:next.packet});
 assert.match(result.error,/expired/);assert.equal(result.inbox.requests.length,0);assert.equal(result.couriers.outgoing.length,0);
}));
test('approval expiry during final dispatch verification cannot send the still-live carrier wrapper',()=>fixture(async({sender,profiles,approval})=>{
 const result=await sender.evaluate(async x=>{
  await courier.queueCourierItems([x.id],x.peer,{defiConfig:config});const next=await courier.courierHandoff(x.peer,{defiConfig:config}),s=await store.readState();
  const envelope=(await p.openMessage(s.identity,s.contacts.find(c=>c.id===x.peer),next.packet)).envelope;
  const v=await n.readNearVault(s,config.reserve),expiry=v.rheaOrders[0].defi.request.expiresAt,now=Date.now,verify=crypto.subtle.verify.bind(crypto.subtle);let matched=0,dispatched=0,error='';
  crypto.subtle.verify=async(...args)=>{if(p.hex(args[2])===envelope.signature&&++matched===2)Date.now=()=>expiry+1;return verify(...args);};
  try{await courier.dispatchCourierItem(next.id,next.packet,()=>{dispatched++;},{defiConfig:config});}catch(e){error=e.message;}finally{Date.now=now;crypto.subtle.verify=verify;}
  return {dispatched,error,reserved:(await n.nearLedger(await n.readNearVault(await store.readState(),config.reserve))).reserved.size};
 },{id:approval.packet.id,peer:profiles[1].id});assert.equal(result.dispatched,0);assert.match(result.error,/expired/);assert.equal(result.reserved,1);
}));

test('executor reviews the exact stored request and dispatches it once with a durable response-loss fence',()=>fixture(async f=>{
 const next=await prepared(f),{executor,profiles,approval,boot}=f;
 await executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),{from:profiles[1].id,packet:next.packet});
 const result=await executor.evaluate(async id=>{
  const review=await inbox.reviewDefiInboxRequest(config,id);let calls=0,error='';
  const invoke=async(operation,body)=>{calls++;if(operation!=='submit'||body.packet.id!==review.orderId)throw Error('Wrong reviewed request');throw Error('Response lost');};
  try{await inbox.submitDefiInboxRequest(config,id,review,{invoke});}catch(e){error=e.message;}
  await inbox.checkDefiInboxRequest(config,id,{invoke:async()=>({finality:'FINAL',order:null,reconciliation:{state:'unavailable'}})});
  try{await inbox.submitDefiInboxRequest(config,id,review,{invoke});}catch{}
  return {calls,error,summary:await inbox.defiInboxSummary()};
 },approval.requestId);
 assert.equal(result.calls,1);assert.match(result.error,/Response lost/);assert.equal(result.summary.requests[0].status,'submission-unresolved');
 await boot(executor);await executor.evaluate(()=>window.inbox=import('/defi-courier.js'));await executor.evaluate(async()=>window.inbox=await inbox);
 const again=await executor.evaluate(async id=>{let calls=0;try{const review=await inbox.reviewDefiInboxRequest(config,id);await inbox.submitDefiInboxRequest(config,id,review,{invoke:async()=>{calls++;}});}catch{}return {calls,summary:await inbox.defiInboxSummary()};},approval.requestId);
 assert.equal(again.calls,0);assert.equal(again.summary.requests[0].status,'submission-unresolved');
}));

test('executor returns its bound encrypted result through a courier without crediting the sender',()=>fixture(async f=>{
 const next=await prepared(f),{executor,carrier,sender,profiles,approval,hop}=f;
 await executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),{from:profiles[1].id,packet:next.packet});
 const before=await sender.evaluate(async()=>n.readNearVault(await store.readState(),config.reserve));
 const executed=await executor.evaluate(async id=>{
  const review=await inbox.reviewDefiInboxRequest(config,id);let calls=0;
  const result=await inbox.submitDefiInboxRequest(config,id,review,{invoke:async(operation,body)=>{calls++;return {finality:'FINAL',order:{id:body.packet.id,instruction:Object.fromEntries(Object.entries(body.packet.instruction).reverse()),stage:'complete',output:'500000000000000000000000'},txHash:'1'.repeat(44)};}});
  const update=await inbox.defiInboxUpdate(config,id);return {calls,result,update};
 },approval.requestId);
 assert.equal(executed.calls,1);assert.equal(executed.result.status,'complete');assert.equal(executed.update.to,profiles[0].id);assert(!JSON.stringify(executed.update).includes('receiver.testnet'));
 await executor.evaluate(x=>courier.queueCourierItems([x.id],x.peer,{defiConfig:config}),{id:executed.update.id,peer:profiles[1].id});
 const firstExecutor=await hop(executor,carrier,profiles[2],profiles[1]);await hop(executor,carrier,profiles[2],profiles[1],[firstExecutor.id]);const first=await hop(carrier,sender,profiles[1],profiles[0]);await hop(carrier,sender,profiles[1],profiles[0],[first.id]);
 const after=await sender.evaluate(async()=>n.readNearVault(await store.readState(),config.reserve));assert.equal(after.rheaOrders[0].defi.executorUpdate.report.requestId,approval.requestId);assert.equal(after.rheaOrders[0].status,null);
 assert.equal(await sender.evaluate(async()=>(await n.nearLedger(await n.readNearVault(await store.readState(),config.reserve))).reserved.size),1);
 after.rheaOrders[0].defi.executorUpdate=undefined;before.rheaOrders[0].defi.executorUpdate=undefined;after.rheaOrders[0].defi.storageReceipt=null;assert.deepEqual(after,before);
}));

test('executor rejects substituted terms, failed persistence, expired review and changed account before dispatch',()=>fixture(async f=>{
 const next=await prepared(f),{executor,profiles,approval}=f;
 await executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),{from:profiles[1].id,packet:next.packet});
 const checks=await executor.evaluate(async id=>{
  const review=await inbox.reviewDefiInboxRequest(config,id),invoke=async()=>{calls++;throw Error('Must not dispatch');};let calls=0;
  const changed=structuredClone(review);changed.receiver='wrong.testnet';try{await inbox.submitDefiInboxRequest(config,id,changed,{invoke});}catch{}
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw Error('Disk full');};try{await inbox.submitDefiInboxRequest(config,id,review,{invoke});}catch{}finally{IDBObjectStore.prototype.put=put;}
  const clock=Date.now;Date.now=()=>review.expiresAt;try{await inbox.submitDefiInboxRequest(config,id,review,{invoke});}catch{}finally{Date.now=clock;}
  await store.updateState(async s=>{s.identity=await p.createIdentity('Changed executor');});try{await inbox.submitDefiInboxRequest(config,id,review,{invoke});}catch{}
  return calls;
 },approval.requestId);assert.equal(checks,0);
}));

test('executor review expiry at durable commit prevents the final submission dispatch',()=>fixture(async f=>{
 const next=await prepared(f),{executor,profiles,approval}=f;
 await executor.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{defiConfig:config}),{from:profiles[1].id,packet:next.packet});
 const result=await executor.evaluate(async id=>{
  const review=await inbox.reviewDefiInboxRequest(config,id),clock=Date.now,transaction=IDBDatabase.prototype.transaction;
  let calls=0,error='';
  IDBDatabase.prototype.transaction=function(...args){
   const tx=transaction.apply(this,args);
   if(args[1]==='readwrite')tx.addEventListener('complete',()=>{Date.now=()=>review.expiresAt+1;});
   return tx;
  };
  try{await inbox.submitDefiInboxRequest(config,id,review,{invoke:async()=>{calls++;throw Error('Expired review dispatched');}});}
  catch(e){error=e.message;}
  finally{Date.now=clock;IDBDatabase.prototype.transaction=transaction;}
  return {calls,error,summary:await inbox.defiInboxSummary()};
 },approval.requestId);
 assert.equal(result.calls,0);assert.match(result.error,/expired/);assert.equal(result.summary.requests[0].id,approval.requestId);
}));

test('executor UI opens an encrypted request file and requires its own review before the signed swap dispatch',()=>fixture(async({sender,executor,approval})=>{
 const envelope=await sender.evaluate(id=>wallet.defiHandoff(config,id,{envelope:true}),approval.requestId);let calls=0;
 await executor.route('**/api/rhea/signed-submit',async route=>{calls++;const body=route.request().postDataJSON();assert.equal(body.packet.id,approval.orderId);assert.equal(body.packet.instruction.receiver_id,'receiver.testnet');await route.fulfill({json:{finality:'FINAL',order:{id:body.packet.id,instruction:body.packet.instruction,stage:'complete',output:'500000000000000000000000'},txHash:'1'.repeat(44)}});});
 await executor.evaluate(async()=>{const dialog=document.createElement('dialog');dialog.innerHTML='<div id="nearby-courier"></div>';document.body.append(dialog);dialog.showModal();window.controls=(await import('/defi-courier-ui.js')).mountDefiInboxControls(dialog,{getConfig:()=>config});dialog.querySelector('details').open=true;await controls.refresh();});
 await executor.locator('#defi-inbox-enabled').check();await executor.waitForFunction(()=>!document.querySelector('#defi-inbox-import').disabled);
 await executor.locator('#defi-inbox-file').setInputFiles({name:'lenz-request.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(envelope))});
 await executor.waitForFunction(()=>document.querySelector('#defi-inbox-items').textContent.includes('Awaiting your review'));
 assert.equal(calls,0);await executor.locator('#defi-inbox-items summary').click();await executor.getByRole('button',{name:'Review swap',exact:true}).click();const submit=executor.getByRole('button',{name:'Submit approved swap',exact:true});await submit.waitFor();assert(await submit.isDisabled());
 assert((await executor.locator('#defi-inbox-items').innerText()).includes('receiver.testnet'));await executor.getByRole('checkbox',{name:'I checked this swap and agree to submit it'}).check();await submit.click();
 await executor.waitForFunction(()=>document.querySelector('#defi-inbox-items').textContent.includes('Swap reported complete'));assert.equal(calls,1);assert.equal(await submit.count(),0);assert(await executor.getByRole('button',{name:'Save update file',exact:true}).isVisible());
}));
