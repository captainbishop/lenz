import {readWorkspace,readWorkspaceLocked,watchWorkspaceSession} from './workspace-session.js';

// Keep the provider's actual lifetime: cancellation cannot dismiss a wallet prompt.
// Financial callers must save their attempt and retain late evidence separately.
export async function createWorkspaceDispatcher(lease,{signal}={}){
 const captured=Object.freeze({workspaceId:lease?.workspaceId,generation:lease?.generation});
 signal?.throwIfAborted();
 const watched=await watchWorkspaceSession(captured),close=()=>watched.close();
 signal?.addEventListener('abort',close,{once:true});
 watched.signal.addEventListener('abort',()=>signal?.removeEventListener('abort',close),{once:true});
 if(signal?.aborted)close();
 watched.signal.throwIfAborted();
 async function dispatch(invoke,{signal:caller}={}){
  if(typeof invoke!=='function')throw Error('Choose a request to send.');
  const active=caller?AbortSignal.any([watched.signal,caller]):watched.signal;
  active.throwIfAborted();
  let pending;
  try{await readWorkspaceLocked(captured,()=>{
    active.throwIfAborted();
    // Box the promise so the session fence ends immediately after invocation.
    pending={settled:Promise.resolve(invoke()).then(value=>({ok:true,value}),error=>({ok:false,error}))};
   },{signal:active});
  }catch(error){
   // A later storage failure cannot make an already opened prompt disappear.
   if(pending)await pending.settled;
   throw error;
  }
  const outcome=await pending.settled;
  active.throwIfAborted();
  await readWorkspace(captured,{signal:active});
  active.throwIfAborted();
  if(!outcome.ok)throw outcome.error;
  return outcome.value;
 }
 function request(provider,input,options){
  if(!provider||typeof provider.request!=='function')throw Error('Choose a wallet provider.');
  const copied=structuredClone(input),invoke=provider.request;
  return dispatch(()=>invoke.call(provider,copied),options);
 }
 return Object.freeze({dispatch,request,signal:watched.signal,close});
}
