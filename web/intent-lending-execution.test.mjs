import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Interface, Transaction } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { createLendingService } from './intent-lending-service.mjs';
import { buildLendingPermissionReview, lendingPermissionDigest } from './public/intent-lending-account.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';

const owner = new Wallet('0x' + '12'.repeat(32)), sponsor = new Wallet('0x' + '34'.repeat(32));
const address = digit => '0x' + digit.repeat(40), hash = digit => '0x' + digit.repeat(64);
const factory = address('1'), account = address('2'), accountHash = hash('2'), receiptHash = hash('3');
const now = 1_800_000_000_000;
const config = { ...LENDING_TESTNET, lendingFactory: factory, codeHashes: { lendingFactory: hash('1'), pool: hash('1'), link: hash('1'), usdc: hash('1'), aLink: hash('1'), variableDebt: hash('1') } };
const route = { chainId:config.chain, factory, pool:config.pool, link:config.link, usdc:config.usdc, aLink:config.aLink, variableDebt:config.variableDebt, poolCodeHash:hash('1'), linkCodeHash:hash('1'), usdcCodeHash:hash('1'), aLinkCodeHash:hash('1'), variableDebtCodeHash:hash('1') };
const events = new Interface(['event Executed(uint256 indexed nonce,bytes32 indexed digest,uint8 action,uint256 amount,address recipient,uint256 result)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
function request(action = 0, nonce = '0', recipient = account) {
  const terms = { action, nonce, deadline:String(now / 1000 + 300), amount:action === 2 ? '100000000000000000' : '5000000', recipient,
    minResult:action === 2 ? '100000000000000000' : '5000000', maxDebt:action === 0 ? '6000000' : '0', minHealthFactor:action === 1 ? '0' : '2000000000000000000', maxBorrowRateRay:action === 0 ? '1000000000000000000000000000' : '0' };
  const review = buildLendingPermissionReview({lenzIdentity:'a'.repeat(64),chainId:config.chain,ownerAddress:owner.address.toLowerCase(),account,accountId:account,route,nonce,deployed:true},{kind:'Order',terms},{config,now});
  const digest = lendingPermissionDigest(review), signature = owner.signingKey.sign(digest).serialized.toLowerCase();
  return { review, signed:{type:'lenz/lending-signed-permission/v1',reviewId:review.id,digest,signature,createdAt:now+1} };
}
function fixture() {
  let stored = {version:1,requests:{},pending:null}, sent = [], signed = [], receipt = null;
  const position = { freeLinkBaseUnits:'0',freeUsdcBaseUnits:'0',aLinkBalanceBaseUnits:'1000000000000000000',aLinkScaled:'1000000000000000000',variableDebtBaseUnits:'0',variableDebtScaled:'0',accountData:{totalCollateralBase:'3000000000',totalDebtBase:'0',availableBorrowsBase:'2100000000',healthFactorWad:'4500000000000000000'} };
  const snapshot = {chainId:config.chain,observedAt:now,block:{number:'100',hash:hash('4'),timestamp:String(now/1000),finality:'finalized',requireCanonical:true},routeVerified:true,trust:{codePinsVerified:true,implementationPinsVerified:true,executionPinsVerified:true},account:{status:'verified',address:account,owner:owner.address.toLowerCase(),nonce:'0',codeHash:accountHash,route,position},reserves:{USDC:{aToken:address('5'),active:true,frozen:false,paused:false,borrowingEnabled:true,variableBorrowRateRay:'100000000000000000000000000',availableLiquidityBaseUnits:'1000000000'},LINK:{aToken:config.aLink,active:true,frozen:false,paused:false}}};
  const rpc = {snapshot:async()=>structuredClone(snapshot),sponsorState:async()=>({chainId:'11155111',address:sponsor.address.toLowerCase(),nonce:'4',balance:'100000000000000000',maxFeePerGas:'1000000000',maxPriorityFeePerGas:'100000000'}),simulate:async()=>true,send:async raw=>{sent.push(raw);return Transaction.from(raw).hash;},receipt:async()=>structuredClone(receipt),block:async number=>({number,hash:receiptHash})};
  const signer = { signTransaction:async tx=>{const raw=await sponsor.signTransaction({...tx,nonce:Number(tx.nonce)});signed.push(raw);return raw;} };
  const journal = {read:async()=>structuredClone(stored),write:async value=>{stored=structuredClone(value);} };
  const make=()=>createLendingService({config,rpc,signer,journal,sponsorAddress:sponsor.address.toLowerCase(),now:()=>now+1000});
  function finalize(value) {
    const tx = Transaction.from(sent.at(-1));
    const event=events.encodeEventLog(events.getEvent('Executed'),[BigInt(value.review.terms.nonce),value.signed.digest,value.review.terms.action,BigInt(value.review.terms.amount),value.review.terms.recipient,BigInt(value.review.terms.amount)]);
    const transfer=events.encodeEventLog(events.getEvent('Transfer'),[address('5'),account,5000000n]);
    receipt={transactionHash:tx.hash,blockNumber:'0x65',blockHash:receiptHash,status:'0x1',from:sponsor.address.toLowerCase(),to:account,logs:[{address:account,...event},{address:config.usdc,...transfer}]};
    snapshot.block.number='102';snapshot.account.nonce='1';snapshot.account.position.freeUsdcBaseUnits='5000000';snapshot.account.position.variableDebtBaseUnits='5000000';snapshot.account.position.variableDebtScaled='5000000';
  }
  return {make,rpc,signer,journal,snapshot,sent,signed,finalize,stored:()=>stored,setReceipt:value=>{receipt=value;},receipt:()=>receipt};
}

test('an original owner-approved borrow is retained once and only finalized credit becomes success',async()=>{
  const f=fixture(),service=f.make(),original=request();
  assert.equal((await service.prepare(original.review)).execute,true);
  const pending=await service.submit(original);
  assert.equal(pending.verified,false);assert.equal(pending.status,'pending');assert.equal(f.sent.length,1);
  await service.submit(original);assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);
  f.finalize(original);
  const complete=await f.make().reconcile(original);
  assert.equal(complete.status,'executed');assert.equal(complete.verified,true);assert.equal(complete.evidence.amount,'5000000');assert.equal(complete.evidence.account,account);
  assert.equal(f.stored().pending,null);
});

test('lost broadcast responses retain one original transaction and explicit resume reuses its bytes',async()=>{
  const f=fixture(),original=request();let fail=true;
  f.rpc.send=async raw=>{f.sent.push(raw);if(fail)throw Error('lost response');return Transaction.from(raw).hash;};
  assert.equal((await f.make().submit(original)).status,'unknown');
  assert.equal(f.stored().pending,original.review.id);
  assert.equal((await f.make().reconcile(original)).verified,false);
  fail=false;await f.make().resume(original);
  assert.equal(f.sent.length,2);assert.equal(f.sent[0],f.sent[1]);assert.equal(f.signed.length,1);
});

test('invalid owner authority and changed sponsor calldata never reach broadcast',async()=>{
  const f=fixture(),original=request(),changed=structuredClone(original);changed.review.terms.amount='1';
  await assert.rejects(f.make().submit(changed),/review identity|bounds/);
  assert.equal(f.sent.length,0);
  f.signer.signTransaction=async tx=>sponsor.signTransaction({...tx,to:address('9'),nonce:Number(tx.nonce)});
  await assert.rejects(f.make().submit(original),/different lending terms/);
  assert.equal(f.sent.length,0);assert.equal(f.stored().pending,original.review.id);
  assert.equal((await f.make().submit(original)).status,'unknown');
});

test('a failed durable write after signing cannot release transaction bytes',async()=>{
  const f=fixture(),original=request(),write=f.journal.write;
  f.journal.write=async state=>{if(state.requests[original.review.id]?.transaction)throw Error('storage full');await write(state);};
  await assert.rejects(f.make().submit(original),/storage full/);
  assert.equal(f.sent.length,0);assert.equal(f.stored().pending,original.review.id);
  assert.equal((await f.make().reconcile(original)).status,'unknown');
});

test('mined receipts are pending until finalized and conflicting canonical hashes never become success',async()=>{
  const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);
  f.snapshot.block.number='100';assert.equal((await f.make().reconcile(original)).verified,false);
  f.snapshot.block.number='102';f.rpc.block=async number=>({number,hash:hash('9')});
  await assert.rejects(f.make().reconcile(original),/no longer canonical/);
  assert.equal(f.stored().pending,original.review.id);
});

test('a successful receipt without the original credited position cannot release the pending request',async()=>{
  const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);
  f.snapshot.account.position.freeUsdcBaseUnits='0';
  await assert.rejects(f.make().reconcile(original),/borrowed funds/);
  assert.equal(f.stored().pending,original.review.id);
});

test('later same-account activity reconciles the original borrow from its finalized receipt-block position',async()=>{
  const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);
  const receiptPosition=structuredClone(f.snapshot);receiptPosition.block.number='101';receiptPosition.block.hash=receiptHash;
  f.snapshot.account.nonce='2';f.snapshot.account.position.freeUsdcBaseUnits='0';f.snapshot.account.position.variableDebtBaseUnits='0';f.snapshot.account.position.variableDebtScaled='0';
  const reads=[];f.rpc.snapshotAt=async(selection,ref)=>{reads.push({selection,ref});return structuredClone(receiptPosition);};
  const result=await f.make().reconcile(original);
  assert.equal(result.verified,true);assert.equal(result.evidence.position.freeUsdcBaseUnits,'5000000');
  assert.deepEqual(reads,[{selection:{owner:owner.address.toLowerCase(),account},ref:{number:'0x65',hash:receiptHash}}]);
  assert.equal(f.stored().pending,null);assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);
});

test('the original finalized position can reconcile before any later permission without archive access',async()=>{
  const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);let historicalReads=0;
  f.rpc.snapshotAt=async()=>{historicalReads++;throw Error('Archive history unavailable');};
  assert.equal((await f.make().reconcile(original)).verified,true);assert.equal(historicalReads,0);assert.equal(f.stored().pending,null);assert.equal(f.sent.length,1);
});

test('interest after execution cannot invalidate the original receipt-time debt bound at the same nonce',async()=>{
  const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);
  const historical=structuredClone(f.snapshot);historical.block.number='101';historical.block.hash=receiptHash;historical.account.position.variableDebtBaseUnits='5000002';
  f.snapshot.account.position.variableDebtBaseUnits='6000001';f.rpc.snapshotAt=async()=>structuredClone(historical);
  const result=await f.make().reconcile(original);
  assert.equal(result.verified,true);assert.equal(result.evidence.position.variableDebtBaseUnits,'5000002');assert.equal(result.evidence.positionBlockNumber,'101');assert.equal(f.stored().pending,null);assert.equal(f.sent.length,1);
});

test('absent or changed receipt-block evidence keeps the original request unresolved after later activity',async()=>{
  const changes=[null,value=>value.block.hash=hash('9'),value=>value.block.number='102',value=>value.account.owner=address('9'),value=>value.account.codeHash=hash('9'),value=>value.account.nonce='2',value=>value.account.position.freeUsdcBaseUnits='0',value=>value.account.position.variableDebtScaled='0',value=>value.account.position.variableDebtBaseUnits='6000001'];
  for(const change of changes){
    const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);
    const historical=structuredClone(f.snapshot);historical.block.number='101';historical.block.hash=receiptHash;
    f.snapshot.account.nonce='2';
    if(change){change(historical);f.rpc.snapshotAt=async()=>structuredClone(historical);}
    await assert.rejects(f.make().reconcile(original));
    assert.equal(f.stored().pending,original.review.id);assert.equal(f.stored().requests[original.review.id].finalized,false);assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);
  }
});

test('a finalized reverted transaction remains failed and repeated submit never spends again',async()=>{
  const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);
  f.setReceipt({...f.receipt(),status:'0x0',logs:[]});f.snapshot.account.nonce='0';
  const result=await f.make().reconcile(original);assert.equal(result.verified,false);assert.match(result.evidence.description,/reverted/);
  assert.equal(f.stored().pending,null);await f.make().submit(original);assert.equal(f.sent.length,1);
});

test('a matching execution event without its exact underlying transfer cannot claim settlement',async()=>{
  const f=fixture(),original=request();await f.make().submit(original);f.finalize(original);
  f.setReceipt({...f.receipt(),logs:f.receipt().logs.slice(0,1)});
  await assert.rejects(f.make().reconcile(original),/underlying transfer/);
  assert.equal(f.stored().pending,original.review.id);
});

test('repay and withdrawal outcomes require their own debt, collateral and token movements',async()=>{
  for(const action of [1,2]) {
    const f=fixture(),original=request(action),p=f.snapshot.account.position;
    if(action===1){p.freeUsdcBaseUnits='5000000';p.variableDebtBaseUnits='5000000';p.variableDebtScaled='5000000';}
    await f.make().submit(original);f.finalize(original);
    const from=action===1?account:config.aLink,to=action===1?address('5'):account,asset=action===1?config.usdc:config.link;
    const movement=events.encodeEventLog(events.getEvent('Transfer'),[from,to,BigInt(original.review.terms.amount)]);
    f.setReceipt({...f.receipt(),logs:[f.receipt().logs[0],{address:asset,...movement}]});
    if(action===1){p.freeUsdcBaseUnits='0';p.variableDebtBaseUnits='0';p.variableDebtScaled='0';}
    else{p.freeUsdcBaseUnits='0';p.variableDebtBaseUnits='0';p.variableDebtScaled='0';p.freeLinkBaseUnits='100000000000000000';p.aLinkScaled='900000000000000000';}
    const result=await f.make().reconcile(original);assert.equal(result.verified,true);assert.equal(result.evidence.action,action);
  }
});

test('external borrow proceeds require the reviewed recipient payout in addition to account credit',async()=>{
  const f=fixture(),recipient=address('7'),original=request(0,'0',recipient);await f.make().submit(original);f.finalize(original);
  await assert.rejects(f.make().reconcile(original),/underlying transfer/);
  const payout=events.encodeEventLog(events.getEvent('Transfer'),[account,recipient,5000000n]);
  f.setReceipt({...f.receipt(),logs:[...f.receipt().logs,{address:config.usdc,...payout}]});f.snapshot.account.position.freeUsdcBaseUnits='0';
  assert.equal((await f.make().reconcile(original)).verified,true);
});
