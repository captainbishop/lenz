// Existing terminal order only: verifies the HTTP recovery route without signing.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base='http://127.0.0.1:4173';
const plan=JSON.parse(await readFile(new URL('../contracts/adapter/redemption-recovery/rollout-plan.json',import.meta.url),'utf8'));
const config=await(await fetch(base+'/rhea-config.json',{signal:AbortSignal.timeout(10000)})).json();
assert(config.recoverRedemption&&config.codeHash===plan.newCodeHash);
const expected=plan.before.orders.find(o=>['complete','refunded'].includes(o.stage));assert(expected);
const post=async route=>{const r=await fetch(base+'/api/rhea/'+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({adapter:config.adapter,id:expected.id}),signal:AbortSignal.timeout(45000)});const body=await r.json();assert(r.ok,JSON.stringify(body));return body;};
const status=await post('order');assert.equal(status.finality,'FINAL');assert.equal(status.order?.id,expected.id);assert.equal(status.order.stage,expected.stage);
const recovery=await post('recover');assert.equal(recovery.finality,'FINAL');assert.deepEqual(recovery.order,status.order);assert.equal(recovery.txHash,undefined,'Unexpected new transaction');
const report={checkedAt:new Date().toISOString(),ok:true,checks:['server serves verified recovery capability','Check status reads existing final order','recovery on terminal order returns unchanged state without a new transaction'],order:{id:expected.id,stage:expected.stage},status,recovery,
  scope:'Actual local HTTP route and configured testnet RPC; one existing terminal order. No missing-callback injection, recovery transaction, funding or user browser access.'};
await writeFile(new URL('./rhea-recovery-live-results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({ok:true,checks:report.checks,order:report.order},null,2));
