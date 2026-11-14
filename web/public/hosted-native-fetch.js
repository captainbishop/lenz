const actions=new Set(['prepare','authorize','submit','reconcile','recover-authorization']);
const journalKey='lenz/hosted-native-transport/v1';
const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
const errorResponse=error=>Response.json({error,code:'HOSTED_REQUEST_UNCERTAIN'},{status:502});

/** Polls transport jobs without repeating the original signing or submission request. */
export function createHostedNativeFetch({fetcher=globalThis.fetch.bind(globalThis),storage=globalThis.localStorage,crypto=globalThis.crypto,now=Date.now,pollMs=1000,hosted=globalThis.location?.protocol==='https:',lock=operation=>{if(!globalThis.navigator?.locks)throw Error('This browser cannot preserve native requests across tabs.');return navigator.locks.request(journalKey,operation);}}={}){
 return async(input,options={})=>{
  const path=typeof input==='string'?input:'';
  if(!path.startsWith('/api/intent-zcash/')||!actions.has(path.slice('/api/intent-zcash/'.length))||options.method!=='POST'||!hosted)return fetcher(input,options);
  options.signal?.throwIfAborted();
  const body=options.body;
  if(typeof body!=='string')throw Error('Keep the original native request body.');
  const key=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(path+'\n'+body))));
  const id=await lock(()=>{
   let journal;try{journal=JSON.parse(storage.getItem(journalKey)??'{}');}catch{throw Error('The native transport journal cannot be read.');}
   if(!journal||Object.getPrototypeOf(journal)!==Object.prototype)throw Error('The native transport journal is invalid.');
   let id=journal[key];
   if(id!==undefined&&!/^\d{13}-[a-f0-9]{32}$/.test(id))throw Error('The native transport identifier changed.');
   if(!id){if(Object.keys(journal).length>=128)throw Error('Check the original unresolved native requests before creating another.');id=String(now())+'-'+hex(crypto.getRandomValues(new Uint8Array(16)));journal[key]=id;storage.setItem(journalKey,JSON.stringify(journal));}
   return id;
  });
  const headers=new Headers(options.headers);headers.set('x-lenz-hosted-request-id',id);
  const response=await fetcher(input,{...options,headers});
  if(response.status!==202)return response;
  let result=await response.json();
  if(!/^[a-f0-9]{64}$/.test(result.lenzHostedJob))return errorResponse('The native transport reply is invalid. Keep the original request.');
  const job=result.lenzHostedJob;
  while(result.state==='pending'){
   await new Promise((resolve,reject)=>{const finish=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(options.signal.reason);},timer=setTimeout(finish,pollMs),cleanup=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);};options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)abort();});
   const check=await fetcher('/api/hosted/jobs/'+job,{method:'GET',credentials:'same-origin',cache:'no-store',signal:options.signal});
   if(!check.ok)return check;result=await check.json();
   if(result.lenzHostedJob!==job)return errorResponse('The native transport job changed. Keep the original request.');
  }
  if(result.state!=='complete'||!Number.isInteger(result.status)||result.status<200||result.status>599||!result.body)return errorResponse(result.error??'The native transport is uncertain. Check the original saved payment or recover its existing authorization.');
  // A fresh explicit receipt check may repeat a read; authority-bearing results
  // keep their identifier even if the caller cannot persist the returned result.
  if(path==='/api/intent-zcash/reconcile'&&result.status>=200&&result.status<300)await lock(()=>{const journal=JSON.parse(storage.getItem(journalKey)??'{}');if(journal[key]===id){delete journal[key];storage.setItem(journalKey,JSON.stringify(journal));}});
  return Response.json(result.body,{status:result.status});
 };
}
export const hostedFetch=(...args)=>createHostedNativeFetch()(...args);
