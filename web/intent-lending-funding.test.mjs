import test from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,Transaction,Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';
import {createLendingFundingService,checkLendingFundingRequest} from './intent-lending-funding.mjs';
const address=d=>'0x'+d.repeat(40),hash=d=>'0x'+d.repeat(64),scalar=d=>'0x'+'0'.repeat(63)+d;
const sponsor=new Wallet('0x'+'19'.repeat(32)),now=1800000000000;
const config={...LENDING_TESTNET,lendingFactory:address('1'),privacyPool:address('2'),codeHashes:Object.fromEntries(['pool','link','usdc','aLink','variableDebt','lendingFactory','privacyPool'].map(key=>[key,hash('9')]))};
const input={owner:'a'.repeat(64),ownerAddress:address('8'),account:address('6'),commitment:scalar('3')};
const abi=new Interface(['function approve(address,uint256) returns(bool)','function deposit(bytes32)','event Approval(address indexed owner,address indexed spender,uint256 value)','event Transfer(address indexed from,address indexed to,uint256 value)','event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)']);
function fixture(){
  let stored={version:1,requests:{},pending:null},receipt=null,nonce=3,block=100,heldFinal=null;const sent=[],signed=[],fence=[],receipts=new Map();
  const snapshot={chainId:config.chain,observedAt:now,block:{number:String(block),hash:hash('a'),timestamp:String(now/1000),finality:'finalized',requireCanonical:true},routeVerified:true,trust:{executionPinsVerified:true,codePinsVerified:true,implementationPinsVerified:true},account:{status:'verified',address:input.account,owner:input.ownerAddress,codeHash:hash('8'),route:{chainId:config.chain,factory:config.lendingFactory,...Object.fromEntries(['pool','link','usdc','aLink','variableDebt'].flatMap(key=>[[key,config[key]],[key+'CodeHash',config.codeHashes[key]]]))}},privatePool:{address:config.privacyPool,inputBalance:'0',commitments:[]}};
  const observed={snapshot,operator:{address:sponsor.address.toLowerCase(),inputBalance:'100000000000000000000',allowance:'0'},deposited:false,deposit:null};
  const journal={read:async()=>structuredClone(stored),write:async value=>{stored=structuredClone(value);}};
  const rpc={fundingSnapshot:async(_input,{blockTag='finalized'}={})=>{const value=structuredClone(blockTag==='finalized'&&heldFinal?heldFinal:observed);value.snapshot.block.finality=blockTag;return value;},sponsorState:async()=>({chainId:'11155111',address:sponsor.address.toLowerCase(),nonce:String(nonce),balance:'100000000000000000',maxFeePerGas:'1000000000',maxPriorityFeePerGas:'100000000'}),simulateFunding:async()=>true,send:async raw=>{sent.push(raw);receipt=null;return Transaction.from(raw).hash;},receipt:async tx=>structuredClone(receipts.get(tx)??null),transaction:async()=>null,block:async number=>({number,hash:hash('b')})};
  const signer={signTransaction:async tx=>{const raw=await sponsor.signTransaction({...tx,nonce:Number(tx.nonce)});signed.push(raw);return raw;}};
  const sponsorFence={assertAvailable:async()=>{},reserve:async id=>{fence.push(['reserve',id]);},release:async id=>{fence.push(['release',id]);}};
  const make=(options={})=>createLendingFundingService({config,rpc,signer,journal,sponsorFence,sponsorAddress:sponsor.address.toLowerCase(),now:()=>now,...options});
  const log=(contract,name,args)=>({address:contract,...abi.encodeEventLog(abi.getEvent(name),args)});
  function finalize(success=true){
    const tx=Transaction.from(sent.at(-1)),operation=abi.parseTransaction({data:tx.data});block++;nonce++;const logs=[];
    if(success&&operation.name==='approve'){observed.operator.allowance=operation.args[1].toString();logs.push(log(config.link,'Approval',[sponsor.address,config.privacyPool,operation.args[1]]));}
    if(success&&operation.name==='deposit'){
      observed.operator.allowance='0';observed.operator.inputBalance=(BigInt(observed.operator.inputBalance)-BigInt(config.denomination)).toString();observed.deposited=true;snapshot.privatePool.inputBalance=config.denomination;snapshot.privatePool.commitments=[input.commitment];
      observed.deposit={commitment:input.commitment,index:0,blockNumber:String(block),blockHash:hash('b'),transactionHash:tx.hash,logIndex:'1'};
      logs.push(log(config.link,'Transfer',[sponsor.address,config.privacyPool,config.denomination]),log(config.privacyPool,'Deposit',[input.commitment,0,BigInt(now/1000)]));
    }
    receipt={transactionHash:tx.hash,from:sponsor.address.toLowerCase(),to:tx.to.toLowerCase(),blockNumber:'0x'+block.toString(16),blockHash:hash('b'),status:success?'0x1':'0x0',logs};receipts.set(tx.hash,receipt);snapshot.block.number=String(block+1);
  }
  return{make,rpc,journal,signer,sponsorFence,snapshot,observed,sent,signed,fence,finalize,stored:()=>stored,setReceipt:value=>{receipt=value;if(value)receipts.set(value.transactionHash,value);},receipt:()=>receipt,holdFinality:()=>{heldFinal=structuredClone(observed);},releaseFinality:()=>{heldFinal=null;},removeReceipt:tx=>receipts.delete(tx)};
}

test('one faucet gift funds its original commitment only after exact approval, deposit and cleanup finality',async()=>{
  assert.deepEqual(checkLendingFundingRequest(input),input);
  const f=fixture();let result=await f.make().submit(input);assert.equal(result.verified,false);assert.equal(f.sent.length,1);
  await f.make().submit(input);assert.equal(f.sent.length,1);
  f.finalize();result=await f.make().reconcile(input);assert.equal(result.continuationAvailable,true);assert.notEqual(f.stored().pending,null);
  await f.make().resume(input);assert.equal(abi.parseTransaction({data:Transaction.from(f.sent[1]).data}).name,'deposit');
  f.finalize();assert.equal((await f.make().reconcile(input)).verified,false);await f.make().resume(input);
  assert.equal(abi.parseTransaction({data:Transaction.from(f.sent[2]).data}).args[1],0n);
  f.finalize();result=await f.make().reconcile(input);assert.equal(result.status,'funded');assert.equal(result.evidence.commitment,input.commitment);assert.equal(result.evidence.amount,config.denomination);assert.equal(result.evidence.allowance,'0');assert.equal(f.stored().pending,null);assert.equal(f.signed.length,3);
});

test('canonical included stages advance promptly while the original grant stays unverified until every receipt is finalized',async()=>{
  const f=fixture();f.holdFinality();await f.make().submit(input);f.finalize();
  assert.equal((await f.make().reconcile(input)).continuationAvailable,true);assert.equal(Object.values(f.stored().requests)[0].stages[0].finalized,false);
  await f.make().resume(input);f.finalize();await f.make().resume(input);f.finalize();
  const pending=await f.make().reconcile(input);assert.equal(pending.verified,false);assert.equal(pending.continuationAvailable,false);assert.notEqual(f.stored().pending,null);assert.equal(f.sent.length,3);
  f.releaseFinality();assert.equal((await f.make().reconcile(input)).status,'funded');assert.equal(f.stored().pending,null);
});

test('a reorged included predecessor reuses its original bytes without creating replacement authority',async()=>{
  const f=fixture();f.holdFinality();await f.make().submit(input);f.finalize();await f.make().resume(input);
  const original=Transaction.from(f.sent[0]);f.removeReceipt(original.hash);f.observed.operator.allowance='0';
  const state=await f.make().reconcile(input);assert.equal(state.continuationAvailable,false);assert.equal(state.resubmissionSafe,true);
  await f.make().resume(input);assert.equal(f.sent[2],f.sent[0]);assert.equal(f.signed.length,2);assert.notEqual(f.stored().pending,null);
});

test('a failed original deposit clears the allowance without crediting or replacing the note',async()=>{
  const f=fixture();await f.make().submit(input);f.finalize();await f.make().resume(input);f.finalize(false);
  assert.equal((await f.make().reconcile(input)).nextOperation,'clear');assert.equal(f.observed.operator.allowance,config.denomination);
  await f.make().resume(input);f.finalize();const outcome=await f.make().reconcile(input);
  assert.equal(outcome.status,'failed');assert.equal(outcome.verified,false);assert.equal(f.observed.operator.allowance,'0');assert.equal(f.stored().pending,null);
  await assert.rejects(f.make().submit({...input,commitment:scalar('4')}),/already/);
});

test('wrong identity, reused commitment and injected secret fields cannot consume faucet inventory',async()=>{
  for(const bad of [{...input,secret:'1'},{...input,commitment:'0x'+'f'.repeat(64)},{...input,ownerAddress:address('7')}]){
    const f=fixture();await assert.rejects(f.make().submit(bad));assert.equal(f.signed.length,0);assert.equal(f.sent.length,0);
  }
  const f=fixture();await f.make().submit(input);await assert.rejects(f.make().submit({...input,owner:'b'.repeat(64),account:address('7')}),/already/);assert.equal(f.sent.length,1);
});

test('wrong allowance, altered signature or failed durable write cannot broadcast the grant',async()=>{
  for(const change of [f=>{f.observed.operator.allowance='1';},f=>{f.signer.signTransaction=async tx=>sponsor.signTransaction({...tx,to:address('9'),nonce:Number(tx.nonce)});},f=>{const write=f.journal.write;f.journal.write=async state=>{if(Object.values(state.requests)[0]?.stages[0]?.transaction)throw Error('disk full');await write(state);};}]){
    const f=fixture();change(f);await assert.rejects(f.make().submit(input));assert.equal(f.sent.length,0);
  }
});

test('missing token transfer or conflicting canonical receipt cannot advance a deposit or release its fence',async()=>{
  for(const tamper of [f=>{f.setReceipt({...f.receipt(),logs:f.receipt().logs.filter(log=>log.address!==config.link)});},f=>{f.rpc.block=async number=>({number,hash:hash('c')});}]){
    const f=fixture();await f.make().submit(input);f.finalize();await f.make().resume(input);f.finalize();tamper(f);
    await assert.rejects(f.make().reconcile(input));assert.notEqual(f.stored().pending,null);assert.equal(f.sent.length,2);
  }
});

test('unknown grant broadcast remains fenced and explicit resume never replays a known pending transaction',async()=>{
  const f=fixture();f.rpc.send=async raw=>{f.sent.push(raw);throw Error('lost response');};await f.make().submit(input);
  const tx=Transaction.from(f.sent[0]);f.rpc.transaction=async()=>({hash:tx.hash,from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),input:tx.data,value:'0x0'});
  assert.equal((await f.make().reconcile(input)).resubmissionSafe,false);await f.make().resume(input);assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);
});

test('latest observations cannot pass the finalized initial-account check and grant count stays capped',async()=>{
  const f=fixture();f.rpc.fundingSnapshot=async()=>({...structuredClone(f.observed),snapshot:{...structuredClone(f.snapshot),block:{...f.snapshot.block,finality:'latest'}}});
  await assert.rejects(f.make().submit(input),/canonical/);assert.equal(f.sent.length,0);
  assert.throws(()=>f.make({maxGrants:21}),/bounded/);assert.throws(()=>f.make({maxGas:'100000000',maxFeePerGas:'100000000'}),/bounded/);
});
