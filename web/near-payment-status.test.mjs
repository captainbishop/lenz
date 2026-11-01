import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, digest } from './public/peer-crypto.js';
import { emptyNearVault, fundingRequest, makeNearPayment, nearLedger, paymentPath, transferTerms } from './public/near-protocol.js';
import { applyNearCheck, applyNearSettlement } from './public/near-payment-status.js';

const contract = 'status-fixture.lenz.testnet';
async function fixture() {
  const [a,b,c] = await Promise.all(['Amina','Bola','Chidi'].map(createIdentity));
  const r = await fundingRequest(a,contract,'10'), initial = emptyNearVault(contract);
  initial.roots.push({id:r.id,owner:r.owner,amount:r.amount});
  const first = await makeNearPayment(initial,a,b.profile,'6');
  const {vault} = await makeNearPayment(first.vault,b,c.profile,'2');
  const ledger = await nearLedger(vault), ids = [...ledger.notes.keys()];
  const receipts = await Promise.all(vault.spends.map(async s => {
    const id = await digest(transferTerms(contract,s));
    return {id,input:s.input,outputs:[...ledger.notes.values()].filter(n=>n.id.startsWith(id+':')),block_height:100};
  }));
  const reply = {finality:'FINAL',results:ids.map(id=>({id,note:ledger.notes.get(id),spent:ledger.consumed.get(id)??null,receipt:receipts.find(r=>id.startsWith(r.id+':'))??null}))};
  return {vault,ids,reply,receipts,note:receipts[1].id+':0'};
}

test('final checks bind all notes, recipients, amounts, change and consumed inputs; ordering is irrelevant',async()=>{
  const {vault,ids,reply,receipts}=await fixture(),before=structuredClone(vault);
  const next=await applyNearCheck(vault,ids,{...reply,results:reply.results.toReversed()});
  assert.deepEqual(vault,before);
  assert.equal(Object.keys(next.receipts).length,3);
  for(const r of receipts) assert.equal(next.chainConsumed[r.input],r.id);
});

test('malformed checks fail atomically without releasing even an expired swap reservation',async()=>{
  const {vault,ids,reply,note}=await fixture();
  vault.rheaOrders=[{packet:{instruction:{input:note,deadline:1}}}];
  const mutations=[
    r=>{r.finality='optimistic';}, r=>r.results.pop(),
    r=>{r.results[1]=structuredClone(r.results[0]);}, r=>{r.results[1].id='foreign';},
    r=>{r.results[1].note.owner='wrong';},r=>{r.results[1].note.amount='1';},
    r=>{r.results[1].receipt.outputs[0].owner='wrong';},r=>{r.results[1].receipt.outputs[0].amount='1';},
    r=>{r.results[1].receipt.outputs[1].amount='1';},r=>{r.results[1].receipt.outputs.pop();},
    r=>{r.results[1].receipt.input='wrong';},r=>{r.results[1].receipt.id='0'.repeat(64);},
    r=>{r.results[1].receipt.block_height=0;},r=>{r.results[1].receipt=null;},
    r=>{r.results[0].spent=null;},r=>{r.results[0].note=null;},r=>{r.results[0].spent='invalid';}
  ];
  for(const mutate of mutations){const bad=structuredClone(reply),before=structuredClone(vault);mutate(bad);await assert.rejects(applyNearCheck(vault,ids,bad));assert.deepEqual(vault,before);}
  const next=await applyNearCheck(vault,ids,reply);
  assert.deepEqual(next.rheaOrders,vault.rheaOrders);assert((await nearLedger(next)).reserved.has(note));
});

test('final spends and receipts cannot be rolled back by later responses',async()=>{
  const {vault,ids,reply}=await fixture(),next=await applyNearCheck(vault,ids,reply);
  for(const value of [null,'a'.repeat(64)]){const bad=structuredClone(reply);bad.results[0].spent=value;await assert.rejects(applyNearCheck(next,ids,bad));}
  const missing=structuredClone(reply);missing.results[1]={...missing.results[1],note:null,receipt:null,spent:null};
  await assert.rejects(applyNearCheck(next,ids,missing));
});

test('conflicting ancestor excludes onward money; pending responses never invent a final receipt',async()=>{
  const {vault,ids,reply,note}=await fixture();
  vault.confirmations={[note]:{startedAt:1,attempts:1}};
  for(const row of reply.results)if(!row.id.startsWith('root:'))Object.assign(row,{note:null,spent:null,receipt:null});
  reply.results[0].spent=null;
  const pending=await applyNearCheck(vault,ids,reply);assert(!(await nearLedger(pending)).blocked.has(note));assert.equal(Object.keys(pending.receipts).length,1);
  assert.deepEqual(pending.confirmations,vault.confirmations);
  reply.results[0].spent='a'.repeat(64);
  const next=await applyNearCheck(pending,ids,reply);assert((await nearLedger(next)).blocked.has(note));assert.equal((await nearLedger(next)).available.length,0);
  assert.equal(next.confirmations[note],undefined);
});

test('settlement validates every path receipt and rejects tampering without mutating the vault',async()=>{
  const {vault,note,receipts}=await fixture(),{path}=await paymentPath(vault,note);
  vault.confirmations={[note]:{startedAt:1,attempts:1}};
  const result={finality:'FINAL',receipts};
  const next=await applyNearSettlement(vault,path,result);assert.equal(Object.keys(next.receipts).length,2);
  assert.equal(next.confirmations[note],undefined);assert.equal(vault.confirmations[note].attempts,1);
  for(const mutate of [r=>{r.finality='optimistic';},r=>r.receipts.pop(),r=>r.receipts.reverse(),r=>{r.receipts[1].outputs[0].owner='wrong';},r=>{r.receipts[1].input='wrong';}]){
    const bad=structuredClone(result),before=structuredClone(vault);mutate(bad);await assert.rejects(applyNearSettlement(vault,path,bad));assert.deepEqual(vault,before);
  }
});

test('receipt input contradictions are rejected even when they cross check batches',async()=>{
  const {vault,ids,reply}=await fixture();
  const input=structuredClone(reply.results[0]);input.spent='a'.repeat(64);
  const next=await applyNearCheck(vault,[input.id],{finality:'FINAL',results:[input]});
  const rest=reply.results.slice(1);
  await assert.rejects(applyNearCheck(next,ids.slice(1),{finality:'FINAL',results:rest}));
});
