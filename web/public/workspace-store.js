import {readWorkspace,readWorkspaceLocked,commitWorkspace,watchWorkspaceSession} from './workspace-session.js';

const backupContent=state=>JSON.stringify([state.identity?.profile,state.contacts,state.messages?.map(record=>[record.packet,record.receiptToShare??null,record.receivedReceipt??null]),state.recoveredChat?.archive,state.contactRecoveries??[],state.privateSpendBox??null]);
function prepared(value,signal){return new Promise((resolve,reject)=>{
 const cleanup=()=>signal.removeEventListener('abort',abort),abort=()=>{cleanup();reject(signal.reason);};
 Promise.resolve(value).then(result=>{cleanup();resolve(result);},error=>{cleanup();reject(error);});
 signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
});}

/** One adapter belongs to one page session; reopening a profile requires a new adapter. */
export async function createWorkspaceStore(lease,{signal}={}){
 const captured=Object.freeze({workspaceId:lease?.workspaceId,generation:lease?.generation}),watched=await watchWorkspaceSession(captured);
 const close=()=>{signal?.removeEventListener('abort',close);watched.close();};
 signal?.addEventListener('abort',close,{once:true});if(signal?.aborted)close();
 watched.signal.addEventListener('abort',()=>signal?.removeEventListener('abort',close),{once:true});watched.signal.throwIfAborted();
 async function scoped(operation,caller){
  const controller=new AbortController(),signals=[watched.signal,caller].filter(Boolean),abort=()=>controller.abort(signals.find(value=>value.aborted).reason);
  for(const value of signals)value.addEventListener('abort',abort,{once:true});if(signals.some(value=>value.aborted))abort();
  try{controller.signal.throwIfAborted();const result=await operation(controller.signal);controller.signal.throwIfAborted();return result;}
  finally{for(const value of signals)value.removeEventListener('abort',abort);}
 }
 const readState=({signal}={})=>scoped(async activeSignal=>(await readWorkspace(captured,{signal:activeSignal})).state,signal);
 // Lock order is workspace update -> session -> dependent storage. Locked readers must not start workspace updates.
 const readStateLocked=(operation,{signal}={})=>scoped(activeSignal=>readWorkspaceLocked(captured,state=>operation(state,{signal:activeSignal}),{signal:activeSignal}),signal);
 const updateState=(operation,{markBackup=true,signal}={})=>scoped(activeSignal=>navigator.locks.request('lenz-workspace-update:'+captured.workspaceId,{signal:activeSignal},async()=>{
  const snapshot=await readWorkspace(captured,{signal:activeSignal}),state=snapshot.state,before=state.accountSync?backupContent(state):null;
  activeSignal.throwIfAborted();const result=await prepared(operation(state,{signal:activeSignal}),activeSignal);activeSignal.throwIfAborted();
  const changed=markBackup&&state.accountSync&&before!==backupContent(state);
  if(changed){state.accountSync.version++;if(state.accountSync.status!=='conflict')state.accountSync.status='pending';}
  await commitWorkspace(captured,snapshot,{signal:activeSignal});
  if(changed){globalThis.dispatchEvent?.(new Event('lenz-account-changed'));if(typeof BroadcastChannel==='function'){const channel=new BroadcastChannel('lenz-account-sync');channel.postMessage('changed');channel.close();}}
  return result;
 }),signal);
 return Object.freeze({workspaceId:captured.workspaceId,readState,readStateLocked,updateState,signal:watched.signal,close});
}
