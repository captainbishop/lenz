import {readState,updateState} from './chat-store.js';
import {readChatBackup} from './recovery-service.js';
import {assert,bytes,hex,unhex,keysAre,openMessage} from './peer-crypto.js';
import {RECOVERED_CHAT,isRecoveredChat} from './chat-access.js';
import {validateRecoveryLink} from './legacy-recovery.js';
const HISTORY='lenz/recovered-history/v1';
const empty=state=>keysAre(state,['identity','contacts','messages'])&&state.identity===null&&Array.isArray(state.contacts)&&!state.contacts.length&&Array.isArray(state.messages)&&!state.messages.length;
const aad=(id,source)=>bytes([HISTORY,id,source]);

export async function readRecoveredHistory(state){
  if(!isRecoveredChat(state.identity))return null;
  const r=state.recoveredChat;
  assert(keysAre(r,['type','sourceId','link','key','iv','ciphertext','archive'])&&r.type===HISTORY,'Recovered history is unavailable.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(r.iv),additionalData:aad(state.identity.profile.id,r.sourceId)},r.key,unhex(r.ciphertext));
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}finally{new Uint8Array(plain).fill(0);}
  assert(keysAre(value,['sourceProfile','contacts','history'])&&value.sourceProfile.id===r.sourceId&&Array.isArray(value.history),'Invalid recovered history.');
  const link=await validateRecoveryLink(r.link,r.sourceId);assert(link.to.id===state.identity.profile.id,'Recovery identity does not match.');
  return value;
}

export function createChatRestorer({read=readState,update=updateState}={}){
  return async function stage(phrase,file){
    const restored=await readChatBackup(phrase,file),identity=structuredClone(restored.identity);
    identity.access=RECOVERED_CHAT;
    const value={sourceProfile:restored.sourceProfile,contacts:restored.contacts,history:restored.history};
    let recoveredChat=null;
    if(restored.link){
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),iv=crypto.getRandomValues(new Uint8Array(12));
      const plaintext=bytes(value);let ciphertext;
      try{ciphertext=hex(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(identity.profile.id,restored.sourceProfile.id)},key,plaintext));}finally{plaintext.fill(0);}
      recoveredChat={type:HISTORY,sourceId:restored.sourceProfile.id,link:structuredClone(restored.link),key,iv:hex(iv),ciphertext,archive:structuredClone(restored.archive)};
    }
    const previewHistory=structuredClone(restored.history);
    for(const {packet} of restored.messages??[]){const peer=restored.contacts.find(p=>p.id===(packet.from===identity.profile.id?packet.to:packet.from));previewHistory.push({packet,payload:await openMessage(identity,peer,packet)});}
    let active=true;
    return {
      preview:{...structuredClone(value),history:previewHistory,ownIds:[restored.sourceProfile.id,identity.profile.id]},canInstall:empty(await read()),identityChanged:identity.profile.id!==restored.sourceProfile.id,
      cancel(){active=false;},
      async install(){
        assert(active,'Open the backup again before restoring.');
        return update(state=>{
          assert(active,'Restore was cancelled.');
          assert(empty(state),'This browser already has account data. Use an empty browser to restore chat.');
          state.identity=structuredClone(identity);state.contacts=structuredClone(restored.contacts);state.messages=structuredClone(restored.messages??[]);
          if(recoveredChat)state.recoveredChat=structuredClone(recoveredChat);
          return structuredClone(identity.profile);
        });
      },
    };
  };
}
export const stageChatRestore=createChatRestorer();
