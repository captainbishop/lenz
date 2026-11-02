// Empty authentication only; no transfer, bridge or execution primitives.
import {randomBytes as secureRandomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

export const INTENTS_AUTH_RPC='https://free.rpc.fastnear.com';
export function emptyAuthenticationPayload({signerId,salt,now=Date.now(),lifetimeMs=240000,random=secureRandomBytes(7)}){
  assert(typeof signerId==='string'&&/^[0-9a-f]{64}$/.test(signerId),'Invalid authentication signer');
  assert(Number.isSafeInteger(now)&&now>=0,'Invalid authentication time');
  assert(Number.isSafeInteger(lifetimeMs)&&lifetimeMs>0&&lifetimeMs<=300000,'Invalid authentication lifetime');
  assert(salt instanceof Uint8Array&&salt.length===4,'Invalid authentication salt');
  assert(random instanceof Uint8Array&&random.length===7,'Invalid authentication randomness');
  const deadline=now+lifetimeMs,startNs=BigInt(now)*1000000n,endNs=BigInt(deadline)*1000000n;
  assert(Number.isSafeInteger(deadline)&&endNs<=0xffffffffffffffffn&&startNs<=0x7fffffffffffffffn,'Authentication time exceeds nonce bounds');
  // SDK 0.93.0: versioned magic, v0, four-byte salt, u64 deadline,
  // then i64 start timestamp and seven random bytes; integers are little-endian.
  const nonce=Buffer.alloc(32);nonce.set([86,40,246,198,0]);nonce.set(salt,5);
  nonce.writeBigUInt64LE(endNs,9);nonce.writeBigInt64LE(startNs,17);nonce.set(random,25);
  return {verifying_contract:'intents.near',signer_id:signerId,deadline:new Date(deadline).toISOString(),nonce:nonce.toString('base64'),intents:[]};
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
  return Buffer.from(salt,'hex');
}
