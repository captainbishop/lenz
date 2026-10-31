import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Account, KeyPair, createTransaction, baseEncode, encodeTransaction } from 'near-api-js';
import { createHash } from 'node:crypto';
import { adapterCall } from './adapter-client.mjs';
import { recordAdapterTransaction, latestAdapterTransaction, inspectAdapterTransaction, reconcileAdapterOrder } from './adapter-recovery.mjs';
const fixture=JSON.parse(await readFile(new URL('./adapter/fixtures/browser-swap.json',import.meta.url),'utf8'));
const {packet}=fixture,c=packet.config,id=packet.id;
const ref={version:1,network:'testnet',adapter:c.adapter,id,sender:'relay.testnet',txHash:'1'.repeat(32),method:'advance'};
const order={id,instruction:packet.instruction,stage:'refunded',output:'0',reason:''};
const encoded=x=>Buffer.from(JSON.stringify(x)).toString('base64');
function transaction(){return {final_execution_status:'FINAL',transaction:{hash:ref.txHash,signer_id:ref.sender,receiver_id:c.adapter,actions:[{FunctionCall:{method_name:'advance',args:encoded({id}),deposit:'0',gas:250000000000000}}]},transaction_outcome:{id:ref.txHash,outcome:{receipt_ids:['callback'],status:{SuccessReceiptId:'callback'}}},receipts_outcome:[{id:'callback',outcome:{executor_id:c.adapter,receipt_ids:[],status:{SuccessValue:encoded(order)}}}],status:{SuccessValue:encoded(order)}};}
test('final receipt recovery binds transaction and terms, retaining the current order',()=>{
  assert.equal(inspectAdapterTransaction(c,id,ref,transaction(),order).state,'confirmed');
  const earlier=transaction();earlier.status.SuccessValue=encoded({...order,stage:'refund_available'});
  earlier.receipts_outcome[0].outcome.status={...earlier.status};
  assert.equal(inspectAdapterTransaction(c,id,ref,earlier,order).state,'confirmed');
});
test('contradictory summaries, cyclic receipt links and invalid return paths are not confirmed',()=>{
  const changes=[
    t=>t.receipts_outcome[0].outcome.status={Failure:{error:'callback failed'}},
    t=>t.status={Failure:{error:'invented failure'}},
    t=>t.receipts_outcome[0].outcome.receipt_ids=['callback'],
    t=>t.receipts_outcome[0].outcome.status={SuccessReceiptId:'callback'},
    t=>t.transaction_outcome.outcome.status={SuccessReceiptId:'absent'},
    t=>t.receipts_outcome[0].outcome.status.Failure={error:'contradictory'},
    t=>t.receipts_outcome[0].outcome.status.SuccessValue=42,
    t=>t.receipts_outcome[0].outcome.executor_id='foreign.testnet',
  ];
  for(const change of changes){const tx=transaction();change(tx);assert.throws(()=>inspectAdapterTransaction(c,id,ref,tx,order));}
});
test('recorded live receipt graphs retain success, caught failure and refund history',async()=>{
  const evidence=JSON.parse(await readFile(new URL('./adapter/recovery-live-results.json',import.meta.url),'utf8'));
  assert.equal(evidence.checks.length,8);
  for(const check of evidence.checks){
    const liveConfig={...c,adapter:evidence.adapter};
    assert.deepEqual(inspectAdapterTransaction(liveConfig,check.reference.id,check.reference,check.transaction,check.result.order),check.result.reconciliation);
  }
});
test('foreign transactions, altered terms, nonfinal results and broken receipt graphs fail closed',()=>{
  const changes=[t=>t.final_execution_status='EXECUTED',t=>t.transaction.hash='2'.repeat(32),t=>t.transaction.signer_id='evil.testnet',t=>t.transaction.receiver_id='evil.testnet',t=>t.transaction.actions.push(t.transaction.actions[0]),t=>t.transaction.actions[0].FunctionCall.args=encoded({id:'b'.repeat(64)}),t=>t.transaction.actions[0].FunctionCall.deposit='1',t=>t.transaction.actions[0].FunctionCall.gas=1,t=>t.transaction.actions[0].FunctionCall.method_name='submit',t=>t.status.SuccessValue=encoded({...order,instruction:{...order.instruction,amount:'1'}}),t=>t.receipts_outcome=[],t=>t.receipts_outcome[0].id='unrelated',t=>t.receipts_outcome.push({...t.receipts_outcome[0]}),t=>t.receipts_outcome[0].outcome.status='Unknown',t=>t.status='Unknown'];
  for(const change of changes){const tx=transaction();change(tx);assert.throws(()=>inspectAdapterTransaction(c,id,ref,tx,order));}
});
test('submit receipts require exact signed instruction, gas and attached deposit',()=>{
  const tx=transaction(),r={...ref,method:'submit'};tx.transaction.actions[0].FunctionCall={method_name:'submit',args:encoded({instruction:order.instruction}),deposit:'100000000000000000000000',gas:250000000000000};
  assert.equal(inspectAdapterTransaction(c,id,r,tx,order).state,'confirmed');
  tx.transaction.actions[0].FunctionCall.args=encoded({instruction:{...order.instruction,receiver_id:'evil.testnet'}});assert.throws(()=>inspectAdapterTransaction(c,id,r,tx,order));
});
test('recovery receipts bind the one zero-deposit id-only action and retain pending stages',async()=>{
  const tx=transaction(),r={...ref,method:'recover_redemption'};tx.transaction.actions[0].FunctionCall.method_name=r.method;
  assert.equal(inspectAdapterTransaction(c,id,r,tx,order).state,'confirmed');
  assert.equal(inspectAdapterTransaction(c,id,r,tx,{...order,stage:'redeeming'}).state,'needs_review');
  for(const args of [{id:'f'.repeat(64)},{id,amount:'1'},{id,method:'advance'}]){
    const changed=structuredClone(tx);changed.transaction.actions[0].FunctionCall.args=encoded(args);assert.throws(()=>inspectAdapterTransaction(c,id,r,changed,order));
  }
  const root=await mkdtemp(join(tmpdir(),'lenz-recovery-journal-'));
  try{await recordAdapterTransaction(r,root);assert.equal((await latestAdapterTransaction(c,id,root)).method,r.method);}finally{await rm(root,{recursive:true,force:true});}
});
test('recovery client refuses disabled capability or extra arguments before signing',async()=>{
  const account={get signer(){assert.fail('Must not open signer');}};
  await assert.rejects(adapterCall(account,c,'recover_redemption',{id}),/not enabled/);
  await assert.rejects(adapterCall(account,{...c,recoverRedemption:true},'recover_redemption',{id,amount:'1'}),/only a swap id/);
});
test('failed callbacks and attention states never produce a refund or a retry authorization',()=>{
  const tx=transaction();tx.status={Failure:{error:'callback gas'}};tx.receipts_outcome[0].outcome.status=tx.status;
  for(const stage of ['paying_refund','depositing','attention']){const result=inspectAdapterTransaction(c,id,ref,tx,{...order,stage});assert.equal(result.state,'needs_review');assert.equal(result.failedReceipts[0].executor,c.adapter);assert.equal(result.order,undefined);}
  assert.equal(inspectAdapterTransaction(c,id,ref,tx,order).state,'transaction_failed');
});
test('missing RPC evidence preserves final status; invalid final order is rejected',async()=>{
  const calls=[],clients={latestAdapterTransaction:async()=>ref,provider:{viewTransactionStatus:async args=>{calls.push(args);throw Error('UNKNOWN_TRANSACTION');}},view:async()=>order};
  const result=await reconcileAdapterOrder(c,id,clients);assert.equal(result.reconciliation.state,'unavailable');assert.deepEqual(result.order,order);assert.equal(calls[0].waitUntil,'FINAL');
  clients.provider.viewTransactionStatus=async()=>transaction();assert.equal((await reconcileAdapterOrder(c,id,clients)).reconciliation.state,'confirmed');
  clients.view=async()=>({...order,instruction:{...order.instruction,amount:'1'}});await assert.rejects(reconcileAdapterOrder(c,id,clients),/signature|Different/i);
});
test('invalid receipt evidence cannot replace current state; old orders need no journal',async()=>{
  const clients={latestAdapterTransaction:async()=>ref,provider:{viewTransactionStatus:async()=>({...transaction(),final_execution_status:'NONE'})},view:async()=>order};
  assert.equal((await reconcileAdapterOrder(c,id,clients)).reconciliation.state,'unverified');
  clients.latestAdapterTransaction=async()=>null;clients.provider.viewTransactionStatus=()=>assert.fail('No reference');assert.equal((await reconcileAdapterOrder(c,id,clients)).reconciliation.state,'no_reference');
});
test('journal survives reload, is idempotent, rejects path substitution and contains no signing payload',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lenz-receipts-'));
  try{await recordAdapterTransaction({...ref,privateKey:'must not persist',signedTransaction:'must not persist'},root);await recordAdapterTransaction(ref,root);const saved=await latestAdapterTransaction(c,id,root);assert.equal(saved.txHash,ref.txHash);assert(!JSON.stringify(saved).includes('persist'));assert.equal(await latestAdapterTransaction(c,'f'.repeat(64),root),null);await assert.rejects(recordAdapterTransaction({...ref,id:'../escape'},root));}
  finally{await rm(root,{recursive:true,force:true});}
});
test('real SDK saves its exact signed hash before broadcast and preserves it on lost reply',async()=>{
  const pair=KeyPair.fromRandom('ed25519'),events=[];let captured;
  const account=new Account(ref.sender,{sendTransactionUntil:async(signed,wait)=>{events.push('broadcast');assert.equal(wait,'FINAL');const hash=baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());assert.equal(captured.txHash,hash);throw Error('connection lost');}},pair.toString());
  account.createTransaction=async({receiverId,actions})=>createTransaction(ref.sender,pair.getPublicKey(),receiverId,1n,actions,new Uint8Array(32));
  for(const method of ['advance','recover_redemption']){
    events.length=0;await assert.rejects(adapterCall(account,{...c,recoverRedemption:true},method,{id},async r=>{events.push('saved');captured=r;}),/connection lost/);assert.deepEqual(events,['saved','broadcast']);assert.equal(captured.id,id);assert.equal(captured.method,method);
    events.length=0;await assert.rejects(adapterCall(account,{...c,recoverRedemption:true},method,{id},async()=>{throw Error('disk full');}),/disk full/);assert.deepEqual(events,[]);
  }
});
