import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaymentReviewService, reviewAmount, inspectReview } from './payment-review.mjs';
const address = JSON.parse(await readFile(new URL('./address-b-results.json', import.meta.url))).orchardAddress;
const txid = 'a'.repeat(64);
const text = `2 Ironwood actions:\n- 0:\n  - Spend: 100000000 zatoshis\n  - Output: 1000000 zatoshis to ${address}\n- 1:\n  - Spend: Zero value (likely a dummy)\n  - Output: 98990000 zatoshis\n\nTxID: ${txid}\nVersion: V6`;
const fixture = async (prepare) => {
  const directory = await mkdtemp(join(tmpdir(), 'lenz-unsigned-review-')); let calls = 0;
  const native = async (wallet, value, file) => { calls++; await writeFile(file, 'private unsigned fixture'); if (prepare) await prepare(); return { ...inspectReview(text, value, address), recipient: 'b', address, walletHeight: 10 }; };
  return { directory, service: createPaymentReviewService({ directory, prepare: native }), native, calls: () => calls };
};
test('decimal input is exact and rejects scientific notation, oversized amounts and extra precision', () => {
  assert.equal(reviewAmount('0.00000001'),1); assert.equal(reviewAmount('0.1'),10000000); assert.equal(reviewAmount('0.01000000'),1000000);
  for (const value of ['0','0.0','0.10000001','0.000000001','1e-2','-0.1','1',' 0.01',0.01]) assert.throws(()=>reviewAmount(value));
});
test('review parser rejects wrong recipients, wrong amounts, extra pools and excessive fees', () => {
  assert.equal(inspectReview(text,1000000,address).fee,'10000');
  for (const changed of [text.replace(address,'utest1wrong'),text.replace('Output: 1000000','Output: 1000001'),text+'\n1 transparent output',text.replace('98990000','98989999'),text.replace('V6','V5')]) assert.throws(()=>inspectReview(changed,1000000,address));
});
test('saved review survives service restart and identical retry without another native preparation',async()=>{
  const f=await fixture(),one=await f.service('prepare',{wallet:'a',amount:'0.01'});
  const restarted=createPaymentReviewService({directory:f.directory,prepare:()=>assert.fail('must reuse saved transaction')});
  assert.deepEqual(await restarted('prepare',{wallet:'a',amount:'0.0100'}),one);assert.equal(f.calls(),1);
  assert.equal(one.review.canSend,false);assert.equal(one.review.canSign,false);assert(!JSON.stringify(one).includes('private unsigned fixture'));
  await assert.rejects(restarted('prepare',{wallet:'a',amount:'0.02'}),/different amount/);
  await assert.rejects(restarted('status',{wallet:'b'}),/other test account/);
});
test('changed PCZT bytes fail instead of displaying a trusted saved review',async()=>{
  const f=await fixture(),r=await f.service('prepare',{wallet:'a',amount:'0.01'});
  await writeFile(join(f.directory,r.review.id+'.pczt'),'changed');
  await assert.rejects(f.service('status',{wallet:'a'}),/Saved transaction changed/);assert.equal(f.calls(),1);
});
test('discard requires the matching unsigned request and does not prepare another payment',async()=>{
  const f=await fixture(),r=await f.service('prepare',{wallet:'a',amount:'0.01'});
  await assert.rejects(f.service('discard',{wallet:'a',id:'wrong'}),/does not match/);
  await assert.rejects(f.service('discard',{wallet:'b',id:r.review.id}),/does not match/);
  assert.deepEqual(await f.service('discard',{wallet:'a',id:r.review.id}),{review:null});
  assert.deepEqual(await f.service('status',{wallet:'a'}),{review:null});assert.equal(f.calls(),1);
});
test('failed preparation stays visible across retry and never regenerates automatically',async()=>{
  const f=await fixture(()=>{throw Error('native failed');});await assert.rejects(f.service('prepare',{wallet:'a',amount:'0.01'}),/native failed/);
  const r=await f.service('prepare',{wallet:'a',amount:'0.01'});assert.equal(r.review.state,'failed');assert.equal(f.calls(),1);
});
test('concurrent preparations do not overlap',async()=>{
  let release;const f=await fixture(()=>new Promise(r=>release=r));const first=f.service('prepare',{wallet:'a',amount:'0.01'});
  while(!release)await new Promise(r=>setTimeout(r,5));
  await assert.rejects(f.service('prepare',{wallet:'a',amount:'0.01'}),/already running/);release();await first;assert.equal(f.calls(),1);
});
