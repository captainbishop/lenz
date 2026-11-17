import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,openMessage,sealMessage,validateProfile,digest,randomId} from './peer-crypto.js';
import {requirePaymentAccess} from './chat-access.js';
import {validateEnvelope} from './carrier-protocol.js';
import {checkRheaConfig} from './rhea-protocol.js';
import {DEFI_REQUEST,DEFI_RECEIPT,DEFI_OBSERVATION,openDefiRequest,defiConflictId} from './defi-request.js';
import {defiCourierSources,acceptDefiReply} from './defi-wallet.js';

const DOMAIN='lenz/defi-device-inbox/v1',MAX_BYTES=4000000,MAX_ROWS=32,PER_SENDER=8;
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&Object.getPrototypeOf(item)===Object.prototype?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const same=(a,b)=>canonical(a)===canonical(b);
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
  assert((keysAre(row,['envelope','sender','request','receipt','storedAt','conflict'])||keysAre(row,['envelope','sender','request','receipt','storedAt','conflict','execution']))&&Number.isSafeInteger(row.storedAt),'Invalid saved DeFi request.');
  await validateProfile(row.sender);await validateEnvelope(row.envelope,row.envelope.createdAt);
  const request=await openDefiRequest(s.identity,row.sender,v.config,row.envelope.packet,row.storedAt);
  assert(same(request,row.request)&&row.conflict===await defiConflictId(request)&&!ids.has(request.id)&&!slots.has(row.conflict),'Conflicting saved DeFi requests.');
  const receipt=await openMessage(s.identity,row.sender,row.receipt);
  assert(keysAre(receipt,['type','requestId','state','storedAt'])&&receipt.type===DEFI_RECEIPT&&receipt.requestId===request.id&&receipt.state==='stored'&&receipt.storedAt===row.storedAt&&row.receipt.from===s.identity.profile.id&&row.receipt.to===row.sender.id,'Saved DeFi receipt changed.');
  if(row.execution){
   const e=row.execution;assert(keysAre(e,['review','attempt','observation','update']),'Invalid saved execution state.');
   if(e.review)assert(keysAre(e.review,['id','executor','requestId','orderId','requestHash','operation','receiver','expiresAt','observationHash'])&&e.review.executor===s.identity.profile.id&&e.review.requestId===request.id&&e.review.orderId===request.operation.packet.id&&e.review.requestHash===await digest(request)&&e.review.receiver===request.operation.packet.instruction.receiver_id&&['submit','advance','recover'].includes(e.review.operation)&&Number.isSafeInteger(e.review.expiresAt),'Saved executor review changed.');
   if(e.attempt)assert(keysAre(e.attempt,['reviewId','operation','startedAt','status'])&&['submit','advance','recover','order'].includes(e.attempt.operation)&&Number.isSafeInteger(e.attempt.startedAt)&&typeof e.attempt.status==='string','Saved executor attempt changed.');
   if(e.observation)checkObservation(e.observation,request.operation.packet);
   if(e.update){const report=await openMessage(s.identity,row.sender,e.update);assert(e.update.from===s.identity.profile.id&&e.update.to===row.sender.id&&keysAre(report,['type','requestId','checkedAt','state','observation','transaction'])&&report.type===DEFI_OBSERVATION&&report.requestId===request.id&&Number.isSafeInteger(report.checkedAt)&&report.checkedAt>=row.storedAt&&report.checkedAt<=Date.now()+60000&&['ready','pending','observed'].includes(report.state)&&same(report.observation,e.observation)&&report.transaction===e.observation.transaction,'Saved executor update changed.');}
  }
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
 const v=await read(await readState());return {enabled:v.enabled,requests:v.rows.map(r=>({id:r.request.id,sender:r.sender.name,from:r.sender.id,status:r.execution?.attempt?.status??(Date.now()>=r.request.expiresAt?'expired':'stored'),operation:r.request.operation.kind,canReview:r.request.operation.kind==='rhea-swap'&&(Date.now()<r.request.expiresAt||!!r.execution?.observation?.order)&&!['submission-unresolved','complete','refunded','rejected','attention'].includes(r.execution?.attempt?.status)&&!waitingStages.has(r.execution?.observation?.order?.stage),hasUpdate:!!r.execution?.update,expiresAt:r.request.expiresAt,
  amount:r.request.operation.packet.instruction.amount,minOutput:r.request.operation.packet.instruction.min_output,receiver:r.request.operation.packet.instruction.receiver_id}))};
}
export async function defiCourierItems(s,config){
 // A changed wallet route must not block ordinary delivery or previously owed receipts.
 let outgoing=[];try{outgoing=await defiCourierSources(s,config);}catch{}
 const v=await read(s);
 return [...outgoing,...v.rows.flatMap(r=>[{packet:r.receipt,kind:'defi-receipt',acknowledged:false,sendable:true,expiresAt:null},...(r.execution?.update?[{packet:r.execution.update,kind:'defi-result',acknowledged:false,sendable:true,expiresAt:null}]:[])])];
}

const swapStages=new Set(['checking','ready','redeeming','funded','depositing','deposited','swapping','output_on_dex','refund_on_dex','withdrawing_output','withdrawing_refund','output_available','refund_available','paying_output','paying_refund','complete','refunded','rejected','attention']);
const waitingStages=new Set(['checking','redeeming','depositing','swapping','withdrawing_output','withdrawing_refund','paying_output','paying_refund']);
function checkObservation(value,packet){
 assert(keysAre(value,['finality','order','transaction'])&&value.finality==='FINAL'&&(value.transaction===null||typeof value.transaction==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.transaction)),'The executor response is not final.');
 const order=value.order;if(order===null)return value;
 assert(order?.id===packet.id&&same(order.instruction,packet.instruction)&&swapStages.has(order.stage)&&typeof order.output==='string'&&/^(0|[1-9][0-9]{0,38})$/.test(order.output)&&BigInt(order.output)<2n**128n,'The executor response changed the approved swap.');
 if(order.stage==='complete')assert(BigInt(order.output)>=BigInt(packet.instruction.min_output),'The reported output is below the approved minimum.');return value;
}
async function context(state,config,requestId){
 requirePaymentAccess(state.identity);const c=configured(config),v=await read(state),row=v.rows.find(r=>r.request.id===requestId);
 assert(row&&same(route(c),route(v.config)),'Open the original received swap and route.');peer(state,row.sender.id);
 assert(row.request.executor===state.identity.profile.id&&row.request.operation.kind==='rhea-swap','This device was not authorized for this swap.');
 return {c,v,row};
}
export async function reviewDefiInboxRequest(config,requestId){
 return updateState(async state=>{
  const {v,row}=await context(state,config,requestId);
  const e=row.execution??={review:null,attempt:null,observation:null,update:null};
  assert(e.attempt?.status!=='submission-unresolved','Check the original submission before another review.');
  const stage=e.observation?.order?.stage;assert(!['complete','refunded','rejected','attention'].includes(stage),'This swap has a result. Check or return its update.');assert(!waitingStages.has(stage),'The swap is processing. Check its status before continuing.');
  assert(stage||row.request.expiresAt>Date.now(),'This approval expired. Its original request remains saved.');
  const review={id:randomId(),executor:state.identity.profile.id,requestId,orderId:row.request.operation.packet.id,requestHash:await digest(row.request),operation:stage?'advance':'submit',receiver:row.request.operation.packet.instruction.receiver_id,expiresAt:stage?Date.now()+300000:Math.min(Date.now()+300000,row.request.expiresAt),observationHash:await digest(e.observation)};
  e.review=review;await save(state,v);assert(Date.now()<review.expiresAt,'The executor review expired before saving.');return structuredClone(review);
 });
}
async function invokeSigned(operation,body,{signal}={}){
 signal?.throwIfAborted();assert(navigator.onLine,'A connected participant must submit this approved swap.');
 const response=await fetch('/api/rhea/signed-'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([AbortSignal.timeout(150000),...(signal?[signal]:[])])});
 const text=await response.text();assert(text.length<=200000,'The swap response exceeds its read limit.');const result=JSON.parse(text);assert(response.ok,result?.error??'The original swap could not be verified.');return result;
}
async function retainObservation(config,requestId,identity,raw,{signal}={}){
 return updateState(async state=>{
  signal?.throwIfAborted();assert(state.identity?.profile.id===identity,'Executor account changed. Check the original request.');const {v,row}=await context(state,config,requestId),e=row.execution??={review:null,attempt:null,observation:null,update:null};
  const observation=checkObservation({finality:raw.finality,order:raw.order,transaction:raw.txHash??raw.reconciliation?.txHash??null},row.request.operation.packet);
  const previous=e.observation?.order;if(previous)assert(observation.order,'The original order cannot be found. Keep its saved status.');if(['complete','refunded'].includes(previous?.stage))assert(same(previous,observation.order),'The reported final result changed.');
  const unresolved=e.attempt?.status==='submission-unresolved'&&observation.order===null;
  e.observation=structuredClone(observation);e.review=null;e.attempt??={reviewId:null,operation:'order',startedAt:Date.now(),status:'not-started'};e.attempt.status=unresolved?'submission-unresolved':observation.order?.stage??'not-started';
  const stateLabel=['complete','refunded'].includes(observation.order?.stage)?'observed':observation.order||unresolved?'pending':'ready';
  e.update=await sealMessage(state.identity,row.sender,{type:DEFI_OBSERVATION,requestId,checkedAt:Date.now(),state:stateLabel,observation:structuredClone(observation),transaction:observation.transaction});
  await save(state,v);signal?.throwIfAborted();return {requestId,status:e.attempt.status,verified:false};
 },{signal});
}
export async function submitDefiInboxRequest(config,requestId,approval,{invoke=invokeSigned,signal}={}){
 const reviewed=structuredClone(approval);signal?.throwIfAborted();assert(navigator.onLine,'A connected participant must submit this approved swap.');
 const prepared=await updateState(async state=>{
  signal?.throwIfAborted();const {v,row}=await context(state,config,requestId),e=row.execution;
  assert(e?.review&&same(e.review,reviewed)&&reviewed.executor===state.identity.profile.id&&Date.now()<reviewed.expiresAt&&(reviewed.operation!=='submit'||Date.now()<row.request.expiresAt),'Review the exact original request before submission.');
  assert(e.attempt?.status!=='submission-unresolved'&&reviewed.observationHash===await digest(e.observation),'Check the original submission before trying again.');
  e.review=null;e.attempt={reviewId:reviewed.id,operation:reviewed.operation,startedAt:Date.now(),status:'submission-unresolved'};await save(state,v);
  signal?.throwIfAborted();assert(Date.now()<reviewed.expiresAt&&navigator.onLine,'The executor approval expired or disconnected before dispatch.');return {identity:state.identity.profile.id,body:{adapter:config.adapter,packet:structuredClone(row.request.operation.packet)}};
 },{signal});
 const current=await readState();signal?.throwIfAborted();assert(current.identity?.profile.id===prepared.identity&&navigator.onLine,'Executor account changed or disconnected before dispatch.');
 assert(Date.now()<reviewed.expiresAt&&(reviewed.operation!=='submit'||Date.now()<Number(prepared.body.packet.instruction.deadline_ms)),'The executor review expired before dispatch. Check the original request.');
 const result=await invoke(reviewed.operation,prepared.body,{signal});return retainObservation(config,requestId,prepared.identity,result,{signal});
}
export async function checkDefiInboxRequest(config,requestId,{invoke=invokeSigned,signal}={}){
 signal?.throwIfAborted();assert(navigator.onLine,'Connect to check the original swap.');const state=await readState(),{row}=await context(state,config,requestId),identity=state.identity.profile.id;
 const result=await invoke('order',{adapter:config.adapter,packet:structuredClone(row.request.operation.packet)},{signal});return retainObservation(config,requestId,identity,result,{signal});
}
export async function defiInboxUpdate(config,requestId){const state=await readState(),{row}=await context(state,config,requestId);assert(row.execution?.update,'Check this swap before returning an update.');return structuredClone(row.execution.update);}
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
