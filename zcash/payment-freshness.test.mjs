import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateFreshness } from './payment-freshness.mjs';
import { createPaymentReviewService } from './payment-review.mjs';
const observed = { serverHeight: 100, walletHeight: 100, expiryHeight: 150, targetHeight: 101, branchMatches: true };
async function fixture(check = async () => observed) {
  const directory = await mkdtemp(join(tmpdir(), 'lenz-expiry-'));
  let preparations = 0, checks = 0;
  const prepare = async (_, value, file) => { preparations++; await writeFile(file, 'unsigned fixture'); return { value }; };
  const options = { directory, prepare, check: async (...args) => { checks++; return check(...args); } };
  const service = createPaymentReviewService(options);
  const { review } = await service('prepare', { wallet: 'a', amount: '0.01' });
  return { directory, service, options, review, input: { wallet: 'a', id: review.id }, preparations: () => preparations, checks: () => checks };
}
test('expiry uses the next block, with an explicit near-expiry margin and network mismatch', () => {
  assert.equal(evaluateFreshness(observed).status, 'within-expiry');
  for (const [change, expected] of [
    [{expiryHeight:100},'expired'], [{expiryHeight:101},'expires-soon'],
    [{expiryHeight:120},'expires-soon'], [{expiryHeight:121},'within-expiry'],
    [{walletHeight:99},'wallet-behind'], [{walletHeight:101},'network-behind'],
    [{branchMatches:false},'network-changed']
  ]) assert.equal(evaluateFreshness({...observed,...change}).status,expected);
  for (const change of [{expiryHeight:0},{targetHeight:100},{branchMatches:'true'},{serverHeight:1.5},{walletHeight:NaN}]) assert.throws(()=>evaluateFreshness({...observed,...change}));
});
test('checking requires the saved wallet/id and preserves payment bytes and unsigned status', async () => {
  const f = await fixture();
  for (const input of [{wallet:'a',id:'wrong'},{wallet:'b',id:f.review.id}]) await assert.rejects(f.service('check',input),/matching/);
  assert.equal(f.checks(),0);
  const result = await f.service('check',f.input);
  assert.equal(result.review.freshness.status,'within-expiry');
  assert.equal(result.review.id,f.review.id); assert.equal(result.review.canSign,false); assert.equal(result.review.canSend,false);
  assert.equal(await readFile(join(f.directory,f.review.id+'.pczt'),'utf8'),'unsigned fixture');
  const restarted = createPaymentReviewService({...f.options,check:()=>assert.fail('no automatic check')});
  assert.deepEqual(await restarted('status',{wallet:'a'}),result);
  await restarted('prepare',{wallet:'a',amount:'0.01'});
  assert.equal(f.preparations(),1); assert.equal(f.checks(),1);
});
test('expired payments remain saved and are never automatically recreated or signed', async () => {
  const f = await fixture(async()=>({...observed,expiryHeight:100}));
  const r = await f.service('check',f.input);
  assert.equal(r.review.freshness.status,'expired'); assert.equal(r.review.canSign,false);
  assert.equal((await f.service('prepare',{wallet:'a',amount:'0.01'})).review.id,f.review.id);
  assert.equal(f.preparations(),1);
});
test('a failed recheck replaces previous success durably and retry uses the same payment', async () => {
  let fail = false;
  const f = await fixture(async()=>{if(fail)throw Error('provider failed');return observed;});
  await f.service('check',f.input);fail=true;
  await assert.rejects(f.service('check',f.input),/provider failed/);
  const restarted=createPaymentReviewService(f.options);
  assert.equal((await restarted('status',{wallet:'a'})).review.freshness.status,'unavailable');
  fail=false;assert.equal((await restarted('check',f.input)).review.freshness.status,'within-expiry');
  assert.equal(f.preparations(),1);assert.equal(f.checks(),3);
});
test('changed transaction bytes reject before contacting the network', async () => {
  const f=await fixture();await writeFile(join(f.directory,f.review.id+'.pczt'),'tampered');
  await assert.rejects(f.service('check',f.input),/Saved transaction changed/);assert.equal(f.checks(),0);
  assert.equal(JSON.parse(await readFile(join(f.directory,'current.json'))).freshness.status,'unavailable');
});
test('changing bytes during a check cannot publish a successful observation', async () => {
  const f=await fixture(async(_,file)=>{await writeFile(file,'changed during I/O');return observed;});
  await assert.rejects(f.service('check',f.input),/changed during check/);
  assert.equal(JSON.parse(await readFile(join(f.directory,'current.json'))).freshness.status,'unavailable');
});
test('a running check blocks discard and saves checking before network access', async () => {
  let release;
  const f=await fixture(()=>new Promise(resolve=>release=resolve)), pending=f.service('check',f.input);
  while(!release)await new Promise(r=>setTimeout(r,5));
  const persisted=JSON.parse(await readFile(join(f.directory,'current.json')));assert.equal(persisted.freshness.status,'checking');
  await assert.rejects(f.service('discard',f.input),/already running/);
  release(observed);await pending;
  await f.service('discard',f.input);await assert.rejects(f.service('check',f.input),/matching/);
  assert.equal(f.checks(),1);
});
