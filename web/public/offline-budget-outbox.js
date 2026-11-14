import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,openMessage,validateProfile} from './peer-crypto.js';
import {PUBLIC_BUDGET_REHEARSAL,checkBudgetPacket,budgetDigest,budgetNonceKey,sealBudgetPacket} from './offline-budget.js';
import {wrapForCarrier,validateEnvelope,carrierConfig,carrierOrigin,carrierPost,CARRIER_DOMAIN} from './carrier-protocol.js';
const aad=s=>bytes(['lenz/offline-budget-outbox/v1',s.identity.profile.id]);
const MAX_BOX_BYTES=2000000;
// Each admitted row must still fit four destination records and their replies.
const DELIVERY_RESERVE_BYTES=4096;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function status(row,now=Date.now()){
 return now>=Number(BigInt(row.packet.order.deadline)*1000n)?'expired-unresolved':row.acknowledgement?'executor-stored':row.storedBy.length&&row.carrierEnvelope?.expiresAt>now?'carrier-stored':'queued';
}
function view(row){return {id:row.id,budgetId:row.packet.order.budgetId,nonce:row.packet.order.nonce,debit:(BigInt(row.packet.order.amount)+BigInt(row.packet.order.fee)).toString(),status:status(row),executor:row.executor.id,createdAt:row.createdAt,executable:false};}
async function read(s){
 assert(s.identity,'Create a Lenz profile first.');if(!s.offlineBudgetKey&&!s.offlineBudgetBox)return [];
 assert(s.offlineBudgetKey&&keysAre(s.offlineBudgetBox,['iv','ciphertext']),'Offline authorization storage is incomplete.');
 const box=s.offlineBudgetBox;assert(typeof box.ciphertext==='string'&&box.ciphertext.length<=MAX_BOX_BYTES*2,'Offline authorization storage is too large.');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(box.iv),additionalData:aad(s)},s.offlineBudgetKey,unhex(box.ciphertext)),rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
 assert(Array.isArray(rows)&&rows.length<=100,'Offline authorization history is full.');
 const ids=new Set(),slots=new Set();
 for(const row of rows){
  assert(keysAre(row,['id','slot','packet','expected','executor','createdAt','envelope','carrierEnvelope','sharedWith','storedBy','acknowledgement'])&&Number.isSafeInteger(row.createdAt)&&row.createdAt>0,'Invalid saved offline authorization.');
  checkBudgetPacket(row.packet,row.expected,{now:Math.floor(row.createdAt/1000)});
  assert(row.id===budgetDigest(row.packet.domain,row.packet.order)&&row.slot===slot(row.packet)&&!ids.has(row.id)&&!slots.has(row.slot),'Conflicting offline authorization.');ids.add(row.id);slots.add(row.slot);
  await validateProfile(row.executor);assert(row.envelope.from===s.identity.profile.id&&row.envelope.to===row.executor.id&&same(await openMessage(s.identity,row.executor,row.envelope),row.packet),'Saved offline handoff changed.');
  carrierConfig({version:1,carriers:row.sharedWith});carrierConfig({version:1,carriers:row.storedBy});
  assert(row.storedBy.every(origin=>row.sharedWith.includes(origin)),'Invalid carrier acknowledgements.');
  if(row.carrierEnvelope){await validateEnvelope(row.carrierEnvelope,row.carrierEnvelope.createdAt);assert(row.carrierEnvelope.createdAt>=row.createdAt&&same(row.carrierEnvelope.packet,row.envelope),'Saved carrier envelope changed.');}
  if(row.acknowledgement)checkAck(row.acknowledgement,row,Math.max(Date.now(),row.acknowledgement.acceptedAt));
 }
 return rows;
}
async function save(s,rows){
 const plaintext=bytes(rows);assert(plaintext.length+16<=MAX_BOX_BYTES,'Offline authorization storage is full.');
 s.offlineBudgetKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.offlineBudgetKey,plaintext);s.offlineBudgetBox={iv:hex(iv),ciphertext:hex(ciphertext)};
}
const slot=budgetNonceKey;
function checkAck(ack,row,now){assert(keysAre(ack,['type','digest','acceptedAt'])&&ack.type==='lenz/budget-ack/v1'&&ack.digest===row.id&&Number.isSafeInteger(ack.acceptedAt)&&ack.acceptedAt>=row.createdAt&&ack.acceptedAt<=now+60000&&BigInt(ack.acceptedAt)<BigInt(row.packet.order.deadline)*1000n,'Invalid executor storage acknowledgement.');}
export async function queueOfflineBudget(packet,expected,executor,{publicRehearsalConsent=false}={}){
 const p=structuredClone(packet),e=structuredClone(expected),peer=await validateProfile(structuredClone(executor));
 assert(publicRehearsalConsent===true&&e.privacyPolicy===PUBLIC_BUDGET_REHEARSAL,'This local rehearsal requires explicit public-execution consent.');
 return updateState(async s=>{const rows=await read(s),id=budgetDigest(p.domain,p.order),existing=rows.find(r=>r.id===id);
  if(existing){assert(same(existing.packet,p)&&same(existing.expected,e)&&same(existing.executor,peer),'Offline authorization already has different delivery terms.');return view(existing);}
  checkBudgetPacket(p,e);assert(rows.length<100,'Offline authorization history is full.');assert(!rows.some(r=>r.slot===slot(p)),'This budget nonce is already reserved. Reconcile it before authorizing anything else.');
  const createdAt=Date.now(),envelope=await sealBudgetPacket(s.identity,peer,p,e),carrierEnvelope=await wrapForCarrier(s.identity,envelope,createdAt);
  rows.push({id,slot:slot(p),packet:p,expected:e,executor:peer,createdAt,envelope,carrierEnvelope,sharedWith:[],storedBy:[],acknowledgement:null});
  const reserve=rows.reduce((total,row)=>total+Math.max(0,DELIVERY_RESERVE_BYTES-bytes([row.sharedWith,row.storedBy,row.acknowledgement]).length),0);
  assert(bytes(rows).length+16+reserve<=MAX_BOX_BYTES,'Offline authorization storage is full.');
  await save(s,rows);checkBudgetPacket(p,e);return view(rows.at(-1));
 });
}
export async function listOfflineBudgets(){return (await read(await readState())).map(view);}
export async function offlineBudgetCourierItems(s){
 return(await read(s)).map(row=>({packet:row.envelope,kind:'budget-approval',acknowledged:!!row.acknowledgement,sendable:!row.acknowledgement&&BigInt(row.packet.order.deadline)*1000n>BigInt(Date.now()),expiresAt:Number(BigInt(row.packet.order.deadline)*1000n)}));
}
export async function offlineBudgetHandoff(id,{carrier=false,origin}={}){
 return updateState(async s=>{const rows=await read(s),row=rows.find(r=>r.id===id);assert(row,'Offline authorization not found.');
  if(carrier){
   assert(s.carrier?.enabled===true,'Turn on carrier delivery before sharing this authorization.');carrierOrigin(origin);
   if(!row.sharedWith.includes(origin)){assert(row.sharedWith.length<4,'An authorization can use at most four carriers.');row.sharedWith.push(origin);}
  }
  checkBudgetPacket(row.packet,row.expected);
  // Retention may expire before the signed instruction. Renew only the outer
  // wrapper; its stable encrypted packet still identifies the same authorization.
  if(!row.carrierEnvelope||row.carrierEnvelope.expiresAt<=Date.now()){
   row.carrierEnvelope=await wrapForCarrier(s.identity,row.envelope);row.storedBy=[];
  }
  await save(s,rows);
  await validateEnvelope(row.carrierEnvelope);checkBudgetPacket(row.packet,row.expected);return structuredClone(row.carrierEnvelope);
 });
}
export async function sendOfflineBudget(id,delivery,{post=carrierPost}={}){
 const origins=carrierConfig(structuredClone(delivery));assert(origins.length>0,'Choose a configured carrier.');let stored=0;
 for(const origin of origins){const envelope=await offlineBudgetHandoff(id,{carrier:true,origin}),ack=await post(origin,'/v1/store',envelope,{limit:1024});
  assert(keysAre(ack,['type','id','status','expiresAt'])&&ack.type===CARRIER_DOMAIN&&ack.id===envelope.id&&ack.status==='stored'&&ack.expiresAt===envelope.expiresAt,'Carrier did not confirm this envelope.');
  await updateState(async s=>{const rows=await read(s),row=rows.find(r=>r.id===id);assert(row&&same(row.carrierEnvelope,envelope),'Saved handoff changed.');if(!row.storedBy.includes(origin)){row.storedBy.push(origin);await save(s,rows);}});stored++;
 }return {state:'carrier-stored',carriers:stored};
}
export async function recordOfflineBudgetAck(id,envelope){
 const incoming=structuredClone(envelope);return updateState(s=>acceptOfflineBudgetAck(s,incoming,id));
}
export async function acceptOfflineBudgetAck(s,incoming,id=null){
 const rows=await read(s),candidate=rows.find(r=>id?r.id===id:r.executor.id===incoming.from);assert(candidate,'Offline authorization not found.');
 assert(incoming.from===candidate.executor.id&&incoming.to===s.identity.profile.id,'Wrong executor receipt direction.');
 const ack=await openMessage(s.identity,candidate.executor,incoming),row=rows.find(r=>r.id===ack?.digest);
 assert(row&&(!id||row.id===id)&&row.executor.id===incoming.from,'Wrong executor receipt direction.');checkAck(ack,row,Date.now());
 if(!row.acknowledgement){row.acknowledgement=ack;await save(s,rows);}return view(row);
}
