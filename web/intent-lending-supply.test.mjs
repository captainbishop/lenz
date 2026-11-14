import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Transaction, Interface } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { keccak256 } from './public/evm-vendor/offline-budget.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { buildLendingSupplyPreparation, lendingSupplySignals } from './public/intent-lending-supply.js';
import { createLendingSupplyService } from './intent-lending-supply.mjs';

const address = digit => '0x' + digit.repeat(40), hash = digit => '0x' + digit.repeat(64), scalar = digit => '0x' + '0'.repeat(63) + digit;
const sponsor = new Wallet('0x'+'17'.repeat(32)), now=1800000000000;
const config = { ...LENDING_TESTNET,lendingFactory:address('1'),privacyPool:address('2'),supplyFactory:address('3'),verifier:address('4'),hasher:address('5'),supplyVaultCreationCode:'0x60006000',codeHashes:Object.fromEntries(['pool','link','usdc','aLink','variableDebt','lendingFactory','privacyPool','supplyFactory','verifier','hasher'].map(key=>[key,hash('9')])) };
const plan = {beneficiary:address('6'),refundRecipient:address('6'),minScaledCredit:'900000000000000000',deadline:'1800000300',salt:hash('7')};
const events = new Interface(['event Supplied(address indexed beneficiary,uint256 inputAmount,uint256 scaledCredit)','event Refunded(address indexed recipient,uint256 inputAmount)','event Withdrawal(address to,bytes32 nullifierHash,address indexed relayer,uint256 fee)','event Transfer(address indexed from,address indexed to,uint256 value)']);
function original() {
  const p=buildLendingSupplyPreparation({ownerAddress:address('8'),plan,root:scalar('1'),nullifierHash:scalar('2')},{config}), proof='0x'+'ab'.repeat(256), publicSignals=lendingSupplySignals(p);
  const artifactId='lending-supply-proof:'+keccak256(new TextEncoder().encode(JSON.stringify({intentId:p.id,proof,publicSignals}))).slice(2);
  return {...p,artifactId,proof,publicSignals};
}
function fixture() {
  let time=now,stored={version:1,requests:{},pending:null},receipt=null; const sent=[],signed=[];
  const value=original(),route={chainId:config.chain,factory:config.lendingFactory,...Object.fromEntries(['pool','link','usdc','aLink','variableDebt'].flatMap(key=>[[key,config[key]],[key+'CodeHash',config.codeHashes[key]]]))};
  const snapshot={chainId:config.chain,observedAt:now,block:{number:'100',hash:hash('a'),timestamp:String(now/1000),finality:'finalized',requireCanonical:true},routeVerified:true,trust:{codePinsVerified:true,implementationPinsVerified:true,executionPinsVerified:true},account:{status:'verified',address:plan.beneficiary,owner:value.ownerAddress,codeHash:hash('8'),nonce:'0',route,position:{aLinkScaled:'100',freeLinkBaseUnits:'0'}},reserves:{LINK:{active:true,frozen:false,paused:false,oneNoteSupplyPossible:true}}};
  const observed={snapshot,knownRoot:true,spent:false,proofValid:true,vault:{address:value.vault,deployed:false,status:null,inputBalance:'0',allowance:'0',termsVerified:false},withdrawal:null};
  const journal={read:async()=>structuredClone(stored),write:async next=>{stored=structuredClone(next);}};
  const rpc={supplySnapshot:async()=>structuredClone(observed),sponsorState:async()=>({chainId:'11155111',address:sponsor.address.toLowerCase(),nonce:'3',balance:'100000000000000000',maxFeePerGas:'1000000000',maxPriorityFeePerGas:'100000000'}),simulate:async()=>true,send:async raw=>{sent.push(raw);return Transaction.from(raw).hash;},receipt:async()=>structuredClone(receipt),transaction:async()=>null,block:async number=>({number,hash:hash('b')})};
  const signer={signTransaction:async tx=>{const raw=await sponsor.signTransaction({...tx,nonce:Number(tx.nonce)});signed.push(raw);return raw;}};
  const make=(options={})=>createLendingSupplyService({config,rpc,signer,journal,sponsorAddress:sponsor.address.toLowerCase(),now:()=>time,...options});
  const log=(contract,name,args)=>({address:contract,...events.encodeEventLog(events.getEvent(name),args)});
  function deployed(status) { Object.assign(observed.vault,{deployed:true,status,termsVerified:true,inputToken:config.link,aavePool:config.pool,aToken:config.aLink,inputAmount:config.denomination,...plan,chainId:String(config.chainId),inputCodeHash:config.codeHashes.link,aavePoolCodeHash:config.codeHashes.pool,aTokenCodeHash:config.codeHashes.aLink}); }
  function finalize(status='executed',operation='fulfill') {
    deployed(status==='executed'?2:3);observed.spent=true;observed.vault.inputBalance='0';
    observed.withdrawal={nullifierHash:value.nullifierHash,recipient:value.vault,relayer:address('0'),fee:'0'};
    snapshot.block.number='102';snapshot.account.position.aLinkScaled=status==='executed'?'900000000000000100':'100';snapshot.account.position.freeLinkBaseUnits=status==='refunded'?config.denomination:'0';
    const logs=[];
    if(operation!=='recover') logs.push(log(config.privacyPool,'Withdrawal',[value.vault,value.nullifierHash,address('0'),0n]),log(config.link,'Transfer',[config.privacyPool,value.vault,config.denomination]));
    if(status==='executed') logs.push(log(config.link,'Transfer',[value.vault,config.aLink,config.denomination]),log(value.vault,'Supplied',[plan.beneficiary,config.denomination,plan.minScaledCredit]));
    else logs.push(log(config.link,'Transfer',[value.vault,plan.refundRecipient,config.denomination]),log(value.vault,'Refunded',[plan.refundRecipient,config.denomination]));
    receipt={transactionHash:Transaction.from(sent.at(-1)).hash,from:sponsor.address.toLowerCase(),to:config.supplyFactory,blockNumber:'0x65',blockHash:hash('b'),status:'0x1',logs};
  }
  return {value,make,rpc,signer,journal,snapshot,observed,sent,signed,finalize,deployed,stored:()=>stored,receipt:()=>receipt,setReceipt:value=>{receipt=value;},expire:()=>{time=now+301000;snapshot.observedAt=time;snapshot.block.timestamp=String(time/1000);}};
}

test('one original Supply is retained once and succeeds only after finality and scaled account credit',async()=>{
  const f=fixture(),service=f.make(),{artifactId,proof,publicSignals,...preparation}=f.value;
  assert.equal((await service.prepare(preparation)).execute,true);
  assert.equal((await service.submit(f.value)).status,'pending');await service.submit(f.value);
  assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);
  f.finalize();f.snapshot.block.number='100';assert.equal((await f.make().reconcile(f.value)).verified,false);
  f.snapshot.block.number='102';const result=await f.make().reconcile(f.value);
  assert.equal(result.status,'executed');assert.equal(result.evidence.scaledCredit,plan.minScaledCredit);assert.equal(result.evidence.beneficiary,plan.beneficiary);assert.equal(f.stored().pending,null);
});

test('lost broadcast responses keep the original fence and never sign or send a replacement',async()=>{
  const f=fixture(); f.rpc.send=async raw=>{f.sent.push(raw);throw Error('response lost');};
  assert.equal((await f.make().submit(f.value)).status,'unknown');
  assert.equal((await f.make().submit(f.value)).status,'unknown');
  assert.equal((await f.make().reconcile(f.value)).verified,false);
  await assert.rejects(f.make().recover({request:f.value,operation:'withdrawRefund'}),/pending|recovered/);
  assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);assert.equal(f.stored().pending.id,f.value.id);
});

test('wrong proof, original signal changes and false account ownership stop before signing',async()=>{
  for(const change of [f=>{f.observed.proofValid=false;},f=>{f.value.publicSignals[2]='1';},f=>{f.snapshot.account.owner=address('9');},f=>{f.observed.knownRoot=false;},f=>{f.observed.spent=true;}]) {
    const f=fixture();change(f);await assert.rejects(f.make().submit(f.value));assert.equal(f.signed.length,0);assert.equal(f.sent.length,0);
  }
});

test('a changed signed transaction or failed durable write keeps uncertainty fenced without broadcasting',async()=>{
  for(const changed of ['calldata','journal']) {
    const f=fixture();
    if(changed==='calldata') f.signer.signTransaction=async tx=>sponsor.signTransaction({...tx,to:address('9'),nonce:Number(tx.nonce)});
    else {const write=f.journal.write;f.journal.write=async state=>{if(state.requests[f.value.id]?.stages.at(-1)?.transaction)throw Error('disk full');await write(state);};}
    await assert.rejects(f.make().submit(f.value));assert.equal(f.sent.length,0);assert.equal(f.stored().pending.id,f.value.id);
    assert.equal((await f.make().submit(f.value)).verified,false);assert.equal(f.sent.length,0);
  }
});

test('wrong canonical receipt, missing token movements, low credit and lingering allowance cannot become success',async()=>{
  for(const change of [f=>{f.rpc.block=async number=>({number,hash:hash('c')});},f=>{f.setReceipt({...f.receipt(),logs:f.receipt().logs.filter(log=>log.address!==config.link)});},f=>{f.snapshot.account.position.aLinkScaled='100';},f=>{f.observed.vault.allowance='1';},f=>{f.observed.vault.beneficiary=address('9');}]) {
    const f=fixture();await f.make().submit(f.value);f.finalize();change(f);
    await assert.rejects(f.make().reconcile(f.value));assert.equal(f.stored().pending.id,f.value.id);
  }
});

test('an expired unspent note can refund only with its retained plan after an explicit status check',async()=>{
  const f=fixture();f.expire();
  await assert.rejects(f.make().submit(f.value),/deadline|unavailable/);
  await assert.rejects(f.make().recover({request:f.value,operation:'withdrawRefund'}),/Check the original/);
  const checked=await f.make().reconcile(f.value);assert.equal(checked.recovery,'withdrawRefund');
  await assert.rejects(f.make().recover({request:f.value,operation:'recover'}),/status/);
  const pending=await f.make().recover({request:f.value,operation:'withdrawRefund'});assert.equal(pending.status,'pending');
  f.finalize('refunded','withdrawRefund');const refunded=await f.make().reconcile(f.value);
  assert.equal(refunded.status,'refunded');assert.equal(refunded.evidence.refundAmount,config.denomination);assert.equal(refunded.evidence.refundRecipient,plan.beneficiary);
  await f.make().recover({request:f.value,operation:'withdrawRefund'});assert.equal(f.sent.length,1);
});

test('a mined failed fulfillment is reconciled before one original expiry refund is allowed',async()=>{
  const f=fixture();await f.make().submit(f.value);f.finalize();
  f.setReceipt({...f.receipt(),status:'0x0',logs:[]});f.observed.spent=false;f.observed.withdrawal=null;f.observed.vault.deployed=false;f.observed.vault.status=null;f.snapshot.account.position.aLinkScaled='100';
  assert.equal((await f.make().reconcile(f.value)).verified,false);assert.equal(f.stored().pending,null);
  f.expire();await f.make().reconcile(f.value);await f.make().recover({request:f.value,operation:'withdrawRefund'});
  assert.equal(f.sent.length,2);assert.equal(f.stored().requests[f.value.id].stages.length,2);
});

test('a direct original withdrawal is recovered only for the same note and vault',async()=>{
  for(const wrong of [true,false]) {
    const f=fixture();f.deployed(0);f.observed.spent=true;f.observed.vault.inputBalance=config.denomination;f.observed.withdrawal={nullifierHash:f.value.nullifierHash,recipient:wrong?address('9'):f.value.vault,relayer:address('0'),fee:'0'};
    const checked=await f.make().reconcile(f.value);
    if(wrong) {assert.equal(checked.recovery,null);await assert.rejects(f.make().recover({request:f.value,operation:'recover'}));assert.equal(f.sent.length,0);}
    else {assert.equal(checked.recovery,'recover');await f.make().recover({request:f.value,operation:'recover'});f.finalize('executed','recover');assert.equal((await f.make().reconcile(f.value)).status,'executed');}
  }
});

test('retained completion cannot be rewritten to claim another scaled credit or recipient',async()=>{
  for(const change of [row=>{row.outcome.evidence.scaledCredit='999999999999999999';},row=>{row.outcome.evidence.beneficiary=address('9');}]) {
    const f=fixture();await f.make().submit(f.value);f.finalize();await f.make().reconcile(f.value);
    const changed=structuredClone(f.stored());change(changed.requests[f.value.id]);await f.journal.write(changed);
    await assert.rejects(f.make().reconcile(f.value),/retained Supply outcome/);
  }
});

test('a final Supply event must satisfy the original minimum scaled credit',async()=>{
  const f=fixture();await f.make().submit(f.value);f.finalize();
  const changed=f.receipt();changed.logs[changed.logs.length-1]={address:f.value.vault,...events.encodeEventLog(events.getEvent('Supplied'),[plan.beneficiary,config.denomination,'1'])};f.setReceipt(changed);
  await assert.rejects(f.make().reconcile(f.value),/minimum/);assert.equal(f.stored().pending.id,f.value.id);
});

test('explicit resume replays only the retained bytes when the original transaction is unknown',async()=>{
  const f=fixture();await f.make().submit(f.value);assert.equal((await f.make().reconcile(f.value)).resubmissionSafe,true);await f.make().resume(f.value);
  assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);assert.equal(f.signed.length,1);
  const tx=Transaction.from(f.sent[0]);f.rpc.transaction=async()=>({hash:tx.hash,from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),input:tx.data,value:'0x0',blockHash:null});
  assert.equal((await f.make().reconcile(f.value)).resubmissionSafe,false);
  await f.make().resume(f.value);assert.equal(f.sent.length,2);
  f.finalize();f.snapshot.block.number='100';await f.make().resume(f.value);assert.equal(f.sent.length,2);
  f.snapshot.block.number='102';assert.equal((await f.make().resume(f.value)).verified,true);assert.equal(f.sent.length,2);
});

test('an expired original fulfillment cannot be resumed as a newly signed or changed operation',async()=>{
  const f=fixture();await f.make().submit(f.value);f.expire();
  assert.equal((await f.make().reconcile(f.value)).resubmissionSafe,false);
  await assert.rejects(f.make().resume(f.value),/deadline|unavailable/);assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);
});

test('a shared sponsor fence blocks Supply and retries only release after a saved final receipt',async()=>{
  const f=fixture();let releaseCalls=0;
  const sponsorFence={assertAvailable:async()=>{throw Error('another sponsor operation is pending');},reserve:async()=>{},release:async()=>{releaseCalls++;if(releaseCalls===1)throw Error('release write failed');}};
  assert.equal((await f.make({sponsorFence}).configuration()).available,false);
  await assert.rejects(f.make({sponsorFence}).submit(f.value),/another sponsor/);assert.equal(f.signed.length,0);
  sponsorFence.assertAvailable=async()=>{};await f.make({sponsorFence}).submit(f.value);f.finalize();
  await assert.rejects(f.make({sponsorFence}).reconcile(f.value),/release write/);assert.equal(f.stored().pending,null);
  assert.equal((await f.make({sponsorFence}).reconcile(f.value)).verified,true);assert.equal(releaseCalls,2);assert.equal(f.signed.length,1);assert.equal(f.sent.length,1);
});

test('cached submit and recovery also retry a completed sponsor fence release after restart',async()=>{
  for(const entry of ['submit','recover']) {
    const f=fixture();let releaseCalls=0;
    const sponsorFence={assertAvailable:async()=>{},reserve:async()=>{},release:async()=>{if(++releaseCalls===1)throw Error('release interrupted');}};
    await f.make({sponsorFence}).submit(f.value);f.finalize();await assert.rejects(f.make({sponsorFence}).reconcile(f.value));
    const result=entry==='submit'?await f.make({sponsorFence}).submit(f.value):await f.make({sponsorFence}).recover({request:f.value,operation:'withdrawRefund'});
    assert.equal(result.verified,true);assert.equal(releaseCalls,2);assert.equal(f.sent.length,1);
  }
});

test('a larger state gas allowance retains the original per-transaction sponsor cost cap',()=>{
  const f=fixture();assert.doesNotThrow(()=>f.make({maxGas:'50000000',maxFeePerGas:'5000000'}));
  assert.throws(()=>f.make({maxGas:'100000000',maxFeePerGas:'100000000'}),/bounded private Supply sponsor/);
});
