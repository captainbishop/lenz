import assert from 'node:assert/strict';
const ENDPOINT='https://test.rpc.fastnear.com',MAX_REPLY=256*1024;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function rpcOptions({fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
  assert(typeof fetchImpl==='function'&&Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=60000,'Invalid RPC options');
  return {fetchImpl,timeoutMs};
}
// Only the fixed testnet endpoint is used; the caller selects these two operations.
export async function submissionRpc(method,params,options){
  assert(method==='status'||method==='send_tx','Unsupported submission operation');
  const {fetchImpl,timeoutMs}=rpcOptions(options),controller=new AbortController();
  let timer,reader;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Submission RPC deadline'));},timeoutMs);});
  async function request(){
    const response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',signal:controller.signal,
      headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    if(!response.ok||controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('Submission RPC unavailable');}
    assert(response.body,'Empty submission response');reader=response.body.getReader();
    const chunks=[];let length=0;
    for(;;){controller.signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;length+=value.byteLength;assert(length<=MAX_REPLY,'Submission response too large');chunks.push(value);}
    let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{assert.fail('Invalid submission JSON');}
    assert(object(body)&&body.jsonrpc==='2.0'&&body.id===1&&Object.hasOwn(body,'result')!==Object.hasOwn(body,'error'),'Invalid submission envelope');
    if(Object.hasOwn(body,'error'))throw Error('Submission RPC rejected the request');
    return body.result;
  }
  try{return await Promise.race([request(),deadline]);}
  finally{clearTimeout(timer);controller.abort();if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
}
