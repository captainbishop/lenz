import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {KeyPair,actions,createTransaction,encodeTransaction,SignedTransaction,Signature} from '../contracts/node_modules/near-api-js/lib/index.js';
import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {base58,base64} from './public/intents-vendor/codecs.js';
import {encodeCall} from '../aurora/engine-codec.mjs';
import {AURORA_INTENT_DEPLOYMENT as d} from './public/intent-aurora-config.js';
import {createAuroraSponsorCoordinator,emptyAuroraSponsorJournal,inspectAuroraSponsoredTransaction,checkAuroraSponsorCall} from './intent-aurora-sponsor.mjs';
import {inspectEngineTransaction} from '../aurora/engine-receipt.mjs';

function fixture(){
 const operator=KeyPair.fromRandom('ed25519'),operatorId='shared-sponsor-fixture.testnet';let state=emptyAuroraSponsorJournal(),signs=0,sends=0;
 const call={receiverId:'aurora',methodName:'call',args:base64.encode(encodeCall({contract:d.inputToken,input:Buffer.from(new Interface(['function approve(address,uint256)']).encodeFunctionData('approve',[d.pool,1000000n]).slice(2),'hex')})),gas:'300000000000000',deposit:'0'};
 const signer={async signTransaction(value){signs++;await Promise.resolve();const transaction=createTransaction(operatorId,operator.getPublicKey(),'aurora',BigInt(signs),[actions.functionCall('call',base64.decode(value.args),BigInt(value.gas),0n)],new Uint8Array(32).fill(3)),digest=createHash('sha256').update(encodeTransaction(transaction)).digest(),signed=new SignedTransaction({transaction,signature:new Signature({keyType:0,data:operator.sign(digest).signature})});return {senderId:operatorId,txHash:base58.encode(digest),bytes:base64.encode(signed.encode())};}};
 const journal={async read(){return structuredClone(state);},async write(value){state=structuredClone(value);}},transport={async send(){sends++;assert.equal(state.pending.state,'submitting');throw Error('Fixture lost acknowledgement');},async transaction(){return null;}};
 function final(signed=state.pending.signed,callValue=state.pending.call){const engineId=base58.encode(new Uint8Array(32).fill(7)),refundId=base58.encode(new Uint8Array(32).fill(8)),status={SuccessValue:Buffer.concat([Buffer.from([7,0]),Buffer.alloc(4),Buffer.alloc(8),Buffer.alloc(4)]).toString('base64')};return {final_execution_status:'FINAL',transaction:{hash:signed.txHash,signer_id:operatorId,receiver_id:'aurora',actions:[{FunctionCall:{method_name:'call',args:callValue.args,gas:callValue.gas,deposit:'0'}}]},transaction_outcome:{id:signed.txHash,outcome:{executor_id:operatorId,receipt_ids:[engineId],status:{SuccessReceiptId:engineId}}},receipts_outcome:[{id:engineId,outcome:{executor_id:'aurora',receipt_ids:[refundId],status}},{id:refundId,outcome:{executor_id:operatorId,receipt_ids:[],status:{SuccessValue:''}}}],status};}
 const coordinator=createAuroraSponsorCoordinator({signer,transport,journal,operatorId});return {coordinator,call,transport,operatorId,final,counts:()=>({signs,sends}),state:()=>structuredClone(state),replaceState:value=>{state=structuredClone(value);}};
}
test('faucet and swap share one durable pending signer fence',async()=>{
 const f=fixture(),run=()=>f.coordinator.serialize(async()=>{const signed=await f.coordinator.signTransaction(f.call);await f.coordinator.send(signed.bytes);});
 const results=await Promise.allSettled([run(),run()]);assert.equal(results.every(row=>row.status==='rejected'),true);assert.deepEqual(f.counts(),{signs:1,sends:1});assert.equal(f.state().pending.state,'unknown');
 const original=f.state().pending.signed.bytes;await assert.rejects(f.coordinator.send(original),/original|submitted/);assert.deepEqual(f.counts(),{signs:1,sends:1});
});
test('only an exact complete final receipt releases the shared pending sponsor',async()=>{
 const f=fixture(),signed=await f.coordinator.signTransaction(f.call);await assert.rejects(f.coordinator.send(signed.bytes));const final=f.final(),receipt={success:true,transaction:signed.txHash,receiptIds:final.receipts_outcome.map(row=>row.id)};f.transport.transaction=async()=>final;
 await assert.rejects(f.coordinator.settle(signed,{...receipt,receiptIds:[base58.encode(new Uint8Array(32).fill(9))]}),/receipt/);assert(f.state().pending);
 await f.coordinator.settle(signed,receipt);assert.equal(f.state().pending,null);const next=await f.coordinator.signTransaction(f.call);await f.coordinator.settle(signed,receipt);assert.equal(f.state().pending.signed.txHash,next.txHash);assert.deepEqual(f.counts(),{signs:2,sends:1});
});
test('legacy finally verified funding can be reconciled without clearing a different pending swap',async()=>{
 const f=fixture(),old=await f.coordinator.signTransaction(f.call),oldFinal=f.final(),receipt={success:true,transaction:old.txHash,receiptIds:oldFinal.receipts_outcome.map(row=>row.id)};
 f.replaceState(emptyAuroraSponsorJournal());const current=await f.coordinator.signTransaction(f.call);f.transport.transaction=async()=>oldFinal;await f.coordinator.settle(old,receipt);assert.equal(f.state().pending.signed.txHash,current.txHash);assert.equal(f.state().completed[0].signed.txHash,old.txHash);assert.equal(f.counts().sends,0);
});
test('the high-gas inspector requires an explicit ceiling and a complete original receipt graph',async()=>{
 const f=fixture(),call={...f.call,args:base64.encode(encodeCall({contract:d.pool,input:Buffer.from(new Interface(['function deposit(bytes32)']).encodeFunctionData('deposit',['0x'+'01'.repeat(32)]).slice(2),'hex')})),gas:'1000000000000000'},signed=await f.coordinator.signTransaction(call),final=f.final(),action=checkAuroraSponsorCall(call),reference={version:1,network:'testnet',engine:'aurora',sender:f.operatorId,txHash:signed.txHash,gas:call.gas,contract:action.contract,input:action.input,value:'0'};
 assert.throws(()=>inspectEngineTransaction(reference,final));assert.equal(inspectAuroraSponsoredTransaction(signed,call,f.operatorId,final).success,true);assert.throws(()=>inspectEngineTransaction(reference,final,{maxGas:1000000000000001n}));final.receipts_outcome.pop();assert.throws(()=>inspectAuroraSponsoredTransaction(signed,call,f.operatorId,final));
});
test('a malformed FINAL reply stays unknown before either service can claim a successful action',async()=>{
 const f=fixture(),signed=await f.coordinator.signTransaction(f.call);f.transport.send=async()=>{const result=f.final();result.receipts_outcome.pop();return result;};await assert.rejects(f.coordinator.send(signed.bytes));assert.equal(f.state().pending.state,'unknown');assert.equal(f.state().completed.length,0);
});
