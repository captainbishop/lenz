import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,openMessage,sealMessage,validateProfile} from './peer-crypto.js';
import {validateEnvelope} from './carrier-protocol.js';
import {checkBudgetPolicy,checkBudgetPacket,budgetDigest,budgetNonceKey} from './offline-budget.js';
import {offlineBudgetCourierItems,acceptOfflineBudgetAck} from './offline-budget-outbox.js';

const DOMAIN='lenz/budget-device-inbox/v1',MAX_BYTES=4000000,MAX_ROWS=32,PER_SENDER=8;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const aad=s=>bytes([DOMAIN,s.identity.profile.id]);
const policyKey=p=>[p.sender,p.expected.domain.chainId,p.expected.domain.verifyingContract,p.expected.budgetId].join(':');
function policies(value){
 assert(Array.isArray(value)&&value.length>0&&value.length<=MAX_ROWS,'Choose independently checked budgets first.');
 const ids=new Set();
 for(const p of value){assert(keysAre(p,['sender','expected'])&&/^[0-9a-f]{64}$/.test(p.sender),'Invalid approved sender.');checkBudgetPolicy(p.expected);const key=policyKey(p);assert(!ids.has(key),'Duplicate approved budget.');ids.add(key);}
 return structuredClone(value);
}
async function read(s){
 assert(s.identity,'Create a Lenz profile first.');
 if(!s.budgetInboxKey&&!s.budgetInboxBox)return {version:1,enabled:false,policies:[],rows:[]};
 const box=s.budgetInboxBox;assert(s.budgetInboxKey&&keysAre(box,['iv','ciphertext'])&&typeof box.ciphertext==='string'&&box.ciphertext.length<=MAX_BYTES*2,'Budget inbox storage is incomplete or too large.');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(box.iv),additionalData:aad(s)},s.budgetInboxKey,unhex(box.ciphertext)),v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 assert(keysAre(v,['version','enabled','policies','rows'])&&v.version===1&&typeof v.enabled==='boolean'&&Array.isArray(v.policies)&&Array.isArray(v.rows)&&v.rows.length<=MAX_ROWS,'Invalid budget inbox.');
 if(v.policies.length)policies(v.policies);else assert(!v.enabled,'No approved budgets.');
 const ids=new Set(),slots=new Set();
 for(const r of v.rows){
  assert(keysAre(r,['id','slot','envelope','sender','expected','packet','receipt','storedAt'])&&Number.isSafeInteger(r.storedAt)&&r.storedAt>0,'Invalid saved budget request.');
  await validateProfile(r.sender);await validateEnvelope(r.envelope,r.storedAt);
  assert(r.envelope.packet.from===r.sender.id&&r.envelope.packet.to===s.identity.profile.id,'Saved budget direction changed.');
  const packet=checkBudgetPacket(await openMessage(s.identity,r.sender,r.envelope.packet),r.expected,{now:Math.floor(r.storedAt/1000)});
  assert(same(packet,r.packet)&&r.id===budgetDigest(packet.domain,packet.order)&&r.slot===budgetNonceKey(packet)&&!ids.has(r.id)&&!slots.has(r.slot),'Conflicting saved budget requests.');
  const receipt=await openMessage(s.identity,r.sender,r.receipt);
  assert(keysAre(receipt,['type','digest','acceptedAt'])&&receipt.type==='lenz/budget-ack/v1'&&receipt.digest===r.id&&receipt.acceptedAt===r.storedAt&&r.receipt.from===s.identity.profile.id&&r.receipt.to===r.sender.id,'Saved budget receipt changed.');
  ids.add(r.id);slots.add(r.slot);
 }
 return v;
}
async function save(s,v){
 const raw=bytes(v);assert(raw.length+16<=MAX_BYTES,'Budget inbox is full. Existing requests remain saved.');
 s.budgetInboxKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.budgetInboxKey,raw);
 s.budgetInboxBox={iv:hex(iv),ciphertext:hex(ciphertext)};
}
export async function setBudgetInboxEnabled(enabled,approved=[],{publicRehearsalConsent=false}={}){
 assert(typeof enabled==='boolean','Choose whether to receive approved spending requests.');
 if(enabled)assert(publicRehearsalConsent===true,'This local rehearsal requires explicit public-execution consent.');
 const checked=enabled?policies(approved):null;
 return updateState(async s=>{const v=await read(s);
  if(enabled){for(const p of checked){assert(s.contacts.some(c=>c.id===p.sender),'Add and verify the approved sender first.');const previous=v.policies.find(row=>policyKey(row)===policyKey(p));assert(!previous||same(previous,p),'The approved budget policy changed.');}v.policies=checked;}
  v.enabled=enabled;await save(s,v);
 });
}
export async function budgetInboxSummary(){
 const v=await read(await readState());return {enabled:v.enabled,requests:v.rows.map(r=>({id:r.id,from:r.sender.id,sender:r.sender.name,status:BigInt(Date.now())>=BigInt(r.packet.order.deadline)*1000n?'expired':'stored',budgetId:r.packet.order.budgetId,nonce:r.packet.order.nonce,debit:(BigInt(r.packet.order.amount)+BigInt(r.packet.order.fee)).toString(),executable:false}))};
}
export async function budgetCourierItems(s){
 const outgoing=await offlineBudgetCourierItems(s),v=await read(s);
 return [...outgoing,...v.rows.map(r=>({packet:r.receipt,kind:'budget-receipt',acknowledged:false,sendable:true,expiresAt:null}))];
}
// The surrounding courier transaction persists intake and the receipt route together.
export async function acceptBudgetCourierEnvelope(s,envelope){
 const sender=s.contacts.find(c=>c.id===envelope.packet.from);assert(sender,'Add and verify the original sender first.');
 const payload=await openMessage(s.identity,sender,envelope.packet);
 if(payload?.type==='lenz/budget-ack/v1'){await acceptOfflineBudgetAck(s,envelope.packet);return {receipt:null,expiresAt:null};}
 if(payload?.type!=='lenz/offline-budget/v1')return null;
 await validateEnvelope(envelope);const v=await read(s);assert(v.enabled,'This device is not receiving spending requests.');
 // The sender's packet cannot supply or replace the receiver's trusted policy.
 const policy=v.policies.find(p=>p.sender===sender.id&&p.expected.domain.verifyingContract===payload.domain?.verifyingContract&&p.expected.domain.chainId===payload.domain?.chainId&&p.expected.budgetId===payload.order?.budgetId);
 assert(policy,'This sender and budget have not been approved.');
 const packet=checkBudgetPacket(payload,policy.expected),id=budgetDigest(packet.domain,packet.order),slot=budgetNonceKey(packet);
 let row=v.rows.find(r=>r.id===id);
 if(row){assert(row.sender.id===sender.id&&same(row.packet,packet)&&same(row.expected,policy.expected),'Conflicting budget authorization.');}
 else{
  assert(!v.rows.some(r=>r.slot===slot),'Conflicting budget nonce. The original request remains saved.');
  assert(v.rows.length<MAX_ROWS&&v.rows.filter(r=>r.sender.id===sender.id).length<PER_SENDER,'Budget inbox is full. Existing requests remain saved.');
  const storedAt=Date.now(),receipt=await sealMessage(s.identity,sender,{type:'lenz/budget-ack/v1',digest:id,acceptedAt:storedAt});
  row={id,slot,envelope:structuredClone(envelope),sender:structuredClone(sender),expected:structuredClone(policy.expected),packet,receipt,storedAt};v.rows.push(row);await save(s,v);
 }
 checkBudgetPacket(packet,policy.expected);assert(Date.now()<envelope.expiresAt,'Budget delivery expired before storage.');
 return {receipt:row.receipt,expiresAt:Number(BigInt(packet.order.deadline)*1000n)};
}
