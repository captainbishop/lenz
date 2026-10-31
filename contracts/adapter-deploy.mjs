// A new disposable testnet adapter. Never updates the existing reserve or user identity.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Account, KeyPair, actions, teraToGas } from 'near-api-js';
import { provider, configuration, view, call, finalReceipt } from './client.mjs';
const reserve=await configuration();assert(reserve.ready && reserve.network==='testnet');
const previous=JSON.parse(await readFile(new URL('./rhea-flow-results.json',import.meta.url),'utf8'));
assert(previous.ok && previous.token===reserve.contract);
const wasm=await readFile(new URL('./target/wasm32-unknown-unknown/release/lenz_rhea_adapter.wasm',import.meta.url));
const hash=createHash('sha256').update(wasm).digest('hex');
const keyPath=new URL('./.testnet/adapter.json',import.meta.url), evidencePath=new URL('./adapter/deployment.json',import.meta.url);
let key;
try{key=JSON.parse(await readFile(keyPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const pair=KeyPair.fromRandom('ed25519');key={accountId:`lenz-rhea-${Date.now()}.testnet`,privateKey:pair.toString(),publicKey:pair.getPublicKey().toString()};await writeFile(keyPath,JSON.stringify(key),{flag:'wx',mode:0o600});}
assert(/^lenz-rhea-[0-9]+\.testnet$/.test(key.accountId));
let evidence;
try{evidence=JSON.parse(await readFile(evidencePath,'utf8'));assert.equal(evidence.wasmSha256,hash,'Adapter build changed; do not replace deployed code');assert.equal(evidence.adapter,key.accountId);}catch(e){if(e.code!=='ENOENT')throw e;}
evidence??={network:'testnet',adapter:key.accountId,reserve:reserve.contract,exchange:previous.exchange,poolId:previous.poolId,tokenOut:'wrap.testnet',wasmSha256:hash,wasmBytes:wasm.length,steps:{},ready:false};
async function save(){evidence.checkedAt=new Date().toISOString();await writeFile(evidencePath,JSON.stringify(evidence,null,2)+'\n',{flush:true});}
async function step(name,fn){if(evidence.steps[name])return;try{evidence.steps[name]=await fn();await save();console.log('PASS '+name);}catch(e){evidence.failure={step:name,message:e.message};await save();throw e;}}
await save();
let state;
try{state=await provider.viewAccount({accountId:key.accountId,blockQuery:{finality:'final'}});}catch(e){if(!/does not exist|UNKNOWN_ACCOUNT/i.test(e.message))throw e;}
if(!state){
  const response=await fetch('https://helper.testnet.near.org/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:key.accountId,newAccountPublicKey:key.publicKey}),signal:AbortSignal.timeout(45000)});
  assert(response.ok,`Testnet faucet HTTP ${response.status}`);
  for(let n=0;n<15;n++){try{state=await provider.viewAccount({accountId:key.accountId,blockQuery:{finality:'final'}});break;}catch(e){if(n===14)throw e;await new Promise(r=>setTimeout(r,2000));}}
}
const account=new Account(key.accountId,provider,key.privateKey);
if(state.code_hash!=='11111111111111111111111111111111')assert(evidence.steps.deploy,'Existing code has no recorded deployment; reconcile before continuing');
await step('deploy',async()=>finalReceipt(await account.signAndSendTransaction({receiverId:key.accountId,actions:[actions.deployContract(wasm),actions.functionCall('new',{reserve:reserve.contract,pool_id:previous.poolId},teraToGas('100'),0n)],waitUntil:'FINAL'})));
assert.deepEqual(await view(key.accountId,'configuration',{}),{network:'testnet',adapter:key.accountId,reserve:reserve.contract,exchange:previous.exchange,poolId:previous.poolId,tokenOut:'wrap.testnet'});
await step('register adapter on tUSD',()=>call(account,reserve.contract,'storage_deposit',{account_id:key.accountId,registration_only:true},'0.02'));
await step('register adapter on wrapped NEAR',()=>call(account,'wrap.testnet','storage_deposit',{account_id:key.accountId,registration_only:true},'0.02'));
await step('register adapter on Rhea',()=>call(account,previous.exchange,'storage_deposit',{account_id:key.accountId,registration_only:false},'0.2'));
await step('register adapter token pair',()=>call(account,previous.exchange,'register_tokens',{token_ids:[reserve.contract,'wrap.testnet']},'0.000000000000000000000001'));
const exchange=await provider.viewAccount({accountId:previous.exchange,blockQuery:{finality:'final'}});assert.equal(exchange.code_hash,previous.exchangeCodeHash);
const deployed=await provider.viewAccount({accountId:key.accountId,blockQuery:{finality:'final'}});evidence.codeHash=deployed.code_hash;evidence.exchangeCodeHash=exchange.code_hash;
evidence.ready=true;delete evidence.failure;await save();
const {network,adapter,exchange:ex,poolId,tokenOut,wasmSha256,codeHash,exchangeCodeHash}=evidence;
await writeFile(new URL('../web/public/rhea-config.json',import.meta.url),JSON.stringify({network,adapter,reserve:reserve.contract,exchange:ex,poolId,tokenOut,wasmSha256,codeHash,exchangeCodeHash,ready:true},null,2)+'\n');
console.log(JSON.stringify({adapter:key.accountId,ready:true,wasmBytes:wasm.length}));
