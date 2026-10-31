import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity } from './public/peer-crypto.js';
import { emptyNearVault, compressed } from './public/near-protocol.js';
import { prepareRefundReturn } from './public/near-deposit.js';
import { refundDepositTransaction, signRefundDeposit } from './public/near-signer.js';
const config={network:'testnet',reserve:'reserve.testnet',adapter:'adapter.testnet'};
async function fixture(){
  const identity=await createIdentity('Signer test'),entry={packet:{id:'ab'.repeat(32),config,instruction:{owner:compressed(identity.profile.signingPublic),amount:'1000000',receiver_id:'receiver.testnet'}},status:{stage:'refunded'}};
  const request=await prepareRefundReturn(emptyNearVault(config.reserve),identity,entry);
  return {request,context:{config,entry,identity}};
}
test('only the exact refund becomes a single bounded testnet deposit action',async()=>{
  const {request,context}=await fixture(),tx=await refundDepositTransaction(request,context);
  assert.deepEqual(tx,{network:'testnet',signerId:'receiver.testnet',receiverId:'reserve.testnet',actions:[{type:'FunctionCall',params:{methodName:'deposit_offline',args:{owner:request.owner,amount:'1000000',source:request.source,signature:request.signature},gas:'50000000000000',deposit:'30000000000000000000000'}}]});
});
test('valid signatures for another network, reserve, source, owner or refund cannot open a wallet action',async()=>{
  const {request,context}=await fixture();
  for(const changes of [{config:{...config,network:'mainnet'}},{config:{...config,reserve:'other.testnet'}},{entry:{...context.entry,returnReceipt:{rootId:request.id}}},{entry:{...context.entry,status:{stage:'refund_available'}}},{identity:await createIdentity('Other')}])await assert.rejects(refundDepositTransaction(request,{...context,...changes}));
  for(const [key,value] of [['amount','2000000'],['receiver_id','other.testnet'],['owner',compressed((await createIdentity('Third')).profile.signingPublic)]]){
    const entry=structuredClone(context.entry);entry.packet.instruction[key]=value;await assert.rejects(refundDepositTransaction(request,{...context,entry}));
  }
  const entry=structuredClone(context.entry);entry.packet.id='cd'.repeat(32);await assert.rejects(refundDepositTransaction(request,{...context,entry}));
});
test('wrong signer and offline state never submit; wallet success returns no credit evidence',async()=>{
  const {request,context}=await fixture();let calls=0;Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
  const signer={getAccounts:async()=>[{accountId:'other.testnet'}],signAndSendTransaction:async()=>{calls++;return {status:'success',root:request};}};
  await assert.rejects(signRefundDeposit(request,context,signer),/Connect receiver/);assert.equal(calls,0);
  signer.getAccounts=async()=>[{accountId:request.payer}];assert.equal(await signRefundDeposit(request,context,signer),undefined);assert.equal(calls,1);
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true});await assert.rejects(signRefundDeposit(request,context,signer),/Reconnect/);assert.equal(calls,1);
  delete navigator.onLine;
});
