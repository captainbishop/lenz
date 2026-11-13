import {assert,validateProfile,randomId,unhex} from './peer-crypto.js';

const DB='proof-u-private-chat-v1',VERSION=2,META='session',CHANNEL='lenz-workspace-session-v1';
const emptyState=()=>({identity:null,contacts:[],messages:[]});
const lock=operation=>{assert(navigator.locks,'This browser cannot safely change workspace access.');return navigator.locks.request(DB,operation);};
function database(){
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB,VERSION);let failed=false,cause;
  request.onblocked=()=>{failed=true;cause=Error('Close the other Lenz page and try again.');reject(cause);};
  request.onerror=()=>reject(cause??request.error);
  request.onupgradeneeded=()=>{
   const db=request.result,tx=request.transaction;
   if(failed){tx.abort();return;}
   try{
    if(!db.objectStoreNames.contains('state'))db.createObjectStore('state');
    db.createObjectStore('workspaces',{keyPath:'id'});db.createObjectStore('lifecycle');
    const source=tx.objectStore('state').get('workspace');
    source.onsuccess=()=>{
     const state=source.result??emptyState(),identity=state?.identity;
     const row={id:'legacy',kind:identity?'profile':'external',profileId:identity?.profile?.id??null,name:identity?.profile?.name??'External wallet',revision:0,state};
     tx.objectStore('workspaces').put(row);
     tx.objectStore('lifecycle').put({active:null,generation:randomId(),migration:'pending',pending:row.id,auxiliary:'unassigned'},META);
    };
   }catch(error){cause=error;tx.abort();}
  };
  request.onsuccess=()=>{if(failed){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 });
}
async function transaction(stores,mode,operation,{signal}={}){
 signal?.throwIfAborted();
 const db=await database();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction(stores,mode);let result,cause;
  const fail=error=>{cause=error;try{tx.abort();}catch{}};
  const abort=()=>fail(signal.reason),cleanup=()=>signal?.removeEventListener('abort',abort);signal?.addEventListener('abort',abort,{once:true});
  tx.oncomplete=()=>{cleanup();resolve(result);};tx.onerror=()=>{};tx.onabort=()=>{cleanup();reject(cause??tx.error??Error('Workspace storage was interrupted.'));};
  try{signal?.throwIfAborted();operation(tx,value=>result=value,fail);}catch(error){fail(error);}
 });}finally{db.close();}
}
// This detects observable copy changes; opaque key metadata does not establish key equality.
function description(value){
 if(value instanceof CryptoKey)return ['key',value.type,value.extractable,value.usages,description(value.algorithm)];
 if(value instanceof ArrayBuffer)return ['bytes',Array.from(new Uint8Array(value))];
 if(ArrayBuffer.isView(value))return [value.constructor.name,Array.from(new Uint8Array(value.buffer,value.byteOffset,value.byteLength))];
 if(Array.isArray(value))return ['array',value.map(description)];
 if(value&&typeof value==='object')return ['object',Object.keys(value).sort().map(key=>[key,description(value[key])])];
 return [typeof value,typeof value==='bigint'?String(value):value];
}
async function validateState(state){
 assert(state&&typeof state==='object'&&!Array.isArray(state)&&Array.isArray(state.contacts)&&Array.isArray(state.messages),'The saved workspace cannot be read.');
 if(state.identity===null)return;
 const identity=state.identity;assert(identity&&typeof identity==='object','The saved identity cannot be read.');
 const profile=await validateProfile(identity.profile),signing=identity.signingPrivate,box=identity.boxPrivate;
 assert(signing instanceof CryptoKey&&signing.type==='private'&&!signing.extractable&&signing.algorithm.name==='ECDSA'&&signing.algorithm.namedCurve==='P-256'&&signing.usages.includes('sign'),'The saved signing key cannot be read.');
 assert(box instanceof CryptoKey&&box.type==='private'&&!box.extractable&&box.algorithm.name==='ECDH'&&box.algorithm.namedCurve==='P-256'&&box.usages.includes('deriveBits'),'The saved conversation key cannot be read.');
 const message=new TextEncoder().encode('lenz/workspace-key-check/v1'),signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing,message);
 const signingPublic=await crypto.subtle.importKey('raw',unhex(profile.signingPublic),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 assert(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},signingPublic,signature,message),'The saved signing key does not match this profile.');
 const peer=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveBits']),boxPublic=await crypto.subtle.importKey('raw',unhex(profile.boxPublic),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const actual=await crypto.subtle.deriveBits({name:'ECDH',public:peer.publicKey},box,256),expected=await crypto.subtle.deriveBits({name:'ECDH',public:boxPublic},peer.privateKey,256);
 assert(new Uint8Array(actual).every((byte,index)=>byte===new Uint8Array(expected)[index]),'The saved conversation key does not match this profile.');
 new Uint8Array(actual).fill(0);new Uint8Array(expected).fill(0);
}
function ready(meta){assert(meta&&meta.migration==='singleton-preserved'&&typeof meta.generation==='string'&&/^[0-9a-f]{32}$/.test(meta.generation),'Workspace migration is incomplete.');return meta;}
function current(meta,lease,{active=true}={}){
 ready(meta);assert(lease&&lease.generation===meta.generation&&lease.workspaceId===meta.active&&(!active||meta.active!==null),'Workspace access changed. Open it again.');
}
function session(meta){ready(meta);return Object.freeze({workspaceId:meta.active,generation:meta.generation,migration:meta.migration,auxiliary:meta.auxiliary});}
async function saved(){return transaction(['state','workspaces','lifecycle'],'readonly',(tx,done,fail)=>{
 const request=tx.objectStore('lifecycle').get(META);request.onsuccess=()=>{
  const meta=request.result;if(meta?.migration!=='pending'){done({meta});return;}
  const original=tx.objectStore('state').get('workspace'),staged=tx.objectStore('workspaces').get(meta.pending);let count=0;
  const finish=()=>{if(++count===2)done({meta,original:original.result??emptyState(),row:staged.result});};original.onsuccess=finish;staged.onsuccess=finish;
 };request.onerror=()=>fail(request.error);
});}

/** Do not expose profile selection until auxiliary stores and callers use a session lease. */
export async function initializeWorkspaces(){return lock(async()=>{
 const value=await saved();if(value.meta?.migration!=='pending')return session(value.meta);
 assert(value.row&&JSON.stringify(description(value.original))===JSON.stringify(description(value.row.state)),'The saved workspace copy could not be verified.');
 await validateState(value.original);
 return transaction(['state','workspaces','lifecycle'],'readwrite',(tx,done,fail)=>{
  const store=tx.objectStore('lifecycle'),request=store.get(META);request.onsuccess=()=>{
   try{
    const meta=request.result;assert(meta?.migration==='pending'&&meta.pending===value.row.id&&meta.generation===value.meta.generation,'Workspace migration changed. Try again.');
    const source=tx.objectStore('state').get('workspace'),staged=tx.objectStore('workspaces').get(meta.pending);let count=0;
    const finish=()=>{if(++count!==2)return;try{
     const reread=source.result??emptyState(),row=staged.result;
     assert(row&&row.id===value.row.id&&JSON.stringify(description(reread))===JSON.stringify(description(value.original))&&JSON.stringify(description(row.state))===JSON.stringify(description(value.row.state)),'Workspace migration changed. Try again.');
     // Copy the captured original snapshot atomically; a reread cannot authenticate changed opaque keys.
     const identity=value.original.identity;tx.objectStore('workspaces').put({id:row.id,kind:identity?'profile':'external',profileId:identity?.profile.id??null,name:identity?.profile.name??'External wallet',revision:0,state:value.original});
     const next={active:row.id,generation:randomId(),migration:'singleton-preserved',auxiliary:'unassigned'};store.put(next,META);done(session(next));
    }catch(error){fail(error);}};source.onsuccess=finish;staged.onsuccess=finish;
   }catch(error){fail(error);}
  };
 });
});}
export async function workspaceSession(){return lock(()=>transaction('lifecycle','readonly',(tx,done,fail)=>{const r=tx.objectStore('lifecycle').get(META);r.onsuccess=()=>{try{done(session(r.result));}catch(error){fail(error);}};}));}
function checkWorkspaceSession(lease,{signal}={}){return lock(()=>transaction('lifecycle','readonly',(tx,done,fail)=>{const r=tx.objectStore('lifecycle').get(META);r.onsuccess=()=>{try{current(r.result,lease);done();}catch(error){fail(error);}};},{signal}));}
function notifyWorkspaceChange(){
 globalThis.dispatchEvent?.(new Event(CHANNEL));
 if(typeof BroadcastChannel==='function'){try{const channel=new BroadcastChannel(CHANNEL);channel.postMessage('changed');channel.close();}catch{}}
}
/** Notifications trigger a durable check; they carry no profile data or spending authority. */
export async function watchWorkspaceSession(lease){
 const controller=new AbortController();let closed=false,channel;
 const cleanup=()=>{closed=true;channel?.close();for(const event of[CHANNEL,'pageshow','focus','visibilitychange'])globalThis.removeEventListener?.(event,check);globalThis.removeEventListener?.('pagehide',pagehide);};
 const abort=error=>{if(!controller.signal.aborted)controller.abort(error);cleanup();};
 const check=()=>{if(!closed)void checkWorkspaceSession(lease).catch(abort);};
 const pagehide=()=>abort(Error('Workspace access closed. Open it again.'));
 for(const event of[CHANNEL,'pageshow','focus','visibilitychange'])globalThis.addEventListener?.(event,check);globalThis.addEventListener?.('pagehide',pagehide);
 if(typeof BroadcastChannel==='function'){try{channel=new BroadcastChannel(CHANNEL);channel.onmessage=check;}catch{}}
 try{await checkWorkspaceSession(lease);}catch(error){abort(error);}
 return Object.freeze({signal:controller.signal,close:()=>abort(Error('Workspace access closed. Open it again.'))});
}
export async function listWorkspaces(){return lock(()=>transaction(['lifecycle','workspaces'],'readonly',(tx,done,fail)=>{
 const meta=tx.objectStore('lifecycle').get(META);meta.onsuccess=()=>{try{ready(meta.result);const rows=tx.objectStore('workspaces').getAll();rows.onsuccess=()=>done(rows.result.map(({id,kind,profileId,name})=>({id,kind,profileId,name})));}catch(error){fail(error);}};
}));}
export async function readWorkspace(lease,{signal}={}){return lock(()=>transaction(['lifecycle','workspaces'],'readonly',(tx,done,fail)=>{
 const meta=tx.objectStore('lifecycle').get(META);meta.onsuccess=()=>{try{current(meta.result,lease);const r=tx.objectStore('workspaces').get(lease.workspaceId);r.onsuccess=()=>{try{assert(r.result,'The workspace cannot be read.');done({state:r.result.state,revision:r.result.revision});}catch(error){fail(error);}};}catch(error){fail(error);}};
},{signal}));}
export async function stageWorkspace(input,lease,{signal}={}){
 const state=structuredClone(input);signal?.throwIfAborted();await validateState(state);signal?.throwIfAborted();
 const identity=state.identity,id=identity?'profile:'+identity.profile.id:'external:'+randomId(),row={id,kind:identity?'profile':'external',profileId:identity?.profile.id??null,name:identity?.profile.name??'External wallet',revision:0,state};
 return lock(()=>transaction(['lifecycle','workspaces'],'readwrite',(tx,done,fail)=>{
  const meta=tx.objectStore('lifecycle').get(META);meta.onsuccess=()=>{try{current(meta.result,lease,{active:false});const store=tx.objectStore('workspaces'),rows=store.getAll();rows.onsuccess=()=>{try{assert(!rows.result.some(r=>r.id===id||identity&&r.profileId===row.profileId),'This profile is already saved.');store.add(row);done(id);}catch(error){fail(error);}};}catch(error){fail(error);}};
 },{signal}));
}
/** Hold the fence through dependent storage or synchronous request invocation. Never await providers/network or call workspace updates here. */
export async function readWorkspaceLocked(lease,operation,{signal}={}){return lock(async()=>{
 const value=await transaction(['lifecycle','workspaces'],'readonly',(tx,done,fail)=>{
  const meta=tx.objectStore('lifecycle').get(META);meta.onsuccess=()=>{try{current(meta.result,lease);const r=tx.objectStore('workspaces').get(lease.workspaceId);r.onsuccess=()=>{try{assert(r.result,'The workspace cannot be read.');done({state:r.result.state,revision:r.result.revision});}catch(error){fail(error);}};}catch(error){fail(error);}};
 },{signal});
 signal?.throwIfAborted();const result=await operation(value.state);signal?.throwIfAborted();
 await transaction('lifecycle','readonly',(tx,done,fail)=>{const r=tx.objectStore('lifecycle').get(META);r.onsuccess=()=>{try{current(r.result,lease);done();}catch(error){fail(error);}};},{signal});
 return result;
});}
export async function commitWorkspace(lease,input,{signal}={}){
 const snapshot=structuredClone(input);assert(Number.isSafeInteger(snapshot?.revision)&&snapshot.revision>=0,'Reopen the workspace before saving.');signal?.throwIfAborted();await validateState(snapshot.state);signal?.throwIfAborted();
 return lock(()=>transaction(['lifecycle','workspaces'],'readwrite',(tx,done,fail)=>{
  const meta=tx.objectStore('lifecycle').get(META);meta.onsuccess=()=>{try{current(meta.result,lease);const store=tx.objectStore('workspaces'),r=store.get(lease.workspaceId);r.onsuccess=()=>{try{
   const row=r.result;assert(row&&row.revision===snapshot.revision,'A newer workspace change is saved. Reopen it.');
   const initialIdentity=row.profileId===null&&row.state.identity===null;
   assert(initialIdentity||(snapshot.state.identity?.profile.id??null)===row.profileId&&snapshot.state.identity?.access===row.state.identity?.access,'Profile identity or recovered access changed.');
   assert(row.revision<Number.MAX_SAFE_INTEGER,'Workspace revision is full.');const revision=row.revision+1,identity=snapshot.state.identity;
   const save=()=>{store.put({...row,kind:identity?'profile':'external',profileId:identity?.profile.id??null,name:identity?.profile.name??row.name,state:snapshot.state,revision});done(revision);};
   if(initialIdentity&&identity){const rows=store.getAll();rows.onsuccess=()=>{try{assert(!rows.result.some(other=>other.id!==row.id&&other.profileId===identity.profile.id),'This profile is already saved.');save();}catch(error){fail(error);}};}else save();
  }catch(error){fail(error);}};}catch(error){fail(error);}};
 },{signal}));
}
async function transition(workspaceId,lease,{signal}={}){signal?.throwIfAborted();const next=await lock(()=>transaction(['lifecycle','workspaces'],'readwrite',(tx,done,fail)=>{
 const store=tx.objectStore('lifecycle'),r=store.get(META);r.onsuccess=()=>{try{current(r.result,lease,{active:false});const save=()=>{const next={...r.result,active:workspaceId,generation:randomId()};store.put(next,META);done(session(next));};if(workspaceId===null){save();return;}const row=tx.objectStore('workspaces').get(workspaceId);row.onsuccess=()=>{try{assert(row.result,'Choose a saved workspace.');save();}catch(error){fail(error);}};}catch(error){fail(error);}};
},{signal}));notifyWorkspaceChange();return next;}
export const activateWorkspace=(workspaceId,lease,options)=>transition(workspaceId,lease,options);
export const signOutWorkspace=(lease,options)=>transition(null,lease,options);

/** Financial callers must durably record the originating attempt before invoking this request fence. */
export async function dispatchWorkspaceRequest(lease,provider,input,{signal}={}){
 assert(provider&&typeof provider.request==='function','Choose a wallet provider.');const request=structuredClone(input);signal?.throwIfAborted();
 const watched=await watchWorkspaceSession(lease);
 try{
  const pending=await lock(async()=>{
   await transaction('lifecycle','readonly',(tx,done,fail)=>{const r=tx.objectStore('lifecycle').get(META);r.onsuccess=()=>{try{current(r.result,lease);done();}catch(error){fail(error);}};},{signal});
   signal?.throwIfAborted();watched.signal.throwIfAborted();return {reply:provider.request(request)};
  });
  const value=await new Promise((resolve,reject)=>{
   const signals=[watched.signal,signal].filter(Boolean),cleanup=()=>signals.forEach(s=>s.removeEventListener('abort',abort)),abort=()=>{cleanup();reject(signals.find(s=>s.aborted).reason);};
   Promise.resolve(pending.reply).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
   for(const s of signals)s.addEventListener('abort',abort,{once:true});if(signals.some(s=>s.aborted))abort();
  });
  await checkWorkspaceSession(lease,{signal});return value;
 }finally{watched.close();}
}
