import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {KeyPair,actions,createTransaction,encodeTransaction,SignedTransaction,Signature} from '../contracts/node_modules/near-api-js/lib/index.js';
import {Interface,keccak256,toUtf8Bytes} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {encodeCall} from '../aurora/engine-codec.mjs';
import {base58,base64} from './public/intents-vendor/codecs.js';
import {nep413Hash} from '../integrations/intent-testnet/swap.mjs';
import {AURORA_INTENT_DEPLOYMENT as d} from './public/intent-aurora-config.js';
import {auroraFundingOwner,buildAuroraFundingReview} from './public/intent-aurora-funding-plan.js';
import {auroraVaultAddress} from './public/intent-aurora-plan.js';
import {createAuroraFundingService,emptyAuroraFundingJournal,auroraFundingStorageId} from './intent-aurora-funding.mjs';
import {createAuroraSwapService,emptyAuroraSwapJournal} from './intent-aurora-swap.mjs';
import {createAuroraSponsorCoordinator,emptyAuroraSponsorJournal} from './intent-aurora-sponsor.mjs';
import {openAuroraSponsorRuntime} from './intent-aurora-sponsor-live.mjs';

const count=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
const abi=new Interface(['function approve(address,uint256)','function deposit(bytes32)','event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)']);

// Chain observations and persistence are fixtures; services, signatures and receipt graphs are real.
function fixture({fundingDailyLimit=5,swapDailyLimit=5,completed=0}={}){
 const user=KeyPair.fromRandom('ed25519'),operator=KeyPair.fromRandom('ed25519'),operatorId='composed-workflow-fixture.testnet',operatorAddress='0x'+'12'.repeat(20),owner=auroraFundingOwner(user.getPublicKey().toString()),commitment='0x'+'01'.repeat(32);
 let clock=1794620000000,nonce=0,nativeSigns=0,sends=0,lost=false,reveal=true,allowance='0',fundingWriteFails=false;
 let sponsorState=emptyAuroraSponsorJournal(),fundingState=emptyAuroraFundingJournal(),swapState=emptyAuroraSwapJournal(),coordinator;const finalResults=new Map();
 function signNative(call,charge=true){
  if(charge)nativeSigns++;const transaction=createTransaction(operatorId,operator.getPublicKey(),'aurora',BigInt(++nonce),[actions.functionCall('call',base64.decode(call.args),BigInt(call.gas),0n)],new Uint8Array(32).fill(3)),digest=createHash('sha256').update(encodeTransaction(transaction)).digest();
  const signed=new SignedTransaction({transaction,signature:new Signature({keyType:0,data:operator.sign(digest).signature})});return {senderId:operatorId,txHash:base58.encode(digest),bytes:base64.encode(signed.encode())};
 }
 const approval={receiverId:'aurora',methodName:'call',args:base64.encode(encodeCall({contract:d.inputToken,input:Buffer.from(abi.encodeFunctionData('approve',[d.pool,1000000n]).slice(2),'hex')})),gas:'300000000000000',deposit:'0'};
 for(let index=0;index<completed;index++){const signed=signNative(approval,false);sponsorState.completed.push({call:approval,signed,receipt:{success:true,transaction:signed.txHash,receiptIds:[]}});}
 function fundingFinal(pending){
  const input=Buffer.from(base64.decode(pending.call.args)).subarray(57),parsed=abi.parseTransaction({data:'0x'+input.toString('hex')}),logs=[];
  if(parsed.name==='approve')allowance=parsed.args[1].toString();else logs.push({address:d.pool,...abi.encodeEventLog(abi.getEvent('Deposit'),[parsed.args[0],0n,BigInt(Math.floor(clock/1000))])});
  const execution=Buffer.concat([Buffer.from([7,0]),count(0),Buffer.alloc(8),count(logs.length),...logs.map(log=>Buffer.concat([Buffer.from(log.address.slice(2),'hex'),count(log.topics.length),...log.topics.map(topic=>Buffer.from(topic.slice(2),'hex')),count((log.data.length-2)/2),Buffer.from(log.data.slice(2),'hex')]))]).toString('base64');
  const engineId=base58.encode(new Uint8Array(32).fill(7)),refundId=base58.encode(new Uint8Array(32).fill(8)),status={SuccessValue:execution};
  return {final_execution_status:'FINAL',transaction:{hash:pending.signed.txHash,signer_id:operatorId,receiver_id:'aurora',actions:[{FunctionCall:{method_name:'call',args:pending.call.args,gas:pending.call.gas,deposit:'0'}}]},transaction_outcome:{id:pending.signed.txHash,outcome:{executor_id:operatorId,receipt_ids:[engineId],status:{SuccessReceiptId:engineId}}},receipts_outcome:[{id:engineId,outcome:{executor_id:'aurora',receipt_ids:[refundId],status}},{id:refundId,outcome:{executor_id:operatorId,receipt_ids:[],status:{SuccessValue:''}}}],status};
 }
 const sponsorJournal={read:async()=>structuredClone(sponsorState),write:async value=>{sponsorState=structuredClone(value);}};
 coordinator=createAuroraSponsorCoordinator({operatorId,journal:sponsorJournal,signer:{signTransaction:async call=>signNative(call)},now:()=>clock,fundingDailyLimit,swapDailyLimit,budgetStatus:async()=>({gasPrice:'100000000',availableBalance:'1000000000000000000000000000000'}),transport:{
  send:async()=>{sends++;const pending=await coordinator.pending(),contract='0x'+Buffer.from(base64.decode(pending.call.args)).subarray(1,21).toString('hex');if(contract===d.factory)return null;const result=fundingFinal(pending);finalResults.set(pending.signed.txHash,result);if(lost)throw Error('Fixture response lost');return result;},
  transaction:async hash=>reveal?finalResults.get(hash)??null:null
 }});
 const snapshot=()=>({routeId:d.routeId,network:'testnet',chainId:d.chainHex,observedAt:clock,block:{number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:clock},codes:{...d.codeSha256},pool:{address:d.pool,denomination:d.denomination,levels:20,root:commitment,nextIndex:1,commitments:[commitment],deposits:[{index:0,commitment}],withdrawals:[],inputBalance:'1000000'},source:{owner:operatorAddress,inputBalance:'5000000'},venue:{address:d.adapter,inputAmount:d.denomination,outputAmount:d.outputAmount,outputBalance:'8000000'}});
 const operatorState=async()=>({accountId:operatorId,address:operatorAddress,engineVerified:true,maxGas:'1000000000000000',gasReady:true,allowance});
 const fundingJournal={read:async()=>structuredClone(fundingState),write:async value=>{if(fundingWriteFails)throw Error('Fixture first journal write failed');fundingState=structuredClone(value);}};
 const funding=createAuroraFundingService({operatorId,operatorAddress,journal:fundingJournal,signer:coordinator,serialize:coordinator.serialize,now:()=>clock,random:size=>new Uint8Array(size).fill(3),rpc:{snapshot:async()=>snapshot(),operatorState,send:coordinator.send,transaction:coordinator.transaction,settle:coordinator.settle}});
 const plan={beneficiary:'0x'+'34'.repeat(20),refundRecipient:'0x'+'34'.repeat(20),relayer:'0x'+'00'.repeat(20),relayerFee:'0',minOutput:'2000000',deadline:String(clock/1000+300),salt:'0x'+'56'.repeat(32)},vault=auroraVaultAddress(plan),root=commitment,nullifierHash='0x'+'02'.repeat(32),proof='0x'+'00'.repeat(256),publicSignals=[root,nullifierHash,vault,'0','0','0'].map(value=>BigInt(value).toString()),id='aurora-swap:'+'a'.repeat(64),artifactId='aurora-proof:'+keccak256(toUtf8Bytes(JSON.stringify({intentId:id,proof,publicSignals}))).slice(2),request={id,artifactId,plan,vault,root,nullifierHash,proof,publicSignals};
 let fundedVault=true;
 const swap=createAuroraSwapService({operatorId,operatorAddress,journal:{read:async()=>structuredClone(swapState),write:async value=>{swapState=structuredClone(value);}},signer:coordinator,serialize:coordinator.serialize,now:()=>clock,rpc:{snapshot:async()=>snapshot(),operatorState,send:coordinator.send,transaction:coordinator.transaction,settle:coordinator.settle,
  swapState:async()=>{const observed=snapshot();if(fundedVault)observed.pool.withdrawals.push({recipient:vault,nullifierHash,relayer:plan.relayer,fee:'0'});return {snapshot:observed,factoryVault:vault,factoryBindingsVerified:true,knownRoot:true,spent:fundedVault,proofValid:true,simulateValid:true,beneficiaryOutputBalance:'0',beneficiaryInputBalance:'0',vault:{deployed:fundedVault,status:fundedVault?0:null,bindingsVerified:true,inputToken:d.inputToken,outputToken:d.outputToken,adapter:d.adapter,inputAmount:d.denomination,minOutput:plan.minOutput,deadline:plan.deadline,beneficiary:plan.beneficiary,refundRecipient:plan.refundRecipient,chainId:String(d.chainId),inputBalance:fundedVault?d.denomination:'0',outputBalance:'0',allowance:'0'}};}
 }});
 function authorize(review){return {review,signed:{standard:'nep413',payload:structuredClone(review.payload),public_key:user.getPublicKey().toString(),signature:'ed25519:'+base58.encode(user.sign(nep413Hash(review.payload)).signature)}};}
 return {funding,swap,coordinator,owner,commitment,request,authorize,async grant(){return authorize(await funding.prepare({owner,commitment}));},locallyAuthorizedGrant(){return authorize(buildAuroraFundingReview(owner,{commitment,nonce:base64.encode(new Uint8Array(32).fill(4)),deadline:clock+300000},{now:clock}));},advance:duration=>{clock+=duration;},lose:value=>{lost=value;},reveal:value=>{reveal=value;},fundedVault:value=>{fundedVault=value;},failFundingWrite:value=>{fundingWriteFails=value;},counts:()=>({nativeSigns,sends}),state:()=>({sponsor:structuredClone(sponsorState),funding:structuredClone(fundingState),swap:structuredClone(swapState)})};
}

test('a verified funded vault keeps recovery access after new swap intake is exhausted',async()=>{
 const f=fixture({swapDailyLimit:1});await f.coordinator.reserveWorkflow({id:'aurora-request:'+'b'.repeat(64),kind:'swap'});assert.equal((await f.coordinator.capacity('swap')).available,false);
 assert.equal((await f.swap.reconcile(f.request)).recovery.operation,'recover');
 const recovered=await f.swap.recover({request:f.request,operation:'recover'});assert.equal(recovered.verified,false);assert.deepEqual(f.counts(),{nativeSigns:1,sends:1});
 const rows=Object.values(f.state().sponsor.workflows);assert.equal(rows.filter(row=>row.retained).length,1);
});

test('an unspent expired proof remains subject to new swap intake limits',async()=>{
 const f=fixture({swapDailyLimit:1});f.fundedVault(false);f.advance(301000);await f.coordinator.reserveWorkflow({id:'aurora-request:'+'b'.repeat(64),kind:'swap'});
 assert.equal((await f.swap.reconcile(f.request)).recovery.operation,'withdrawRefund');await assert.rejects(f.swap.recover({request:f.request,operation:'withdrawRefund'}),/daily swap intake/);assert.deepEqual(f.counts(),{nativeSigns:0,sends:0});
});

test('a fresh owner grant reserves, dispatches and releases one complete funding workflow',async()=>{
 const f=fixture(),request=await f.grant();assert.deepEqual(f.counts(),{nativeSigns:0,sends:0});assert.equal(Object.keys(f.state().sponsor.workflows??{}).length,0);
 const result=await f.funding.submit(request);assert.equal(result.funded,true);assert.equal(result.deposit.commitment,f.commitment);assert.deepEqual(f.counts(),{nativeSigns:3,sends:3});
 const row=f.state().sponsor.workflows[auroraFundingStorageId(request.review)];assert.equal(row.actions,3);assert.equal(row.gas,'1600000000000000');assert.equal(row.usedActions,3);assert.equal(row.usedGas,'1600000000000000');assert.equal(row.released,true);assert.equal(f.state().sponsor.completed.length,3);
 for(const method of ['submit','reconcile','resume'])assert.deepEqual(await f.funding[method](request),result);assert.deepEqual(f.counts(),{nativeSigns:3,sends:3});
});

test('an interrupted grant keeps cleanup capacity across midnight and exhausted new intake',async()=>{
 const f=fixture({fundingDailyLimit:1}),request=await f.grant();f.lose(true);f.reveal(false);assert.equal((await f.funding.submit(request)).state,'pending');const initial=f.state().sponsor.workflows[auroraFundingStorageId(request.review)];
 f.advance(86400000);const before=f.counts();assert.equal((await f.funding.reconcile(request)).state,'pending');assert.deepEqual(f.counts(),before);
 f.reveal(true);await f.funding.reconcile(request);await f.coordinator.reserveWorkflow({id:'aurora-funds:'+'b'.repeat(64),kind:'funding'});assert.equal((await f.coordinator.capacity('funding')).available,false);assert.deepEqual(f.counts(),before);
 f.lose(false);const cleaned=await f.funding.cleanup(request);assert.equal(cleaned.cancelled,true);assert.equal(cleaned.cleanupComplete,true);assert.equal(cleaned.funded,false);assert.deepEqual(f.counts(),{nativeSigns:2,sends:2});
 const row=f.state().sponsor.workflows[auroraFundingStorageId(request.review)];assert.equal(row.day,initial.day);assert.equal(row.released,true);assert.equal(row.usedActions,2);assert.equal(row.usedGas,'600000000000000');assert.deepEqual(await f.funding.reconcile(request),cleaned);assert.deepEqual(f.counts(),{nativeSigns:2,sends:2});
});

test('a service refuses a first grant when the sponsor cannot retain its complete workflow',async()=>{
 const f=fixture({completed:98}),request=f.locallyAuthorizedGrant(),initial=f.state();assert.equal((await f.funding.configuration()).available,false);await assert.rejects(f.funding.submit(request),/unavailable/);assert.deepEqual(f.counts(),{nativeSigns:0,sends:0});assert.deepEqual(f.state(),initial);
});

test('expired cancellation releases a reservation whose grant row never persisted',async()=>{
 const f=fixture(),request=await f.grant();f.failFundingWrite(true);await assert.rejects(f.funding.submit(request),/first journal write failed/);assert.deepEqual(f.counts(),{nativeSigns:0,sends:0});assert.equal(Object.keys(f.state().funding.grants).length,0);
 f.failFundingWrite(false);f.advance(301000);const cancelled=await f.funding.cleanup(request);assert.equal(cancelled.cancelled,true);assert.equal(cancelled.cleanupComplete,true);assert.equal(f.state().sponsor.workflows[auroraFundingStorageId(request.review)].released,true);assert.deepEqual(f.counts(),{nativeSigns:0,sends:0});
});

test('another owner reusing a nonce cannot release the original unused reservation',async()=>{
 const f=fixture(),request=await f.grant(),originalKey=auroraFundingStorageId(request.review);f.failFundingWrite(true);await assert.rejects(f.funding.submit(request),/first journal write failed/);f.failFundingWrite(false);
 const other=KeyPair.fromRandom('ed25519'),review=buildAuroraFundingReview(auroraFundingOwner(other.getPublicKey().toString()),{nonce:request.review.payload.nonce,deadline:request.review.deadline,commitment:'0x'+'02'.repeat(32)},{now:request.review.deadline-300000});
 const signed={standard:'nep413',payload:structuredClone(review.payload),public_key:other.getPublicKey().toString(),signature:'ed25519:'+base58.encode(other.sign(nep413Hash(review.payload)).signature)};
 assert.equal(review.id,request.review.id);assert.notEqual(auroraFundingStorageId(review),originalKey);f.advance(301000);assert.equal((await f.funding.cleanup({review,signed})).cancelled,true);assert.equal(f.state().sponsor.workflows[originalKey].released,false);
 assert.equal((await f.funding.cleanup(request)).cancelled,true);assert.equal(f.state().sponsor.workflows[originalKey].released,true);assert.deepEqual(f.counts(),{nativeSigns:0,sends:0});
});

test('failed runtime initialization releases its journal lock before configuration can be corrected',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'lenz-runtime-initialization-test-')),operatorId='runtime-initialization-fixture.testnet',keyFile=join(directory,'operator.json'),originalLimit=process.env.LENZ_AURORA_FUNDING_DAILY_LIMIT;
 assert(resolve(directory).startsWith(resolve(tmpdir())+sep));t.after(async()=>{await rm(directory,{recursive:true,force:true});});
 await writeFile(keyFile,JSON.stringify({accountId:operatorId,privateKey:KeyPair.fromRandom('ed25519').toString()}),{mode:0o600});
 try{process.env.LENZ_AURORA_FUNDING_DAILY_LIMIT='0';await assert.rejects(openAuroraSponsorRuntime({deployerKeyFile:keyFile,operatorId,engineCodeHash:base58.encode(new Uint8Array(32).fill(3))}),/bounded private sponsor budget is invalid/);}
 finally{if(originalLimit===undefined)delete process.env.LENZ_AURORA_FUNDING_DAILY_LIMIT;else process.env.LENZ_AURORA_FUNDING_DAILY_LIMIT=originalLimit;}
 await assert.rejects(stat(join(directory,'aurora-sponsor-'+operatorId,'run.lock')),{code:'ENOENT'});
});
