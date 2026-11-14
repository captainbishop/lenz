const artifactDefault='/api/intent-testnet/private-pool/artifacts';

/** Note secrets and witnesses remain in the current browser. Dispose on account teardown. */
export function createTornadoProver({artifactBase=artifactDefault,isCurrent=()=>true}={}){
 const base=new URL(artifactBase.endsWith('/')?artifactBase:artifactBase+'/',location.href);
 if(base.origin!==location.origin||base.search||base.hash)throw Error('Tornado artifacts must use a same-origin public endpoint');
 let active=null,disposed=false;
 const aborted=()=>new DOMException('Local proving was cancelled or the account changed','AbortError');
 function cancel(){active?.finish(aborted());}
 addEventListener('lenz-account-identity',cancel);
 function run(operation,input,{signal,onProgress}={}){
  if(disposed)return Promise.reject(Error('Local prover is disposed'));
  if(!isCurrent()||signal?.aborted)return Promise.reject(aborted());
  if(active)return Promise.reject(Error('A local proving operation is already running'));
  return new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./tornado-vendor/prover-worker.js',import.meta.url),{type:'module'});
   const job={finish(error,value){
    if(active!==job)return;
    active=null;signal?.removeEventListener('abort',cancel);worker.onmessage=null;worker.onerror=null;worker.onmessageerror=null;worker.terminate();
    if(error)reject(error);else if(!isCurrent())reject(aborted());else resolve(value);
   }};
   active=job;
   signal?.addEventListener('abort',cancel,{once:true});
   worker.onerror=()=>job.finish(Error('The browser could not run the local Tornado prover'));
   worker.onmessageerror=()=>job.finish(Error('The browser could not read the local proving result'));
   worker.onmessage=event=>{
    if(active!==job)return;
    if(!isCurrent()){job.finish(aborted());return;}
    if(event.data.phase){try{onProgress?.(event.data.phase);}catch{job.finish(aborted());}return;}
    if(event.data.error){job.finish(Error(event.data.error));return;}
    job.finish(null,event.data.result);
   };
   try{worker.postMessage({operation,input,artifactBase:base.href});}catch{job.finish(Error('The browser could not start local proving'));}
  });
 }
 return {
  generateNote:options=>run('note',null,options),
  validateNote:(note,options)=>run('validate-note',note,options),
  buildMerklePath:(commitments,index,options)=>run('path',{commitments,index},options),
  prove:(input,options)=>run('prove',input,options),
  verify:(proof,options)=>run('verify',proof,options),
  cancel,
  dispose(){if(disposed)return;cancel();disposed=true;removeEventListener('lenz-account-identity',cancel);},
 };
}
