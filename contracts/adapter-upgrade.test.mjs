import test from 'node:test';
import assert from 'node:assert/strict';
import {Account,KeyPair,createTransaction} from 'near-api-js';
import {readFile} from 'node:fs/promises';
import {applyAdapterUpgrade,verifyUpgradeReceipt,sha} from './adapter-upgrade.mjs';
const wasm=Buffer.from('reviewed test artifact'),target='lenz-rhea-123.testnet';
function fixture(){
  const before={codeSha256:'0'.repeat(64),values:[{key:'STATE',value:'unchanged'}]};
  const plan={network:'testnet',target,oldSha256:before.codeSha256,newSha256:sha(wasm),before};
  const pair=KeyPair.fromRandom('ed25519');let journal,tx,current=structuredClone(before);const log=[];
  const f={plan,log,lost:false,badState:false,failSave:false};
  const account=new Account(target,{sendTransactionUntil:async signed=>{
    log.push('broadcast');assert.equal(signed.transaction.actions.length,1);assert.deepEqual(Buffer.from(signed.transaction.actions[0].deployContract.code),wasm);
    const hash=journal.pending.txHash;
    tx={final_execution_status:'FINAL',transaction:{hash,signer_id:target,receiver_id:target,actions:[{DeployContract:{code:Buffer.from(plan.newSha256,'hex').toString('base64')}}]},
      transaction_outcome:{id:hash,outcome:{executor_id:target,status:{SuccessReceiptId:'deploy'},receipt_ids:['deploy']}},
      receipts_outcome:[{id:'deploy',outcome:{executor_id:target,status:{SuccessValue:''},receipt_ids:[]}}],status:{SuccessValue:''}};
    current={...before,codeSha256:plan.newSha256,values:f.badState?[]:before.values};
    if(f.lost)throw Error('Lost response');return tx;
  }},pair.toString());
  account.createTransaction=async({receiverId,actions})=>createTransaction(target,pair.getPublicKey(),receiverId,1n,actions,new Uint8Array(32));
  f.io={snapshot:async()=>structuredClone(current),readJournal:async()=>structuredClone(journal),saveJournal:async j=>{if(j.pending&&f.failSave)throw Error('Journal disk full');journal=structuredClone(j);log.push(j.pending?'saved hash':'saved state');},openAccount:async()=>{log.push('signer');return account;},transactionStatus:async ref=>{log.push('reconcile');assert.equal(ref.txHash,journal.pending.txHash);return structuredClone(tx);},enable:async()=>log.push('enabled')};
  f.journal=()=>journal;return f;
}
test('upgrade deploys only reviewed code, journals before broadcast and preserves state',async()=>{
  const f=fixture(),result=await applyAdapterUpgrade(f.plan,wasm,f.io);assert(result.ok);assert.equal(result.stateVerified.entries,1);
  assert(f.log.indexOf('saved hash')<f.log.indexOf('broadcast'));assert(f.log.indexOf('saved state')<f.log.indexOf('signer'));
  await applyAdapterUpgrade(f.plan,wasm,f.io);assert.equal(f.log.filter(x=>x==='broadcast').length,1);assert.equal(f.log.filter(x=>x==='signer').length,1);
});
test('lost upgrade reply resumes its recorded transaction without signing again',async()=>{
  const f=fixture();f.lost=true;await assert.rejects(applyAdapterUpgrade(f.plan,wasm,f.io),/Lost response/);assert(f.journal().pending);assert(!f.log.includes('enabled'));
  const r=await applyAdapterUpgrade(f.plan,wasm,f.io);assert(r.ok);assert.equal(f.log.filter(x=>x==='broadcast').length,1);assert(f.log.includes('reconcile'));
});
test('unknown or nonfinal transaction never redeploys or enables config',async()=>{
  const f=fixture();f.lost=true;await assert.rejects(applyAdapterUpgrade(f.plan,wasm,f.io));
  const finalStatus=f.io.transactionStatus;
  f.io.transactionStatus=async()=>{throw Error('UNKNOWN_TRANSACTION');};await assert.rejects(applyAdapterUpgrade(f.plan,wasm,f.io),/UNKNOWN_TRANSACTION/);
  f.io.transactionStatus=async()=>({final_execution_status:'NONE'});await assert.rejects(applyAdapterUpgrade(f.plan,wasm,f.io),/not final/);
  assert.equal(f.log.filter(x=>x==='broadcast').length,1);assert(!f.log.includes('enabled'));
  f.io.transactionStatus=finalStatus;assert((await applyAdapterUpgrade(f.plan,wasm,f.io)).ok);assert.equal(f.log.filter(x=>x==='broadcast').length,1);
});
test('journal failure prevents broadcast; altered post-deploy state prevents enabling',async()=>{
  const f=fixture();f.failSave=true;await assert.rejects(applyAdapterUpgrade(f.plan,wasm,f.io),/disk full/);assert(!f.log.includes('broadcast'));
  const g=fixture();g.badState=true;await assert.rejects(applyAdapterUpgrade(g.plan,wasm,g.io),/State changed during upgrade/);assert(!g.log.includes('enabled'));
});
test('changed artifact, planned state, network or unexplained new code fails before signing',async()=>{
  for(const kind of ['artifact','state','network','new code']){
    const f=fixture();let artifact=wasm;
    if(kind==='artifact')artifact=Buffer.from('other');if(kind==='state')f.plan.before.values=[];if(kind==='network')f.plan.network='mainnet';
    if(kind==='new code')f.io.snapshot=async()=>({...f.plan.before,codeSha256:f.plan.newSha256});
    await assert.rejects(applyAdapterUpgrade(f.plan,artifact,f.io));assert(!f.log.includes('signer'));assert(!f.log.includes('enabled'));
  }
});
test('final receipt rejects extra initializer, foreign target, failures and missing return graph',async()=>{
  const f=fixture();await applyAdapterUpgrade(f.plan,wasm,f.io);const {pending,transaction}=f.journal();
  for(const mutate of [t=>t.transaction.actions.push({FunctionCall:{method_name:'new'}}),t=>t.transaction.receiver_id='evil.testnet',t=>t.transaction.actions[0].DeployContract.code='wrong',t=>t.status={Failure:{}},t=>t.receipts_outcome=[],t=>t.receipts_outcome[0].outcome.status={Failure:{}},t=>t.receipts_outcome[0].outcome.receipt_ids=['deploy']]){
    const tx=structuredClone(transaction);mutate(tx);assert.throws(()=>verifyUpgradeReceipt(f.plan,pending,tx));
  }
});
test('saved isolated live upgrade receipt matches the exact deploy-only validation',async()=>{
  const ev=JSON.parse(await readFile(new URL('./adapter/redemption-recovery/rehearsal.json',import.meta.url),'utf8'));
  const tx=ev.transactions['candidate deployment'];verifyUpgradeReceipt({target:ev.adapter,newSha256:ev.artifactHashes.candidate},{txHash:tx.transaction.hash},tx);
});
