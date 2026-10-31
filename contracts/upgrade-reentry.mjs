// Defaults to a read-only plan. --apply performs the rehearsed code-only testnet upgrade.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Account,actions} from 'near-api-js';
import {provider,configuration,configPath,finalReceipt,view,relayAccount} from './client.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const config=await configuration();assert(config.ready&&config.network==='testnet'&&/^tusd\.lenz-dev-[0-9]+\.testnet$/.test(config.contract));
assert.equal((await provider.sendJsonRpc('status',[])).chain_id,'testnet');
const wasm=await readFile(new URL('./target/wasm32-unknown-unknown/release/lenz_test_dollar.wasm',import.meta.url));
const source=await readFile(new URL('./src/lib.rs',import.meta.url));
const rehearsal=JSON.parse(await readFile(new URL('./upgrade/rehearsal.json',import.meta.url),'utf8'));
const original=JSON.parse(await readFile(new URL('./deployment.json',import.meta.url),'utf8'));
for(const file of ['test-results.json','wasm-results.json']){const result=JSON.parse(await readFile(new URL(file,import.meta.url),'utf8'));assert.equal(result.exitCode,0);assert.equal(result.sourceSha256,sha(source));}
assert(rehearsal.ok&&rehearsal.newSha256===sha(wasm)&&rehearsal.oldSha256===original.wasmSha256);
async function codeHash(){const r=await provider.sendJsonRpc('query',{request_type:'view_code',finality:'final',account_id:config.contract});return sha(Buffer.from(r.code_base64,'base64'));}
async function snapshot(){const r=await provider.sendJsonRpc('query',{request_type:'view_state',finality:'final',account_id:config.contract,prefix_base64:'',include_proof:false});return r.values.sort((a,b)=>a.key.localeCompare(b.key));}
const planPath=new URL('./upgrade/plan.json',import.meta.url),resultPath=new URL('./upgrade/applied.json',import.meta.url);
if(!process.argv.includes('--apply')){
  const oldSha256=await codeHash();assert.equal(oldSha256,original.wasmSha256,'Reserve code differs from the rehearsed baseline');
  const plan={target:config.contract,network:'testnet',oldSha256,newSha256:sha(wasm),sourceSha256:sha(source),wasmBytes:wasm.length,
    action:'Deploy code only; do not run new or change storage layout',rehearsal:'rehearsal.json',plannedAt:new Date().toISOString()};
  await writeFile(planPath,JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify(plan,null,2));
}else{
  const plan=JSON.parse(await readFile(planPath,'utf8'));assert.equal(plan.target,config.contract);assert.equal(plan.newSha256,sha(wasm));assert.equal(plan.sourceSha256,sha(source));
  let result;try{result=JSON.parse(await readFile(resultPath,'utf8'));assert.equal(result.newSha256,plan.newSha256);}catch(e){if(e.code!=='ENOENT')throw e;}
  const current=await codeHash();
  if(current!==plan.newSha256){
    assert.equal(current,plan.oldSha256,'Unexpected current reserve code');
    const before=await snapshot();await writeFile(new URL('./upgrade/before-state.json',import.meta.url),JSON.stringify(before,null,2)+'\n');
    const key=JSON.parse(await readFile(new URL('./.testnet/contract.json',import.meta.url),'utf8'));assert.equal(key.accountId,config.contract);
    const account=new Account(key.accountId,provider,key.privateKey);
    const receipt=finalReceipt(await account.signAndSendTransaction({receiverId:config.contract,actions:[actions.deployContract(wasm)],waitUntil:'FINAL'}));
    result={...plan,receipt,appliedAt:new Date().toISOString()};await writeFile(resultPath,JSON.stringify(result,null,2)+'\n');
  }else assert(result,'Upgraded code found without a receipt; reconcile before changing configuration');
  assert.equal(await codeHash(),plan.newSha256);assert.deepEqual(await view(config.contract,'capabilities',{}),['deposit_offline_v1']);
  const before=JSON.parse(await readFile(new URL('./upgrade/before-state.json',import.meta.url),'utf8')),after=await snapshot();
  if(!result.stateVerified){assert.deepEqual(after,before,'State changed during code deployment; inspect before enabling deposits');result.stateVerified={entries:after.length,sha256:sha(JSON.stringify(after))};}
  result.ok=true;await writeFile(resultPath,JSON.stringify(result,null,2)+'\n');
  await writeFile(configPath,JSON.stringify({...config,wasmSha256:plan.newSha256,depositOffline:true,upgradeTx:result.receipt.txHash},null,2)+'\n');
  const rheaPath=new URL('../web/public/rhea-config.json',import.meta.url),rhea=JSON.parse(await readFile(rheaPath,'utf8'));
  assert.equal(rhea.reserve,config.contract);const sponsor=await relayAccount();
  await writeFile(rheaPath,JSON.stringify({...rhea,refundPayer:sponsor.accountId},null,2)+'\n');
  console.log(JSON.stringify({target:config.contract,ok:true,oldStateEntriesPreserved:result.stateVerified.entries,txHash:result.receipt.txHash}));
}
