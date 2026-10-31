import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity} from './public/peer-crypto.js';
import {emptyNearVault,nearLedger,makeNearPayment} from './public/near-protocol.js';
import {makeDepositRequest,checkDepositRequest,acceptDepositResult,prepareRefundReturn,refundSource} from './public/near-deposit.js';
const contract='reserve.lenz.testnet',payer='payer.testnet';
async function fixture(){const identity=await createIdentity('Return A');const r=await makeDepositRequest(identity,contract,payer,'3000000','ab'.repeat(32));const result={finality:'FINAL',root:{id:r.id,owner:r.owner,amount:r.amount},spent:null};return {identity,r,result};}
test('deposit signs payer, source, owner, reserve and amount; root id remains stable',async()=>{
  const {identity,r}=await fixture();assert.equal((await checkDepositRequest(r)).id,r.id);
  for(const [field,value] of [['payer','other.testnet'],['contract','other.testnet'],['source','bc'.repeat(32)],['amount','1'],['signature','0'.repeat(128)],['id','root:'+'0'.repeat(64)]])await assert.rejects(checkDepositRequest({...r,[field]:value}));
  const changed=await makeDepositRequest(identity,contract,payer,'1',r.source);assert.equal(changed.id,r.id);
});
test('matching final deposit adds value once and later retries preserve local spends',async()=>{
  const {identity,r,result}=await fixture();const v=await acceptDepositResult(emptyNearVault(contract),identity,r,result);
  assert.equal((await nearLedger(v)).available[0].amount,'3000000');const sent=await makeNearPayment(v,identity,identity.profile,'1');
  const again=await acceptDepositResult(sent.vault,identity,r,result);assert.equal(again.roots.length,1);assert.equal(again.spends.length,1);
  assert.equal((await nearLedger(again)).available.reduce((n,v)=>n+BigInt(v.amount),0n),3000000n);
});
test('consumed deposits and known conflicts never become fresh spendable value',async()=>{
  const {identity,r,result}=await fixture();let v=await acceptDepositResult(emptyNearVault(contract),identity,r,{...result,spent:'cd'.repeat(32)});
  assert.equal((await nearLedger(v)).available.length,0);v=await acceptDepositResult(v,identity,r,result);assert.equal((await nearLedger(v)).available.length,0);
});
test('wrong-owner, missing-consumption and nonfinal results cannot credit a wallet',async()=>{
  const {identity,r,result}=await fixture(),v=emptyNearVault(contract);
  for(const bad of [{...result,finality:'EXECUTED'}, {...result,spent:undefined},{...result,root:{...result.root,amount:'4000000'}}])await assert.rejects(acceptDepositResult(v,identity,r,bad));
  await assert.rejects(acceptDepositResult(v,await createIdentity('B'),r,result));assert.equal(v.roots.length,0);
});
test('refund returns require the original owner and final refunded status with stable source',async()=>{
  const {identity,r}=await fixture(),v=emptyNearVault(contract);
  const entry={packet:{id:'11'.repeat(32),config:{reserve:contract,adapter:'adapter.testnet'},instruction:{owner:r.owner,amount:r.amount,receiver_id:payer}},status:{stage:'refunded'}};
  const returned=await prepareRefundReturn(v,identity,entry);assert.equal(returned.source,await refundSource('adapter.testnet',entry.packet.id));
  for(const stage of ['complete','ready','refund_available','attention','rejected'])await assert.rejects(prepareRefundReturn(v,identity,{...entry,status:{stage}}));
  await assert.rejects(prepareRefundReturn(v,await createIdentity('B'),entry));
});
