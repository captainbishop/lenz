import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {sha,verifyUpgradeReceipt} from './adapter-upgrade.mjs';
import {adapterConfig,verifyAdapter} from './adapter-client.mjs';
import {provider,view} from './client.mjs';
const base=new URL('./adapter/redemption-recovery/',import.meta.url),json=async name=>JSON.parse(await readFile(new URL(name,base),'utf8'));
const [plan,result,config]=await Promise.all([json('rollout-plan.json'),json('rollout.json'),adapterConfig()]);
assert(result.ok&&result.stateVerified);assert.equal(result.planHash,sha(JSON.stringify(plan)));
verifyUpgradeReceipt(plan,result.pending,result.transaction);
assert.deepEqual(plan.before.values,result.before.values);assert.deepEqual(result.before.values,result.after.values);
assert.equal(result.stateVerified.entries,result.after.values.length);assert.equal(result.stateVerified.sha256,sha(JSON.stringify(result.after.values)));
assert.equal(result.after.codeSha256,plan.newSha256);assert.equal(sha(await readFile(new URL('candidate.wasm',base))),plan.newSha256);
assert.equal(config.wasmSha256,plan.newSha256);assert.equal(config.codeHash,plan.newCodeHash);assert.equal(config.upgradeTx,result.pending.txHash);assert.equal(config.recoverRedemption,true);
const report={checkedAt:new Date().toISOString(),ok:true,target:plan.target,txHash:result.pending.txHash,stateEntries:result.after.values.length,
  checks:['one final exact deploy action with successful receipt graph','all reviewed storage entries unchanged','public capability bound to verified candidate and deployment'],
  scope:'Saved final RPC receipts and snapshots; no independent consensus proof.'};
if(process.argv.includes('--live')){
  const nativeFetch=globalThis.fetch;globalThis.fetch=(u,i={})=>nativeFetch(u,{...i,signal:AbortSignal.any([AbortSignal.timeout(15000),...(i.signal?[i.signal]:[])])});
  await verifyAdapter(config);
  const code=await provider.sendJsonRpc('query',{request_type:'view_code',finality:'final',account_id:plan.target});assert.equal(sha(Buffer.from(code.code_base64,'base64')),plan.newSha256);
  const state=await provider.sendJsonRpc('query',{request_type:'view_state',block_id:code.block_hash,account_id:plan.target,prefix_base64:'',include_proof:false});assert.deepEqual(state.values.sort((a,b)=>a.key.localeCompare(b.key)),result.after.values);
  for(const order of plan.before.orders)assert.equal((await view(plan.target,'get_order',{id:order.id})).stage,order.stage);
  report.live={blockHash:code.block_hash,blockHeight:code.block_height,orders:plan.before.orders};
  report.checks.push('live code/configuration and reserve route remain pinned','all existing orders and storage unchanged on follow-up read');
  report.scope+=' Follow-up reads use the configured testnet RPC. No new recovery, token transfer, funding or injected fault.';
}
await writeFile(new URL(process.argv.includes('--live')?'rollout-verification.json':'rollout-offline-verification.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
