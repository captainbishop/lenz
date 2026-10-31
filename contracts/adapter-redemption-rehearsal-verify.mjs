// Offline verification of the recorded isolated testnet rehearsal; never signs or sends.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const base=new URL('./adapter/redemption-recovery/',import.meta.url);
const bytes=await readFile(new URL('rehearsal.json',base));const r=JSON.parse(bytes);
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(r.ok,true);assert.equal(r.network,'testnet');assert.deepEqual(r.pending,{});
for(const role of ['reserve','adapter'])assert(new RegExp(`^lenz-redrec-${role}-[0-9]+\\.testnet$`).test(r[role]));
assert.equal(r.recipient,'r.'+r.adapter);
const artifacts={old:'deployed-v1.wasm',candidate:'candidate.wasm',fault:'fault-fixture.wasm'};
for(const [key,file] of Object.entries(artifacts))assert.equal(sha(await readFile(new URL(file,base))),r.artifactHashes[key]);
assert.equal(sha(await readFile(new URL('../web/public/rhea-config.json',import.meta.url))),r.productConfigSha256);
const allowed=new Set([r.reserve,r.adapter,r.recipient]),hashes=new Set(),transfers=[];
const expectedFailures={
  'lost redeem':[1,/LENZ_REHEARSAL_INJECTED_REDEMPTION_CALLBACK_FAILURE/],
  'overlapping recoveries':[1,/Unexpected callback stage/],
  'original callback race':[2,/Unexpected callback stage/],
  'forged callback':[1,/private|Private/],
  'late original callback replay':[1,/Unexpected callback stage/],
};
for(const [name,tx] of Object.entries(r.transactions)){
  assert.equal(tx.final_execution_status,'FINAL');assert(allowed.has(tx.transaction.receiver_id));assert(allowed.has(tx.transaction.signer_id));
  assert(!hashes.has(tx.transaction.hash),'Repeated transaction under multiple names');hashes.add(tx.transaction.hash);
  const failed=tx.receipts_outcome.filter(x=>Object.hasOwn(x.outcome.status,'Failure'));
  if(expectedFailures[name]){const [count,pattern]=expectedFailures[name];assert.equal(failed.length,count,name);for(const f of failed)assert.match(JSON.stringify(f.outcome.status),pattern);}
  else {assert.equal(failed.length,0,name);assert(Object.hasOwn(tx.status,'SuccessValue'),name);}
  for(const receipt of tx.receipts_outcome){assert(allowed.has(receipt.outcome.executor_id),receipt.outcome.executor_id);
    for(const log of receipt.outcome.logs){if(!log.startsWith('EVENT_JSON:'))continue;
      const e=JSON.parse(log.slice('EVENT_JSON:'.length));if(e.standard==='nep141'&&e.event==='ft_transfer')for(const data of e.data){assert.equal(receipt.outcome.executor_id,r.reserve);transfers.push({transaction:name,...data});}
    }
  }
}
for(const name of Object.keys(expectedFailures))assert(r.transactions[name],name);
const checks=[];const checked=(name,fn)=>{fn();checks.push(name);};
checked('all seven old state entries survive the exact candidate upgrade',()=>{
  const before=r.steps['snapshot before candidate upgrade'];assert.equal(before.length,7);
  const after=r.steps['candidate preserves every prior state entry'];assert.equal(after.entries,before.length);assert.equal(after.sha256,sha(JSON.stringify(before)));
});
checked('failed original callback follows an actual one-tUSD reserve transfer',()=>{
  const t=transfers.filter(x=>x.transaction==='lost redeem');assert.equal(t.length,1);assert.equal(t[0].old_owner_id,r.reserve);assert.equal(t[0].new_owner_id,r.adapter);assert.equal(t[0].amount,'1000000');
});
checked('recovery and callback replay transfer no tokens',()=>{
  for(const name of ['overlapping recoveries','late original callback replay','forged callback',...['normal','lost','race'].map(x=>'terminal retries '+x)])assert(!transfers.some(x=>x.transaction===name),name);
});
checked('only three exact redemptions and three exact signed-recipient refunds occur',()=>{
  assert.equal(transfers.length,6);
  for(const label of ['normal','lost','race']){
    const txName=label==='normal'?'normal redeem':label==='lost'?'lost redeem':'original callback race';
    const redemption=transfers.filter(t=>t.transaction===txName),payout=transfers.filter(t=>t.transaction===label+' payout');
    assert.equal(redemption.length,1);assert.equal(payout.length,1);
    assert.equal(redemption[0].old_owner_id,r.reserve);assert.equal(redemption[0].new_owner_id,r.adapter);assert.equal(redemption[0].amount,'1000000');
    assert.equal(payout[0].old_owner_id,r.adapter);assert.equal(payout[0].new_owner_id,r.fixtures[label].packet.instruction.receiver_id);assert.equal(payout[0].amount,'1000000');
  }
});
checked('final supply, reserve, adapter and recipient balances conserve all three tUSD',()=>{
  assert.deepEqual(r.steps['duplicate commands preserve all final balances and state'],{supply:'3000000',reserved:'0',reserve:'0',adapter:'0',recipient:'3000000'});
});
const report={checkedAt:new Date().toISOString(),ok:true,network:r.network,reserve:r.reserve,adapter:r.adapter,recipient:r.recipient,
  rehearsalSha256:sha(bytes),stepCount:Object.keys(r.steps).length,transactionCount:hashes.size,checks,transfers,
  expectedFailedReceipts:Object.values(expectedFailures).reduce((n,x)=>n+x[0],0),stateEntries:7,
  scope:'Offline checks of saved FINAL RPC receipts and snapshots. No independent consensus/inclusion proof; no product rollout or exchange swap.'};
await writeFile(new URL('rehearsal-verification.json',base),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,steps:report.stepCount,transactions:report.transactionCount,checks:checks.length,transfers:transfers.length,stateEntries:7,expectedFailedReceipts:report.expectedFailedReceipts},null,2));
