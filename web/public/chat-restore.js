import {readState,updateState} from './chat-store.js';
import {readChatBackup} from './recovery-service.js';
import {assert,bytes,hex,unhex,keysAre,openMessage} from './peer-crypto.js';
import {RECOVERED_CHAT,isRecoveredChat} from './chat-access.js';
import {validateRecoveryLink} from './legacy-recovery.js';
import {contactForPacket,isContactControl} from './contact-requests.js';
import {validateDeclinedContacts} from './contact-request-backup.js';
const HISTORY='lenz/recovered-history/v1';
const empty=state=>keysAre(state,['identity','contacts','messages'])&&state.identity===null&&Array.isArray(state.contacts)&&!state.contacts.length&&Array.isArray(state.messages)&&!state.messages.length;
const aad=(id,source)=>bytes([HISTORY,id,source]);

export async function readRecoveredHistory(state){
  if(!isRecoveredChat(state.identity))return null;
  const r=state.recoveredChat;
  assert(keysAre(r,['type','sourceId','link','key','iv','ciphertext','archive'])&&r.type===HISTORY,'Recovered history is unavailable.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(r.iv),additionalData:aad(state.identity.profile.id,r.sourceId)},r.key,unhex(r.ciphertext));
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}finally{new Uint8Array(plain).fill(0);}
  const fields=['sourceProfile','contacts','history'];if(Object.hasOwn(value,'contactRequests'))fields.push('contactRequests');
  assert(keysAre(value,fields)&&value.sourceProfile.id===r.sourceId&&Array.isArray(value.history),'Invalid recovered history.');
  const link=await validateRecoveryLink(r.link,r.sourceId);assert(link.to.id===state.identity.profile.id,'Recovery identity does not match.');
  return value;
}

export function createChatRestorer({read=readState,update=updateState}={}){
  return async function stage(phrase,file){
    const restored=await readChatBackup(phrase,file),identity=structuredClone(restored.identity);
    identity.access=RECOVERED_CHAT;
    const value={sourceProfile:restored.sourceProfile,contacts:restored.contacts,history:restored.history,...(restored.sourceContactRequests?{contactRequests:restored.sourceContactRequests}:{})};
    let recoveredChat=null;
    if(restored.link){
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
      const plaintext=bytes(value);let ciphertext;
      try{ciphertext=hex(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(identity.profile.id,restored.sourceProfile.id)},key,plaintext));}finally{plaintext.fill(0);}
      recoveredChat={type:HISTORY,sourceId:restored.sourceProfile.id,link:structuredClone(restored.link),key,iv:hex(iv),ciphertext,archive:structuredClone(restored.archive)};
    }
    const previewHistory=structuredClone(restored.history.filter(row=>!isContactControl(row.payload)));
    for(const {packet} of restored.messages??[]){const peer=contactForPacket({identity,contacts:restored.contacts,contactRequests:restored.contactRequests??[]},packet),payload=await openMessage(identity,peer,packet);if(!isContactControl(payload))previewHistory.push({packet,payload});}
    let active=true;const controller=new AbortController();
    return {
      preview:{...structuredClone(value),history:previewHistory,ownIds:[restored.sourceProfile.id,identity.profile.id]},canInstall:empty(await read()),identityChanged:identity.profile.id!==restored.sourceProfile.id,
      cancel(){active=false;controller.abort(Error('Restore was cancelled.'));},
      async install(){
        assert(active,'Open the backup again before restoring.');
        return update(state=>{
          assert(active,'Restore was cancelled.');
          assert(empty(state),'This browser already has account data. Use an empty browser to restore chat.');
          state.identity=structuredClone(identity);state.contacts=structuredClone(restored.contacts);state.messages=structuredClone(restored.messages??[]);
          if(restored.contactRequests?.length)state.contactRequests=structuredClone(restored.contactRequests);
          if(restored.declinedContactIds?.length)state.declinedContactIds=validateDeclinedContacts(restored.declinedContactIds);
          if(recoveredChat)state.recoveredChat=structuredClone(recoveredChat);
          return structuredClone(identity.profile);
        },{signal:controller.signal});
      },
    };
  };
}
export const stageChatRestore=createChatRestorer();
