import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,open,rename,readdir,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const digest=value=>createHash('sha256').update(value).digest('hex');

/** A transport job never grants a replacement signature or retries its backend request. */
export async function openHostedJobs({directory,dispatch,maxJobs=256}={}){
 const root=resolve(directory);await mkdir(root,{recursive:true});
 const lockPath=join(root,'gateway.lock');let lock;
 try{lock=await open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:Date.now()}));await lock.sync();}catch(error){await lock?.close();throw Object.assign(Error('The hosted native journal is already owned. Verify the original gateway stopped before removing its lock.'),{cause:error});}
 const active=new Map();let queue=Promise.resolve(),ioQueue=Promise.resolve(),closing=false,closePromise;
 const serial=operation=>{const result=queue.then(operation);queue=result.catch(()=>{});return result;};
 const fileIO=operation=>{const result=ioQueue.then(operation);ioQueue=result.catch(()=>{});return result;};
 const file=id=>{if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid native transport job.');return join(root,id+'.json');};
 const saved=id=>fileIO(async()=>{const value=JSON.parse(await readFile(file(id),'utf8'));if(![1,2].includes(value.version)||value.id!==id||value.version===2&&!/^[a-f0-9]{64}$/.test(value.identity))throw Error('Invalid native transport journal.');return value;});
 const save=value=>fileIO(async()=>{const target=file(value.id),temporary=target+'.'+randomUUID()+'.tmp',handle=await open(temporary,'wx');try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}await rename(temporary,target);});
 const visible=value=>value.state==='complete'?{lenzHostedJob:value.id,state:'complete',status:value.status,body:value.body}:value.state==='running'&&active.has(value.id)?{lenzHostedJob:value.id,state:'pending'}:{lenzHostedJob:value.id,state:'unknown',error:'The native transport stopped. Check the original saved payment or recover its existing authorization.'};
 const owned=(value,identity)=>{if(value.version===1)return {lenzHostedJob:value.id,state:'unknown',error:'The original hosted job predates identity binding. Check the existing backend request locally; it cannot be reassigned or dispatched again.'};if(value.identity!==identity)throw Object.assign(Error('The native transport job belongs to another Lenz identity.'),{status:403});return visible(value);};
 async function start(requestId,policy,method,body,identity){
  if(!/^[a-f0-9]{64}$/.test(identity))throw Error('Keep the verified Lenz identity with its native job.');
  const id=digest(requestId),requestDigest=digest(Buffer.concat([Buffer.from(method+'\n'+policy.raw+'\n'),body]));
  return serial(async()=>{
   if(closing)throw Error('The native gateway is shutting down. Keep the original request.');
   let previous;try{previous=await saved(id);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(previous){if(previous.version===1)return owned(previous,identity);if(previous.identity!==identity)return owned(previous,identity);if(previous.requestDigest!==requestDigest)throw Error('The native transport identifier belongs to another exact request.');return owned(previous,identity);}
   if((await readdir(root)).filter(name=>name.endsWith('.json')).length>=maxJobs)throw Error('Native transport journal is full.');
   const record={version:2,id,identity,requestDigest,path:policy.path,state:'running',createdAt:Date.now()};await save(record);
   const pending=(async()=>{try{
    const response=await dispatch(policy,method,body,AbortSignal.timeout(1_800_000),identity);
    if(response.status>=300&&response.status<400)throw Error('Unexpected native redirect.');
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>1_000_000)throw Error('Native reply exceeds its limit.');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));await save({...record,state:'complete',status:response.status,body:result,completedAt:Date.now()});
   }catch{await save({...record,state:'unknown',completedAt:Date.now()});}finally{active.delete(id);}})();
   pending.catch(()=>{});active.set(id,pending);return {lenzHostedJob:id,state:'pending'};
  });
 }
 return {start,read:async(id,identity)=>owned(await saved(id),identity),close:()=>closePromise??=(async()=>{closing=true;await queue;await Promise.allSettled([...active.values()]);await lock.close();await unlink(lockPath);})()};
}
