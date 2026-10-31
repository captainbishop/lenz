// Isolated testnet receipt/upgrade rehearsal. Never changes product configuration or accounts.
import assert from 'node:assert/strict';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Account,KeyPair,PublicKey,actions,nearToYocto,teraToGas,baseEncode} from 'near-api-js';
import {provider,view} from './client.mjs';
import {createIdentity} from '../web/public/peer-crypto.js';
import {emptyNearVault,fundingRequest} from '../web/public/near-protocol.js';
import {prepareRheaSwap,redemptionTerms} from '../web/public/rhea-protocol.js';

const base=new URL('./adapter/redemption-recovery/',import.meta.url);
const evidenceFile=new URL('rehearsal.json',base),keyFile=new URL('./.testnet/redemption-rehearsal.json',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const [old,candidate,fault,reserveWasm,review,faultBuild,upgrade,productConfig]=await Promise.all([
  readFile(new URL('deployed-v1.wasm',base)),readFile(new URL('candidate.wasm',base)),
  readFile(new URL('fault-fixture.wasm',base)),readFile(new URL('./target/wasm32-unknown-unknown/release/lenz_test_dollar.wasm',import.meta.url)),
  json(new URL('verification.json',base)),json(new URL('fault-build.json',base)),
  json(new URL('./upgrade/applied.json',import.meta.url)),readFile(new URL('../web/public/rhea-config.json',import.meta.url)),
]);
assert.equal(sha(old),review.deployedBaseline.sha256);assert.equal(sha(candidate),review.candidate.sha256);
assert.equal(sha(fault),faultBuild.wasmSha256);assert.equal(sha(reserveWasm),upgrade.newSha256);
const artifactHashes={old:sha(old),candidate:sha(candidate),fault:sha(fault),reserve:sha(reserveWasm)};
for(const method of ['functionCall','deployContract','createAccount','transfer','addFullAccessKey'])assert.equal(typeof actions[method],'function','Missing SDK action '+method);
if(!process.argv.includes('--run')){
  console.log(JSON.stringify({mode:'plan',network:'testnet',accounts:'Two fresh faucet-funded contracts and one recipient subaccount',artifactHashes,
    scope:'Three 1-tUSD fixture orders; expired refunds only. Injected callback failure, code-only upgrades, storage comparison, overlapping recovery and callback replay. No exchange call or configured-account change.'},null,2));
  process.exit(0);
}
// Bound individual HTTP requests, including provider calls. A signed unresolved transaction is never sent again.
const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init={})=>nativeFetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(30000),...(init.signal?[init.signal]:[])])});
assert.equal((await provider.sendJsonRpc('status',[])).chain_id,'testnet');
await mkdir(new URL('./.testnet/',import.meta.url),{recursive:true});
let keys;try{keys=await json(keyFile);}catch(e){if(e.code!=='ENOENT')throw e;const stamp=Date.now();keys={};
  for(const role of ['reserve','adapter','recipient']){const pair=KeyPair.fromRandom('ed25519');
    keys[role]={accountId:role==='recipient'?`r.lenz-redrec-adapter-${stamp}.testnet`:`lenz-redrec-${role}-${stamp}.testnet`,privateKey:pair.toString(),publicKey:pair.getPublicKey().toString()};}
  await writeFile(keyFile,JSON.stringify(keys),{flag:'wx',mode:0o600,flush:true});
}
for(const role of ['reserve','adapter'])assert(new RegExp(`^lenz-redrec-${role}-[0-9]+\\.testnet$`).test(keys[role].accountId));
assert.equal(keys.recipient.accountId,'r.'+keys.adapter.accountId);
const reserveId=keys.reserve.accountId,adapterId=keys.adapter.accountId,recipientId=keys.recipient.accountId;
const accounts=Object.fromEntries(Object.entries(keys).map(([r,k])=>[r,new Account(k.accountId,provider,k.privateKey)]));
let ev;try{ev=await json(evidenceFile);}catch(e){if(e.code!=='ENOENT')throw e;}
ev??={network:'testnet',reserve:reserveId,adapter:adapterId,recipient:recipientId,artifactHashes,productConfigSha256:sha(productConfig),steps:{},pending:{},transactions:{},faucets:{},failures:[],scope:'Actual isolated NEAR testnet receipts with explicitly injected callback failure; native fixtures and product deployment are separate.'};
assert.equal(ev.reserve,reserveId);assert.equal(ev.adapter,adapterId);assert.deepEqual(ev.artifactHashes,artifactHashes);
assert.equal(ev.productConfigSha256,sha(productConfig));
async function save(){ev.checkedAt=new Date().toISOString();const temporary=new URL('rehearsal.json.tmp',base);await writeFile(temporary,JSON.stringify(ev,(_key,value)=>typeof value==='bigint'?value.toString():value,2)+'\n',{flush:true});await rename(temporary,evidenceFile);}
async function step(name,fn){if(ev.steps[name])return ev.steps[name];try{const r=await fn();ev.steps[name]=r??true;await save();console.log('PASS '+name);return r;}catch(e){ev.failures.push({step:name,message:e.message,at:new Date().toISOString()});await save();throw e;}}
async function state(account){try{return await provider.viewAccount({accountId:account,blockQuery:{finality:'final'}});}catch(e){if(/does not exist|UNKNOWN_ACCOUNT/i.test(e.message))return null;throw e;}}
async function snapshot(account){const r=await provider.sendJsonRpc('query',{request_type:'view_state',finality:'final',account_id:account,prefix_base64:'',include_proof:false});return r.values.sort((a,b)=>a.key.localeCompare(b.key));}
async function balances(){return {supply:await view(reserveId,'ft_total_supply',{}),reserved:await view(reserveId,'reserved_balance',{}),reserve:await view(reserveId,'ft_balance_of',{account_id:reserveId}),adapter:await view(reserveId,'ft_balance_of',{account_id:adapterId}),recipient:await view(reserveId,'ft_balance_of',{account_id:recipientId})};}
function conserved(b){assert.equal(BigInt(b.supply),BigInt(b.reserve)+BigInt(b.adapter)+BigInt(b.recipient));assert.equal(b.reserve,b.reserved);assert.equal(b.supply,'3000000');}
const failures=tx=>tx.receipts_outcome.filter(r=>Object.hasOwn(r.outcome.status,'Failure'));
function success(tx){assert(Object.hasOwn(tx.status,'SuccessValue'),JSON.stringify(tx.status));assert.equal(failures(tx).length,0);return tx;}
const fc=(method,args={},gas='80',deposit='0')=>actions.functionCall(method,args,teraToGas(gas),nearToYocto(deposit));
async function transact(name,account,target,list){
  assert([reserveId,adapterId,recipientId].includes(target),'Rehearsal targets only');
  if(ev.transactions[name])return ev.transactions[name];
  let tx;
  if(ev.pending[name]){const p=ev.pending[name];tx=await provider.sendJsonRpc('tx',{tx_hash:p.txHash,sender_account_id:p.sender,wait_until:'FINAL'});}
  else{
    const original=account.signer;
    const signer={getPublicKey:()=>original.getPublicKey(),signTransaction:async t=>{
      const signed=await original.signTransaction(t);ev.pending[name]={txHash:baseEncode(signed.txHash),sender:account.accountId,target};await save();return signed;
    }};
    tx=await account.signAndSendTransaction({receiverId:target,actions:list,waitUntil:'FINAL',throwOnFailure:false,signer});
  }
  assert.equal(tx.final_execution_status,'FINAL');assert.equal(tx.transaction.hash,ev.pending[name].txHash);
  ev.transactions[name]=tx;delete ev.pending[name];await save();return tx;
}
const invoke=(name,account,target,method,args={},gas='80',deposit='0')=>transact(name,account,target,[fc(method,args,gas,deposit)]);
async function faucet(role){const k=keys[role];if(await state(k.accountId))return {account:k.accountId,exists:true};
  assert(!ev.faucets[role],'Prior faucet request unresolved; check its account before another request');
  ev.faucets[role]={account:k.accountId,requestedAt:new Date().toISOString()};await save();
  const response=await fetch('https://helper.testnet.near.org/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:k.accountId,newAccountPublicKey:k.publicKey})});
  ev.faucets[role].status=response.status;ev.faucets[role].body=(await response.text()).slice(0,1500);await save();assert(response.ok,'Faucet HTTP '+response.status);
  for(let n=0;n<15;n++){const s=await state(k.accountId);if(s)return {account:k.accountId,amount:s.amount};await new Promise(r=>setTimeout(r,1500));}throw Error('Faucet account not yet confirmed; request preserved');
}
async function deploy(name,role,bytes,init){
  if(!ev.pending[name]&&!ev.transactions[name]){const s=await state(keys[role].accountId);assert(s);if(init)assert.equal(s.code_hash,'11111111111111111111111111111111');}
  const tx=success(await transact(name,accounts[role],keys[role].accountId,[actions.deployContract(bytes),...(init?[fc('new',init,'80')]:[])]));
  assert.equal((await state(keys[role].accountId)).code_hash,baseEncode(createHash('sha256').update(bytes).digest()));return {txHash:tx.transaction.hash,codeHash:(await state(keys[role].accountId)).code_hash};
}
async function order(label){return view(adapterId,'get_order',{id:ev.fixtures[label].packet.id});}
async function refund(label){const id=ev.fixtures[label].packet.id;
  await step(label+' refund available',async()=>{success(await invoke(label+' expire',accounts.reserve,adapterId,'advance',{id}));assert.equal((await order(label)).stage,'refund_available');return balances();});
  await step(label+' refund paid once',async()=>{const before=await balances();success(await invoke(label+' payout',accounts.reserve,adapterId,'advance',{id}));assert.equal((await order(label)).stage,'refunded');const after=await balances();conserved(after);assert.equal(BigInt(after.recipient)-BigInt(before.recipient),1000000n);return after;});
}
try{
  if(ev.ok){console.log('Saved rehearsal already complete; no transactions repeated.');process.exit(0);}
  await save();
  await step('create isolated reserve',()=>faucet('reserve'));
  await step('create isolated adapter',()=>faucet('adapter'));
  await step('deploy current reserve artifact',()=>deploy('reserve deployment','reserve',reserveWasm,{}));
  await step('deploy exact original adapter',()=>deploy('adapter deployment','adapter',old,{reserve:reserveId,pool_id:2870}));
  await step('create isolated recipient',async()=>{
    if(await state(recipientId))return {account:recipientId,exists:true};
    const tx=success(await transact('recipient creation',accounts.adapter,recipientId,[actions.createAccount(),actions.transfer(nearToYocto('0.1')),actions.addFullAccessKey(PublicKey.fromString(keys.recipient.publicKey))]));return {txHash:tx.transaction.hash};
  });
  await step('register adapter and recipient tokens',async()=>{
    for(const id of [adapterId,recipientId])success(await invoke('register '+id,accounts.reserve,reserveId,'storage_deposit',{account_id:id,registration_only:true},'40','0.02'));return true;
  });
  if(!ev.fixtures){ev.fixtures={};const config={network:'testnet',adapter:adapterId,reserve:reserveId,exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
    for(const label of ['normal','lost','race']){const identity=await createIdentity('Rehearsal '+label),funding=await fundingRequest(identity,reserveId,'1');
      const vault=emptyNearVault(reserveId);vault.roots.push({id:funding.id,owner:funding.owner,amount:funding.amount});const now=Date.now()-60000;
      const {packet}=await prepareRheaSwap(vault,identity,config,{text:'1',minOutput:'1',receiver:recipientId,deadlineMs:now+1},now);ev.fixtures[label]={funding,packet};}
    await save();
  }
  await step('mint three isolated signed inputs',async()=>{for(const [label,f] of Object.entries(ev.fixtures)){const {id,...args}=f.funding;success(await invoke('fund '+label,accounts.reserve,reserveId,'fund_test',args,'80','0.03'));assert(await view(reserveId,'get_root',{id}));}const b=await balances();conserved(b);assert.equal(b.reserved,'3000000');return b;});
  await step('create three old-layout orders',async()=>{for(const [label,f] of Object.entries(ev.fixtures)){success(await invoke('submit '+label,accounts.reserve,adapterId,'submit',{instruction:f.packet.instruction},'80','0.1'));assert.equal((await order(label)).stage,'ready');}return snapshot(adapterId);});
  await step('normal redemption on original code',async()=>{success(await invoke('normal redeem',accounts.reserve,adapterId,'advance',{id:ev.fixtures.normal.packet.id}));assert.equal((await order('normal')).stage,'funded');return balances();});
  await refund('normal');
  await step('snapshot original completed and pending orders',()=>snapshot(adapterId));
  await step('install explicit callback-failure fixture',()=>deploy('fault deployment','adapter',fault));
  await step('fault build preserves original state bytes',async()=>{assert.deepEqual(await snapshot(adapterId),ev.steps['snapshot original completed and pending orders']);return true;});
  await step('actual reserve transfer survives failed callback',async()=>{
    const before=await balances(),id=ev.fixtures.lost.packet.id;
    const tx=await invoke('lost redeem',accounts.reserve,adapterId,'advance',{id});
    assert(failures(tx).some(r=>JSON.stringify(r.outcome.status).includes('LENZ_REHEARSAL_INJECTED_REDEMPTION_CALLBACK_FAILURE')));
    assert.equal((await order('lost')).stage,'redeeming');const after=await balances();conserved(after);
    assert.equal(BigInt(after.adapter)-BigInt(before.adapter),1000000n);
    const expected=sha(JSON.stringify(redemptionTerms(ev.fixtures.lost.packet.config,ev.fixtures.lost.packet.instruction)));
    assert.equal(await view(reserveId,'spent_by',{id:ev.fixtures.lost.packet.instruction.input}),expected);
    return {txHash:tx.transaction.hash,failedReceipts:failures(tx).map(r=>r.id),before,after};
  });
  await step('snapshot before candidate upgrade',()=>snapshot(adapterId));
  await step('upgrade to exact recovery candidate',()=>deploy('candidate deployment','adapter',candidate));
  await step('candidate preserves every prior state entry',async()=>{const after=await snapshot(adapterId);assert.deepEqual(after,ev.steps['snapshot before candidate upgrade']);return {entries:after.length,sha256:sha(JSON.stringify(after))};});
  await step('overlapping recovery restores once and rejects stale callback',async()=>{
    const before=await balances(),id=ev.fixtures.lost.packet.id;
    const tx=await transact('overlapping recoveries',accounts.reserve,adapterId,[fc('recover_redemption',{id},'50'),fc('recover_redemption',{id},'50')]);
    assert.equal((await order('lost')).stage,'funded');assert.equal(failures(tx).length,1);assert.match(JSON.stringify(failures(tx)[0]),/Unexpected callback stage/);
    assert.deepEqual(await balances(),before);return {txHash:tx.transaction.hash,failedReceipts:failures(tx).map(r=>r.id),balances:before};
  });
  await refund('lost');
  await step('original callback races two recovery callbacks safely',async()=>{
    const before=await balances(),id=ev.fixtures.race.packet.id;
    const tx=await transact('original callback race',accounts.reserve,adapterId,[fc('advance',{id},'90'),fc('recover_redemption',{id},'50'),fc('recover_redemption',{id},'50')]);
    assert.equal((await order('race')).stage,'funded');assert.equal(failures(tx).length,2);for(const r of failures(tx))assert.match(JSON.stringify(r),/Unexpected callback stage/);
    const after=await balances();conserved(after);assert.equal(BigInt(after.adapter)-BigInt(before.adapter),1000000n);return {txHash:tx.transaction.hash,failedReceipts:failures(tx).map(r=>r.id),before,after};
  });
  await refund('race');
  await step('forged external recovery callback is rejected',async()=>{const before=await snapshot(adapterId);const tx=await invoke('forged callback',accounts.recipient,adapterId,'on_redemption_status',{id:ev.fixtures.lost.packet.id},'30');assert.equal(failures(tx).length,1);assert.match(JSON.stringify(failures(tx)[0]),/private|Private/);assert.deepEqual(await snapshot(adapterId),before);return {txHash:tx.transaction.hash};});
  await step('replayed original callback cannot rewind paid order',async()=>{
    const before=await snapshot(adapterId),money=await balances(),id=ev.fixtures.lost.packet.id;
    // Test-only fixture queues the original callback; final code in this same receipt is the exact candidate.
    const tx=await transact('late original callback replay',accounts.adapter,adapterId,[actions.deployContract(fault),fc('rehearsal_replay_redemption',{id},'90'),actions.deployContract(candidate)]);
    assert.equal(failures(tx).length,1);assert.match(JSON.stringify(failures(tx)[0]),/Unexpected callback stage/);
    assert.equal((await state(adapterId)).code_hash,baseEncode(createHash('sha256').update(candidate).digest()));
    assert.deepEqual(await snapshot(adapterId),before);assert.deepEqual(await balances(),money);return {txHash:tx.transaction.hash,scope:'Explicit replay through the idempotent reserve, not a naturally delayed historical receipt.'};
  });
  await step('duplicate commands preserve all final balances and state',async()=>{
    const before=await snapshot(adapterId),money=await balances();
    for(const [label,f] of Object.entries(ev.fixtures))success(await transact('terminal retries '+label,accounts.reserve,adapterId,[fc('submit',{instruction:f.packet.instruction},'40','0.1'),fc('advance',{id:f.packet.id},'40'),fc('recover_redemption',{id:f.packet.id},'40')]));
    assert.deepEqual(await snapshot(adapterId),before);const after=await balances();assert.deepEqual(after,money);conserved(after);assert.equal(after.recipient,'3000000');assert.equal(after.adapter,'0');assert.equal(after.reserved,'0');return after;
  });
  assert.equal(sha(await readFile(new URL('../web/public/rhea-config.json',import.meta.url))),ev.productConfigSha256);
  ev.ok=true;ev.checks=Object.keys(ev.steps);await save();console.log(`PASS rehearsal: ${ev.checks.length} checks; product configuration unchanged`);
}catch(e){ev.ok=false;ev.lastError=e.message;await save();console.error(e.message);process.exitCode=1;}
