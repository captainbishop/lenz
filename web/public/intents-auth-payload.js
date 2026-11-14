// Empty authentication only; no transfer, bridge or execution primitives.
import { base64 } from './intents-vendor/codecs.js';
const assert = (ok, message) => { if (!ok) throw Error(message); };

export const INTENTS_AUTH_RPC='https://free.rpc.fastnear.com';
// Restrict the wallet capability to the exact empty ownership payload we build.
export function checkAuthenticationPayload(text, address, now=Date.now()) {
  assert(typeof text==='string' && text.length<=1024, 'Invalid authentication message.');
  const value=JSON.parse(text);
  assert(value && Object.keys(value).sort().join(',')==='deadline,intents,nonce,signer_id,verifying_contract'
    && value.verifying_contract==='intents.near' && value.signer_id===address
    && Array.isArray(value.intents) && value.intents.length===0, 'Only empty ownership authentication is allowed.');
  const deadline=Date.parse(value.deadline), nonce=base64.decode(value.nonce);
  assert(Number.isSafeInteger(deadline) && deadline>now && deadline<=now+300000
    && new Date(deadline).toISOString()===value.deadline, 'Authentication request expired or invalid.');
  assert(nonce.length===32 && base64.encode(nonce)===value.nonce
    && [86,40,246,198,0].every((byte,index)=>nonce[index]===byte), 'Invalid authentication nonce.');
  const view=new DataView(nonce.buffer,nonce.byteOffset,nonce.byteLength), start=view.getBigInt64(17,true);
  assert(view.getBigUint64(9,true)===BigInt(deadline)*1000000n && start>=0n
    && start<=BigInt(now)*1000000n && BigInt(deadline)*1000000n-start<=300000000000n, 'Invalid authentication nonce lifetime.');
}
export function emptyAuthenticationPayload({signerId,salt,now=Date.now(),lifetimeMs=240000,random=crypto.getRandomValues(new Uint8Array(7))}){
  assert(typeof signerId==='string'&&(/^[0-9a-f]{64}$/.test(signerId)||/^0x[0-9a-f]{40}$/.test(signerId)&&!/^0x0{40}$/.test(signerId)),'Invalid authentication signer');
  assert(Number.isSafeInteger(now)&&now>=0,'Invalid authentication time');
  assert(Number.isSafeInteger(lifetimeMs)&&lifetimeMs>0&&lifetimeMs<=300000,'Invalid authentication lifetime');
  assert(salt instanceof Uint8Array&&salt.length===4,'Invalid authentication salt');
  assert(random instanceof Uint8Array&&random.length===7,'Invalid authentication randomness');
  const deadline=now+lifetimeMs,startNs=BigInt(now)*1000000n,endNs=BigInt(deadline)*1000000n;
  assert(Number.isSafeInteger(deadline)&&endNs<=0xffffffffffffffffn&&startNs<=0x7fffffffffffffffn,'Authentication time exceeds nonce bounds');
  // SDK 0.93.0: versioned magic, v0, four-byte salt, u64 deadline,
  // then i64 start timestamp and seven random bytes; integers are little-endian.
  const nonce=new Uint8Array(32), view=new DataView(nonce.buffer);nonce.set([86,40,246,198,0]);nonce.set(salt,5);
  view.setBigUint64(9,endNs,true);view.setBigInt64(17,startNs,true);nonce.set(random,25);
  return {verifying_contract:'intents.near',signer_id:signerId,deadline:new Date(deadline).toISOString(),nonce:base64.encode(nonce),intents:[]};
}

export async function fetchAuthenticationSalt({fetcher=fetch}={}){
  const response=await fetcher(INTENTS_AUTH_RPC,{method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(20000),
    body:JSON.stringify({jsonrpc:'2.0',id:'lenz-auth-salt',method:'query',params:{request_type:'call_function',account_id:'intents.near',method_name:'current_salt',args_base64:'e30=',finality:'optimistic'}})});
  assert(response.ok,'Authentication salt RPC failed');
  const value=await response.json(),bytes=value?.result?.result;
  assert(value.jsonrpc==='2.0'&&value.id==='lenz-auth-salt'&&!value.error,'Invalid authentication salt RPC envelope');
  assert(Array.isArray(bytes)&&bytes.length<=32&&bytes.every(n=>Number.isInteger(n)&&n>=0&&n<=255),'Invalid authentication salt bytes');
  const salt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(bytes)));
  assert(typeof salt==='string'&&/^[0-9a-fA-F]{8}$/.test(salt),'Invalid authentication salt');
  return Uint8Array.from(salt.match(/../g), byte=>parseInt(byte,16));
}
