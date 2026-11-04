import {readState} from './chat-store.js';
import {assert,keysAre,openMessage} from './peer-crypto.js';
import {createRecoverableIdentity} from './identity-recovery.js';
import {sealLegacyChatArchive,openLegacyChatArchive} from './legacy-recovery.js';

// Capture chat only. Financial records stay in their existing stores.
export async function prepareChatBackup(){
  const state=await readState();assert(state.identity,'Open this page in the browser that holds your Lenz account.');
  assert(Array.isArray(state.contacts)&&state.contacts.length<=500&&Array.isArray(state.messages)&&state.messages.length<=1000,'Backup supports up to 500 contacts and 1,000 messages.');
  const peers=new Map(state.contacts.map(p=>[p.id,p])),messages=[];let excluded=0;
  for(const record of state.messages){
    const p=record.packet,peer=peers.get(p.from===state.identity.profile.id?p.to:p.from);assert(peer,'A message has no matching contact.');
    const payload=await openMessage(state.identity,peer,p);
    if(payload.kind==='chat'){
      assert(keysAre(payload,['kind','text']),'Unsupported chat fields.');messages.push({packet:p});
    }else{
      assert(['lenz-near-payment-v1','trade-offer','trade-agreed','trade-payment'].includes(payload.kind),'Unsupported message type.');excluded++;
    }
  }
  const next=await createRecoverableIdentity(state.identity.profile.name);
  const archive=await sealLegacyChatArchive(state.identity,next.phrase,{profile:state.identity.profile,contacts:state.contacts,messages});
  return {phrase:next.phrase,archive,name:state.identity.profile.name,contacts:state.contacts.length,messages:messages.length,excluded};
}

export async function readChatBackup(phrase,file){
  assert(file&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=16_001_024,'Choose a Lenz chat backup under 16 MB.');
  const text=await file.text();assert(new TextEncoder().encode(text).length<=16_001_024,'Backup is too large.');
  return openLegacyChatArchive(phrase,JSON.parse(text));
}
