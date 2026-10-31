import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity} from '../web/public/peer-crypto.js';
import {makeDepositRequest,refundSource} from '../web/public/near-deposit.js';
import {returnRefund,depositReceipt} from './refund-return.mjs';
const account={accountId:'lenz-dev-123.testnet'},c={reserve:'reserve.testnet',adapter:'adapter.testnet'},id='ab'.repeat(32);
async function fixture(){
  const identity=await createIdentity('A'),source=await refundSource(c.adapter,id),r=await makeDepositRequest(identity,c.reserve,account.accountId,'1000000',source);
  const order={id,stage:'refunded',instruction:{owner:r.owner,amount:r.amount,receiver_id:r.payer}},calls=[];let root=null;
  const clients={view:async(_contract,method)=>method==='get_order'?order:method==='get_root'?root:method==='capabilities'?['deposit_offline_v1']:null,
    call:async(_account,_contract,_method,args)=>{calls.push(args);root={id:r.id,owner:r.owner,amount:r.amount};return {finality:'FINAL',txHash:'fixture'};}};
  return {identity,r,order,calls,clients};
}
test('sponsor returns only a signed final refund and retries without another debit',async()=>{
  const {r,calls,clients}=await fixture();assert.equal((await returnRefund(account,c,id,r,clients)).root.id,r.id);
  assert((await returnRefund(account,c,id,r,clients)).recovered);assert.equal(calls.length,1);
});
test('nonrefunded status, wrong owner, receiver and amount cannot spend sponsor balance',async()=>{
  for(const change of [o=>o.stage='refund_available',o=>o.stage='complete',o=>o.instruction.owner='bad',o=>o.instruction.amount='2',o=>o.instruction.receiver_id='other.testnet']){
    const {r,order,calls,clients}=await fixture();change(order);await assert.rejects(returnRefund(account,c,id,r,clients));assert.equal(calls.length,0);
  }
});
test('changing source, payer or signature is rejected before any debit',async()=>{
  const {identity,r,calls,clients}=await fixture();
  const wrongSource=await makeDepositRequest(identity,c.reserve,r.payer,r.amount,'bc'.repeat(32));
  const wrongPayer=await makeDepositRequest(identity,c.reserve,'other.testnet',r.amount,r.source);
  for(const bad of [wrongSource,wrongPayer,{...r,signature:'0'.repeat(128)}])await assert.rejects(returnRefund(account,c,id,bad,clients));assert.equal(calls.length,0);
});
test('checking an externally signed deposit reads its consumed state without spending',async()=>{
  const {r}=await fixture();const methods=[];
  const result=await depositReceipt(r,{view:async(_c,method)=>{methods.push(method);return method==='get_root'?{id:r.id,owner:r.owner,amount:r.amount}:'de'.repeat(32);}});
  assert.equal(result.spent,'de'.repeat(32));assert.deepEqual(methods,['get_root','spent_by']);
});
test('absent or mismatched roots cannot be reported as returned funds',async()=>{
  const {r}=await fixture();
  for(const root of [null,{id:r.id,owner:r.owner,amount:'999'}])await assert.rejects(depositReceipt(r,{view:async()=>root}));
});
