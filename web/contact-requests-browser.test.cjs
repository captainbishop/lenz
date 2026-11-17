const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');

async function workspace(run,{native=false}={}){
 const root=path.join(__dirname,'public'),server=http.createServer(async(req,res)=>{
  try{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+name);assert(file.startsWith(root+path.sep));res.setHeader('Content-Type',path.extname(file)==='.js'?'text/javascript':'text/html');res.end(name==='/test.html'?'<!doctype html><title>Contact request verification</title>':await fs.readFile(file));}
  catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://localhost:'+server.address().port;let browser;
 try{browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),origin=native?'https://appassets.androidplatform.net':base;
  if(native)await page.route(origin+'/**',async route=>route.fulfill({response:await route.fetch({url:base+new URL(route.request().url()).pathname})}));
  await page.goto(origin+'/test.html');await run(page);}
 finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

test('adding a contact sends a signed request that becomes a contact only after acceptance',async()=>workspace(async page=>{
 const result=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),requests=await import('/contact-requests.js'),intake=await import('/receive-packet.js'),carrier=await import('/carrier-protocol.js'),receipts=await import('/delivery-receipts.js');
  const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola');
  await store.updateState(state=>Object.assign(state,{identity:a,contacts:[],messages:[]}));
  const request=await requests.addContactRequest(b.profile,{owner:a.profile.id});
  const envelope=await carrier.wrapForCarrier(a,request.packet),recipient={identity:b,contacts:[],messages:[]};
  const received=await intake.receivePacket(recipient,envelope.packet,false,null,envelope.sender);
  const before=recipient.contacts.length,receipt=await receipts.prepareDeliveryReceipt(recipient,request.packet.id);
  const sender=await store.readState();await intake.receivePacket(sender,receipt);
  await store.updateState(state=>Object.assign(state,recipient));
  const response=await requests.resolveContactRequest(request.packet.id,'accepted',{owner:b.profile.id}),accepted=await store.readState();
  await intake.receivePacket(sender,response);
  return {requestKind:received.kind,before,after:accepted.contacts.map(p=>p.name),senderStatus:sender.contactRequests[0].status,receiptStatus:await receipts.deliveryAcknowledged(sender,sender.messages[0]),requestPlaintext:JSON.stringify(request.packet).includes('Alice'),responseKind:(await crypto.openMessage(a,b.profile,response)).kind};
 });
 assert.deepEqual(result,{requestKind:'lenz-contact-request-v1',before:0,after:['Alice'],senderStatus:'accepted',receiptStatus:true,requestPlaintext:false,responseKind:'lenz-contact-response-v1'});
}));

test('native Bluetooth intake admits an unknown signed request and returns a receipt without creating a contact',async()=>workspace(async page=>{
 await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),requests=await import('/contact-requests.js'),carrier=await import('/carrier-protocol.js'),{createBluetoothClient}=await import('/bluetooth-client.js');
  const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola');
  await store.updateState(state=>Object.assign(state,{identity:a,contacts:[],messages:[],contactRequests:[]}));
  const outgoing=await requests.addContactRequest(b.profile,{owner:a.profile.id});window.nativeRequest=await carrier.wrapForCarrier(a,outgoing.packet);
  await store.updateState(state=>Object.assign(state,{identity:b,contacts:[],messages:[],contactRequests:[]}));
  window.intakeErrors=[];window.nativeSent=[];window.nativeCommands=[];
  const channel=new MessageChannel();window.testNativePort=channel.port2;
  channel.port2.onmessage=event=>{const command=JSON.parse(event.data);window.nativeCommands.push(command);
   if(command.op==='send')window.nativeSent.push(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(command.payload),c=>c.charCodeAt(0)))));
   channel.port2.postMessage(JSON.stringify({id:command.id,ok:true,result:command.op==='status'?{state:'off',peers:0}:command.op==='start'?{state:'ready',peers:1}:{}}));
  };channel.port2.start();window.bluetoothTest=createBluetoothClient({onError:error=>window.intakeErrors.push(error.message)});
  dispatchEvent(new MessageEvent('message',{origin:'',data:JSON.stringify({type:'lenz-bluetooth-ready',version:1}),ports:[channel.port1]}));await window.bluetoothTest.start();
  window.testNativePort.postMessage(JSON.stringify({type:'envelope',token:'unknown-request',hops:1,payload:btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(window.nativeRequest))))}));
 });
 await page.waitForFunction(()=>window.nativeCommands.some(command=>command.op==='discard'));
 const result=await page.evaluate(async()=>{
  const state=await(await import('/chat-store.js')).readState(),request=state.contactRequests[0];
  const receipt=window.nativeSent[0];await(await import('/carrier-protocol.js')).validateEnvelope(receipt);
  await window.bluetoothTest.stop();window.bluetoothTest.close();
  return {contacts:state.contacts.length,status:request.status,rows:state.messages.length,receipt:!!state.messages[0].receiptToShare,errors:window.intakeErrors,sent:window.nativeSent.length};
 });
 assert.deepEqual(result,{contacts:0,status:'pending',rows:1,receipt:true,errors:[],sent:1});
},{native:true}));

test('pending and declined requests cannot accept payments or promote unverified senders',async()=>workspace(async page=>{
 const result=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),requests=await import('/contact-requests.js'),intake=await import('/receive-packet.js'),carrier=await import('/carrier-protocol.js');
  const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola'),other=await crypto.createIdentity('Other');
  await store.updateState(state=>Object.assign(state,{identity:a,contacts:[],messages:[],contactRequests:[]}));
  const request=await requests.addContactRequest(b.profile,{owner:a.profile.id}),envelope=await carrier.wrapForCarrier(a,request.packet),recipient={identity:b,contacts:[],messages:[]};
  await intake.receivePacket(recipient,envelope.packet,false,null,envelope.sender);
  const duplicate=await intake.receivePacket(recipient,envelope.packet,false,null,envelope.sender);
  const errors={};
  async function rejected(name,operation){try{await operation();errors[name]='accepted';}catch(error){errors[name]=error.message;}}
  const chat=await crypto.sealMessage(a,b.profile,{kind:'chat',text:'Waiting in requests'});await intake.receivePacket(recipient,chat);
  const payment=await crypto.sealMessage(a,b.profile,{kind:'lenz-near-payment-v1',contract:'test.testnet',path:[]});
  await rejected('payment',()=>intake.receivePacket(recipient,payment,false,'test.testnet'));
  const tampered={...envelope.packet,signature:'0'.repeat(128)};await rejected('signature',()=>intake.receivePacket(recipient,tampered,false,null,envelope.sender));
  const forged=await crypto.sealMessage(a,b.profile,{kind:requests.CONTACT_REQUEST,profile:other.profile});
  await rejected('profile',()=>intake.receivePacket(recipient,forged,false,null,envelope.sender));
  const stranger=await crypto.sealMessage(other,b.profile,{kind:'chat',text:'Without a request'});await rejected('stranger',()=>intake.receivePacket(recipient,stranger,false,null,carrier.publicIdentity(other)));
  await store.updateState(state=>Object.assign(state,recipient));const response=await requests.resolveContactRequest(request.packet.id,'declined',{owner:b.profile.id}),declined=await store.readState();
  const ignored=await intake.receivePacket(declined,chat),future=await crypto.sealMessage(a,b.profile,{kind:requests.CONTACT_REQUEST,profile:a.profile}),futureResult=await intake.receivePacket(declined,future,false,null,envelope.sender);
  const sender={identity:a,contacts:[b.profile],messages:[{packet:request.packet}],contactRequests:[{requestId:request.packet.id,peerId:b.profile.id,profile:b.profile,direction:'outgoing',status:'pending'}]};
  await intake.receivePacket(sender,response);const wrong=await crypto.sealMessage(b,a.profile,{kind:requests.CONTACT_RESPONSE,requestId:'0'.repeat(32),decision:'accepted'});await rejected('wrongResponse',()=>intake.receivePacket(sender,wrong));
  return {duplicate:duplicate.duplicate,pendingRows:recipient.messages.length,pendingContacts:recipient.contacts.length,declinedContacts:declined.contacts.length,ignored:ignored.ignored,futureIgnored:futureResult.ignored,senderStatus:sender.contactRequests[0].status,errors};
 });
 assert.equal(result.duplicate,true);assert.equal(result.pendingRows,2);assert.equal(result.pendingContacts,0);assert.equal(result.declinedContacts,0);assert.equal(result.ignored,true);assert.equal(result.futureIgnored,true);assert.equal(result.senderStatus,'declined');
 assert.match(result.errors.payment,/Accept.*request/i);assert.match(result.errors.signature,/signature/i);assert.match(result.errors.profile,/profile.*match/i);assert.match(result.errors.stranger,/request first/i);assert.match(result.errors.wrongResponse,/saved outgoing request/i);
}));

test('contact changes reject a stale owner and preserve declined identities restored from a backup',async()=>workspace(async page=>{
 const result=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),requests=await import('/contact-requests.js'),intake=await import('/receive-packet.js'),carrier=await import('/carrier-protocol.js');
  const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola'),replacement=await crypto.createIdentity('Replacement');
  await store.updateState(state=>Object.assign(state,{identity:replacement,contacts:[],messages:[],contactRequests:[],declinedContactIds:[a.profile.id]}));
  const errors={};for(const [label,owner,profile] of [['stale',a.profile.id,b.profile],['declined',replacement.profile.id,a.profile]])try{await requests.addContactRequest(profile,{owner});errors[label]='accepted';}catch(error){errors[label]=error.message;}
  const packet=await crypto.sealMessage(a,replacement.profile,{kind:requests.CONTACT_REQUEST,profile:a.profile}),state=await store.readState();
  const received=await intake.receivePacket(state,packet,false,null,carrier.publicIdentity(a));
  return {errors,ignored:received.ignored,contacts:state.contacts.length,messages:state.messages.length};
 });
 assert.match(result.errors.stale,/account changed/i);assert.match(result.errors.declined,/declined/i);assert.equal(result.ignored,true);assert.equal(result.contacts,0);assert.equal(result.messages,0);
}));

test('an unaccepted sender cannot fill normal chat history beyond eight pending messages',async()=>workspace(async page=>{
 const result=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),intake=await import('/receive-packet.js'),carrier=await import('/carrier-protocol.js');
  const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola'),request=await crypto.sealMessage(a,b.profile,{kind:'lenz-contact-request-v1',profile:a.profile});
  await store.updateState(state=>Object.assign(state,{identity:b,contacts:[],messages:[],contactRequests:[]}));
  await store.updateState(state=>intake.receivePacket(state,request,false,null,carrier.publicIdentity(a)));
  for(let index=0;index<8;index++){const packet=await crypto.sealMessage(a,b.profile,{kind:'chat',text:'Pending '+(index+1)});await store.updateState(state=>intake.receivePacket(state,packet));}
  const extra=await crypto.sealMessage(a,b.profile,{kind:'chat',text:'Ninth pending message'});let error;
  try{await store.updateState(state=>intake.receivePacket(state,extra));}catch(failure){error=failure.message;}
  const state=await store.readState();await(await import('/contact-requests.js')).resolveContactRequest(request.id,'accepted',{owner:b.profile.id});
  await store.updateState(state=>intake.receivePacket(state,extra));const accepted=await store.readState();
  return {error,rows:state.messages.length,original:state.messages[0].packet.id===request.id,contacts:state.contacts.length,acceptedExtra:accepted.messages.some(r=>r.packet.id===extra.id)};
 });
 assert.match(result.error,/pending message limit/i);assert.equal(result.rows,9);assert.equal(result.original,true);assert.equal(result.contacts,0);assert.equal(result.acceptedExtra,true);
}));

test('pending senders share a 96-message bound that preserves accepted history capacity',async()=>workspace(async page=>{
 const result=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),intake=await import('/receive-packet.js'),carrier=await import('/carrier-protocol.js');
  const recipient=await crypto.createIdentity('Bola');await store.updateState(state=>Object.assign(state,{identity:recipient,contacts:[],messages:[],contactRequests:[]}));
  for(let peerIndex=0;peerIndex<12;peerIndex++){
   const sender=await crypto.createIdentity('Sender '+peerIndex),request=await crypto.sealMessage(sender,recipient.profile,{kind:'lenz-contact-request-v1',profile:sender.profile});
   await store.updateState(state=>intake.receivePacket(state,request,false,null,carrier.publicIdentity(sender)));
   for(let index=0;index<8;index++){const packet=await crypto.sealMessage(sender,recipient.profile,{kind:'chat',text:'Pending '+(index+1)});await store.updateState(state=>intake.receivePacket(state,packet));}
  }
  const extra=await crypto.createIdentity('Another sender'),request=await crypto.sealMessage(extra,recipient.profile,{kind:'lenz-contact-request-v1',profile:extra.profile});
  await store.updateState(state=>intake.receivePacket(state,request,false,null,carrier.publicIdentity(extra)));
  const packet=await crypto.sealMessage(extra,recipient.profile,{kind:'chat',text:'Beyond shared request capacity'});let error;
  try{await store.updateState(state=>intake.receivePacket(state,packet));}catch(failure){error=failure.message;}
  const state=await store.readState();return {error,rows:state.messages.length,requests:state.contactRequests.length,stored:state.messages.some(r=>r.packet.id===packet.id)};
 });
 assert.match(result.error,/pending message limit/i);assert.equal(result.rows,109);assert.equal(result.requests,13);assert.equal(result.stored,false);
}));

test('enabling restored carrier delivery resumes requested originals and leaves unrequested history local',async()=>workspace(async page=>{
 const result=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),requests=await import('/contact-requests.js'),carrier=await import('/carrier-client.js'),protocol=await import('/carrier-protocol.js');
  const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola');await store.updateState(state=>Object.assign(state,{identity:a,contacts:[],messages:[],contactRequests:[]}));
  const request=await requests.addContactRequest(b.profile,{owner:a.profile.id}),unrequested=await crypto.sealMessage(a,b.profile,{kind:'chat',text:'Local history without delivery consent'});
  await store.updateState(state=>{state.messages.push({packet:unrequested});state.carrier={enabled:false,outbox:[],excluded:[request.packet.id]};});
  await carrier.setCarrierEnabled(true);window.storedPackets=[];window.carrierErrors=[];
  const client=carrier.createCarrierClient({config:{version:1,carriers:['http://127.0.0.1:4319']},onError:error=>window.carrierErrors.push(error.message),post:async(origin,route,body)=>{
   if(route==='/v1/store'){await protocol.validateEnvelope(body);window.storedPackets.push(body.packet.id);return {type:protocol.CARRIER_DOMAIN,id:body.id,status:'stored',expiresAt:body.expiresAt};}
   return {type:protocol.CARRIER_DOMAIN,envelopes:[],next:''};
  }});
  await client.tick();const enabled=await store.readState();await carrier.setCarrierEnabled(false);client.wake();await client.tick();client.close();
  return {requested:request.packet.id,unrequested:unrequested.id,stored:window.storedPackets,excluded:enabled.carrier.excluded,errors:window.carrierErrors};
 });
 assert.deepEqual(result.stored,[result.requested]);assert.deepEqual(result.excluded,[result.unrequested]);assert.deepEqual(result.errors,[]);
}));

test('accepted and declined decisions retain their first signed response despite fresh encrypted repeats',async()=>workspace(async page=>{
 const results=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),requests=await import('/contact-requests.js'),intake=await import('/receive-packet.js');
  const results=[];
  for(const decision of ['accepted','declined']){
   const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola');await store.updateState(state=>Object.assign(state,{identity:a,contacts:[],messages:[],contactRequests:[]}));
   const outgoing=await requests.addContactRequest(b.profile,{owner:a.profile.id}),payload={kind:requests.CONTACT_RESPONSE,requestId:outgoing.packet.id,decision};
   const first=await crypto.sealMessage(b,a.profile,payload);await store.updateState(state=>intake.receivePacket(state,first));
   let ignored=0;
   for(let index=0;index<32;index++){const repeat=await crypto.sealMessage(b,a.profile,payload);const result=await store.updateState(state=>intake.receivePacket(state,repeat));if(result.ignored)ignored++;}
   const repeated=await store.readState(),exact=await store.updateState(state=>intake.receivePacket(state,first)),state=await store.readState();
   results.push({decision,rows:state.messages.length,firstResponse:repeated.contactRequests[0].responseId===first.id&&state.contactRequests[0].responseId===first.id,status:state.contactRequests[0].status,ignored,exactDuplicate:exact.duplicate});
  }
  return results;
 });
 assert.deepEqual(results,[{decision:'accepted',rows:2,firstResponse:true,status:'accepted',ignored:32,exactDuplicate:true},{decision:'declined',rows:2,firstResponse:true,status:'declined',ignored:32,exactDuplicate:true}]);
}));

test('a signed decision ends original request delivery while responses and receipts remain retryable',async()=>workspace(async page=>{
 const results=await page.evaluate(async()=>{
  const crypto=await import('/peer-crypto.js'),store=await import('/chat-store.js'),requests=await import('/contact-requests.js'),intake=await import('/receive-packet.js'),carrier=await import('/carrier-client.js'),protocol=await import('/carrier-protocol.js'),receipts=await import('/delivery-receipts.js');
  const results=[];
  for(const decision of ['accepted','declined']){
   const a=await crypto.createIdentity('Alice'),b=await crypto.createIdentity('Bola');await store.updateState(state=>Object.assign(state,{identity:a,contacts:[],messages:[],contactRequests:[],carrier:undefined}));
   const outgoing=await requests.addContactRequest(b.profile,{owner:a.profile.id}),sender=await store.readState(),recipient={identity:b,contacts:[],messages:[],contactRequests:[]};
   await intake.receivePacket(recipient,outgoing.packet,false,null,protocol.publicIdentity(a));await store.updateState(state=>Object.assign(state,recipient));
   const response=await requests.resolveContactRequest(outgoing.packet.id,decision,{owner:b.profile.id}),receiver=await store.readState(),responseRetryable=await carrier.sendable(receiver,response,null);
   await store.updateState(state=>Object.assign(state,sender));await store.updateState(state=>intake.receivePacket(state,response));
   const receipt=await store.updateState(state=>receipts.prepareDeliveryReceipt(state,response.id)),terminal=await store.readState();
   const originalRetryable=await carrier.sendable(terminal,outgoing.packet,null),receiptRetryable=await carrier.sendable(terminal,receipt,null),withoutArrivalReceipt=!terminal.messages.find(r=>r.packet.id===outgoing.packet.id).receivedReceipt;
   await carrier.setCarrierEnabled(true);const sent=[];
   const client=carrier.createCarrierClient({config:{version:1,carriers:['http://127.0.0.1:4319']},post:async(origin,route,body)=>{
    if(route==='/v1/store'){sent.push(body.packet.id);return {type:protocol.CARRIER_DOMAIN,id:body.id,status:'stored',expiresAt:body.expiresAt};}
    return {type:protocol.CARRIER_DOMAIN,envelopes:[],next:''};
   }});
   await client.tick();client.close();
   results.push({decision,originalRetryable,responseRetryable,receiptRetryable,withoutArrivalReceipt,sentOnlyReceipt:sent.length===1&&sent[0]===receipt.id});
  }
  return results;
 });
 assert.deepEqual(results,[{decision:'accepted',originalRetryable:false,responseRetryable:true,receiptRetryable:true,withoutArrivalReceipt:true,sentOnlyReceipt:true},{decision:'declined',originalRetryable:false,responseRetryable:true,receiptRetryable:true,withoutArrivalReceipt:true,sentOnlyReceipt:true}]);
}));
