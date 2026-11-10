import {readState} from './chat-store.js';
import {assert,keysAre,openMessage} from './peer-crypto.js';
import {createRecoverableIdentity,sealChatArchive,openChatArchive,isChatArchiveType} from './identity-recovery.js';
import {sealLegacyChatArchive,openLegacyChatArchive} from './legacy-recovery.js';
import {isRecoveredChat} from './chat-access.js';
const BUNDLE='lenz/recovered-chat-backup/v1',MAX_FILE=16_001_024;

// Capture chat only. Financial records stay in their existing stores.
export async function prepareChatBackup(savedPhrase){
  const state=await readState();assert(state.identity,'Open this page in the browser that holds your Lenz account.');
  assert(Array.isArray(state.contacts)&&state.contacts.length<=500&&Array.isArray(state.messages)&&state.messages.length<=1000,'Backup supports up to 500 contacts and 1,000 messages.');
  const peers=new Map(state.contacts.map(p=>[p.id,p])),messages=[];let excluded=0;
  for(const record of state.messages){
    const p=record.packet,peer=peers.get(p.from===state.identity.profile.id?p.to:p.from);assert(peer,'A message has no matching contact.');
    const payload=await openMessage(state.identity,peer,p);
    if(payload.kind==='chat'){
      assert(keysAre(payload,['kind','text']),'Unsupported chat fields.');messages.push(isRecoveredChat(state.identity)?structuredClone(record):{packet:p});
    }else{
      assert(['lenz-near-payment-v1','trade-offer','trade-agreed','trade-payment'].includes(payload.kind),'Unsupported message type.');excluded++;
    }
  }
  if(isRecoveredChat(state.identity)){
    assert(typeof savedPhrase==='string'&&savedPhrase.trim(),'Enter the Lenz phrase used to restore this account.');
    const current=await sealChatArchive(savedPhrase,{profile:state.identity.profile,contacts:state.contacts,messages});
    const archive=state.recoveredChat?{type:BUNDLE,legacy:state.recoveredChat.archive,current}:current;
    const restored=state.recoveredChat?await openBundle(savedPhrase,archive):await openChatArchive(savedPhrase,archive);
    assert(restored.identity.profile.id===state.identity.profile.id,'Backup does not match this account.');
    assert(new TextEncoder().encode(JSON.stringify(archive)).length<=MAX_FILE,'Backup exceeds the 16 MB limit.');
    return {phrase:savedPhrase.trim().toLowerCase().split(/\s+/).join(' '),archive,name:state.identity.profile.name,contacts:restored.contacts.length,messages:(restored.history?.length??0)+messages.length,excluded};
  }
  const next=await createRecoverableIdentity(state.identity.profile.name);
  const archive=await sealLegacyChatArchive(state.identity,next.phrase,{profile:state.identity.profile,contacts:state.contacts,messages});
  return {phrase:next.phrase,archive,name:state.identity.profile.name,contacts:state.contacts.length,messages:messages.length,excluded};
}

async function openBundle(phrase,archive){
  assert(keysAre(archive,['type','legacy','current'])&&archive.type===BUNDLE,'Invalid recovered chat backup.');
  const legacy=await openLegacyChatArchive(phrase,archive.legacy),current=await openChatArchive(phrase,archive.current);
  assert(current.identity.profile.id===legacy.identity.profile.id,'Backup accounts differ.');
  const contacts=new Map(legacy.contacts.map(p=>[p.id,p]));for(const p of current.contacts)contacts.set(p.id,p);
  assert(contacts.size<=500&&legacy.history.length+current.messages.length<=1000,'Backup exceeds the contact or message limit.');
  return {...legacy,identity:current.identity,contacts:[...contacts.values()],messages:current.messages,archive:structuredClone(archive.legacy)};
}

export async function readChatBackup(phrase,file){
  assert(file&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=MAX_FILE,'Choose a Lenz chat backup under 16 MB.');
  const text=await file.text();assert(new TextEncoder().encode(text).length<=MAX_FILE,'Backup is too large.');
  const archive=JSON.parse(text);
  if(archive?.type===BUNDLE)return openBundle(phrase,archive);
  if(isChatArchiveType(archive?.type)){
    const restored=await openChatArchive(phrase,archive);
    return {...restored,sourceProfile:restored.identity.profile,history:[],archive};
  }
  return {...await openLegacyChatArchive(phrase,archive),archive};
}
