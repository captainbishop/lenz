import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Interface,keccak256,toUtf8Bytes} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {KeyPair,actions,createTransaction,encodeTransaction,SignedTransaction,Signature} from '../contracts/node_modules/near-api-js/lib/index.js';
import {base58,base64} from './public/intents-vendor/codecs.js';
import {AURORA_INTENT_DEPLOYMENT as d} from './public/intent-aurora-config.js';
import {auroraVaultAddress} from './public/intent-aurora-plan.js';
import {createAuroraSwapService,emptyAuroraSwapJournal} from './intent-aurora-swap.mjs';

// Explicit protocol fixtures use actual NEAR signatures and Aurora ABI codecs.
function fixture(){
 const operator=KeyPair.fromRandom('ed25519'),operatorId='private-swap-fixture.testnet',operatorAddress='0x'+'12'.repeat(20);let clock=1794620000000;
 const plan={beneficiary:'0x'+'34'.repeat(20),refundRecipient:'0x'+'34'.repeat(20),relayer:'0x'+'0'.repeat(40),relayerFee:'0',minOutput:'2000000',deadline:String(clock/1000+300),salt:'0x'+'56'.repeat(32)};
 const vault=auroraVaultAddress(plan),root='0x'+'01'.repeat(32),nullifierHash='0x'+'02'.repeat(32),proof='0x'+'00'.repeat(256),publicSignals=[root,nullifierHash,vault,'0','0','0'].map(v=>BigInt(v).toString());
 const id='aurora-swap:'+'a'.repeat(64),artifactId='aurora-proof:'+keccak256(toUtf8Bytes(JSON.stringify({intentId:id,proof,publicSignals}))).slice(2),request={id,artifactId,plan,vault,root,nullifierHash,proof,publicSignals};
 let retained=emptyAuroraSwapJournal(),signs=0,sends=0,settings={knownRoot:true,spent:false,proofValid:true,simulateValid:true,gasReady:true,lost:false,status:null,inputBalance:'0',outputBalance:'0',allowance:'0',beneficiaryOutputBalance:'0',beneficiaryInputBalance:'0'};
 const snapshot={routeId:d.routeId,network:'testnet',chainId:d.chainHex,observedAt:clock,block:{number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:clock},codes:{...d.codeSha256},pool:{address:d.pool,denomination:d.denomination,levels:20,root,nextIndex:1,commitments:[root],deposits:[{index:0,commitment:root}],withdrawals:[],inputBalance:'1000000'},venue:{address:d.adapter,inputAmount:d.denomination,outputAmount:d.outputAmount,outputBalance:'8000000'}};
 const rpc={async snapshot(){return structuredClone(snapshot);},async swapState(){return {snapshot:structuredClone(snapshot),factoryVault:vault,factoryBindingsVerified:true,...settings,vault:{deployed:settings.status!==null,status:settings.status,bindingsVerified:true,inputToken:d.inputToken,outputToken:d.outputToken,adapter:d.adapter,inputAmount:d.denomination,minOutput:plan.minOutput,deadline:plan.deadline,beneficiary:plan.beneficiary,refundRecipient:plan.refundRecipient,chainId:String(d.chainId),inputBalance:settings.inputBalance,outputBalance:settings.outputBalance,allowance:settings.allowance},beneficiaryOutputBalance:settings.beneficiaryOutputBalance};},async operatorState(){return {accountId:operatorId,address:operatorAddress,engineVerified:true,maxGas:'1000000000000000',gasReady:settings.gasReady,allowance:'0'};},async send(){sends++;assert(retained.pending?.signed.bytes,'Retain exact signed bytes before dispatch');if(settings.lost)throw Error('Fixture lost response');return null;},async transaction(){return null;}};
 const signer={async signTransaction(call){signs++;const transaction=createTransaction(operatorId,operator.getPublicKey(),'aurora',BigInt(signs),[actions.functionCall('call',base64.decode(call.args),BigInt(call.gas),0n)],new Uint8Array(32).fill(3)),digest=createHash('sha256').update(encodeTransaction(transaction)).digest(),signed=new SignedTransaction({transaction,signature:new Signature({keyType:0,data:operator.sign(digest).signature})});return {senderId:operatorId,txHash:base58.encode(digest),bytes:base64.encode(signed.encode())};}};
 const journal={async read(){return structuredClone(retained);},async write(value){retained=structuredClone(value);}};
 const service=createAuroraSwapService({rpc,signer,journal,operatorId,operatorAddress,now:()=>clock});
 function final({wrongRecipient=false,missingOutput=false,failed=false,refunded=false}={}){
  const stage=retained.pending,events=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)','event Withdrawal(address to,bytes32 nullifierHash,address indexed relayer,uint256 fee)']),logs=[];
  const add=(address,name,args)=>logs.push({address,...events.encodeEventLog(events.getEvent(name),args)});
  if(stage.operation!=='recover'){add(d.inputToken,'Transfer',[d.pool,vault,1000000n]);add(d.pool,'Withdrawal',[vault,nullifierHash,plan.relayer,0n]);}if(refunded)add(d.inputToken,'Transfer',[vault,plan.refundRecipient,1000000n]);else{add(d.inputToken,'Transfer',[vault,d.adapter,1000000n]);add(d.outputToken,'Transfer',[d.adapter,vault,2000000n]);if(!missingOutput)add(d.outputToken,'Transfer',[vault,wrongRecipient?'0x'+'aa'.repeat(20):plan.beneficiary,2000000n]);}
  const count=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;},execution=Buffer.concat([Buffer.from([7,0]),count(0),Buffer.alloc(8),count(logs.length),...logs.map(log=>Buffer.concat([Buffer.from(log.address.slice(2),'hex'),count(log.topics.length),...log.topics.map(topic=>Buffer.from(topic.slice(2),'hex')),count((log.data.length-2)/2),Buffer.from(log.data.slice(2),'hex')]))]).toString('base64');
  const engineId=base58.encode(new Uint8Array(32).fill(7)),refundId=base58.encode(new Uint8Array(32).fill(8)),status=failed?{Failure:{ActionError:{kind:'fixture failure'}}}:{SuccessValue:execution};
  if(!failed)Object.assign(settings,{spent:true,status:refunded?3:2,inputBalance:'0',outputBalance:'0',...(refunded?{beneficiaryInputBalance:'1000000'}:{beneficiaryOutputBalance:'2000000'})});
  return {final_execution_status:'FINAL',transaction:{hash:stage.signed.txHash,signer_id:operatorId,receiver_id:'aurora',actions:[{FunctionCall:{method_name:'call',args:stage.call.args,gas:stage.call.gas,deposit:'0'}}]},transaction_outcome:{id:stage.signed.txHash,outcome:{executor_id:operatorId,receipt_ids:[engineId],status:{SuccessReceiptId:engineId}}},receipts_outcome:[{id:engineId,outcome:{executor_id:'aurora',receipt_ids:[refundId],status}},{id:refundId,outcome:{executor_id:operatorId,receipt_ids:[],status:{SuccessValue:''}}}],status};
 }
 return {service,rpc,request,journal,snapshot,final,state:()=>structuredClone(retained),counts:()=>({signs,sends}),options:value=>{Object.assign(settings,value);if('clock'in value){clock=value.clock;snapshot.observedAt=clock;snapshot.block.timestamp=clock;}}};
}
test('private swap preparation checks the onchain vault without requesting a signature',async()=>{
 const f=fixture(),{plan,vault,root,nullifierHash}=f.request;
 const prepared=await f.service.prepare({plan,vault,root,nullifierHash});
 assert.equal(prepared.vault,vault);assert.equal(prepared.available,true);assert.deepEqual(f.counts(),{signs:0,sends:0});assert.deepEqual(f.state(),emptyAuroraSwapJournal());
 await assert.rejects(f.service.prepare({plan,vault:'0x'+'ff'.repeat(20),root,nullifierHash}),/vault/);assert.deepEqual(f.counts(),{signs:0,sends:0});
});
test('an uncertain private swap retains one exact factory call and never rebroadcasts',async()=>{
 const f=fixture();f.options({lost:true});const result=await f.service.submit(f.request);
 assert.equal(result.intentId,f.request.id);assert.equal(result.artifactId,f.request.artifactId);assert.equal(result.status,'unknown');assert.equal(result.verified,false);
 const original=f.state().pending,bytes=base64.decode(original.call.args);
 assert.equal('0x'+Buffer.from(bytes.slice(1,21)).toString('hex'),d.factory);assert.equal(Buffer.from(bytes.slice(21,53)).some(v=>v!==0),false);assert.equal(original.call.gas,'1000000000000000');assert.equal(original.call.deposit,'0');
 const abi=new Interface(['function fulfill((address beneficiary,address refundRecipient,address relayer,uint256 relayerFee,uint256 minOutput,uint256 deadline,bytes32 salt),bytes,bytes32,bytes32)']);
 const decoded=abi.decodeFunctionData('fulfill','0x'+Buffer.from(bytes.slice(57)).toString('hex'));
 assert.equal(decoded[0].beneficiary.toLowerCase(),f.request.plan.beneficiary);assert.equal(decoded[0].minOutput,2000000n);assert.equal(decoded[1],f.request.proof);assert.equal(decoded[2],f.request.root);assert.equal(decoded[3],f.request.nullifierHash);
 await f.service.submit(f.request);await f.service.reconcile(f.request);assert.equal(f.state().pending.signed.bytes,original.signed.bytes);assert.deepEqual(f.counts(),{signs:1,sends:1});
});
test('changed private authority and unavailable proof state stop before sponsor signing',async()=>{
 for(const options of [{knownRoot:false},{spent:true},{proofValid:false},{gasReady:false}]){const f=fixture();f.options(options);await assert.rejects(f.service.submit(f.request));assert.deepEqual(f.counts(),{signs:0,sends:0});}
 for(const change of [r=>r.publicSignals[2]='1',r=>r.artifactId='aurora-proof:'+'b'.repeat(64),r=>r.plan.refundRecipient='0x'+'aa'.repeat(20),r=>r.secret='forbidden']){const f=fixture(),request=structuredClone(f.request);change(request);await assert.rejects(f.service.submit(request));assert.deepEqual(f.counts(),{signs:0,sends:0});}
});
test('private swap success requires exact final withdrawal, output transfers and cleared vault state',async()=>{
 const f=fixture();f.rpc.send=async()=>f.final();const result=await f.service.submit(f.request);
 assert.equal(result.status,'executed');assert.equal(result.verified,true);assert.equal(result.evidence.transaction,f.state().requests[f.request.id].stages[0].signed.txHash);assert.equal(result.evidence.outputAmount,'2000000');assert.equal(result.evidence.beneficiary,f.request.plan.beneficiary);assert.equal(result.evidence.allowance,'0');assert.equal(f.state().pending,null);
 await f.service.submit(f.request);await f.service.reconcile(f.request);assert.equal(f.counts().signs,1);
});
test('wrong output or an incomplete final receipt graph cannot release the original note fence',async()=>{
 for(const options of [{wrongRecipient:true},{missingOutput:true},{incomplete:true}]){const f=fixture();f.options({lost:true});await f.service.submit(f.request);f.rpc.transaction=async()=>{const result=f.final(options);if(options.incomplete)result.receipts_outcome.pop();return result;};await assert.rejects(f.service.reconcile(f.request));assert(f.state().pending);assert.deepEqual(f.counts(),{signs:1,sends:1});}
});
test('expired original proof refunds only after a fresh status check and explicit recovery operation',async()=>{
 const f=fixture();f.options({lost:true});await f.service.submit(f.request);f.rpc.transaction=async()=>f.final({failed:true});await f.service.reconcile(f.request);f.options({clock:1794620400000,lost:false});
 await assert.rejects(f.service.recover({request:f.request,operation:'withdrawRefund'}),/status/);await f.service.reconcile(f.request);f.rpc.send=async()=>f.final({refunded:true});
 const result=await f.service.recover({request:f.request,operation:'withdrawRefund'});assert.equal(result.status,'refunded');assert.equal(result.evidence.refundRecipient,f.request.plan.refundRecipient);assert.equal(result.evidence.refundAsset,d.inputToken);assert.equal(result.evidence.refundAmount,'1000000');assert.equal(f.counts().signs,2);assert.equal(f.state().pending,null);
 await f.service.recover({request:f.request,operation:'withdrawRefund'});assert.equal(f.counts().signs,2);
});
test('an offline retained but never submitted proof can read expiry and explicitly refund without a replacement plan',async()=>{
 const f=fixture();f.options({clock:1794620400000});const status=await f.service.reconcile(f.request);assert.equal(status.recovery.operation,'withdrawRefund');assert.deepEqual(f.counts(),{signs:0,sends:0});f.rpc.send=async()=>f.final({refunded:true});const result=await f.service.recover({request:f.request,operation:'withdrawRefund'});assert.equal(result.status,'refunded');assert.equal(f.counts().signs,1);assert.deepEqual(f.state().requests[f.request.id].request,f.request);
});
test('final vault allowance, terms, code, nullifier and receiving balance are required independently',async()=>{
 for(const modify of [state=>state.vault.allowance='1',state=>state.vault.deadline='1',state=>state.factoryBindingsVerified=false,state=>state.spent=false,state=>state.beneficiaryOutputBalance='0']){const f=fixture();f.options({lost:true});await f.service.submit(f.request);f.rpc.transaction=async()=>f.final();const read=f.rpc.swapState;f.rpc.swapState=async(...args)=>{const state=await read(...args);modify(state);return state;};await assert.rejects(f.service.reconcile(f.request));assert(f.state().pending);assert.equal(f.counts().signs,1);}
});
test('journal persistence failure prevents dispatch and a changed original request cannot reuse its note',async()=>{
 const f=fixture(),write=f.journal.write;f.journal.write=async state=>{if(state.pending)throw Error('Fixture persistence failure');return write(state);};await assert.rejects(f.service.submit(f.request),/persistence/);assert.equal(f.counts().sends,0);
 const g=fixture();g.options({lost:true});await g.service.submit(g.request);const changed=structuredClone(g.request);changed.id='aurora-swap:'+'b'.repeat(64);changed.artifactId='aurora-proof:'+keccak256(toUtf8Bytes(JSON.stringify({intentId:changed.id,proof:changed.proof,publicSignals:changed.publicSignals}))).slice(2);await assert.rejects(g.service.submit(changed),/original/);assert.deepEqual(g.counts(),{signs:1,sends:1});
});
test('consuming the last venue output does not invalidate an exact verified swap payout',async()=>{
 const f=fixture();f.snapshot.venue.outputBalance='2000000';f.rpc.send=async()=>{const result=f.final();f.snapshot.venue.outputBalance='0';return result;};const result=await f.service.submit(f.request);assert.equal(result.status,'executed');assert.equal(result.evidence.outputAmount,'2000000');
});
test('original input refunds do not depend on available output liquidity',async()=>{
 const f=fixture();f.options({clock:1794620400000});f.snapshot.venue.outputBalance='0';const status=await f.service.reconcile(f.request);assert.equal(status.recovery.operation,'withdrawRefund');f.rpc.send=async()=>f.final({refunded:true});assert.equal((await f.service.recover({request:f.request,operation:'withdrawRefund'})).status,'refunded');
});
test('an originally proof-funded vault recovers without a replacement withdrawal or relying on remaining pool inventory',async()=>{
 const f=fixture();f.options({spent:true,status:0,inputBalance:'1000000'});f.snapshot.pool.inputBalance='0';f.snapshot.pool.withdrawals=[{nullifierHash:f.request.nullifierHash,recipient:f.request.vault,relayer:f.request.plan.relayer,fee:'0'}];const status=await f.service.reconcile(f.request);assert.equal(status.recovery.operation,'recover');assert.equal(f.counts().signs,0);f.rpc.send=async()=>f.final();const result=await f.service.recover({request:f.request,operation:'recover'});assert.equal(result.status,'executed');assert.equal(f.state().requests[f.request.id].stages[0].operation,'recover');assert.equal(f.counts().signs,1);
});
test('unfunded venue still cannot authorize a new private execution',async()=>{
 const f=fixture();f.snapshot.venue.outputBalance='0';await assert.rejects(f.service.submit(f.request),/venue/);assert.deepEqual(f.counts(),{signs:0,sends:0});
});
