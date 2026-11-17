import {readState,readStateLocked,updateState} from './chat-store.js';
import {assert,bytes} from './peer-crypto.js';
import {wrapForCarrier,validateEnvelope,MAX_ENVELOPE_BYTES} from './carrier-protocol.js';
import {sendable} from './delivery-packets.js';
import {receiveDeliveredPacket} from './receive-packet.js';
import {acceptDefiReply} from './defi-wallet.js';
import {acceptDefiCourierEnvelope,defiCourierItems} from './defi-courier.js';
import {requestedDeliveryPackets} from './delivery-mode.js';
import {contactRequestStatus} from './contact-requests.js';

const ANDROID='https://appassets.androidplatform.net';
const nativeEvent=event=>window.top===window.self&&location.origin===ANDROID&&(event.origin===ANDROID||!event.source&&['','null'].includes(event.origin)&&event.ports?.length===1);
let nativeHandoff=null;
addEventListener('message',event=>{
 if(!nativeEvent(event))return;
 let value;try{value=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
 if(value?.type==='lenz-bluetooth-ready'&&value.version===1)nativeHandoff=event;
});
const states=new Set(['off','permission','unavailable','starting','ready']);
const MAX_QUEUE_BYTES=1024*1024,MAX_QUEUE_ROWS=32;
const encode=value=>{let text='';for(const byte of bytes(value))text+=String.fromCharCode(byte);return btoa(text);};
function decode(value){
 assert(typeof value==='string'&&value.length<=Math.ceil(MAX_ENVELOPE_BYTES/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'Invalid Bluetooth envelope.');
 const data=Uint8Array.from(atob(value),c=>c.charCodeAt(0));
 assert(data.length<=MAX_ENVELOPE_BYTES,'Bluetooth envelope is too large.');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}
const same=(a,b)=>a?.id===b?.id&&a?.signature===b?.signature&&JSON.stringify(a)===JSON.stringify(b);

// The installed app provides only a transport channel. It cannot sign payments.
export function createBluetoothClient({contract=null,defiConfig=null,onState=()=>{},onUpdate=()=>{},onError=()=>{}}={}){
 let port=null,supported=false,closed=false,owner=null,run=0,syncing=false,sequence=0;
 let radio={state:'off',peers:0},receiving=Promise.resolve(),intakeRows=0,intakeBytes=0;
 const requests=new Map(),sent=new Map();
 async function sources(state){
  const messages=[],receipts=[];
  for(const packet of requestedDeliveryPackets(state)){
   if(state.messages.some(r=>r.packet.id===packet.id&&r.receivedReceipt)||!await sendable(state,packet,contract))continue;
   (state.messages.some(r=>r.receiptToShare?.id===packet.id)?receipts:messages).push(packet);
  }
  for(const item of await defiCourierItems(state,defiConfig)){
   if(!item.sendable||item.acknowledged||item.expiresAt&&item.expiresAt<=Date.now()||item.packet.from!==state.identity?.profile.id)continue;
   (item.kind==='defi-approval'?messages:receipts).push(item.packet);
  }
  // Receipts have no receipt-of-receipt. Reserve sender capacity and rotate
  // their retry batch so old responses cannot indefinitely block newer ones.
  const count=Math.min(receipts.length,messages.length?8:MAX_QUEUE_ROWS);
  const offset=receipts.length?Math.floor(Date.now()/30000)*count%receipts.length:0;
  return [...messages.slice(0,MAX_QUEUE_ROWS-count),...[...receipts.slice(offset),...receipts.slice(0,offset)].slice(0,count)];
 }
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;
 const changed=()=>{channel?.postMessage('changed');onUpdate();};
 const report=value=>{
  assert(value&&states.has(value.state)&&Number.isInteger(value.peers)&&value.peers>=0&&value.peers<=8,'Invalid Bluetooth status.');
  radio={state:value.state,peers:value.peers};onState({...radio,supported});
 };
 function command(op,extra={}){
  if(!supported||closed)return Promise.reject(Error('Bluetooth delivery needs the installed Lenz app.'));
  const id=String(++sequence),message=JSON.stringify({id,op,...extra});
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{requests.delete(id);reject(Error('Bluetooth did not respond. Your message stays queued.'));},10000);
   requests.set(id,{resolve,reject,timer});
   try{port.postMessage(message);}
   catch(error){clearTimeout(timer);requests.delete(id);reject(error);}
  });
 }
 async function receive(message){
  const captured=owner,generation=run;
  if(!captured||closed||radio.state!=='ready')return;
  const envelope=decode(message.payload);await validateEnvelope(envelope);
  if(closed||generation!==run||(await readState()).identity?.profile.id!==captured)return;
  // Radio peers are untrusted. Authorize relay only after both signatures check.
  assert(typeof message.token==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(message.token)&&Number.isInteger(message.hops)&&message.hops>=1&&message.hops<=7,'Invalid Bluetooth relay token.');
  if(envelope.packet.to!==captured){
   await readStateLocked(async state=>{
    assert(!closed&&generation===run&&state.identity?.profile.id===captured,'The Bluetooth account changed.');
    await validateEnvelope(envelope);
    assert(!closed&&generation===run,'The Bluetooth account changed.');
    await command('forward',{token:message.token});
   });return;
  }
  await updateState(async state=>{
   assert(!closed&&generation===run&&state.identity?.profile.id===captured,'The Bluetooth account changed.');
   await validateEnvelope(envelope);
   if(await acceptDefiReply(state,defiConfig,envelope.packet))return;
   const courier=state.contacts.some(p=>p.id===envelope.packet.from)&&contactRequestStatus(state,envelope.packet.from)==='accepted'?await acceptDefiCourierEnvelope(state,defiConfig,envelope):null;
   if(courier){if(courier.receipt){const row=state.messages.find(r=>r.receiptToShare?.id===courier.receipt.id);if(row)row.receiptDeliveryRequested=true;}return;}
   await receiveDeliveredPacket(state,envelope.packet,{contract,sender:envelope.sender});
   assert(!closed&&generation===run&&state.identity?.profile.id===captured,'The Bluetooth account changed.');
  });
  changed();void tick().catch(onError);
  // Local receipt persistence must succeed independently of relay capacity.
  try{await readStateLocked(async state=>{
   if(closed||generation!==run||state.identity?.profile.id!==captured)return;
   await command('discard',{token:message.token});
  });}catch(error){onError(error);}
 }
 function message(value){
  if(closed)return;
  try{
   const item=typeof value==='string'?JSON.parse(value):value;
   assert(item&&typeof item==='object'&&!Array.isArray(item),'Invalid Bluetooth reply.');
   if(typeof item.id==='string'){
    const request=requests.get(item.id);if(!request)return;
    requests.delete(item.id);clearTimeout(request.timer);
    if(item.ok===true)request.resolve(item.result);
    else request.reject(Error(typeof item.error?.message==='string'?item.error.message:'Bluetooth delivery failed.'));
   }else if(item.type==='status')report(item);
   else if(item.type==='envelope'){
    assert(typeof item.payload==='string'&&item.payload.length<=Math.ceil(MAX_ENVELOPE_BYTES/3)*4,'Bluetooth envelope is too large.');
    const size=item.payload.length;assert(intakeRows<16&&intakeBytes+size<=Math.ceil(MAX_QUEUE_BYTES/3)*4,'Bluetooth intake is full.');intakeRows++;intakeBytes+=size;
    // Serial intake preserves original wallet state and receipt ordering.
    receiving=receiving.then(()=>receive(item)).catch(onError).finally(()=>{intakeRows--;intakeBytes-=size;});
   }
  }catch(error){onError(error);}
 }
 function bootstrap(event){
  const origin=location.origin;
  if(closed||!nativeEvent(event))return;
  let value;try{value=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
  if(value?.type==='lenz-bluetooth-ready'&&value.version===1){
   if(supported)return;
   if(event.ports?.length!==1)return;
   port=event.ports[0];port.onmessage=e=>message(e.data);port.start();
   supported=true;report({state:'off',peers:0});dispatchEvent(new Event('lenz-bluetooth-ready'));
   void command('status').then(report).catch(onError);
  }
 }
 async function start(){
  assert(!closed&&supported,'Bluetooth delivery needs the installed Lenz app.');
  const state=await readState();assert(state.identity,'Create your Lenz profile first.');
  const next=state.identity.profile.id;
  if(owner!==next){run++;sent.clear();owner=next;}
  const captured=run,result=await command('start',{owner:next});
  if(closed||run!==captured||(await readState()).identity?.profile.id!==next){await stop();throw Error('The Bluetooth account changed.');}
  if(result)report(result);await tick();return {...radio,supported};
 }
 async function stop(){
  run++;owner=null;sent.clear();
  if(supported&&!closed)await command('stop');
  report({state:'off',peers:0});
 }
 async function tick(){
  if(closed||syncing||!supported||radio.state!=='ready'||!owner)return;
  syncing=true;const captured=owner,generation=run;
  try{
   const snapshot=await readState();
   if(snapshot.identity?.profile.id!==captured){await stop();return;}
   const packets=await sources(snapshot),ids=new Set(packets.map(p=>p.id));
   const existing=snapshot.bluetoothOutbox??[];
   assert(Array.isArray(existing)&&existing.length<=MAX_QUEUE_ROWS&&bytes(existing).length<=MAX_QUEUE_BYTES,'Bluetooth storage is full or invalid. Your originals stay saved.');
   for(const envelope of existing){
    if(!ids.has(envelope.packet?.id)||snapshot.messages.some(r=>r.packet.id===envelope.packet.id&&r.receivedReceipt)||envelope.expiresAt<=Date.now()){
     await command('forget',{payload:encode(envelope)});sent.delete(envelope.id);
    }
   }
   await updateState(async state=>{
    assert(!closed&&generation===run&&state.identity?.profile.id===captured,'The Bluetooth account changed.');
    const requested=await sources(state);
    const queue=(state.bluetoothOutbox??[]).filter(e=>e.expiresAt>Date.now()&&e.packet?.from===captured&&requested.some(p=>same(p,e.packet)));
    for(const envelope of queue)await validateEnvelope(envelope);
    for(const packet of requested){
     if(queue.some(e=>same(e.packet,packet)))continue;
     const envelope=await wrapForCarrier(state.identity,packet);
     // Drain admitted items even when later originals must wait for capacity.
     if(queue.length>=MAX_QUEUE_ROWS||bytes([...queue,envelope]).length>MAX_QUEUE_BYTES)continue;
     queue.push(envelope);
    }
    state.bluetoothOutbox=queue;
   },{markBackup:false});
   const current=await readState();
   for(const envelope of current.bluetoothOutbox??[]){
    if(closed||generation!==run)return;
    if(sent.has(envelope.id))continue;
    await readStateLocked(async state=>{
     assert(state.identity?.profile.id===captured&&!closed&&generation===run,'The Bluetooth account changed.');
     const requested=await sources(state);
     if(!requested.some(p=>same(p,envelope.packet)))return;
     await validateEnvelope(envelope);assert(!closed&&generation===run,'The Bluetooth account changed.');await command('send',{payload:encode(envelope)});sent.set(envelope.id,envelope.packet.id);
    });
   }
   changed();
  }finally{syncing=false;}
 }
 addEventListener('message',bootstrap);
 if(nativeHandoff){const event=nativeHandoff;nativeHandoff=null;bootstrap(event);}
 return {get supported(){return supported;},get status(){return {...radio,supported};},start,stop,tick,setDefiConfig:value=>{defiConfig=value?structuredClone(value):null;},
  close(){if(closed)return;void stop().catch(()=>{});closed=true;removeEventListener('message',bootstrap);port?.close();channel?.close();for(const request of requests.values()){clearTimeout(request.timer);request.reject(Error('Bluetooth session closed.'));}requests.clear();}
 };
}
