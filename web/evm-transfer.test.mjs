import test from 'node:test';
import assert from 'node:assert/strict';
import {address,units,amount,prepareTransfer,recheckTransfer,validateReview,inspectTransfer} from './public/evm-transfer.js';
import {createTransferService} from './public/evm-transfer-service.js';
import {validateTransferRow} from './public/evm-transfer-store.js';
import {transferFixture,memoryJournal,to,txHash} from './evm-transfer-fixtures.mjs';
test('address checksum, integer precision and explicit public consent are enforced',async()=>{
 assert.equal(address('0x52908400098527886E0F7030069857D2E4169EE7'),'0x52908400098527886e0f7030069857d2e4169ee7');
 assert.throws(()=>address('0x52908400098527886E0F7030069857D2E4169Ee7'));
 assert.equal(amount(units('1.000000000000000001',18)),'1.000000000000000001');
 for(const value of ['-1','1e18','01','0','.5','1.0000001'])assert.throws(()=>units(value,6));
 const f=transferFixture();await assert.rejects(prepareTransfer(f.lease,{...f.input,publicConsent:false}));assert.equal(f.calls.length,0);
 await assert.rejects(prepareTransfer(f.lease,{...f.input,extra:'hidden'}));assert.equal(f.calls.length,0);
});
test('native review binds exact fields, nonce and gas without sending',async()=>{
 const f=transferFixture(),r=await f.review();assert.equal(r.transaction.to,to);assert.equal(amount(r.transaction.value),'1.25');assert.equal(r.transaction.data,'0x');assert.equal(r.transaction.gas,'0x6270');assert.equal(f.state.sends,0);
 for(const field of ['to','from','value','chainId','data']){const changed=structuredClone(r);changed.transaction[field]=field==='chainId'?'0x2105':'0x1';assert.throws(()=>validateReview(changed));}
});
test('ERC20 review checks decimals, balance and exact transfer calldata',async()=>{
 const f=transferFixture();f.input.asset=f.token();f.input.amount='2.500001';const r=await f.review();assert.equal(r.transaction.to,f.token());assert.equal(r.transaction.value,'0x0');assert(r.transaction.data.startsWith('0xa9059cbb'));assert.equal(r.transaction.data.length,138);assert.equal(amount(r.terms.units,6),'2.500001');
 f.state.decimals=18;await assert.rejects(f.review(),/decimals/);f.state.decimals=6;f.state.tokenBalance=1n;await assert.rejects(f.review(),/balance/);
});
test('changed balance, nonce, account, network, fee, gas or expiry blocks before signing',async()=>{
 for(const mutate of [f=>f.state.balance='0x1',f=>f.state.nonce='0x1',f=>f.state.account=to,f=>f.state.chainId='0x2105',f=>f.state.gasPrice='0x77359400',f=>f.state.gas='0x100000',f=>f.state.alive=false]){
  const f=transferFixture(),r=await f.review();mutate(f);await assert.rejects(recheckTransfer(f.lease,r));assert.equal(f.state.sends,0);
 }
 const f=transferFixture(),r=await f.review();await assert.rejects(recheckTransfer(f.lease,r,{now:r.expiresAt}),/expired/);
});
test('storage failure and a changed session after durable save prevent wallet dispatch',async()=>{
 const f=transferFixture(),r=await f.review(),service=createTransferService({read:async()=>[],update:async()=>{throw Error('disk failure');}});await assert.rejects(service.send(f.lease,r),/disk/);assert.equal(f.state.sends,0);
 const memory=memoryJournal(),other=createTransferService({...memory,update:async op=>{const result=await memory.update(op);f.state.alive=false;return result;}});
 assert.equal((await other.send(f.lease,r)).state,'not_sent');assert.equal(f.state.sends,0);
});
test('durable record precedes the wallet prompt; repeated and concurrent sends cannot duplicate it',async()=>{
 const f=transferFixture(),r=await f.review(),memory=memoryJournal(),service=createTransferService(memory),send=f.lease.sendTransaction;
 f.lease.sendTransaction=async tx=>{const rows=await memory.read();assert.equal(rows.length,1);assert.equal(rows[0].state,'awaiting_wallet');return send(tx);};
 const results=await Promise.allSettled([service.send(f.lease,r),service.send(f.lease,r)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.state.sends,1);
 await assert.rejects(service.send(f.lease,r),/earlier transfer/);assert.equal(f.state.sends,1);
});
test('wallet rejection is distinct from unknown RPC failure and malformed hash',async()=>{
 for(const [reply,state]of [[()=>{throw Object.assign(Error('no'),{code:4001});},'declined'],[()=>{throw Error('lost response');},'unknown'],[()=>Promise.resolve('garbage'),'unknown']]){
  const f=transferFixture(),memory=memoryJournal(),service=createTransferService(memory);f.lease.sendTransaction=reply;const result=await service.send(f.lease,await f.review());assert.equal(result.state,state);validateTransferRow(result);
 }
});
test('timeout preserves uncertainty and a late hash updates the same durable attempt',async()=>{
 const f=transferFixture(),memory=memoryJournal(),service=createTransferService({...memory,timeoutMs:10});let resolve;f.lease.sendTransaction=()=>new Promise(r=>resolve=r);
 const result=await service.send(f.lease,await f.review());assert.equal(result.state,'unknown');await assert.rejects(service.send(f.lease,result.review),/earlier/);
 resolve(txHash);await new Promise(r=>setTimeout(r,10));const rows=await memory.read();assert.equal(rows.length,1);assert.equal(rows[0].hash,txHash);assert.equal(rows[0].state,'submitted');
});
test('matching canonical finalized receipt confirms; inclusion alone is not finality',async()=>{
 const f=transferFixture(),memory=memoryJournal(),service=createTransferService(memory),sent=await service.send(f.lease,await f.review());
 f.state.finalized=false;assert.equal((await service.reconcile(f.lease,sent.id)).state,'included');f.state.finalized=true;assert.equal((await service.reconcile(f.lease,sent.id)).state,'confirmed');assert.equal(f.state.sends,1);
});
test('mismatched transactions, receipts, gas and reorgs cannot confirm',async()=>{
 for(const alter of [f=>f.state.transaction.to=f.state.transaction.from,f=>f.state.transaction.nonce='0x2',f=>f.state.transaction.input='0x1234',f=>f.state.receipt.transactionHash='0x'+'ef'.repeat(32),f=>f.state.receipt.gasUsed='0xffffff',f=>f.state.transaction.chainId='0x2105']){
  const f=transferFixture(),r=await f.review();f.mine(r.transaction);alter(f);await assert.rejects(inspectTransfer(f.lease,r,txHash));
 }
 const f=transferFixture(),r=await f.review();f.mine(r.transaction);f.state.hook=method=>method==='eth_getBlockByNumber'?{hash:'0x'+'99'.repeat(32),number:'0x2a',transactions:[txHash]}:undefined;assert.equal((await inspectTransfer(f.lease,r,txHash)).state,'pending');
});
test('token confirmation requires the exact Transfer event; reverted transaction records failure',async()=>{
 const f=transferFixture();f.input.asset=f.token();const r=await f.review();f.mine(r.transaction);assert.equal((await inspectTransfer(f.lease,r,txHash)).state,'confirmed');f.state.receipt.logs=[];await assert.rejects(inspectTransfer(f.lease,r,txHash),/not reported/);f.state.receipt.status='0x0';assert.equal((await inspectTransfer(f.lease,r,txHash)).state,'failed');
});
test('hash recovery requires matching included transaction and never sends again',async()=>{
 const f=transferFixture(),memory=memoryJournal(),service=createTransferService(memory);f.lease.sendTransaction=async tx=>{f.state.sends++;f.mine(tx);throw Error('reply lost');};
 const sent=await service.send(f.lease,await f.review());assert.equal(sent.state,'unknown');assert.equal((await service.reconcile(f.lease,sent.id,txHash)).state,'confirmed');assert.equal(f.state.sends,1);
 const wrong={...f.lease,identity:{...f.lease.identity,address:to}};await assert.rejects(service.reconcile(wrong,sent.id,txHash),/original account/);
});
