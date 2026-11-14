import {readState,readStateLocked,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,sealMessage,openMessage,validateProfile} from './peer-crypto.js';
import {wrapForCarrier,validateEnvelope} from './carrier-protocol.js';
import {savedPackets,sendable} from './carrier-client.js';
import {receivePacket} from './receive-packet.js';
import {DELIVERY_RECEIPT,prepareDeliveryReceipt,deliveryAcknowledged} from './delivery-receipts.js';
import {defiCourierItems,acceptDefiCourierEnvelope} from './defi-courier.js';
import {budgetCourierItems,acceptBudgetCourierEnvelope} from './budget-courier.js';
import {confidentialCourierItems,acceptConfidentialCourierEnvelope} from './intents-courier.js';
import {confidentialSpendOutbox} from './intents-spend-outbox.js';

export const COURIER='lenz/nearby-courier/v1';
const MAX_ITEM_BYTES=90000,MAX_ROWS=32,MAX_BYTES=4000000,MAX_PER_SENDER=8;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rowKey=r=>r.kind+':'+r.envelope.id;
const nextPeer=r=>r.kind==='outgoing'?r.via:r.envelope.packet.to;
const body=r=>({kind:COURIER,operation:r.kind==='outgoing'?'store':'deliver',envelope:r.envelope});
const aad=s=>bytes([COURIER,s.identity.profile.id]);
const current=e=>assert(e.expiresAt>Date.now(),'Courier delivery window expired. The source item remains saved.');
const currentItem=item=>assert(!item.expiresAt||item.expiresAt>Date.now(),'This approval expired for delivery. The signed request remains saved.');
const contact=(s,id)=>{const peer=s.contacts.find(c=>c.id===id);assert(peer,'Add and verify this contact first.');return peer;};
async function sourceItems(s,{contract=null,defiConfig=null}={},ids=null){
 const items=[];
 for(const packet of savedPackets(s)){
  if(ids&&!ids.has(packet.id))continue;
  const record=s.messages.find(r=>r.packet.id===packet.id);
  const acknowledged=record?await deliveryAcknowledged(s,record):false;
  let allowed=false;try{allowed=await sendable(s,packet,contract);}catch{}
  items.push({packet,kind:'message',sendable:allowed&&!acknowledged,acknowledged,expiresAt:null});
 }
 if(ids&&items.length===ids.size)return items;
 return [...items,...(await defiCourierItems(s,defiConfig)),...(await budgetCourierItems(s)),...(await confidentialCourierItems(s))].filter(item=>!ids||ids.has(item.packet.id));
}

async function load(s){
 assert(s.identity,'Create a Lenz profile first.');
 if(!s.courierKey&&!s.courierBox)return {version:1,enabled:false,rows:[]};
 assert(s.courierKey&&keysAre(s.courierBox,['iv','ciphertext'])&&typeof s.courierBox.ciphertext==='string'&&s.courierBox.ciphertext.length<=MAX_BYTES*2,'Courier storage is incomplete or too large.');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(s.courierBox.iv),additionalData:aad(s)},s.courierKey,unhex(s.courierBox.ciphertext));
 const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
 assert(keysAre(v,['version','enabled','rows'])&&v.version===1&&typeof v.enabled==='boolean'&&Array.isArray(v.rows)&&v.rows.length<=MAX_ROWS,'Invalid courier storage.');
 const seen=new Set();
 for(const r of v.rows){
  assert(keysAre(r,['kind','via','envelope','packet','peer','sentAt'])&&['outgoing','carried'].includes(r.kind)&&/^[0-9a-f]{64}$/.test(r.via)&&(r.sentAt===null||Number.isSafeInteger(r.sentAt)&&r.sentAt>0),'Invalid courier record.');
  await validateEnvelope(r.envelope,r.envelope.createdAt);
  assert(bytes(r.envelope).length<=MAX_ITEM_BYTES&&!seen.has(rowKey(r)),'Invalid or duplicate courier item.');seen.add(rowKey(r));
  assert(r.kind==='outgoing'?r.envelope.packet.from===s.identity.profile.id:r.envelope.packet.from===r.via&&r.envelope.packet.to!==s.identity.profile.id,'Courier record belongs to another identity.');
  if(r.packet){
   await validateProfile(r.peer);assert(r.peer.id===nextPeer(r)&&r.packet.from===s.identity.profile.id&&r.packet.to===r.peer.id,'Courier destination changed.');
   assert(same(await openMessage(s.identity,r.peer,r.packet),body(r)),'Saved courier handoff changed.');
  }else assert(r.peer===null&&r.sentAt===null,'Incomplete courier handoff.');
 }
 return v;
}
function storageBytes(v){
 const plain=bytes(v);
 // Reserve future forwarding wrappers and receipt timestamps at admission.
 const reserve=v.rows.reduce((total,r)=>total+128+(r.packet?0:bytes(body(r)).length*2+2048),0);
 return plain.length+16+reserve;
}
async function save(s,v){
 assert(storageBytes(v)<=MAX_BYTES,'Courier storage is full. Existing items remain saved.');
 s.courierKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.courierKey,bytes(v));
 s.courierBox={iv:hex(iv),ciphertext:hex(ciphertext)};
}
async function append(s,v,kind,via,envelope){
 assert(bytes(envelope).length<=MAX_ITEM_BYTES,'This item is too large for nearby courier delivery. Its saved file is unchanged.');
 await validateEnvelope(envelope);
 // Expired transport copies can leave the carrier; source payment reservations cannot.
 v.rows=v.rows.filter(r=>r.kind==='outgoing'||r.envelope.expiresAt>Date.now());
 const key=kind+':'+envelope.id,existing=v.rows.find(r=>rowKey(r)===key);
 if(existing){assert(existing.via===via&&same(existing.envelope,envelope),'This item already has different courier terms.');return existing;}
 assert(v.rows.length<MAX_ROWS,'Courier storage is full. Existing items remain saved.');
 assert(kind!=='carried'||v.rows.filter(r=>r.kind==='carried'&&r.via===via).length<MAX_PER_SENDER,'This sender already has eight carried items.');
 const row={kind,via,envelope:structuredClone(envelope),packet:null,peer:null,sentAt:null};v.rows.push(row);return row;
}
async function sealHandoff(s,row){
 const peer=await validateProfile(contact(s,nextPeer(row)));
 if(!row.packet){row.peer=peer;row.packet=await sealMessage(s.identity,peer,body(row));}
 return row.packet;
}
async function outgoing(s,v,packet,courierId,{returnReceipt=false}={}){
 assert(packet.from===s.identity.profile.id&&courierId!==packet.to&&courierId!==packet.from,'Choose a courier other than the recipient.');
 await validateProfile(contact(s,courierId));
 const old=v.rows.find(r=>r.kind==='outgoing'&&r.envelope.packet.id===packet.id);
 const occupied=v.rows.filter(r=>r!==old&&r.kind==='outgoing'&&r.via===courierId&&r.envelope.expiresAt>Date.now()).length;
 assert(occupied<MAX_PER_SENDER,'Eight items are already assigned to this courier. Use another courier or wait for their delivery window to end.');
 if(old){
  assert(same(old.envelope.packet,packet)&&(old.via===courierId||returnReceipt),'This item already has a different courier.');
  if(old.via!==courierId){old.via=courierId;old.packet=null;old.peer=null;old.sentAt=null;}
  if(old.envelope.expiresAt<=Date.now()){old.envelope=await wrapForCarrier(s.identity,packet);old.packet=null;old.peer=null;old.sentAt=null;}
  await sealHandoff(s,old);return old;
 }
 const row=await append(s,v,'outgoing',courierId,await wrapForCarrier(s.identity,packet));await sealHandoff(s,row);return row;
}
export async function setCourierEnabled(enabled){
 assert(typeof enabled==='boolean','Choose whether to use couriers.');
 return updateState(async s=>{const v=await load(s);v.enabled=enabled;await save(s,v);});
}
export async function courierCandidates(courierId,options={}){
 const s=await readState(),v=await load(s);await validateProfile(contact(s,courierId));
 const groups=new Map();
 for(const item of await sourceItems(s,options)){
  const packet=item.packet;
  if(packet.to===courierId||packet.from!==s.identity.profile.id)continue;
  const old=v.rows.find(r=>r.kind==='outgoing'&&r.envelope.packet.id===packet.id);
  if(old&&(old.via!==courierId||old.envelope.expiresAt>Date.now()))continue;
  if(!item.sendable)continue;
  const group=groups.get(packet.to)??{id:packet.to,messageIds:[],remaining:0,vault:structuredClone(v)};
  groups.set(packet.to,group);
  const candidate=structuredClone(group.vault);
  try{
   await outgoing(s,candidate,packet,courierId);
   assert(storageBytes(candidate)<=MAX_BYTES,'Courier storage is full.');
   group.vault=candidate;group.messageIds.push(packet.id);
  }catch{group.remaining++;}
 }
 return [...groups.values()].map(({vault,...group})=>group);
}
export async function queueCourierItems(messageIds,courierId,options={}){
 const ids=structuredClone(messageIds);
 const settings=structuredClone(options);
 assert(Array.isArray(ids)&&ids.length>0&&ids.length<=MAX_ROWS&&new Set(ids).size===ids.length,'Choose saved items to send.');
 return updateState(async s=>{
  const v=await load(s);assert(v.enabled,'Turn on carried deliveries first.');const keys=[],items=await sourceItems(s,settings,new Set(ids)),selected=[];
  for(const id of ids){
   const item=items.find(item=>item.packet.id===id);assert(item?.sendable,'This saved item cannot be sent.');selected.push(item);
   keys.push(rowKey(await outgoing(s,v,item.packet,courierId)));
  }
  await confidentialSpendOutbox.markShared(s,selected.map(item=>item.packet.id));await save(s,v);selected.forEach(currentItem);return keys;
 });
}
async function eligible(s,r,options){
 if(r.envelope.expiresAt<=Date.now())return false;
 if(r.kind==='carried')return {expiresAt:null};
 const item=(await sourceItems(s,options,new Set([r.envelope.packet.id]))).find(item=>same(item.packet,r.envelope.packet));
 return item?.sendable||item?.acknowledged?item:false;
}
export async function courierHandoff(peerId,options={}){
 const settings=structuredClone(options),skipped=new Set(settings.exclude??[]);
 return updateState(async s=>{
  const v=await load(s);if(!v.enabled)return null;contact(s,peerId);
  for(const row of v.rows){
   if(nextPeer(row)!==peerId||skipped.has(rowKey(row)))continue;
   const item=await eligible(s,row,settings);if(!item||item.acknowledged)continue;
   const packet=await sealHandoff(s,row);await save(s,v);await validateEnvelope(row.envelope);current(row.envelope);
   currentItem(item);
   return {id:rowKey(row),packet:structuredClone(packet)};
  }
  return null;
 });
}
export async function dispatchCourierItem(id,packet,dispatch,options={}){
 const settings=structuredClone(options);
 return readStateLocked(async s=>{
  const v=await load(s),row=v.rows.find(r=>rowKey(r)===id);
  assert(v.enabled&&row&&same(row.packet,packet),'Courier delivery stopped. Your item remains saved.');
  const item=await eligible(s,row,settings);assert(item,'Courier delivery stopped. Your item remains saved.');
  // An authenticated receipt may arrive while the data channel hashes a queued
  // copy. Completion makes that copy unnecessary; it is not a delivery failure.
  if(item.acknowledged)return {delivery:Promise.resolve()};
  await validateProfile(contact(s,nextPeer(row)));await validateEnvelope(row.envelope);
  current(row.envelope);currentItem(item);
  return {delivery:dispatch()};
 });
}
export async function markCourierSent(id,packet){
 const sent=structuredClone(packet);
 return updateState(async s=>{const v=await load(s),row=v.rows.find(r=>rowKey(r)===id);if(row&&same(row.packet,sent)){row.sentAt=Date.now();await save(s,v);}});
}
// Caller commits this with received wallet state before the link acknowledges it.
export async function acceptCourierPacket(s,peerId,packet,{contract=null,defiConfig=null}={}){
 assert(packet.from===peerId&&packet.to===s.identity?.profile.id,'Wrong courier direction.');
 const payload=await openMessage(s.identity,contact(s,peerId),packet);
 if(payload?.kind!==COURIER)return null;
 assert(keysAre(payload,['kind','operation','envelope'])&&['store','deliver'].includes(payload.operation),'Invalid courier request.');
 const v=await load(s);assert(v.enabled,'Carried deliveries are turned off.');
 const e=payload.envelope;assert(bytes(e).length<=MAX_ITEM_BYTES,'Carried item is too large.');await validateEnvelope(e);
 if(payload.operation==='store'){
  assert(e.packet.from===peerId&&e.packet.to!==s.identity.profile.id,'Only the original sender can deposit this item.');
  await append(s,v,'carried',peerId,e);await save(s,v);await validateEnvelope(e);current(e);return {kind:COURIER,state:'stored'};
 }
 assert(e.packet.to===s.identity.profile.id&&e.packet.from!==peerId,'This carried item has a different recipient.');
 const defi=await acceptConfidentialCourierEnvelope(s,e)??await acceptBudgetCourierEnvelope(s,e)??await acceptDefiCourierEnvelope(s,defiConfig,e);
 if(defi){
  if(defi.receipt)await outgoing(s,v,defi.receipt,peerId,{returnReceipt:true});
  await save(s,v);current(e);currentItem(defi);return {kind:COURIER,state:'received'};
 }
 const result=await receivePacket(s,e.packet,false,contract);
 if(result.kind!==DELIVERY_RECEIPT){
  const receipt=await prepareDeliveryReceipt(s,e.packet.id);await outgoing(s,v,receipt,peerId,{returnReceipt:true});
 }
 await save(s,v);await validateEnvelope(e);current(e);return {kind:COURIER,state:'received',duplicate:result.duplicate};
}
export async function receiveCourierPacket(peerId,packet,options={}){
 const incoming=structuredClone(packet),settings=structuredClone(options);
 return updateState(s=>acceptCourierPacket(s,peerId,incoming,settings));
}
export async function forgetCourierItem(id){
 return updateState(async s=>{const v=await load(s);v.rows=v.rows.filter(r=>rowKey(r)!==id);await save(s,v);});
}
export async function courierSummary(options={}){
 const s=await readState(),v=await load(s),outgoing=[],carried=[],ids=new Set(v.rows.filter(r=>r.kind==='outgoing').map(r=>r.envelope.packet.id)),items=ids.size?await sourceItems(s,options,ids):[];
 for(const r of v.rows){
  const item=r.kind==='outgoing'?items.find(item=>same(item.packet,r.envelope.packet)):null;
  const received=!!item?.acknowledged;
  const status=received?'received':r.envelope.expiresAt<=Date.now()||(item?.expiresAt&&item.expiresAt<=Date.now())?'expired':r.kind==='outgoing'&&!item?'unavailable':r.sentAt?(r.kind==='outgoing'?'with-courier':'forwarded'):'waiting';
  const row={id:rowKey(r),messageId:r.envelope.packet.id,from:r.envelope.packet.from,to:r.envelope.packet.to,via:r.via,status,purpose:item?.kind??'sealed-item'};
  (r.kind==='outgoing'?outgoing:carried).push(row);
 }
 return {enabled:v.enabled,outgoing,carried};
}
