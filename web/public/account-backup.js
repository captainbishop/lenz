import {assert,bytes,hex,unhex,openMessage,keysAre,digest} from './peer-crypto.js';
import {stageIdentityRecovery,sealChatArchive,openChatArchive,isChatArchiveType} from './identity-recovery.js';
import {sealLegacyChatArchive,validateRecoveryLink} from './legacy-recovery.js';
import {unlockLocalBackup} from './account-keys.js';
import {readChatBackup} from './recovery-service.js';
export const ACCOUNT_BACKUP='lenz/account-backup/v1';
const terms=a=>bytes([a.type,a.accountId,a.revision,a.previous]);
export async function accountChatSnapshot(state,{receipts=true}={}){
  const messages=[];
  for(const record of state.messages){const {packet}=record,peer=state.contacts.find(p=>p.id===(packet.from===state.identity.profile.id?packet.to:packet.from));assert(peer,'A saved message has no contact.');const payload=await openMessage(state.identity,peer,packet);if(payload.kind==='chat'){assert(keysAre(payload,['kind','text']),'Unsupported chat message.');messages.push(receipts?structuredClone(record):{packet});}else assert(['lenz-near-payment-v1','trade-offer','trade-agreed','trade-payment'].includes(payload.kind),'Unsupported saved message.');}
  return {profile:state.identity.profile,contacts:state.contacts,messages};
}
export async function createAccountBackup(state){
  const sync=state.accountSync,phrase=await unlockLocalBackup(sync),own=await stageIdentityRecovery(phrase,state.identity.profile.name);
  const snapshot=await accountChatSnapshot(state,{receipts:own.profile.id===state.identity.profile.id});let chat;
  if(own.profile.id!==state.identity.profile.id)chat=await sealLegacyChatArchive(state.identity,phrase,snapshot);
  else{const current=await sealChatArchive(phrase,snapshot);chat=state.recoveredChat?{type:'lenz/recovered-chat-backup/v1',legacy:state.recoveredChat.archive,current}:current;}
  const archive={type:ACCOUNT_BACKUP,accountId:sync.accountId,revision:sync.revision+1,previous:sync.digest,iv:hex(crypto.getRandomValues(new Uint8Array(12))),ciphertext:''};
  const plain=bytes({chat,contactRecoveries:state.contactRecoveries??[]});assert(plain.length<=8_000_000,'This account exceeds the backup size limit.');
  try{archive.ciphertext=hex(await crypto.subtle.encrypt({name:'AES-GCM',iv:unhex(archive.iv),additionalData:terms(archive)},sync.backupKey,plain));}finally{plain.fill(0);}
  return archive;
}
export async function openAccountBackup(material,result){
  const a=result.archive;assert(keysAre(a,['type','accountId','revision','previous','iv','ciphertext'])&&a.type===ACCOUNT_BACKUP&&a.accountId===material.accountId,'Backup belongs to another account.');
  assert(Number.isSafeInteger(a.revision)&&a.revision>0&&a.revision===result.revision&&result.digest===await digest(a)&&Number.isSafeInteger(result.savedAt)&&result.savedAt>=0&&/^(?:[a-f0-9]{64})?$/.test(a.previous),'Backup revision is invalid.');
  assert(typeof a.iv==='string'&&/^[a-f0-9]{24}$/.test(a.iv)&&typeof a.ciphertext==='string'&&a.ciphertext.length<=16_000_032&&/^(?:[a-f0-9]{2})+$/.test(a.ciphertext),'Invalid backup encryption.');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(a.iv),additionalData:terms(a)},material.backupKey,unhex(a.ciphertext));let value;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));}finally{new Uint8Array(plain).fill(0);}
  assert(keysAre(value,['chat','contactRecoveries'])&&Array.isArray(value.contactRecoveries)&&value.contactRecoveries.length<=500,'Invalid account contents.');
  const recovered=isChatArchiveType(value.chat.type)?await openChatArchive(material.phrase,value.chat):await readChatBackup(material.phrase,new File([JSON.stringify(value.chat)],'backup.json'));
  assert(recovered.identity.profile.id===material.identity.profile.id,'Backup identity does not match this passkey.');
  const roots=new Set();for(const link of value.contactRecoveries){assert(recovered.contacts.some(p=>p.id===link.from?.id)&&recovered.contacts.some(p=>p.id===link.to?.id)&&!roots.has(link.from.id),'Invalid saved contact update.');await validateRecoveryLink(link,link.from.id);roots.add(link.from.id);}
  return {...value,recovered};
}
