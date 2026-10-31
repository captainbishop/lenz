// Durable, code-only upgrade orchestration. All network/storage operations are injected.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {actions,baseEncode} from 'near-api-js';
export const sha=value=>createHash('sha256').update(value).digest('hex');
export function verifyUpgradeReceipt(plan,ref,tx){
  assert.equal(tx.final_execution_status,'FINAL','Upgrade is not final');
  const t=tx.transaction;
  assert(t?.hash===ref.txHash&&t.signer_id===plan.target&&t.receiver_id===plan.target,'Different upgrade transaction');
  assert.deepEqual(t.actions,[{DeployContract:{code:Buffer.from(plan.newSha256,'hex').toString('base64')}}],'Expected exactly the reviewed deploy action');
  assert.deepEqual(tx.status,{SuccessValue:''},'Upgrade failed');
  assert.equal(tx.transaction_outcome?.id,ref.txHash);
  const outcomes=tx.receipts_outcome;assert(Array.isArray(outcomes)&&outcomes.length>0,'Missing upgrade receipts');
  const byId=new Map(outcomes.map(r=>[r.id,r]));assert.equal(byId.size,outcomes.length);
  const visited=new Set(),active=new Set();
  function walk(r){
    const s=r.outcome?.status;assert(s&&Object.keys(s).length===1&&('SuccessValue' in s||'SuccessReceiptId' in s),'Unsuccessful upgrade receipt');
    assert.equal(r.outcome.executor_id,plan.target,'Foreign upgrade executor');
    assert(Array.isArray(r.outcome.receipt_ids));
    for(const id of r.outcome.receipt_ids){assert(byId.has(id)&&!active.has(id),'Broken upgrade receipt graph');if(!visited.has(id)){visited.add(id);active.add(id);walk(byId.get(id));active.delete(id);}}
  }
  walk(tx.transaction_outcome);assert.equal(visited.size,outcomes.length,'Unrelated upgrade receipt');
  let returned=tx.transaction_outcome;const path=new Set();
  while('SuccessReceiptId' in returned.outcome.status){const id=returned.outcome.status.SuccessReceiptId;assert(byId.has(id)&&!path.has(id),'Broken upgrade return path');path.add(id);returned=byId.get(id);}
  assert.deepEqual(returned.outcome.status,tx.status);
}
export async function applyAdapterUpgrade(plan,wasm,io){
  assert(plan.network==='testnet'&&/^lenz-rhea-[0-9]+\.testnet$/.test(plan.target),'Configured test adapter only');
  assert.equal(sha(wasm),plan.newSha256,'Candidate differs from plan');
  const planHash=sha(JSON.stringify(plan));let journal=await io.readJournal();
  if(journal)assert.equal(journal.planHash,planHash,'Upgrade plan changed');
  const current=await io.snapshot();
  assert([plan.oldSha256,plan.newSha256].includes(current.codeSha256),'Unexpected adapter code');
  if(!journal?.pending&&!journal?.transaction){
    assert.equal(current.codeSha256,plan.oldSha256,'New code found without a saved transaction');
    assert.deepEqual(current.values,plan.before.values,'Adapter state changed since review');
    journal={planHash,before:current,startedAt:new Date().toISOString()};await io.saveJournal(journal);
    const account=await io.openAccount();assert.equal(account.accountId,plan.target);
    const original=account.signer;
    const signer={getPublicKey:()=>original.getPublicKey(),signTransaction:async transaction=>{
      const signed=await original.signTransaction(transaction);
      journal.pending={txHash:baseEncode(signed.txHash),sender:account.accountId};
      await io.saveJournal(journal);return signed;
    }};
    journal.transaction=await account.signAndSendTransaction({receiverId:plan.target,actions:[actions.deployContract(wasm)],waitUntil:'FINAL',throwOnFailure:false,signer});
    await io.saveJournal(journal);
  }else if(journal.transaction?.final_execution_status!=='FINAL'){
    // Unknown/nonfinal status is an error. Never sign again after saving a hash.
    journal.transaction=await io.transactionStatus(journal.pending);await io.saveJournal(journal);
  }
  verifyUpgradeReceipt(plan,journal.pending,journal.transaction);
  if(!journal.stateVerified){
    const after=await io.snapshot();assert.equal(after.codeSha256,plan.newSha256,'Deployed code does not match candidate');
    assert.deepEqual(after.values,journal.before.values,'State changed during upgrade; do not enable recovery');
    journal.after=after;journal.stateVerified={entries:after.values.length,sha256:sha(JSON.stringify(after.values))};await io.saveJournal(journal);
  }else{
    assert.equal(current.codeSha256,plan.newSha256,'Verified upgrade code changed');
    assert.deepEqual(journal.after.values,journal.before.values,'Saved state verification differs');
  }
  await io.enable(journal.pending.txHash);
  journal.ok=true;await io.saveJournal(journal);return journal;
}
