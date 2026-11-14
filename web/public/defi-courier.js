import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,openMessage,sealMessage,validateProfile} from './peer-crypto.js';
import {validateEnvelope} from './carrier-protocol.js';
import {checkRheaConfig} from './rhea-protocol.js';
import {DEFI_REQUEST,DEFI_RECEIPT,DEFI_OBSERVATION,openDefiRequest,defiConflictId} from './defi-request.js';
import {defiCourierSources,acceptDefiReply} from './defi-wallet.js';

const DOMAIN='lenz/defi-device-inbox/v1',MAX_BYTES=4000000,MAX_ROWS=32,PER_SENDER=8;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const route=c=>['network','adapter','reserve','exchange','poolId','tokenOut'].map(k=>c[k]);
const aad=s=>bytes([DOMAIN,s.identity.profile.id]);
const peer=(s,id)=>{const c=s.contacts.find(p=>p.id===id);assert(c,'Add and verify the original sender first.');return c;};
function configured(config){assert(config?.ready===true,'DeFi request intake is not configured.');checkRheaConfig(config);return structuredClone(config);}
async function read(s){
 assert(s.identity,'Create a Lenz profile first.');
 if(!s.defiInboxKey&&!s.defiInboxBox)return {version:1,enabled:false,config:null,rows:[]};
 assert(s.defiInboxKey&&keysAre(s.defiInboxBox,['iv','ciphertext'])&&typeof s.defiInboxBox.ciphertext==='string'&&s.defiInboxBox.ciphertext.length<=MAX_BYTES*2,'DeFi inbox storage is incomplete or too large.');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(s.defiInboxBox.iv),additionalData:aad(s)},s.defiInboxKey,unhex(s.defiInboxBox.ciphertext));
 const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 assert(keysAre(v,['version','enabled','config','rows'])&&v.version===1&&typeof v.enabled==='boolean'&&Array.isArray(v.rows)&&v.rows.length<=MAX_ROWS,'Invalid DeFi inbox.');
 if(v.config)configured(v.config);else assert(!v.enabled&&!v.rows.length,'DeFi inbox has no route.');
 const ids=new Set(),slots=new Set();
 for(const row of v.rows){
  assert(keysAre(row,['envelope','sender','request','receipt','storedAt','conflict'])&&Number.isSafeInteger(row.storedAt),'Invalid saved DeFi request.');
  await validateProfile(row.sender);await validateEnvelope(row.envelope,row.envelope.createdAt);
  const request=await openDefiRequest(s.identity,row.sender,v.config,row.envelope.packet,row.storedAt);
  assert(same(request,row.request)&&row.conflict===await defiConflictId(request)&&!ids.has(request.id)&&!slots.has(row.conflict),'Conflicting saved DeFi requests.');
  const receipt=await openMessage(s.identity,row.sender,row.receipt);
  assert(keysAre(receipt,['type','requestId','state','storedAt'])&&receipt.type===DEFI_RECEIPT&&receipt.requestId===request.id&&receipt.state==='stored'&&receipt.storedAt===row.storedAt&&row.receipt.from===s.identity.profile.id&&row.receipt.to===row.sender.id,'Saved DeFi receipt changed.');
  ids.add(request.id);slots.add(row.conflict);
 }
 return v;
}
async function save(s,v){
 const raw=bytes(v);assert(raw.length+16<=MAX_BYTES,'DeFi inbox is full. Existing requests remain saved.');
 s.defiInboxKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.defiInboxKey,raw);
 s.defiInboxBox={iv:hex(iv),ciphertext:hex(ciphertext)};
}
export async function setDefiInboxEnabled(enabled,config){
 assert(typeof enabled==='boolean','Choose whether to receive DeFi requests.');const c=enabled?configured(config):null;
 return updateState(async s=>{const v=await read(s);
  if(enabled){assert(!v.config||same(route(v.config),route(c)),'Saved requests belong to another DeFi route.');v.config??=c;}
  v.enabled=enabled;await save(s,v);
 });
}
export async function defiInboxSummary(){
 const v=await read(await readState());return {enabled:v.enabled,requests:v.rows.map(r=>({id:r.request.id,sender:r.sender.name,from:r.sender.id,status:Date.now()>=r.request.expiresAt?'expired':'stored',expiresAt:r.request.expiresAt,
  amount:r.request.operation.packet.instruction.amount,minOutput:r.request.operation.packet.instruction.min_output,receiver:r.request.operation.packet.instruction.receiver_id}))};
}
export async function defiCourierItems(s,config){
 // A changed wallet route must not block ordinary delivery or previously owed receipts.
 let outgoing=[];try{outgoing=await defiCourierSources(s,config);}catch{}
 const v=await read(s);
 return [...outgoing,...v.rows.map(r=>({packet:r.receipt,kind:'defi-receipt',acknowledged:false,sendable:true,expiresAt:null}))];
}
// The courier commits intake, receipt and return route together before acknowledging.
export async function acceptDefiCourierEnvelope(s,config,envelope){
 const packet=envelope.packet,sender=peer(s,packet.from),payload=await openMessage(s.identity,sender,packet);
 if([DEFI_RECEIPT,DEFI_OBSERVATION].includes(payload?.type)){
  assert(await acceptDefiReply(s,config,packet),'No saved approval for this update.');return {receipt:null,expiresAt:null};
 }
 if(payload?.type!==DEFI_REQUEST)return null;
 await validateEnvelope(envelope);
 const c=configured(config),v=await read(s);assert(v.enabled,'This device is not receiving DeFi requests.');
 assert(same(route(v.config),route(c)),'DeFi inbox route changed.');
 const request=await openDefiRequest(s.identity,sender,c,packet),conflict=await defiConflictId(request);
 let row=v.rows.find(r=>r.request.id===request.id);
 if(!row){
  assert(!v.rows.some(r=>r.conflict===conflict),'Conflicting DeFi authorization. The saved request is retained.');
  assert(v.rows.length<MAX_ROWS&&v.rows.filter(r=>r.sender.id===sender.id).length<PER_SENDER,'DeFi inbox is full. Existing requests remain saved.');
  const storedAt=Date.now(),receipt=await sealMessage(s.identity,sender,{type:DEFI_RECEIPT,requestId:request.id,state:'stored',storedAt});
  row={envelope:structuredClone(envelope),sender:structuredClone(sender),request,receipt,storedAt,conflict};v.rows.push(row);await save(s,v);
 }
 assert(Date.now()<request.expiresAt&&Date.now()<envelope.expiresAt,'DeFi request expired before storage.');
 return {receipt:row.receipt,expiresAt:request.expiresAt};
}
