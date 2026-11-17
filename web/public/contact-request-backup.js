import {assert,keysAre,validateProfile,bytes,openMessage} from './peer-crypto.js';
import {CONTACT_REQUEST,CONTACT_RESPONSE,isContactControl,contactForPacket} from './contact-requests.js';

const id=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const sameKeys=(a,b)=>a.id===b.id&&a.signingPublic===b.signingPublic&&a.boxPublic===b.boxPublic;
const sameProfile=(a,b)=>keysAre(a,Object.keys(b))&&Object.keys(b).every(key=>a[key]===b[key]);
export function validateDeclinedContacts(value=[]){
 assert(Array.isArray(value)&&value.length<=256&&value.every(id)&&new Set(value).size===value.length,'Invalid declined contacts in backup.');
 return structuredClone(value);
}
export function chatBackupRecord(record,{receipts=true}={}){
 const result={packet:structuredClone(record.packet)};
 if(receipts){
  for(const field of ['receiptToShare','receivedReceipt','deliveryRequested','receiptDeliveryRequested'])if(Object.hasOwn(record,field))result[field]=structuredClone(record[field]);
 }
 return result;
}
export function validateChatBackupRecord(record,owner,withReceipts){
 const packet=record.packet,receiptField=packet.from===owner?'receivedReceipt':'receiptToShare',fields=['packet'];
 if(withReceipts){
  if(Object.hasOwn(record,receiptField))fields.push(receiptField);
  if(Object.hasOwn(record,'deliveryRequested')){assert(packet.from===owner&&typeof record.deliveryRequested==='boolean','Invalid outgoing delivery request.');fields.push('deliveryRequested');}
  if(Object.hasOwn(record,'receiptDeliveryRequested')){assert(packet.to===owner&&Object.hasOwn(record,'receiptToShare')&&typeof record.receiptDeliveryRequested==='boolean','Invalid receipt delivery request.');fields.push('receiptDeliveryRequested');}
 }
 assert(keysAre(record,fields),'Invalid archived message fields.');
 return receiptField;
}
export function validateChatBackupPayload(payload){
 assert(keysAre(payload,['kind','text'])&&payload.kind==='chat'&&typeof payload.text==='string'&&payload.text.trim().length>0&&bytes(payload.text).length<=16002,'Financial records cannot be restored as chat.');
 return payload;
}
// A terminal request status needs the exact signed decision, not contact-list membership.
export async function validateContactRequestSnapshot(state,{readPayload=(peer,packet)=>openMessage(state.identity,peer,packet)}={}){
 const requests=state.contactRequests??[];
 assert(Array.isArray(requests)&&requests.length<=256&&requests.filter(row=>row.direction==='incoming'&&row.status==='pending').length<=32,'Invalid message request capacity in backup.');
 const own=state.identity.profile.id,ids=new Set(),pendingPeers=new Set(),rows=new Map();
 for(const row of requests){
  const fields=['requestId','peerId','profile','direction','status'];if(Object.hasOwn(row,'responseId'))fields.push('responseId');
  assert(keysAre(row,fields)&&/^[0-9a-f]{32}$/.test(row.requestId)&&id(row.peerId)&&row.peerId!==own&&!ids.has(row.requestId)&&['incoming','outgoing'].includes(row.direction)&&['pending','accepted','declined'].includes(row.status),'Invalid saved message request.');
  const profile=await validateProfile(row.profile);assert(profile.id===row.peerId,'Saved request profile differs from its peer.');
  const record=state.messages.find(record=>record.packet.id===row.requestId);assert(record,'The original message request is missing from backup.');
  const packet=record.packet,incoming=row.direction==='incoming';
  assert(packet.from===(incoming?row.peerId:own)&&packet.to===(incoming?own:row.peerId),'Saved request belongs to another conversation.');
  const payload=await readPayload(profile,packet);
  assert(keysAre(payload,['kind','profile'])&&payload.kind===CONTACT_REQUEST,'Invalid archived message request.');
  const sender=await validateProfile(payload.profile);assert(sameKeys(sender,incoming?profile:state.identity.profile),'Archived request profile does not match its signed sender.');
  if(incoming)assert(sameProfile(profile,sender),'Archived incoming request profile was changed.');
  if(row.status==='pending'){
   assert(!Object.hasOwn(row,'responseId'),'A pending request cannot carry a terminal response.');
   const key=row.direction+':'+row.peerId;assert(!pendingPeers.has(key),'Duplicate pending request from this person.');pendingPeers.add(key);
   if(incoming)assert(!state.contacts.some(peer=>peer.id===row.peerId),'An incoming pending request cannot be an accepted contact.');
  }else{
   assert(typeof row.responseId==='string'&&/^[0-9a-f]{32}$/.test(row.responseId),'The saved request decision has no response.');
   const response=state.messages.find(record=>record.packet.id===row.responseId)?.packet;assert(response,'The saved request response is missing.');
   assert(response.from===packet.to&&response.to===packet.from,'Request response is from a different recipient.');
   const decision=await readPayload(profile,response);
   assert(keysAre(decision,['kind','requestId','decision'])&&decision.kind===CONTACT_RESPONSE&&decision.requestId===row.requestId&&decision.decision===row.status,'The signed response does not match the saved request decision.');
   if(incoming&&row.status==='accepted')assert(state.contacts.some(peer=>peer.id===row.peerId),'An accepted incoming request has no contact.');
  }
  ids.add(row.requestId);rows.set(row.requestId,row);
 }
 for(const record of state.messages){
  const peer=contactForPacket(state,record.packet);assert(peer,'Archived message has no matching contact or request.');
  const payload=await readPayload(peer,record.packet);
  if(payload.kind===CONTACT_REQUEST)assert(rows.has(record.packet.id),'An archived request has no saved request record.');
  if(payload.kind===CONTACT_RESPONSE){
   const row=rows.get(payload.requestId),request=state.messages.find(record=>record.packet.id===payload.requestId)?.packet;
   assert(keysAre(payload,['kind','requestId','decision'])&&row&&row.status===payload.decision&&request&&record.packet.from===request.to&&record.packet.to===request.from,'An archived response does not match a saved decision.');
  }
 }
 validateDeclinedContacts(state.declinedContactIds);
 return structuredClone(requests);
}
export async function chatSnapshot(state,{receipts=true}={}){
 assert(state.identity&&Array.isArray(state.contacts)&&state.contacts.length<=500&&Array.isArray(state.messages)&&state.messages.length<=1000,'Backup supports up to 500 contacts and 1,000 messages.');
 assert(bytes([state.identity.profile,state.contacts,state.messages,state.contactRequests??[],state.declinedContactIds??[]]).length<=8000000,'Chat archive is too large.');
 const contactRequests=await validateContactRequestSnapshot(state),messages=[];
 for(const record of state.messages){
  const peer=contactForPacket(state,record.packet);assert(peer,'A saved message has no contact or request.');
  const payload=await openMessage(state.identity,peer,record.packet);
  if(payload.kind==='chat'||isContactControl(payload))messages.push(chatBackupRecord(record,{receipts}));
  else assert(['lenz-near-payment-v1','trade-offer','trade-agreed','trade-payment'].includes(payload.kind),'Unsupported saved message.');
 }
 return {profile:state.identity.profile,contacts:state.contacts,messages,...(contactRequests.length?{contactRequests}:{}),...(state.declinedContactIds?.length?{declinedContactIds:validateDeclinedContacts(state.declinedContactIds)}:{})};
}
export function mergeContactRequestHistory(local,remote){
 const rows=new Map((remote??[]).map(row=>[row.requestId,structuredClone(row)]));
 for(const row of local??[]){
  const previous=rows.get(row.requestId);
  if(!previous){rows.set(row.requestId,structuredClone(row));continue;}
  assert(previous.peerId===row.peerId&&previous.direction===row.direction&&sameKeys(previous.profile,row.profile),'Message request histories disagree.');
  assert(previous.status==='pending'||row.status==='pending'||previous.status===row.status,'Message request decisions disagree.');
  if(row.status!=='pending'&&previous.status==='pending')rows.set(row.requestId,structuredClone(row));
  else if(previous.status===row.status&&row.responseId&&row.responseId<previous.responseId)rows.set(row.requestId,structuredClone(row));
 }
 assert(rows.size<=256,'Combined message requests exceed the backup limit.');
 return [...rows.values()];
}
