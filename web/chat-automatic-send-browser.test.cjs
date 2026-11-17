const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');

async function conversation(run,{native=false}={}){
 const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{
  try{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));
   res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');
   if(name==='/nostr-config.json'){res.end(JSON.stringify({version:1,relays:[]}));return;}
   res.end(await fs.readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  const origin=native?'https://appassets.androidplatform.net':base;
  await context.route('**/*',async route=>{
   if(native&&route.request().url().startsWith(origin+'/')){await route.fulfill({response:await route.fetch({url:base+new URL(route.request().url()).pathname})});return;}
   return route.request().url().startsWith(base+'/')?route.continue():route.abort();
  });
  await context.addInitScript(()=>{
   window.chatShareCalls=[];window.chatDownloads=[];
   Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
   Object.defineProperty(navigator,'share',{configurable:true,value:async options=>{window.chatShareCalls.push(options);throw new DOMException('Unexpected file sharing','AbortError');}});
   document.addEventListener('click',event=>{const link=event.target.closest?.('a[download]');if(link)window.chatDownloads.push(link.download);},true);
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/chat.html');await page.locator('#status').filter({hasText:'Private chat is ready'}).waitFor();
  const idle=()=>page.waitForFunction(()=>document.querySelector('main').getAttribute('aria-busy')!=='true');
  await page.locator('#device-profile>summary').click();await page.locator('#continue-private').click();await idle();
  const peer=await page.evaluate(async()=>{window.chatPeer=await(await import('/peer-crypto.js')).createIdentity('Bola');return window.chatPeer.profile;});
  await page.evaluate(async profile=>{await(await import('/chat-store.js')).updateState(state=>state.contacts.push(profile));const channel=new BroadcastChannel('proof-u-chat-refresh');channel.postMessage('changed');channel.close();},peer);
  await page.locator('#contact-list button').waitFor({state:'attached'});await page.locator('#back-people').click();await page.locator('#contact-list button').click();await idle();
  await run({page,context,idle,base});assert.deepEqual(errors,[]);
 }finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

async function nativeBridge(page,{state={state:'unavailable',peers:0},discardError=false}={}){
 await page.waitForFunction(()=>document.querySelector('#nostr-status')?.textContent.includes('Internet delivery is unavailable'));
 await page.evaluate(({state,discardError})=>{
  const channel=new MessageChannel();window.nativePort=channel.port2;window.nativeCommands=[];window.nativeSent=[];window.nativeState=state;window.nativeDiscardError=discardError;
  channel.port2.onmessage=event=>{const command=JSON.parse(event.data);window.nativeCommands.push(command);
   if(command.op==='send')window.nativeSent.push(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(command.payload),c=>c.charCodeAt(0)))));
   const result=command.op==='status'?{state:'off',peers:0}:command.op==='start'?window.nativeState:command.op==='stop'?{state:'off',peers:0}:{};
   channel.port2.postMessage(JSON.stringify(command.op==='discard'&&window.nativeDiscardError?{id:command.id,ok:false,error:{message:'Test native discard failed'}}:{id:command.id,ok:true,result}));
  };channel.port2.start();
  dispatchEvent(new MessageEvent('message',{origin:'',data:JSON.stringify({type:'lenz-bluetooth-ready',version:1}),ports:[channel.port1]}));
 },{state,discardError});
 await page.waitForFunction(()=>document.querySelector('#bluetooth-open')?.hidden===false);
}

async function recipientReceipt(page,packet){
 return page.evaluate(async packet=>{
  const state=await(await import('/chat-store.js')).readState(),peerState={identity:window.chatPeer,contacts:[state.identity.profile],messages:[{packet}]};
  const receipt=await(await import('/delivery-receipts.js')).prepareDeliveryReceipt(peerState,packet.id);return (await import('/carrier-protocol.js')).wrapForCarrier(window.chatPeer,receipt);
 },packet);
}

test('ordinary offline Send retains encrypted messages for automatic delivery without sharing or downloading',async()=>conversation(async({page,context,idle})=>{
 await page.evaluate(()=>{const ports=new MessageChannel();window.webNativeCommands=[];ports.port2.onmessage=event=>window.webNativeCommands.push(event.data);ports.port2.start();dispatchEvent(new MessageEvent('message',{origin:'https://appassets.androidplatform.net',data:JSON.stringify({type:'lenz-bluetooth-ready',version:1}),ports:[ports.port1]}));});
 await context.setOffline(true);await page.locator('#message').fill('Keep this message until a connection returns.');await page.locator('#prepare-message').click();await idle();
 assert.deepEqual(await page.evaluate(()=>({shares:window.chatShareCalls.length,downloads:window.chatDownloads.length})),{shares:0,downloads:0});
 assert.match(await page.locator('#status').innerText(),/saved.*delivery|waiting.*send/i);
 assert.equal(await page.locator('#handover').count(),0);assert.equal(await page.locator('.bubble.outgoing button').count(),0);
 assert.match(await page.locator('.bubble.outgoing').innerText(),/Waiting to send|Saved.*delivery/i);
 assert.equal(await page.locator('#message').inputValue(),'');assert.equal(await page.getByText('Use Bitchat',{exact:true}).count(),0);
 const saved=await page.evaluate(async()=>{const state=await(await import('/chat-store.js')).readState(),packet=state.messages[0].packet;return {packet,requested:state.messages[0].deliveryRequested,text:(await(await import('/peer-crypto.js')).openMessage(window.chatPeer,state.identity.profile,packet)).text};});
 assert.equal(saved.requested,true);assert.equal(saved.text,'Keep this message until a connection returns.');assert(!JSON.stringify(saved.packet).includes(saved.text));
 assert.equal(await page.evaluate(()=>window.webNativeCommands.length),0);assert.equal(await page.evaluate(()=>document.querySelector('#bluetooth-open').hidden),true);
 await context.setOffline(false);await page.reload();await page.locator('#status').filter({hasText:'Private chat is ready'}).waitFor();
 assert.equal(await page.locator('.bubble.outgoing').count(),1);assert.deepEqual(await page.evaluate(async()=>{const s=await(await import('/chat-store.js')).readState();return s.messages.map(r=>r.packet);}),[saved.packet]);
}));

test('simulated secure native transport resumes the original offline message and accepts only a signed recipient receipt',async()=>conversation(async({page,context,idle})=>{
 await nativeBridge(page,{discardError:true});await context.setOffline(true);
 await page.locator('#message').fill('Send this original when Nearby returns.');await page.locator('#prepare-message').click();await idle();
 const original=await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).messages[0].packet);
 const earlier=await page.evaluate(async packet=>{
  const store=await import('/chat-store.js'),crypto=await import('/peer-crypto.js'),carrier=await import('/carrier-protocol.js'),nostr=await import('/nostr-protocol.js');
  return store.updateState(async state=>{
   const contact=state.contacts.find(contact=>contact.id===packet.to),past=Date.now()-90000000;
   const local=await crypto.sealMessage(state.identity,contact,{kind:'chat',text:'Earlier saved history.'});state.messages.push({packet:local});
   const envelope=await carrier.wrapForCarrier(state.identity,packet,past);state.bluetoothOutbox=[envelope];
   state.nostr={enabled:true,excluded:[],outbox:[await nostr.packEnvelope(state.identity,contact,packet,past),await nostr.packEnvelope(state.identity,contact,local,past)]};
   return {localId:local.id,envelopeId:envelope.id,expiresAt:envelope.expiresAt};
  });
 },original);
 await page.locator('#chat-options').click();await page.locator('#bluetooth-open').click();await page.locator('#bluetooth-status').filter({hasText:'Bluetooth is unavailable'}).waitFor();assert.equal(await page.evaluate(()=>window.nativeSent.length),0);
 assert.equal(await page.locator('#nearby-dialog').isVisible(),false);assert.equal(await page.locator('#handover').count(),0);
 await page.evaluate(()=>{window.nativeState={state:'ready',peers:1};window.nativePort.postMessage(JSON.stringify({type:'status',...window.nativeState}));});
 await page.waitForFunction(()=>window.nativeSent.length>=1);assert.equal(await page.evaluate(()=>window.nativeSent.length),1);
 const delivered=await page.evaluate(async()=>{const envelope=window.nativeSent[0];await(await import('/carrier-protocol.js')).validateEnvelope(envelope);return envelope;});assert.deepEqual(delivered.packet,original);assert.equal(delivered.id,earlier.envelopeId);assert(earlier.expiresAt<Date.now()&&delivered.expiresAt>Date.now());
 assert.deepEqual(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).nostr.outbox.map(entry=>entry.packetId)),[earlier.localId]);
 assert.deepEqual(await page.evaluate(()=>({shares:window.chatShareCalls.length,downloads:window.chatDownloads.length})),{shares:0,downloads:0});
 const receipt=await recipientReceipt(page,original);
 const forwardBefore=await page.evaluate(()=>window.nativeCommands.filter(command=>['forward','discard'].includes(command.op)).length);
 await page.evaluate(envelope=>{
  const invalid=structuredClone(envelope);invalid.signature=(invalid.signature[0]==='0'?'1':'0')+invalid.signature.slice(1);
  window.nativePort.postMessage(JSON.stringify({type:'envelope',token:'invalid-receipt',hops:1,payload:btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(invalid))))}));
 },receipt);
 await page.locator('#bluetooth-status').filter({hasText:/signature|signature rejected/i}).waitFor();assert.equal(await page.evaluate(()=>window.nativeCommands.filter(command=>['forward','discard'].includes(command.op)).length),forwardBefore);
 assert.doesNotMatch(await page.locator('.bubble.outgoing').first().innerText(),/your contact acknowledged/i);
 await page.evaluate(envelope=>window.nativePort.postMessage(JSON.stringify({type:'envelope',token:'recipient-receipt',hops:1,payload:btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(envelope))))})),receipt);
 await page.locator('.bubble.outgoing').filter({hasText:'your contact acknowledged this message'}).waitFor();
 await page.waitForFunction(()=>window.nativeCommands.some(command=>command.op==='discard'));assert.equal(await page.evaluate(()=>window.nativeCommands.filter(command=>command.op==='forward').length),0);
 assert.equal(await page.locator('.bubble.outgoing').count(),2);assert.equal(await page.evaluate(()=>window.nativeSent.filter(envelope=>envelope.packet.id===window.nativeSent[0].packet.id).length),1);
 await page.locator('#bluetooth-stop').click();await page.locator('#bluetooth-status').filter({hasText:'Nearby is off'}).waitFor();await page.locator('#bluetooth-close').click();
 await page.locator('#message').fill('Queue this after I turned Nearby off.');await page.locator('#prepare-message').click();await idle();
 assert.equal(await page.evaluate(()=>window.nativeSent.length),1);assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).bluetoothPreference.disabled),true);
},{native:true}));

test('a queued conversation Send cannot sign or deliver under a replacement account',async()=>conversation(async({page,idle})=>{
 await page.evaluate(()=>new Promise(resolve=>{navigator.locks.request('proof-u-private-chat-v1',async()=>{resolve();await new Promise(done=>window.releaseChatSave=done);});}));
 await page.evaluate(async()=>{const store=await import('/chat-store.js'),replacement=await(await import('/peer-crypto.js')).createIdentity('Replacement');window.replacementSave=store.updateState(state=>{state.identity=replacement;state.messages=[];});});
 await page.locator('#message').fill('Original account only.');await page.locator('#prepare-message').click();await page.evaluate(()=>window.releaseChatSave());await idle();
 const result=await page.evaluate(async()=>{await window.replacementSave;const state=await(await import('/chat-store.js')).readState();return {owner:state.identity.profile.name,messages:state.messages.length,shares:window.chatShareCalls.length,downloads:window.chatDownloads.length};});
 assert.deepEqual(result,{owner:'Replacement',messages:0,shares:0,downloads:0});assert.match(await page.locator('#status').innerText(),/account changed/i);
}));

test('a full simulated native queue drains 32 originals and refills with the retained 33rd after a recipient receipt',async()=>conversation(async({page,context,idle})=>{
 await nativeBridge(page,{state:{state:'ready',peers:1}});await context.setOffline(true);
 const originals=await page.evaluate(async()=>{const store=await import('/chat-store.js'),crypto=await import('/peer-crypto.js');return store.updateState(async state=>{
  const packets=[];for(let i=0;i<33;i++)packets.push(await crypto.sealMessage(state.identity,state.contacts[0],{kind:'chat',text:'Retained original '+(i+1)}));state.messages=packets.map(packet=>({packet,deliveryRequested:true}));return packets;
 });});
 await page.locator('#chat-options').click();await page.locator('#bluetooth-open').click();await page.waitForFunction(()=>window.nativeSent.length>=32);assert.equal(await page.evaluate(()=>window.nativeSent.length),32);
 assert.deepEqual(await page.evaluate(()=>window.nativeSent.map(envelope=>envelope.packet)),originals.slice(0,32));
 assert.deepEqual(await page.evaluate(async()=>{const state=await(await import('/chat-store.js')).readState();return {messages:state.messages.length,queued:state.bluetoothOutbox.length};}),{messages:33,queued:32});
 const receipt=await recipientReceipt(page,originals[0]);await page.evaluate(envelope=>window.nativePort.postMessage(JSON.stringify({type:'envelope',token:'first-recipient-receipt',hops:1,payload:btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(envelope))))})),receipt);
 await page.waitForFunction(()=>window.nativeSent.length>=33);assert.equal(await page.evaluate(()=>window.nativeSent.length),33);assert.deepEqual(await page.evaluate(()=>window.nativeSent[32].packet),originals[32]);
 assert.equal(await page.evaluate(async()=>(await(await import('/chat-store.js')).readState()).messages.length),33);await idle();
},{native:true}));

test('32 returned receipts cannot block a new original and their simulated native retry batch rotates',async()=>conversation(async({page,context})=>{
 await nativeBridge(page,{state:{state:'ready',peers:1}});await context.setOffline(true);
 const saved=await page.evaluate(async()=>{
  window.realNativeNow=Date.now;window.testNativeNow=Date.now();Date.now=()=>window.testNativeNow;
  const store=await import('/chat-store.js'),crypto=await import('/peer-crypto.js'),receipts=await import('/delivery-receipts.js');
  return store.updateState(async state=>{
   for(let i=0;i<32;i++){
    const packet=await crypto.sealMessage(window.chatPeer,state.identity.profile,{kind:'chat',text:'Received original '+(i+1)});state.messages.push({packet});
    await receipts.prepareDeliveryReceipt(state,packet.id);state.messages.at(-1).receiptDeliveryRequested=true;
   }
   const original=await crypto.sealMessage(state.identity,state.contacts[0],{kind:'chat',text:'My new original after 32 receipts.'});state.messages.push({packet:original,deliveryRequested:true});
   return {original,receiptIds:state.messages.flatMap(row=>row.receiptToShare?[row.receiptToShare.id]:[])};
  });
 });
 await page.locator('#chat-options').click();await page.locator('#bluetooth-open').click();await page.waitForFunction(()=>window.nativeSent.length>=9);assert.equal(await page.evaluate(()=>window.nativeSent.length),9);
 const first=await page.evaluate(()=>window.nativeSent.map(envelope=>envelope.packet));assert.deepEqual(first.find(packet=>packet.id===saved.original.id),saved.original);
 const firstReceiptIds=first.filter(packet=>packet.id!==saved.original.id).map(packet=>packet.id);assert.equal(firstReceiptIds.length,8);assert(firstReceiptIds.every(id=>saved.receiptIds.includes(id)));
 await page.evaluate(()=>{window.testNativeNow+=30000;dispatchEvent(new Event('lenz-delivery-ready'));});await page.waitForFunction(()=>window.nativeSent.length>=17);assert.equal(await page.evaluate(()=>window.nativeSent.length),17);
 const secondReceiptIds=await page.evaluate(()=>window.nativeSent.slice(9).map(envelope=>envelope.packet.id));assert.equal(new Set(secondReceiptIds).size,8);assert(secondReceiptIds.every(id=>saved.receiptIds.includes(id)&&!firstReceiptIds.includes(id)));
 assert.deepEqual(await page.evaluate(async()=>{const state=await(await import('/chat-store.js')).readState();return {messages:state.messages.length,receipts:state.messages.filter(row=>row.receiptToShare).length};}),{messages:33,receipts:32});
 await page.evaluate(()=>{Date.now=window.realNativeNow;});
},{native:true}));

test('a payment review retains its opening account and cannot spend under a replacement profile',async()=>conversation(async({page,idle})=>{
 await page.locator('#pay-tusd').click();await page.locator('#chat-pay-amount').fill('1');
 await page.evaluate(async()=>{const store=await import('/chat-store.js'),identity=await(await import('/peer-crypto.js')).createIdentity('Replacement payer');await store.updateState(state=>{state.identity=identity;state.messages=[];});});
 await page.locator('#chat-pay-submit').click();await idle();assert.match(await page.locator('#chat-pay-feedback').innerText(),/account changed/i);
 assert.deepEqual(await page.evaluate(async()=>{const state=await(await import('/chat-store.js')).readState();return {owner:state.identity.profile.name,messages:state.messages.length};}),{owner:'Replacement payer',messages:0});
}));

test('contact changes and a pending save preserve each conversation draft and newly typed text',async()=>conversation(async({page,idle})=>{
 await page.locator('#message').fill('Draft only for Bola.');await page.locator('#back-people').click();
 const contact=await page.evaluate(async()=>(await(await import('/peer-crypto.js')).createIdentity('Mina')).profile);
 await page.locator('#show-add-contact').click();await page.locator('#contact-file').setInputFiles({name:'mina.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(contact))});await page.locator('#contact-review').waitFor();await page.locator('#verified').check();await page.locator('#confirm-contact').click();await idle();
 assert.equal(await page.locator('#message').inputValue(),'');await page.locator('#back-people').click();await page.locator('#contact-list button').filter({hasText:'Bola'}).click();await idle();assert.equal(await page.locator('#message').inputValue(),'Draft only for Bola.');
 for(const next of ['Keep this next draft.','Send this message first.']){
  await page.evaluate(()=>new Promise(resolve=>{navigator.locks.request('proof-u-private-chat-v1',async()=>{resolve();await new Promise(done=>window.releaseDraftSave=done);});}));
  await page.locator('#message').fill('Send this message first.');await page.locator('#prepare-message').click();await page.locator('#message').fill(next);await page.evaluate(()=>window.releaseDraftSave());await idle();assert.equal(await page.locator('#message').inputValue(),next);
 }
 assert.equal(await page.locator('.bubble.outgoing').count(),2);assert.equal(await page.evaluate(()=>window.chatShareCalls.length),0);
}));

test('failed durable storage keeps the draft and starts no message delivery',async()=>conversation(async({page,idle})=>{
 await nativeBridge(page,{state:{state:'ready',peers:1}});
 await page.evaluate(()=>{window.savedPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(){throw Error('Test storage failure');};});
 try{await page.locator('#message').fill('Keep this until storage works.');await page.locator('#prepare-message').click();await idle();assert.match(await page.locator('#status').innerText(),/storage failure/i);assert.equal(await page.locator('#message').inputValue(),'Keep this until storage works.');assert.equal(await page.locator('.bubble.outgoing').count(),0);assert.deepEqual(await page.evaluate(()=>({shares:window.chatShareCalls.length,downloads:window.chatDownloads.length,native:window.nativeCommands.filter(command=>['start','send'].includes(command.op)).length})),{shares:0,downloads:0,native:0});}
 finally{await page.evaluate(()=>{IDBObjectStore.prototype.put=window.savedPut;});}
},{native:true}));
