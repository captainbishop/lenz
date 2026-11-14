import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTransfer,recheckTransfer,validateReview,inspectTransfer} from './public/evm-transfer.js';
import {transferFixture,txHash} from './evm-transfer-fixtures.mjs';
import {createTransferService} from './public/evm-transfer-service.js';
import {memoryJournal} from './evm-transfer-fixtures.mjs';
const token={id:'0x'+'56'.repeat(20),symbol:'MEME',decimals:6};
test('an imported ERC20 can be reviewed, sent and recovered without its inventory entry',async()=>{
 const f=transferFixture(),input={...f.input,asset:token.id,token,amount:'12.345678'};
 const review=await prepareTransfer(f.lease,input);
 assert.equal(review.version,2);assert.deepEqual(review.token,token);assert.equal(review.terms.units,'0xbc614e');
 assert.equal(review.transaction.to,token.id);assert.equal(review.transaction.value,'0x0');
 const restored=validateReview(JSON.parse(JSON.stringify(review))),memory=memoryJournal(),service=createTransferService(memory);
 const sent=await service.send(f.lease,restored);assert.equal(sent.state,'submitted');
 assert.equal((await inspectTransfer(f.lease,restored,txHash)).state,'confirmed');assert.equal(f.state.sends,1);
});
test('imported metadata and balances are rechecked before signing',async()=>{
 for(const change of [f=>f.state.decimals=18,f=>f.state.tokenBalance=1n,f=>f.state.account='0x'+'78'.repeat(20),f=>f.state.chainId='0x2105']){
  const f=transferFixture(),review=await prepareTransfer(f.lease,{...f.input,asset:token.id,token});change(f);
  await assert.rejects(recheckTransfer(f.lease,review));assert.equal(f.state.sends,0);
 }
 const f=transferFixture();for(const bad of [{...token,id:f.token()},{...token,decimals:37},{...token,symbol:'ETH\u202e'}])await assert.rejects(prepareTransfer(f.lease,{...f.input,asset:token.id,token:bad}));
 const r=await prepareTransfer(f.lease,{...f.input,asset:token.id,token});r.token.id=f.token();assert.throws(()=>validateReview(r));
});
