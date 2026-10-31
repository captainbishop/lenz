import test from 'node:test';
import assert from 'node:assert/strict';
import {finalReceipt,call} from './client.mjs';
const tx=()=>({final_execution_status:'FINAL',status:{SuccessValue:Buffer.from(JSON.stringify({ok:true})).toString('base64')},transaction:{hash:'test-hash'},receipts_outcome:[{id:'receipt-id',outcome:{gas_burnt:1300000000000,status:{SuccessValue:''}}}]});
test('only a successful final outcome produces a settlement receipt',()=>{
  assert.deepEqual(finalReceipt(tx()).value,{ok:true});
  assert.equal(finalReceipt(tx()).gasBurnt,'1300000000000');
  for(const status of['NONE','INCLUDED','EXECUTED_OPTIMISTIC','EXECUTED'])assert.throws(()=>finalReceipt({...tx(),final_execution_status:status}),/final execution/);
  assert.throws(()=>finalReceipt({...tx(),status:{Failure:{}}}),/final execution/);
});
test('a failed asynchronous receipt is not treated as settlement success',()=>{
  const failed=tx();failed.receipts_outcome[0].outcome.status={Failure:{ActionError:'failed'}};
  assert.throws(()=>finalReceipt(failed),/receipt failed/);
});
test('contract calls request the full final execution outcome, not the decoded return value',async()=>{
  const account={
    callFunction:async()=>{assert.fail('Decoded return values cannot prove finality');},
    callFunctionRaw:async args=>{assert.equal(args.waitUntil,'FINAL');assert.equal(args.methodName,'settle');return tx();}
  };
  assert.equal((await call(account,'reserve.testnet','settle',{path:[]})).txHash,'test-hash');
});
