const test=require('node:test'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {securityHeaders}=require('./security-policy.mjs');
async function until(page,predicate,arg){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){if(await page.evaluate(predicate,arg))return;await page.waitForTimeout(50);}
 throw Error('Courier state did not reach the expected condition.');
}

async function fixture(run){
 const server=http.createServer(async(req,res)=>{
  const file=new URL(req.url,'http://localhost').pathname;
  for(const [k,v]of Object.entries(securityHeaders(file)))res.setHeader(k,v);
  if(file==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Courier fixture</title>');return;}
  try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(__dirname,'public',file)));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const contexts=await Promise.all([0,1,2,3].map(()=>browser.newContext())),pages=await Promise.all(contexts.map(c=>c.newPage())),profiles=[];
  async function boot(page){await page.goto(base);await page.evaluate(async()=>{window.store=await import('/chat-store.js');window.p=await import('/peer-crypto.js');window.courier=await import('/nearby-courier.js');});}
  for(const [i,page]of pages.entries()){
   await boot(page);profiles.push(await page.evaluate(async name=>{await store.updateState(async s=>{s.identity=await p.createIdentity(name);});return (await store.readState()).identity.profile;},['Sender','Carrier','Recipient','Replacement'][i]));
  }
  for(const page of pages)await page.evaluate(async profiles=>{await store.updateState(s=>{s.contacts=profiles.filter(p=>p.id!==s.identity.profile.id);});await courier.setCourierEnabled(true);},profiles);
  const [sender,carrier,recipient,replacement]=pages;
  const message=await sender.evaluate(async recipient=>store.updateState(async s=>{
   const packet=await p.sealMessage(s.identity,recipient,{kind:'chat',text:'Only the recipient can read this.'});s.messages.push({packet});return packet.id;
  }),profiles[2]);
  await run({sender,carrier,recipient,replacement,profiles,message,contexts,boot});
 }finally{await browser.close();await new Promise(r=>server.close(r));}
}

test('courier survives sender departure and restart, delivers once and returns a bound receipt',()=>fixture(async({sender,carrier,recipient,profiles,message,boot,contexts})=>{
 await sender.evaluate(async({message,peer})=>courier.queueCourierItems([message],peer,{}),{message,peer:profiles[1].id});
 const deposit=await sender.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[1].id);
 assert(deposit?.packet);await carrier.evaluate(async({peer,packet})=>courier.receiveCourierPacket(peer,packet,{}),{peer:profiles[0].id,packet:deposit.packet});
 const before=await carrier.evaluate(async()=>{const s=await store.readState();return {messages:s.messages.length,raw:JSON.stringify(s),summary:await courier.courierSummary()};});
 assert.equal(before.messages,0);assert(!before.raw.includes('Only the recipient'));assert.equal(before.summary.carried.length,1);
 await sender.close();await boot(carrier);
 const delivery=await carrier.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[2].id);
 for(let i=0;i<2;i++)await recipient.evaluate(async({peer,packet})=>courier.receiveCourierPacket(peer,packet,{}),{peer:profiles[1].id,packet:delivery.packet});
 const received=await recipient.evaluate(async()=>{const s=await store.readState();return {count:s.messages.length,text:await p.openMessage(s.identity,s.contacts.find(c=>c.id===s.messages[0].packet.from),s.messages[0].packet),summary:await courier.courierSummary()};});
 assert.equal(received.count,1);assert.equal(received.text.text,'Only the recipient can read this.');assert.equal(received.summary.outgoing.length,1);
 const receipt=await recipient.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[1].id);
 await carrier.evaluate(async({peer,packet})=>courier.receiveCourierPacket(peer,packet,{}),{peer:profiles[2].id,packet:receipt.packet});
 assert.equal((await carrier.evaluate(()=>courier.courierSummary())).carried.length,2);
 const returning=await carrier.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[0].id),returned=await contexts[0].newPage();await boot(returned);
 await returned.evaluate(async({peer,packet})=>courier.receiveCourierPacket(peer,packet,{}),{peer:profiles[1].id,packet:returning.packet});
 assert.equal((await returned.evaluate(()=>courier.courierSummary())).outgoing[0].status,'received');
 assert.equal(await returned.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[1].id),null);
}));

test('courier opt-in, peer binding and storage failure gate disclosure and acceptance',()=>fixture(async({sender,carrier,recipient,profiles,message})=>{
 await sender.evaluate(()=>courier.setCourierEnabled(false));
 await assert.rejects(sender.evaluate(x=>courier.queueCourierItems([x.message],x.peer,{}),{message,peer:profiles[1].id}),/Turn on/);
 await sender.evaluate(()=>courier.setCourierEnabled(true));
 await sender.evaluate(x=>courier.queueCourierItems([x.message],x.peer,{}),{message,peer:profiles[1].id});
 const deposit=await sender.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[1].id);
 await sender.evaluate(()=>courier.setCourierEnabled(false));
 await assert.rejects(sender.evaluate(x=>courier.dispatchCourierItem(x.id,x.packet,()=>{}),deposit),/stopped/);
 const tampered=structuredClone(deposit.packet);tampered.ciphertext=(tampered.ciphertext.startsWith('00')?'01':'00')+tampered.ciphertext.slice(2);
 await assert.rejects(carrier.evaluate(x=>courier.receiveCourierPacket(x.peer,x.packet,{}),{peer:profiles[0].id,packet:tampered}),/signature/);
 await assert.rejects(carrier.evaluate(x=>courier.receiveCourierPacket(x.peer,x.packet,{}),{peer:profiles[2].id,packet:deposit.packet}),/direction/);
 await carrier.evaluate(()=>courier.setCourierEnabled(false));
 await assert.rejects(carrier.evaluate(x=>courier.receiveCourierPacket(x.peer,x.packet,{}),{peer:profiles[0].id,packet:deposit.packet}),/turned off/);
 await carrier.evaluate(()=>courier.setCourierEnabled(true));
 const failed=await carrier.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw Error('Disk full');};let error='';
  try{await courier.receiveCourierPacket(x.peer,x.packet,{});}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,summary:await courier.courierSummary()};
 },{peer:profiles[0].id,packet:deposit.packet});
 assert.match(failed.error,/Disk full/);assert.equal(failed.summary.carried.length,0);
 await carrier.evaluate(x=>courier.receiveCourierPacket(x.peer,x.packet,{}),{peer:profiles[0].id,packet:deposit.packet});
 const delivery=await carrier.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[2].id);
 const failedRecipient=await recipient.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw Error('Disk full');};let error='';
  try{await courier.receiveCourierPacket(x.peer,x.packet,{});}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,messages:(await store.readState()).messages.length,summary:await courier.courierSummary()};
 },{peer:profiles[1].id,packet:delivery.packet});
 assert.match(failedRecipient.error,/Disk full/);assert.equal(failedRecipient.messages,0);assert.equal(failedRecipient.summary.outgoing.length,0);
}));

test('expired carrier copy can accept an explicitly renewed source envelope without changing its original item',()=>fixture(async({sender,carrier,profiles,message})=>{
 await sender.evaluate(x=>courier.queueCourierItems([x.message],x.peer,{}),{message,peer:profiles[1].id});
 const first=await sender.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[1].id);
 await carrier.evaluate(x=>courier.receiveCourierPacket(x.peer,x.packet,{}),{peer:profiles[0].id,packet:first.packet});
 const future=Date.now()+25*3600000;
 for(const page of [sender,carrier])await page.evaluate(time=>{Date.now=()=>time;},future);
 assert.equal((await sender.evaluate(()=>courier.courierSummary())).outgoing[0].status,'expired');
 assert.equal(await sender.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[1].id),null);
 await sender.evaluate(x=>courier.queueCourierItems([x.message],x.peer,{}),{message,peer:profiles[1].id});
 const renewed=await sender.evaluate(peer=>courier.courierHandoff(peer,{}),profiles[1].id);
 assert.equal(renewed.id,first.id);assert.notDeepEqual(renewed.packet,first.packet);
 await carrier.evaluate(x=>courier.receiveCourierPacket(x.peer,x.packet,{}),{peer:profiles[0].id,packet:renewed.packet});
 assert.equal((await carrier.evaluate(()=>courier.courierSummary())).carried.length,1);
}));

test('replacement courier returns the original receipt without accepting the item twice',()=>fixture(async({sender,carrier,recipient,replacement,profiles,message})=>{
 const contract='courier-fixture.lenz.testnet';
 const original=await sender.evaluate(async x=>store.updateState(async s=>{
  const n=await import('/near-protocol.js'),pay=await import('/near-payment-service.js'),root=await n.fundingRequest(s.identity,x.contract,'10'),v=n.emptyNearVault(x.contract);
  v.roots.push({id:root.id,owner:root.owner,amount:root.amount});await n.saveNearVault(s,v);s.messages=[];
  const packet=await pay.prepareNearPayment(s,x.contract,x.to,'4');return {message:packet.id,box:s.nearBox};
 }),{contract,to:profiles[2].id});message=original.message;
 const hop=async(from,to,author,peer)=>{
  const handoff=await from.evaluate(x=>courier.courierHandoff(x.peer,{contract:x.contract}),{peer:peer.id,contract});
  assert(handoff);await to.evaluate(x=>courier.receiveCourierPacket(x.from,x.packet,{contract:x.contract}),{from:author.id,packet:handoff.packet,contract});return handoff;
 };
 await sender.evaluate(x=>courier.queueCourierItems([x.message],x.peer,{contract:x.contract}),{message,peer:profiles[1].id,contract});
 const first=await hop(sender,carrier,profiles[0],profiles[1]);await hop(carrier,recipient,profiles[1],profiles[2]);
 const receipt=await recipient.evaluate(async()=>(await store.readState()).messages[0].receiptToShare);
 const acceptedBox=(await recipient.evaluate(()=>store.readState())).nearBox;
 await sender.evaluate(id=>courier.forgetCourierItem(id),first.id);
 assert.deepEqual((await sender.evaluate(()=>store.readState())).nearBox,original.box);
 await sender.evaluate(x=>courier.queueCourierItems([x.message],x.peer,{contract:x.contract}),{message,peer:profiles[3].id,contract});
 await hop(sender,replacement,profiles[0],profiles[3]);await hop(replacement,recipient,profiles[3],profiles[2]);
 const after=await recipient.evaluate(()=>store.readState());assert.equal(after.messages.length,1);assert.deepEqual(after.messages[0].receiptToShare,receipt);
 assert.deepEqual(after.nearBox,acceptedBox);
 await hop(recipient,replacement,profiles[2],profiles[3]);await hop(replacement,sender,profiles[3],profiles[0]);
 assert.equal((await sender.evaluate(()=>courier.courierSummary())).outgoing[0].status,'received');
 assert.deepEqual((await sender.evaluate(()=>store.readState())).nearBox,original.box);
}));

test('pausing during packet hashing prevents queued courier frames from leaving',()=>fixture(async({sender,profiles,message})=>{
 const result=await sender.evaluate(async x=>{
  await courier.queueCourierItems([x.message],x.peer);const next=await courier.courierHandoff(x.peer),state=await store.readState(),frames=[];
  const {createNearbyConnection}=await import('/nearby-connection.js');
  window.RTCPeerConnection=class{constructor(){window.fakePc=this;}close(){}};
  const conn=createNearbyConnection({identity:state.identity,contact:state.contacts.find(c=>c.id===x.peer),onPacket:async()=>{}});
  let size=0;const channel={label:'lenz/nearby/v1',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,readyState:'open',close(){},send(text){
   const frame=JSON.parse(text);frames.push(frame);if(frame.kind==='part'){size+=frame.data.length;if(size===frames[0].size)queueMicrotask(()=>channel.onmessage({data:JSON.stringify({kind:'ack',hash:frames[0].hash})}));}
  }};
  fakePc.ondatachannel({channel});channel.onopen();
  const digest=crypto.subtle.digest.bind(crypto.subtle);let hit,release;const reached=new Promise(r=>hit=r),gate=new Promise(r=>release=r);
  crypto.subtle.digest=async(algorithm,data)=>{if(new TextDecoder().decode(data)===JSON.stringify(next.packet)){hit();await gate;}return digest(algorithm,data);};
  let error='';const sending=conn.send(next.packet,{withDispatch:dispatch=>courier.dispatchCourierItem(next.id,next.packet,dispatch)}).catch(e=>{error=e.message;});
  await reached;await courier.setCourierEnabled(false);release();await sending;crypto.subtle.digest=digest;conn.close();
  return {frames:frames.length,error};
 },{message,peer:profiles[1].id});
 assert.equal(result.frames,0);assert.match(result.error,/stopped/);
}));

async function mountControls(sender,peer){
 await sender.evaluate(async peer=>{
  const ui=await import('/nearby-courier-ui.js');document.body.innerHTML='<dialog open><div id="nearby-connected"></div></dialog>';
  window.control=ui.mountCourierControls(document.querySelector('dialog'),{getSession:()=>({connected:true,contact:peer,sendCouriers:async()=>{}}),getContract:()=>null});await control.refresh();
 },peer);
 await sender.locator('#nearby-courier>summary').click();
}
test('expiry during final signature verification prevents dispatch',()=>fixture(async({sender,profiles,message})=>{
 const result=await sender.evaluate(async x=>{
  await courier.queueCourierItems([x.message],x.peer);const next=await courier.courierHandoff(x.peer),s=await store.readState();
  const envelope=(await p.openMessage(s.identity,s.contacts.find(c=>c.id===x.peer),next.packet)).envelope;
  const now=Date.now,verify=crypto.subtle.verify.bind(crypto.subtle);let matched=0,dispatched=0,error='';
  crypto.subtle.verify=async(...args)=>{if(p.hex(args[2])===envelope.signature&&++matched===2)Date.now=()=>envelope.expiresAt+1;return verify(...args);};
  try{await courier.dispatchCourierItem(next.id,next.packet,()=>{dispatched++;});}catch(e){error=e.message;}finally{Date.now=now;crypto.subtle.verify=verify;}
  return {dispatched,error};
 },{message,peer:profiles[1].id});
 assert.equal(result.dispatched,0);assert.match(result.error,/expired/);
}));
test('courier UI offers a bounded batch from a larger history and keeps the remainder saved',()=>fixture(async({sender,profiles})=>{
 await sender.evaluate(async recipient=>store.updateState(async s=>{while(s.messages.length<33)s.messages.push({packet:await p.sealMessage(s.identity,recipient,{kind:'chat',text:'Saved '+s.messages.length})});}),profiles[2]);
 await mountControls(sender,profiles[1]);await sender.locator('#courier-queue').click();
 await sender.waitForFunction(()=>document.querySelector('#courier-feedback').dataset.result);
 assert.equal((await sender.evaluate(()=>courier.courierSummary())).outgoing.length,8);
 assert.equal((await sender.evaluate(()=>store.readState())).messages.length,33);
 assert.match(await sender.locator('#courier-feedback').textContent(),/25.*remain/);
}));
test('courier UI skips unsupported saved items and can renew an expired delivery',()=>fixture(async({sender,profiles})=>{
 await sender.evaluate(async recipient=>store.updateState(async s=>{s.messages.push({packet:await p.sealMessage(s.identity,recipient,{kind:'old-demo-format'})});}),profiles[2]);
 await mountControls(sender,profiles[1]);await sender.locator('#courier-queue').click();
 await sender.waitForFunction(()=>document.querySelector('#courier-feedback').dataset.result);
 assert.equal((await sender.evaluate(()=>courier.courierSummary())).outgoing.length,1);
 await sender.evaluate(async()=>{const now=Date.now()+25*3600000;Date.now=()=>now;await control.refresh();});
 assert.equal(await sender.locator('#courier-queue').isVisible(),true);await sender.locator('#courier-queue').click();
 await until(sender,async()=>(await courier.courierSummary()).outgoing[0].status==='waiting');
}));
test('courier UI recovers after a transient read error without changing consent',()=>fixture(async({sender,profiles})=>{
 const errors=[];sender.on('pageerror',e=>errors.push(e.message));await sender.evaluate(()=>courier.setCourierEnabled(false));await mountControls(sender,profiles[1]);
 await sender.evaluate(()=>{window.originalGet=IDBObjectStore.prototype.get;IDBObjectStore.prototype.get=function(...args){if(document.querySelector('#nearby-courier').hasAttribute('aria-busy'))throw Error('Transient read failed');return originalGet.apply(this,args);};});
 await sender.locator('#courier-enabled').click();
 await sender.waitForFunction(()=>document.querySelector('#courier-feedback').textContent.includes('Transient read failed')&&!document.querySelector('#nearby-courier').hasAttribute('aria-busy'));
 await sender.evaluate(async()=>{IDBObjectStore.prototype.get=originalGet;await control.refresh();});
 assert.equal((await sender.evaluate(()=>courier.courierSummary())).enabled,false);
 await sender.locator('#courier-enabled').click();await until(sender,async()=>(await courier.courierSummary()).enabled);
 assert.deepEqual(errors,[]);
}));

test('expiry during final inbound verification rolls back carrier admission',()=>fixture(async({sender,carrier,profiles,message})=>{
 await sender.evaluate(x=>courier.queueCourierItems([x.message],x.peer),{message,peer:profiles[1].id});
 const next=await sender.evaluate(peer=>courier.courierHandoff(peer),profiles[1].id);
 const result=await carrier.evaluate(async x=>{
  const s=await store.readState(),envelope=(await p.openMessage(s.identity,s.contacts.find(c=>c.id===x.peer),x.packet)).envelope;
  const now=Date.now,verify=crypto.subtle.verify.bind(crypto.subtle);let matched=0,error='';
  crypto.subtle.verify=async(...args)=>{if(p.hex(args[2])===envelope.signature&&++matched===3)Date.now=()=>envelope.expiresAt+1;return verify(...args);};
  try{await courier.receiveCourierPacket(x.peer,x.packet);}catch(e){error=e.message;}finally{Date.now=now;crypto.subtle.verify=verify;}
  return {error,carried:(await courier.courierSummary()).carried.length};
 },{peer:profiles[0].id,packet:next.packet});
 assert.match(result.error,/expired/);assert.equal(result.carried,0);
}));

test('concurrent retries count once and a full courier preserves every admitted copy',()=>fixture(async({sender,carrier,profiles})=>{
 const ids=await sender.evaluate(async recipient=>store.updateState(async s=>{
  while(s.messages.length<9)s.messages.push({packet:await p.sealMessage(s.identity,recipient,{kind:'chat',text:'Saved '+s.messages.length})});return s.messages.map(r=>r.packet.id);
 }),profiles[2]);
 await sender.evaluate(x=>courier.queueCourierItems(x.ids,x.peer),{ids:ids.slice(0,8),peer:profiles[1].id});
 const deposited=[];
 for(let i=0;i<8;i++){
  const handoff=await sender.evaluate(x=>courier.courierHandoff(x.peer,{exclude:x.exclude}),{peer:profiles[1].id,exclude:deposited});
  await carrier.evaluate(x=>Promise.all([0,1,2].map(()=>courier.receiveCourierPacket(x.peer,x.packet))),{peer:profiles[0].id,packet:handoff.packet});deposited.push(handoff.id);
 }
 assert.equal((await carrier.evaluate(()=>courier.courierSummary())).carried.length,8);
 await sender.evaluate(id=>courier.forgetCourierItem(id),deposited[0]);
 await sender.evaluate(x=>courier.queueCourierItems([x.id],x.peer),{id:ids[8],peer:profiles[1].id});
 const extra=await sender.evaluate(x=>courier.courierHandoff(x.peer,{exclude:x.exclude}),{peer:profiles[1].id,exclude:deposited});
 await assert.rejects(carrier.evaluate(x=>courier.receiveCourierPacket(x.peer,x.packet),{peer:profiles[0].id,packet:extra.packet}),/eight carried/);
 assert.equal((await carrier.evaluate(()=>courier.courierSummary())).carried.length,8);
 assert.equal((await sender.evaluate(()=>store.readState())).messages.length,9);
}));

test('source write failure prevents handoff and oversized items stay in saved history',()=>fixture(async({sender,profiles,message})=>{
 const failed=await sender.evaluate(async x=>{
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=()=>{throw Error('Disk full');};let error='';
  try{await courier.queueCourierItems([x.message],x.peer);}catch(e){error=e.message;}finally{IDBObjectStore.prototype.put=put;}
  return {error,handoff:await courier.courierHandoff(x.peer)};
 },{message,peer:profiles[1].id});assert.match(failed.error,/Disk full/);assert.equal(failed.handoff,null);
 const large=await sender.evaluate(async recipient=>store.updateState(async s=>{
  const packet=await p.sealMessage(s.identity,recipient,{kind:'chat',text:'x'.repeat(45000)});s.messages.push({packet});return packet.id;
 }),profiles[2]);
 await assert.rejects(sender.evaluate(x=>courier.queueCourierItems([x.id],x.peer),{id:large,peer:profiles[1].id}),/too large/);
 assert.equal((await sender.evaluate(()=>store.readState())).messages.length,2);assert.equal((await sender.evaluate(()=>courier.courierSummary())).outgoing.length,0);
}));

test('dispatch serializes with removal but releases storage before the remote acknowledgement',()=>fixture(async({sender,profiles,message})=>{
 const result=await sender.evaluate(async x=>{
  await courier.queueCourierItems([x.message],x.peer);const next=await courier.courierHandoff(x.peer);
  let finish;const receipt=new Promise(r=>finish=r);
  const sent=await courier.dispatchCourierItem(next.id,next.packet,()=>receipt);
  await courier.forgetCourierItem(next.id);let error='';
  try{await courier.dispatchCourierItem(next.id,next.packet,()=>{});}catch(e){error=e.message;}
  finish();await sent.delivery;return {error,remaining:(await courier.courierSummary()).outgoing.length};
 },{message,peer:profiles[1].id});assert.match(result.error,/stopped/);assert.equal(result.remaining,0);
}));
