import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPublicKey,verify} from 'node:crypto';
import {base58} from '@scure/base';
import {disposableIntentsSession} from './disposable-intents-session.mjs';
import {emptyAuthenticationPayload,fetchAuthenticationSalt,INTENTS_AUTH_RPC} from './intents-auth-payload.mjs';
const input=()=>({signerId:'a'.repeat(64),salt:Uint8Array.from([1,2,3,4]),now:1793577600000,lifetimeMs:240000,random:Uint8Array.from([1,2,3,4,5,6,7])});
test('all 32 saved official-SDK payload fixtures remain byte-identical',()=>{
  const saved=JSON.parse(readFileSync(new URL('./intents-auth-sdk-fixtures.json',import.meta.url)));
  assert.equal(saved.fixtures.length,32);
  for(const f of saved.fixtures)assert.equal(JSON.stringify(emptyAuthenticationPayload({...f,salt:Uint8Array.from(f.salt),random:Uint8Array.from(f.random)})),JSON.stringify(f.expected));
});
test('empty authentication matches the SDK v0 wire format and has no token actions',()=>{
  const payload=emptyAuthenticationPayload(input()),nonce=Buffer.from(payload.nonce,'base64');
  assert.equal(nonce.length,32);assert.equal(nonce.subarray(0,9).toString('hex'),'5628f6c60001020304');
  assert.equal(nonce.readBigUInt64LE(9),1793577840000000000n);assert.equal(nonce.readBigInt64LE(17),1793577600000000000n);
  assert.equal(nonce.subarray(25).toString('hex'),'01020304050607');
  assert.deepEqual(payload,{verifying_contract:'intents.near',signer_id:'a'.repeat(64),deadline:new Date(1793577840000).toISOString(),nonce:nonce.toString('base64'),intents:[]});
  assert.deepEqual(emptyAuthenticationPayload({...input(),intents:[{transfer:{}}]}).intents,[]);
});
test('authentication refuses malformed identity, salt, randomness, lifetime and overflowing times',()=>{
  for(const change of [{signerId:'b.near'},{signerId:'a'.repeat(63)},{signerId:{toString:()=>'a'.repeat(64)}},{salt:new Uint8Array(3)},{salt:[1,2,3,4]},
    {random:new Uint8Array(6)},{lifetimeMs:0},{lifetimeMs:300001},{lifetimeMs:1.1},{now:-1},{now:NaN},{now:Number.MAX_SAFE_INTEGER}])
    assert.throws(()=>emptyAuthenticationPayload({...input(),...change}),/Invalid|bounds/);
});
test('authentication uses fresh randomness and snapshots supplied bytes',()=>{
  const {random,...args}=input(),a=emptyAuthenticationPayload(args),b=emptyAuthenticationPayload(args);
  assert.notEqual(a.nonce,b.nonce);args.salt.fill(9);assert.equal(Buffer.from(a.nonce,'base64').subarray(5,9).toString('hex'),'01020304');
});
const rpc=()=>({jsonrpc:'2.0',id:'lenz-auth-salt',result:{result:[...Buffer.from('"01020304"')]}});
test('salt lookup pins contract, view method and finality and rejects malformed responses',async()=>{
  const fetcher=async(url,options)=>{assert.equal(url,INTENTS_AUTH_RPC);assert.equal(options.method,'POST');assert(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body),{jsonrpc:'2.0',id:'lenz-auth-salt',method:'query',params:{request_type:'call_function',account_id:'intents.near',method_name:'current_salt',args_base64:'e30=',finality:'optimistic'}});
    return {ok:true,json:async()=>rpc()};};
  assert.equal(Buffer.from(await fetchAuthenticationSalt({fetcher})).toString('hex'),'01020304');
  for(const body of [{...rpc(),error:{}},{...rpc(),id:1},{...rpc(),jsonrpc:'1.0'},
    {...rpc(),result:{result:[256]}},{...rpc(),result:{result:[...Buffer.from('"abc"')]}},{...rpc(),result:{result:new Array(33).fill(0)}}])
    await assert.rejects(fetchAuthenticationSalt({fetcher:async()=>({ok:true,json:async()=>body})}));
  await assert.rejects(fetchAuthenticationSalt({fetcher:async()=>({ok:false})}),/RPC failed/);
});
test('disposable authentication signs the empty payload with its matching fresh Ed25519 identity',async()=>{
  const calls=[];let address;
  const fetcher=async(url,options)=>{calls.push(url);if(url===INTENTS_AUTH_RPC)return {ok:true,json:async()=>rpc()};
    assert.equal(url,'https://1click.chaindefuser.com/v0/auth/authenticate');
    const {signedData:s}=JSON.parse(options.body),payload=JSON.parse(s.payload);
    assert.equal(s.standard,'raw_ed25519');assert.deepEqual(payload.intents,[]);assert.equal(payload.verifying_contract,'intents.near');
    const publicBytes=base58.decode(s.public_key.slice(8));address=Buffer.from(publicBytes).toString('hex');assert.equal(payload.signer_id,address);
    const key=createPublicKey({format:'der',type:'spki',key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),publicBytes])});
    assert(verify(null,Buffer.from(s.payload),key,base58.decode(s.signature.slice(8))));
    return {ok:true,json:async()=>({accessToken:'local-session-fixture',expiresIn:60})};};
  assert.deepEqual(await disposableIntentsSession({fetcher,now:input().now}),{address,sessionToken:'local-session-fixture',expiresIn:60});
  assert.equal(calls.length,2);
});
