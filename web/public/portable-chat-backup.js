import {sealChatArchive,openChatArchive} from './identity-recovery.js';
import {RECOVERED_CHAT} from './chat-access.js';
import {keysAre,randomId} from './peer-crypto.js';

const DATABASE='lenz-portable-chat-backup-v1',STORE='backup',KEY='latest';
function validateRecord(record){
 if(record===undefined)return null;
 if(!keysAre(record,['revision','archive'])||!/^[0-9a-f]{32}$/.test(record.revision)||!keysAre(record.archive,['type','kdf','salt','iv','ciphertext']))throw Error('The automatic backup cannot be read. Use an exported backup.');
 return record;
}
async function database(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DATABASE,1);let failed=false;
  request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
  request.onerror=()=>{failed=true;reject(request.error);};
  request.onblocked=()=>{failed=true;reject(Error('Close the other Lenz page and try again.'));};
  request.onsuccess=()=>{if(failed){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 });
}
async function access(mode,operation,{key=KEY,signal}={}){
 const db=await database();
 try{signal?.throwIfAborted();return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);let result,error;
  const abort=()=>{try{tx.abort();}catch{}},cleanup=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});
  tx.oncomplete=()=>{cleanup();resolve(result);};
  tx.onabort=()=>{cleanup();reject(signal?.reason??error??tx.error??Error('Automatic save failed.'));};
  tx.onerror=()=>{};
  const request=store.get(key);
  request.onsuccess=()=>{try{signal?.throwIfAborted();result=operation(validateRecord(request.result),store);}catch(cause){error=cause;tx.abort();}};
 });}finally{db.close();}
}

/** Only an encrypted archive is persisted; local files must never store identity keys. */
export async function savePortableBackup(phrase,snapshot,expectedRevision){
 if(expectedRevision!==null&&(typeof expectedRevision!=='string'||!/^[0-9a-f]{32}$/.test(expectedRevision)))throw Error('Reopen the automatic backup before saving.');
 const archive=await sealChatArchive(phrase,snapshot),revision=randomId();
 return access('readwrite',(current,store)=>{
  if((current?.revision??null)!==expectedRevision)throw Error('A newer automatic backup is already saved. Reopen it before making changes.');
  store.put({archive,revision},KEY);
  return revision;
 });
}
export async function readPortableBackup(){return access('readonly',current=>current);}
export async function openPortableBackup(phrase){
 const record=await readPortableBackup();if(!record)throw Error('No automatic backup on this browser. Open an exported backup.');
 const restored=await openChatArchive(phrase,record.archive);restored.identity.access=RECOVERED_CHAT;
 return {...restored,revision:record.revision};
}

/** Unattributed legacy archives stay in their original slot for explicit recovery. */
export function createPortableBackupStore(workspace){
 if(!workspace||typeof workspace.workspaceId!=='string'||typeof workspace.readState!=='function'||typeof workspace.readStateLocked!=='function')throw Error('Open a workspace before saving a backup.');
 const key=['workspace',workspace.workspaceId];
 const sameProfile=(state,id)=>{if(!state.identity||state.identity.profile.id!==id)throw Error('Lenz profile changed. Open its backup again.');};
 async function read({signal}={}){
  await workspace.readState({signal});const value=await access('readonly',current=>current,{key,signal});
  return workspace.readStateLocked(()=>value,{signal});
 }
 async function save(phrase,snapshot,expectedRevision,{signal}={}){
  if(expectedRevision!==null&&(typeof expectedRevision!=='string'||!/^[0-9a-f]{32}$/.test(expectedRevision)))throw Error('Reopen the automatic backup before saving.');
  const value=structuredClone(snapshot),id=value?.profile?.id;sameProfile(await workspace.readState({signal}),id);
  const archive=await sealChatArchive(phrase,value),revision=randomId();
  return workspace.readStateLocked((state,{signal:activeSignal})=>{
   sameProfile(state,id);
   return access('readwrite',(current,store)=>{
    if((current?.revision??null)!==expectedRevision)throw Error('A newer automatic backup is already saved. Reopen it before making changes.');
    store.put({archive,revision},key);return revision;
   },{key,signal:activeSignal});
  },{signal});
 }
 async function open(phrase,{signal}={}){
  const record=await read({signal});if(!record)throw Error('No automatic backup for this profile. Open an exported backup.');
  const restored=await openChatArchive(phrase,record.archive);restored.identity.access=RECOVERED_CHAT;
  return workspace.readStateLocked(state=>{sameProfile(state,restored.identity.profile.id);return {...restored,revision:record.revision};},{signal});
 }
 return Object.freeze({read,save,open});
}
