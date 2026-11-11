import {readState,readStateLocked,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,randomId,openMessage,sealMessage,validateProfile} from './peer-crypto.js';
import {requirePaymentAccess,isRecoveredContact} from './chat-access.js';
import {validateEnvelope} from './carrier-protocol.js';
import {checkConfidentialSpend,checkConfidentialSignedData} from './intents-spend.js';
import {confidentialSpendOutbox,confidentialApprovalId,confidentialApprovalSlot} from './intents-spend-outbox.js';
import {base58} from './intents-vendor/codecs.js';
import {PRIVATE_REPORT,PRIVATE_REPORT_ACK,PRIVATE_REPORT_RESERVE,checkPrivateReportPacket,checkPrivateReport,checkPrivateReportAck,privateReportOrder} from './intents-report.js';

const DOMAIN='lenz/private-spend-inbox/v1',MAX_BYTES=4000000,MAX_ROWS=32,PER_SENDER=8;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),aad=s=>bytes([DOMAIN,s.identity.profile.id]);
const hasActivity=observation=>observation&&(observation.status!=='PENDING_DEPOSIT'||['amountIn','amountOut','refundedAmount'].some(field=>BigInt(observation[field]??'0')>0n));
const validHash=value=>typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)&&base58.decode(value).length===32;
function requestView(row){
 const terms=row.packet.offer.terms;
 return {id:row.id,sender:row.sender.id,owner:terms.owner,amount:terms.amount,originAsset:terms.originAsset,destinationAsset:terms.destinationAsset,recipient:terms.recipient,minOutput:row.packet.offer.quote.quote.minAmountOut,depositAddress:row.packet.offer.quote.quote.depositAddress,refundDeadline:terms.refundDeadline,signingDeadline:terms.signingDeadline,status:row.submission?.state??(Date.now()>=Date.parse(terms.signingDeadline)?'expired-unresolved':'stored'),intentHash:row.submission?.intentHash??null,observation:structuredClone(row.report?.observation??null),statusCheckPending:!!row.observationPending,activitySeen:!!row.activitySeen,reportReceived:!!row.report?.acknowledgement,settlementVerified:false};
}
function checkPolicies(policies){
 assert(Array.isArray(policies)&&policies.length>0&&policies.length<=MAX_ROWS,'Choose the approved senders and wallet owners first.');
 const ids=new Set();
 for(const policy of policies){
  assert(keysAre(policy,['sender','owner'])&&/^[0-9a-f]{64}$/.test(policy.sender)&&/^0x[0-9a-f]{40}$/.test(policy.owner)&&!/^0x0{40}$/.test(policy.owner),'Invalid approved private owner.');
  const key=policy.sender+':'+policy.owner;assert(!ids.has(key),'Duplicate private owner policy.');ids.add(key);
 }
}
async function checkPacket(packet,time){
 assert(keysAre(packet,['type','id','offer','signedData'])&&packet.type==='lenz/private-spend/v1','Invalid private approval packet.');
 const review=checkConfidentialSpend(packet.offer,{now:time});checkConfidentialSignedData(review,packet.signedData);
 assert(packet.id===await confidentialApprovalId(review.payload),'Private approval identity changed.');return review;
}
function checkAck(ack,row){
 assert(keysAre(ack,['type','id','acceptedAt'])&&ack.type==='lenz/private-spend-ack/v1'&&ack.id===row.id&&ack.acceptedAt===row.storedAt,'Saved private receipt changed.');
}
async function read(s){
 assert(s.identity,'Create a Lenz profile first.');
 if(!s.privateInboxKey&&!s.privateInboxBox)return {version:1,enabled:false,policies:[],rows:[]};
 const box=s.privateInboxBox;assert(s.privateInboxKey&&keysAre(box,['iv','ciphertext'])&&typeof box.ciphertext==='string'&&box.ciphertext.length<=MAX_BYTES*2,'Private inbox storage is incomplete or too large.');
 const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(box.iv),additionalData:aad(s)},s.privateInboxKey,unhex(box.ciphertext)),v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 assert(keysAre(v,['version','enabled','policies','rows'])&&v.version===1&&typeof v.enabled==='boolean'&&Array.isArray(v.policies)&&Array.isArray(v.rows)&&v.rows.length<=MAX_ROWS,'Invalid private inbox.');
 if(v.policies.length)checkPolicies(v.policies);else assert(!v.enabled,'No private senders approved.');
 const ids=new Set(),slots=new Set();
 for(const row of v.rows){
  const fields=['id','slot','envelope','sender','packet','receipt','storedAt'];if(Object.hasOwn(row,'submission'))fields.push('submission');
  if(Object.hasOwn(row,'report'))fields.push('report');
  if(Object.hasOwn(row,'activitySeen'))fields.push('activitySeen');
  if(Object.hasOwn(row,'observationPending'))fields.push('observationPending');
  assert(keysAre(row,fields)&&Number.isSafeInteger(row.storedAt)&&row.storedAt>0,'Invalid saved private request.');row.submission??=null;
  row.report??=null;
  row.observationPending??=false;
  assert(typeof row.observationPending==='boolean','Invalid pending private status check.');
  row.activitySeen??=!!hasActivity(row.report?.observation);
  assert(typeof row.activitySeen==='boolean'&&(!hasActivity(row.report?.observation)||row.activitySeen),'Invalid private deposit activity history.');
  if(row.submission){const a=row.submission;assert(keysAre(a,['id','state','startedAt','intentHash'])&&/^[0-9a-f]{32}$/.test(a.id)&&['submission-unknown','not-submitted','submitted'].includes(a.state)&&Number.isSafeInteger(a.startedAt)&&a.startedAt>=row.storedAt&&(a.state==='submitted'?validHash(a.intentHash):a.intentHash===null),'Invalid private submission history.');}
  await validateProfile(row.sender);await validateEnvelope(row.envelope,row.storedAt);
  assert(row.envelope.packet.from===row.sender.id&&row.envelope.packet.to===s.identity.profile.id,'Saved private request direction changed.');
  const packet=await openMessage(s.identity,row.sender,row.envelope.packet),review=await checkPacket(packet,row.storedAt);
  assert(same(packet,row.packet)&&row.id===packet.id&&row.slot===confidentialApprovalSlot(review)&&!ids.has(row.id)&&!slots.has(row.slot),'Conflicting private request history.');
  assert(row.receipt.from===s.identity.profile.id&&row.receipt.to===row.sender.id,'Saved private receipt direction changed.');
  checkAck(await openMessage(s.identity,row.sender,row.receipt),row);ids.add(row.id);slots.add(row.slot);
  if(row.report){
   const r=row.report;assert(keysAre(r,['packet','observation','acknowledgement'])&&bytes(r).length<=PRIVATE_REPORT_RESERVE,'Invalid saved outgoing private report.');
   checkPrivateReportPacket(r.packet,s.identity.profile.id,row.sender.id);
   const observation=checkPrivateReport(review,row.id,await openMessage(s.identity,row.sender,r.packet),{now:r.observation.observedAt});
   assert(same(observation,r.observation),'Saved outgoing private observation changed.');
   if(r.acknowledgement){
    checkPrivateReportPacket(r.acknowledgement,row.sender.id,s.identity.profile.id);
    checkPrivateReportAck(row.id,r.packet.id,observation.observedAt,await openMessage(s.identity,row.sender,r.acknowledgement),Infinity);
   }
  }
 }
 return v;
}
async function save(s,v){
 const raw=bytes(v),reserve=v.rows.reduce((total,row)=>total+Math.max(0,512-bytes(row.submission).length)+Math.max(0,PRIVATE_REPORT_RESERVE-bytes(row.report??null).length),0);
 assert(raw.length+16+reserve<=MAX_BYTES,'Private inbox is full. Existing requests remain saved.');
 s.privateInboxKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.privateInboxKey,raw);
 s.privateInboxBox={iv:hex(iv),ciphertext:hex(ciphertext)};
}
export async function setConfidentialInboxEnabled(enabled,approved=[],{signal,identity,previous}={}){
 assert(typeof enabled==='boolean','Choose whether to receive private approvals.');const policies=structuredClone(approved);
 if(enabled)checkPolicies(policies);
 return updateState(async s=>{
  if(identity!==undefined)assert(s.identity?.profile.id===identity,'Executor account changed.');
  if(enabled)requirePaymentAccess(s.identity);const v=await read(s);
  if(previous!==undefined)assert(same(v.policies,previous),'Approved senders changed. Review again.');
  if(enabled){for(const policy of policies)assert(s.contacts.some(p=>p.id===policy.sender)&&!isRecoveredContact(s,policy.sender),'Add and verify the approved sender first.');v.policies=policies;}
  else if(previous!==undefined){if(policies.length)checkPolicies(policies);v.policies=policies;}
  v.enabled=enabled;await save(s,v);
 },{signal});
}
export async function confidentialInboxSummary(){
 const s=await readState(),v=await read(s);
 return {enabled:v.enabled,policies:structuredClone(v.policies),requests:v.rows.map(row=>{
  const value=requestView(row),allowed=v.enabled&&s.identity.access===undefined&&!isRecoveredContact(s,row.sender.id)&&s.contacts.some(p=>p.id===row.sender.id)&&v.policies.some(p=>p.sender===row.sender.id&&p.owner===value.owner);
  let live=false;try{checkConfidentialSpend(row.packet.offer);live=true;}catch{}
  return {...value,canCheck:allowed,canSubmit:allowed&&live&&!row.activitySeen&&!row.observationPending&&(!row.submission||row.submission.state==='not-submitted')};
 })};
}

export async function confidentialRequestUpdate(id,{signal}={}){
 signal?.throwIfAborted();
 return readStateLocked(async s=>{const v=await read(s),row=v.rows.find(r=>r.id===id);assert(row,'Private request not found.');signal?.throwIfAborted();return structuredClone(row.report?.packet??row.receipt);});
}

// submit is the connected provider adapter. Persist the exact request and attempt
// before invoking it; a response or a storage failure cannot imply non-execution.
export async function submitConfidentialRequest(id,submit,{signal}={}){
 assert(typeof submit==='function','A connected private execution adapter is required.');signal?.throwIfAborted();
 const initial=await readState();assert(initial.identity,'Create a Lenz profile first.');const identity=initial.identity.profile.id;
 function permitted(s,v,row){
  assert(s.identity?.profile.id===identity,'Executor account changed.');requirePaymentAccess(s.identity);
  assert(v.enabled&&row&&v.policies.some(p=>p.sender===row.sender.id&&p.owner===row.packet.offer.terms.owner),'Private execution is not enabled for this sender and owner.');
  assert(s.contacts.some(p=>p.id===row.sender.id)&&!isRecoveredContact(s,row.sender.id),'Add and verify the approved sender first.');
  assert(!row.activitySeen,'Provider reported activity for this deposit. Reconcile it before submitting.');
  assert(!row.observationPending,'A private status check needs reconciliation before submitting.');
  signal?.throwIfAborted();
 }
 const attempt=await updateState(async s=>{
  const v=await read(s),row=v.rows.find(r=>r.id===id);permitted(s,v,row);await checkPacket(row.packet,Date.now());
  assert(!row.submission||row.submission.state==='not-submitted','A submission is already recorded. Check its original deposit before any further action.');
  row.submission={id:randomId(),state:'submission-unknown',startedAt:Math.max(Date.now(),row.storedAt),intentHash:null};
  await save(s,v);return structuredClone(row.submission);
 },{signal});
 let dispatched=false,result;
 try{
  const operation=await readStateLocked(async s=>{
   const v=await read(s),row=v.rows.find(r=>r.id===id);permitted(s,v,row);
   assert(row.submission?.id===attempt.id&&row.submission.state==='submission-unknown','Private submission attempt changed.');
   await checkPacket(row.packet,Date.now());signal?.throwIfAborted();checkConfidentialSpend(row.packet.offer);
   dispatched=true;
   // Do not hold the workspace lock while awaiting a network response.
   return {pending:Promise.resolve(submit(structuredClone(row.packet.offer),structuredClone(row.packet.signedData),{signal}))};
  });
  result=await operation.pending;
 }catch{}
 return updateState(async s=>{
  assert(s.identity?.profile.id===identity,'Executor account changed. The saved submission needs reconciliation.');
  const v=await read(s),row=v.rows.find(r=>r.id===id);
  assert(row?.submission?.id===attempt.id,'Private submission attempt changed.');
  if(!dispatched)row.submission.state='not-submitted';
  else if(result?.state==='submitted'&&result.settlementVerified===false&&result.depositAddress===row.packet.offer.quote.quote.depositAddress&&validHash(result.intentHash)){
   row.submission.state='submitted';row.submission.intentHash=result.intentHash;
  }
  await save(s,v);return requestView(row);
 });
}
export async function confidentialCourierItems(s){
 const outgoing=await confidentialSpendOutbox.courierItems(s),v=await read(s);
 return [...outgoing,...v.rows.flatMap(row=>[
  {packet:row.receipt,kind:'private-receipt',acknowledged:false,sendable:true,expiresAt:null},
  ...(row.report?[{packet:row.report.packet,kind:'private-report',acknowledged:!!row.report.acknowledgement,sendable:!row.report.acknowledgement,expiresAt:null}]:[])
 ])];
}
export async function observeConfidentialRequest(id,observe,{signal}={}){
 assert(navigator.locks,'This browser needs Web Locks to check private requests safely.');
 // One reader per approval keeps a later read from clearing an earlier
 // unfinished check. Other approvals and ordinary chat retain their own locks.
 return navigator.locks.request('lenz/private-status/'+id,{signal},()=>observeRequest(id,observe,{signal}));
}
async function observeRequest(id,observe,{signal}){
 assert(typeof observe==='function','A connected private status reader is required.');signal?.throwIfAborted();
 const initial=await readState();assert(initial.identity,'Create a Lenz profile first.');const identity=initial.identity.profile.id;
 function permitted(s,v,row){
  assert(s.identity?.profile.id===identity,'Executor account changed.');requirePaymentAccess(s.identity);
  assert(v.enabled&&row&&v.policies.some(p=>p.sender===row.sender.id&&p.owner===row.packet.offer.terms.owner),'Private status reading is not enabled for this sender and owner.');
  assert(s.contacts.some(p=>p.id===row.sender.id)&&!isRecoveredContact(s,row.sender.id),'Add and verify the approved sender first.');
  signal?.throwIfAborted();
 }
 await updateState(async s=>{
  const v=await read(s),row=v.rows.find(r=>r.id===id);permitted(s,v,row);
  row.observationPending=true;await save(s,v);
 },{signal});
 const operation=await readStateLocked(async s=>{
  const v=await read(s),row=v.rows.find(r=>r.id===id);permitted(s,v,row);
  return {pending:Promise.resolve(observe(structuredClone(row.packet.offer),{signal}))};
 });
 const value=await operation.pending;
 const result=await updateState(async s=>{
  const v=await read(s),row=v.rows.find(r=>r.id===id);permitted(s,v,row);
  const review=checkConfidentialSpend(row.packet.offer,{now:row.storedAt}),observation=checkPrivateReport(review,id,{type:PRIVATE_REPORT,id,observation:value});
  let order;
  try{order=privateReportOrder(row.report?.observation,observation);}catch(error){
   // Reject the report only after its activity warning is durable; throwing
   // inside the storage callback would roll back the submission block too.
   row.activitySeen||=!!hasActivity(observation);await save(s,v);return {error};
  }
  if(order<=0){
   row.activitySeen||=!!hasActivity(observation);row.observationPending=order<0;await save(s,v);
   return requestView(row);
  }
  const packet=await sealMessage(s.identity,row.sender,{type:PRIVATE_REPORT,id,observation});checkPrivateReportPacket(packet,s.identity.profile.id,row.sender.id);
  // A later pending report cannot reopen submission after deposit activity.
  row.activitySeen||=!!hasActivity(observation);
  row.observationPending=false;
  row.report={packet,observation,acknowledgement:null};await save(s,v);return requestView(row);
 },{signal});
 if(result.error)throw result.error;
 return result;
}
// The surrounding courier transaction commits the request and receipt route
// together. Neither storage nor this acknowledgement releases money.
export async function acceptConfidentialCourierEnvelope(s,envelope){
 envelope=structuredClone(envelope);await validateEnvelope(envelope);
 const sender=s.contacts.find(p=>p.id===envelope.packet.from);assert(sender,'Add and verify the original sender first.');
 const packet=await openMessage(s.identity,sender,envelope.packet);
 if(packet?.type===PRIVATE_REPORT){const result=await confidentialSpendOutbox.acceptReport(s,envelope.packet);assert(Date.now()<envelope.expiresAt,'Private report delivery expired before storage.');return {receipt:result.receipt,expiresAt:null};}
 if(packet?.type===PRIVATE_REPORT_ACK){
  const v=await read(s),row=v.rows.find(r=>r.id===packet.id&&r.sender.id===sender.id);assert(row,'Unknown private report receipt.');
  if(!row.report||packet.packetId!==row.report.packet.id)return {receipt:null,expiresAt:null};
  checkPrivateReportPacket(envelope.packet,row.sender.id,s.identity.profile.id);
  checkPrivateReportAck(row.id,row.report.packet.id,row.report.observation.observedAt,packet);
  if(!row.report.acknowledgement){row.report.acknowledgement=structuredClone(envelope.packet);await save(s,v);}
  assert(Date.now()<envelope.expiresAt,'Private report receipt expired before storage.');
  return {receipt:null,expiresAt:null};
 }
 if(packet?.type==='lenz/private-spend-ack/v1'){await confidentialSpendOutbox.acceptAcknowledgement(s,envelope.packet);return {receipt:null,expiresAt:null};}
 if(packet?.type!=='lenz/private-spend/v1')return null;
 requirePaymentAccess(s.identity);await validateEnvelope(envelope);const v=await read(s);assert(v.enabled,'This device is not receiving private approvals.');
 assert(!isRecoveredContact(s,sender.id),'Add and verify the approved sender first.');
 assert(v.policies.some(p=>p.sender===sender.id&&p.owner===packet.offer?.terms?.owner),'This sender and private wallet owner have not been approved.');
 const storedAt=Date.now(),review=await checkPacket(packet,storedAt),slot=confidentialApprovalSlot(review);
 let row=v.rows.find(r=>r.id===packet.id);
 if(row)assert(row.sender.id===sender.id&&same(row.packet,packet),'Conflicting private approval.');
 else{
  assert(!v.rows.some(r=>r.slot===slot),'Conflicting private nonce. The original request remains saved.');
  assert(v.rows.length<MAX_ROWS&&v.rows.filter(r=>r.sender.id===sender.id).length<PER_SENDER,'Private inbox is full. Existing requests remain saved.');
  const receipt=await sealMessage(s.identity,sender,{type:'lenz/private-spend-ack/v1',id:packet.id,acceptedAt:storedAt});
  row={id:packet.id,slot,envelope:structuredClone(envelope),sender:structuredClone(sender),packet,receipt,storedAt,submission:null,report:null,activitySeen:false,observationPending:false};v.rows.push(row);await save(s,v);
 }
 checkConfidentialSpend(packet.offer);assert(Date.now()<envelope.expiresAt,'Private delivery expired before storage.');
 return {receipt:row.receipt,expiresAt:Date.parse(review.refundDeadline)-60000};
}
