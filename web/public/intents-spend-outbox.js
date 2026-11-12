import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,digest,sealMessage,openMessage,validateProfile} from './peer-crypto.js';
import {checkConfidentialSpend,checkConfidentialSignedData} from './intents-spend.js';
import {verifyQuoteSignature} from './intents-vendor/quote.js';
import {requirePaymentAccess} from './chat-access.js';
import {PRIVATE_REPORT_ACK,PRIVATE_REPORT_RESERVE,checkPrivateReportPacket,checkPrivateReport,checkPrivateReportAck,privateReportOrder} from './intents-report.js';

const DOMAIN='lenz/private-spend-outbox/v1',MAX_BYTES=2000000,MAX_ROWS=32,RECEIPT_RESERVE=8192;
const SNAPSHOT='lenz/private-spend-history/v1';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const canonical=value=>JSON.stringify(ordered(value));
const aad=s=>bytes([DOMAIN,s.identity.profile.id]);
export const confidentialApprovalSlot=review=>[JSON.parse(review.payload).verifying_contract,review.owner,JSON.parse(review.payload).nonce].join(':');
export const confidentialApprovalId=payload=>digest([DOMAIN,payload]);
const slot=confidentialApprovalSlot;

// This journal retains spending evidence; it neither reserves on-chain funds nor
// treats disclosure as execution. External wallet keys remain in that wallet.
export function createConfidentialSpendOutbox({now=Date.now,verifySignature=verifyQuoteSignature}={}){
 const check=(offer,time=now())=>checkConfidentialSpend(offer,{now:time,verifySignature});
 function view(row){
  const terms=row.offer.terms,time=now();
  const status=row.report?'provider-reported':time>=Date.parse(terms.signingDeadline)?'expired-unresolved':row.acknowledgement?'executor-reported-stored':time+60000>=Date.parse(terms.refundDeadline)?'review-window-ended':row.sharedAt?'shared-unresolved':'queued';
  return {id:row.id,owner:terms.owner,executor:row.executor.id,amount:terms.amount,originAsset:terms.originAsset,destinationAsset:terms.destinationAsset,minOutput:row.offer.quote.quote.minAmountOut,recipient:terms.recipient,signingDeadline:terms.signingDeadline,status,observation:structuredClone(row.report?.observation??null),settlementVerified:false};
 }
 async function read(s){
  assert(s.identity,'Create a Lenz profile first.');
  if(!s.privateSpendKey&&!s.privateSpendBox)return [];
  const box=s.privateSpendBox;
  assert(s.privateSpendKey&&keysAre(box,['iv','ciphertext'])&&typeof box.ciphertext==='string'&&box.ciphertext.length<=MAX_BYTES*2,'Private approval storage is incomplete or too large.');
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(box.iv),additionalData:aad(s)},s.privateSpendKey,unhex(box.ciphertext));
  const rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  return validate(s,rows);
 }
 async function validate(s,rows){
  assert(Array.isArray(rows)&&rows.length<=MAX_ROWS&&bytes(rows).length<=MAX_BYTES,'Invalid private approval history.');
  const ids=new Set(),slots=new Set();
  for(const row of rows){
   const fields=['id','slot','offer','signedData','executor','checkedAt','envelope','sharedAt'];if(Object.hasOwn(row,'acknowledgement'))fields.push('acknowledgement');
   if(Object.hasOwn(row,'report'))fields.push('report');
   assert(keysAre(row,fields)&&Number.isSafeInteger(row.checkedAt)&&row.checkedAt>0&&(row.sharedAt===null||Number.isSafeInteger(row.sharedAt)&&row.sharedAt>=row.checkedAt),'Invalid saved private approval.');
   row.acknowledgement??=null;
   row.report??=null;
   const review=check(row.offer,row.checkedAt);checkConfidentialSignedData(review,row.signedData);
   assert(row.id===await confidentialApprovalId(review.payload)&&row.slot===slot(review)&&!ids.has(row.id)&&!slots.has(row.slot),'Conflicting private approval history.');
   ids.add(row.id);slots.add(row.slot);await validateProfile(row.executor);
   const payload={type:'lenz/private-spend/v1',id:row.id,offer:row.offer,signedData:row.signedData};
   assert(row.envelope.from===s.identity.profile.id&&row.envelope.to===row.executor.id&&same(await openMessage(s.identity,row.executor,row.envelope),payload),'Saved private handoff changed.');
   if(row.acknowledgement)await checkAcknowledgement(s,row,row.acknowledgement,Infinity);
   if(row.report){
    const r=row.report;assert(keysAre(r,['packet','observation','receipt'])&&bytes(r).length<=PRIVATE_REPORT_RESERVE,'Invalid saved private report.');
    checkPrivateReportPacket(r.packet,row.executor.id,s.identity.profile.id);
    const observation=checkPrivateReport(review,row.id,await openMessage(s.identity,row.executor,r.packet),{now:r.observation.observedAt});
    assert(same(observation,r.observation),'Saved private observation changed.');
    checkPrivateReportPacket(r.receipt,s.identity.profile.id,row.executor.id);
    checkPrivateReportAck(row.id,r.packet.id,observation.observedAt,await openMessage(s.identity,row.executor,r.receipt),Infinity);
   }
  }
  return rows;
 }
 function checkCapacity(rows){
  const raw=bytes(rows),reserve=rows.reduce((total,r)=>total+(r.sharedAt===null?16:0)+(r.acknowledgement?0:RECEIPT_RESERVE)+Math.max(0,PRIVATE_REPORT_RESERVE-bytes(r.report??null).length),0);
  assert(raw.length+16+reserve<=MAX_BYTES,'Private approval storage is full. Existing approvals remain saved.');
  return raw;
 }
 async function save(s,rows){
  const raw=checkCapacity(rows);
  s.privateSpendKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.privateSpendKey,raw);
  s.privateSpendBox={iv:hex(iv),ciphertext:hex(ciphertext)};
 }
 async function checkAcknowledgement(s,row,packet,time=now()){
  assert(bytes(packet).length<=RECEIPT_RESERVE&&packet.from===row.executor.id&&packet.to===s.identity.profile.id,'Wrong private executor receipt.');
  const ack=await openMessage(s.identity,row.executor,packet);
  assert(keysAre(ack,['type','id','acceptedAt'])&&ack.type==='lenz/private-spend-ack/v1'&&ack.id===row.id&&Number.isSafeInteger(ack.acceptedAt)&&ack.acceptedAt>=row.checkedAt-60000&&ack.acceptedAt<=time+60000&&ack.acceptedAt<Date.parse(row.offer.terms.refundDeadline)-60000,'Invalid private executor storage receipt.');
 }
 return Object.freeze({
  async list(){return(await read(await readState())).map(view);},
  async snapshot(s){return {type:SNAPSHOT,identity:s.identity.profile.id,rows:structuredClone((await read(s)).sort((a,b)=>a.id.localeCompare(b.id)))};},
  async validateSnapshot(s,input){
   const value=structuredClone(input);
   assert(keysAre(value,['type','identity','rows'])&&value.type===SNAPSHOT&&value.identity===s.identity?.profile.id,'Private history belongs to another Lenz account.');
   await validate(s,value.rows);checkCapacity(value.rows);
   value.rows.sort((a,b)=>a.id.localeCompare(b.id));return value;
  },
  async restore(s,input){
   const value=await this.validateSnapshot(s,input),local=await read(s),before=canonical([...local].sort((a,b)=>a.id.localeCompare(b.id))),rows=new Map(local.map(row=>[row.id,row]));
   for(const incoming of value.rows){
    const existing=rows.get(incoming.id);
    if(!existing){assert(![...rows.values()].some(row=>row.slot===incoming.slot),'Private nonce histories disagree.');rows.set(incoming.id,incoming);continue;}
    for(const field of ['id','slot','offer','signedData','executor','checkedAt','envelope'])assert(canonical(existing[field])===canonical(incoming[field]),'Private approval histories disagree.');
    const shared=[existing.sharedAt,incoming.sharedAt].filter(time=>time!==null);existing.sharedAt=shared.length?Math.min(...shared):null;
    if(incoming.acknowledgement&&(!existing.acknowledgement||canonical(incoming.acknowledgement)<canonical(existing.acknowledgement)))existing.acknowledgement=incoming.acknowledgement;
    if(incoming.report){const order=privateReportOrder(existing.report?.observation,incoming.report.observation);if(order>0||order===0&&canonical(incoming.report)<canonical(existing.report))existing.report=incoming.report;}
   }
   const merged=[...rows.values()].sort((a,b)=>a.id.localeCompare(b.id));await validate(s,merged);checkCapacity(merged);
   if(canonical(merged)!==before)await save(s,merged);
   return {type:SNAPSHOT,identity:s.identity.profile.id,rows:structuredClone(merged)};
  },
  async courierItems(s){
   let access=true;try{requirePaymentAccess(s.identity);}catch{access=false;}
   return(await read(s)).flatMap(row=>[
    {packet:row.envelope,kind:'private-approval',acknowledged:!!row.acknowledgement||!!row.report,sendable:access&&!row.acknowledgement&&!row.report&&now()+60000<Date.parse(row.offer.terms.refundDeadline),expiresAt:Date.parse(row.offer.terms.refundDeadline)-60000},
    ...(row.report?[{packet:row.report.receipt,kind:'private-report-receipt',acknowledged:false,sendable:true,expiresAt:null}]:[])
   ]);
  },
  async markShared(s,packetIds){
   const rows=await read(s),selected=rows.filter(r=>packetIds.includes(r.envelope.id));if(!selected.length)return;
   requirePaymentAccess(s.identity);for(const row of selected){check(row.offer);row.sharedAt??=Math.max(now(),row.checkedAt);}await save(s,rows);
  },
  async acceptAcknowledgement(s,packet){
   const rows=await read(s),candidates=rows.filter(r=>r.executor.id===packet.from);assert(candidates.length,'Unknown private executor receipt.');
   const ack=await openMessage(s.identity,candidates[0].executor,packet),row=candidates.find(r=>r.id===ack?.id);assert(row,'Unknown private approval receipt.');
   await checkAcknowledgement(s,row,packet);
   if(!row.acknowledgement){row.acknowledgement=structuredClone(packet);await save(s,rows);}
   return view(row);
  },
  async acceptReport(s,input){
   const packet=structuredClone(input),rows=await read(s),candidates=rows.filter(r=>r.executor.id===packet.from);assert(candidates.length,'Unknown private report executor.');
   const value=await openMessage(s.identity,candidates[0].executor,packet),row=candidates.find(r=>r.id===value?.id);assert(row,'Unknown private approval report.');
   checkPrivateReportPacket(packet,row.executor.id,s.identity.profile.id);
   const observation=checkPrivateReport(check(row.offer,row.checkedAt),row.id,value,{now:now()}),order=privateReportOrder(row.report?.observation,observation);
   if(order<=0)return {receipt:order===0&&row.report.packet.id===packet.id?row.report.receipt:null,request:view(row)};
   const receipt=await sealMessage(s.identity,row.executor,{type:PRIVATE_REPORT_ACK,id:row.id,packetId:packet.id,acceptedAt:now()});
   checkPrivateReportPacket(receipt,s.identity.profile.id,row.executor.id);
   row.report={packet,observation,receipt};await save(s,rows);return {receipt,request:view(row)};
  },
  async queue(input,approval,executor,{signal}={}){
   signal?.throwIfAborted();
   const captured=structuredClone(input),offer={terms:captured.terms,quote:captured.quote,generated:captured.generated};
   const signed=structuredClone(approval),peer=structuredClone(executor),initial=await readState();
   assert(initial.identity,'Create a Lenz profile first.');requirePaymentAccess(initial.identity);const identity=initial.identity.profile.id;
   const review=check(offer),signedData=checkConfidentialSignedData(review,signed);await validateProfile(peer);
   return updateState(async s=>{
    assert(s.identity?.profile.id===identity,'Lenz account changed. Review again.');
    requirePaymentAccess(s.identity);
    assert(s.contacts.some(p=>p.id===peer.id&&p.signingPublic===peer.signingPublic&&p.boxPublic===peer.boxPublic),'Add and verify the selected executor first.');
    const rows=await read(s),id=await confidentialApprovalId(review.payload),existing=rows.find(r=>r.id===id);
    if(existing){assert(same(existing.offer,offer)&&same(existing.signedData,signedData)&&same(existing.executor,peer),'This approval already has different delivery terms.');return view(existing);}
    assert(rows.length<MAX_ROWS,'Private approval history is full.');
    assert(!rows.some(r=>r.slot===slot(review)),'This private nonce already has an approval. Reconcile it before signing another.');
    const checkedAt=now();check(offer,checkedAt);
    const envelope=await sealMessage(s.identity,peer,{type:'lenz/private-spend/v1',id,offer,signedData});
    const row={id,slot:slot(review),offer,signedData,executor:peer,checkedAt,envelope,sharedAt:null,acknowledgement:null,report:null};
    rows.push(row);
    // Admission reserves later report and receipt growth before disclosure.
    await save(s,rows);check(offer);return view(row);
   },{signal});
  },
  async handoff(id,{signal}={}){
   signal?.throwIfAborted();
   const initial=await readState();assert(initial.identity,'Create a Lenz profile first.');requirePaymentAccess(initial.identity);
   const identity=initial.identity.profile.id;
   const saved=await updateState(async s=>{
    assert(s.identity?.profile.id===identity,'Lenz account changed. Review again.');
    requirePaymentAccess(s.identity);
    const rows=await read(s),row=rows.find(r=>r.id===id);assert(row,'Private approval not found.');
    check(row.offer);row.sharedAt??=Math.max(now(),row.checkedAt);await save(s,rows);
    return {envelope:structuredClone(row.envelope),offer:row.offer};
   },{signal});
   // Persistence finishes after the update callback. Check again at disclosure.
   const current=await readState();assert(current.identity?.profile.id===identity,'Lenz account changed. Review again.');requirePaymentAccess(current.identity);
   signal?.throwIfAborted();check(saved.offer);return saved.envelope;
  },
 });
}

export const confidentialSpendOutbox=createConfidentialSpendOutbox();
