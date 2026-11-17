import {assert,CHAT_DOMAIN,keysAre,sealMessage,validateProfile} from './peer-crypto.js';
import {updateState} from './chat-store.js';

export const CONTACT_REQUEST='lenz-contact-request-v1',CONTACT_RESPONSE='lenz-contact-response-v1';
export const isContactControl=payload=>payload?.kind===CONTACT_REQUEST||payload?.kind===CONTACT_RESPONSE;
const MAX_PENDING=32,MAX_REQUESTS=256;
const samePacket=(a,b)=>keysAre(a,Object.keys(b))&&Object.keys(b).every(key=>a[key]===b[key]);
export function contactForPacket(state,packet){
 const peerId=packet.from===state.identity?.profile.id?packet.to:packet.from;
 return state.contacts.find(p=>p.id===peerId)??state.contactRequests?.find(r=>r.peerId===peerId)?.profile;
}
export function contactRequestStatus(state,peerId){
 if(state.declinedContactIds?.includes(peerId))return 'declined';
 const incoming=state.contactRequests?.find(r=>r.peerId===peerId&&r.direction==='incoming');
 const outgoing=state.contactRequests?.find(r=>r.peerId===peerId&&r.direction==='outgoing');
 return incoming?.status==='declined'||outgoing?.status==='declined'?'declined':incoming?.status==='pending'||outgoing?.status==='pending'?'pending':'accepted';
}
export async function requestSender(packet,sender){
 assert(sender&&sender.id===packet.from,'Add and verify the sender’s contact card first.');
 return validateProfile({type:CHAT_DOMAIN,id:sender.id,name:'New person',signingPublic:sender.signingPublic,boxPublic:sender.boxPublic});
}
function savePacket(state,packet){
 const previous=state.messages.find(r=>r.packet.id===packet.id);
 if(previous){assert(samePacket(previous.packet,packet),'This message ID was reused with different content.');return previous;}
 assert(state.messages.length<1000,'This device has reached its 1,000-message storage limit.');
 const record={packet};state.messages.push(record);return record;
}
function newRequest(state,request){
 state.contactRequests??=[];
 assert(state.contactRequests.length<MAX_REQUESTS,'This device has reached its 256-request storage limit. Save a backup before clearing space.');
  assert(request.direction!=='incoming'||request.status!=='pending'||state.contactRequests.filter(r=>r.status==='pending'&&r.direction==='incoming').length<MAX_PENDING,'Your 32 pending requests are full. Accept or decline a request first.');
 state.contactRequests.push(request);return request;
}
function checkOwner(state,owner){assert(state.identity&&state.identity.profile.id===owner,'Your account changed. Reload before changing contacts.');}
export async function addContactRequest(profile,{owner}={}){
 const peer=await validateProfile(profile);
 return updateState(async state=>{
  checkOwner(state,owner);assert(peer.id!==owner,'This is your own Lenz ID.');
  assert(contactRequestStatus(state,peer.id)!=='declined','This request was declined.');
  const existing=state.contacts.findIndex(p=>p.id===peer.id);
  if(existing!==-1){state.contacts[existing]=peer;return {packet:null,created:false};}
  const payload={kind:CONTACT_REQUEST,profile:await validateProfile(state.identity.profile)};
  const packet=await sealMessage(state.identity,peer,payload);
  newRequest(state,{requestId:packet.id,peerId:peer.id,profile:peer,direction:'outgoing',status:'pending'});
  state.contacts.push(peer);savePacket(state,packet).deliveryRequested=true;
  return {packet,created:true};
 });
}
async function prepareResponse(state,request,decision){
 const original=state.messages.find(r=>r.packet.id===request.requestId);
 assert(original&&original.packet.from===request.peerId&&original.packet.to===state.identity.profile.id,'The original incoming request is not saved.');
 if(request.responseId){
  const previous=state.messages.find(r=>r.packet.id===request.responseId);
  assert(previous,'The saved request response is missing.');return previous.packet;
 }
 const packet=await sealMessage(state.identity,request.profile,{kind:CONTACT_RESPONSE,requestId:request.requestId,decision});
 savePacket(state,packet).deliveryRequested=true;request.responseId=packet.id;return packet;
}
export async function resolveContactRequest(requestId,decision,{owner}={}){
 assert(['accepted','declined'].includes(decision),'Choose Accept or Decline.');
 return updateState(async state=>{
  checkOwner(state,owner);
  const request=state.contactRequests?.find(r=>r.requestId===requestId&&r.direction==='incoming');
  assert(request,'This message request is no longer available.');
  assert(request.status==='pending'||request.status===decision,'This request already has a different decision.');
  const packet=await prepareResponse(state,request,decision);
  if(decision==='accepted'&&!state.contacts.some(p=>p.id===request.peerId))state.contacts.push(await validateProfile(request.profile));
  request.status=decision;return packet;
 });
}
// Called inside the same saved intake transaction as encrypted history.
export async function receiveContactControl(state,packet,payload,peer){
 const previous=state.messages.find(r=>r.packet.id===packet.id);
 if(previous)assert(samePacket(previous.packet,packet),'This message ID was reused with different content.');
 if(payload.kind===CONTACT_REQUEST){
  assert(keysAre(payload,['kind','profile']),'Invalid message request.');
  const profile=await validateProfile(payload.profile);
  assert(profile.id===packet.from&&profile.signingPublic===peer.signingPublic&&profile.boxPublic===peer.boxPublic,'Message request profile does not match the sender.');
  const current=state.contactRequests?.find(r=>r.peerId===peer.id&&r.direction==='incoming');
  if(contactRequestStatus(state,peer.id)==='declined')return {duplicate:!!previous,contactId:peer.id,kind:CONTACT_REQUEST,ignored:true};
  if(current?.status==='pending')assert(current.requestId===packet.id,'A request from this person is already waiting.');
  savePacket(state,packet);
  let request=state.contactRequests?.find(r=>r.requestId===packet.id&&r.direction==='incoming');
  if(!request)request=newRequest(state,{requestId:packet.id,peerId:peer.id,profile,direction:'incoming',status:state.contacts.some(p=>p.id===peer.id)?'accepted':'pending'});
  if(request.status==='accepted')await prepareResponse(state,request,'accepted');
  return {duplicate:!!previous,contactId:peer.id,kind:CONTACT_REQUEST};
 }
 assert(keysAre(payload,['kind','requestId','decision'])&&/^[0-9a-f]{32}$/.test(payload.requestId)&&['accepted','declined'].includes(payload.decision),'Invalid request response.');
 const request=state.contactRequests?.find(r=>r.requestId===payload.requestId&&r.peerId===packet.from&&r.direction==='outgoing');
 assert(request,'This response does not match a saved outgoing request.');
 assert(request.status==='pending'||request.status===payload.decision,'The request already has a different decision.');
 if(request.status!=='pending'){
  assert(state.messages.some(r=>r.packet.id===request.responseId),'The original request response is not saved.');
  if(packet.id!==request.responseId)return {duplicate:true,contactId:peer.id,kind:CONTACT_RESPONSE,ignored:true};
 }
 savePacket(state,packet);request.status=payload.decision;request.responseId=packet.id;
 return {duplicate:!!previous,contactId:peer.id,kind:CONTACT_RESPONSE};
}
