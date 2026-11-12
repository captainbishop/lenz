import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPaymentReviewService } from './payment-review.mjs';
import { validateMemos } from './payment-memos.mjs';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const summary = { fee:'10000', change:'98990000', address:'test-recipient' };
const effects = {status:'verified',version:6,pool:'ironwood',amount:'1000000',fee:'10000',change:'98990000',inputValue:'100000000',recipient:summary.address,changeOwned:true,commitmentsVerified:true,noteEncryptionVerified:true,canSign:false,canSend:false};
const recipientHex = Buffer.concat([Buffer.from('Public synthetic memo'),Buffer.alloc(491)]).toString('hex');
const changeHex = 'f6' + '00'.repeat(511);
async function fixture(memos) {
  const directory = await mkdtemp(join(tmpdir(),'lenz-memos-'));
  const options = {directory,prepare:async(_,value,file)=>{await writeFile(file,'unsigned');return summary;},memos:memos??(async()=>({...effects,pcztSha256:sha('unsigned'),memos:{recipient:{hex:recipientHex},change:{hex:changeHex}},ufvk:'must never escape'}))};
  const service=createPaymentReviewService(options),{review}=await service('prepare',{wallet:'a',amount:'0.01'});
  return {directory,options,service,input:{wallet:'a',id:review.id}};
}
test('authenticated exact memos are shown only on explicit inspection and confirmation saves their binding without raw content',async()=>{
  const f=await fixture(), inspected=await f.service('memos',f.input);
  assert.equal(inspected.review.memos.status,'inspected');
  assert.equal(inspected.memoInspection.recipient.hex.length,1024);
  assert.equal(inspected.memoInspection.recipient.text,'Public synthetic memo');
  assert.equal(inspected.memoInspection.change.format,'empty');
  assert.equal(inspected.memoInspection.pcztSha256,sha('unsigned'));
  assert(!JSON.stringify(inspected).includes('must never escape'));
  const confirmed=await f.service('memo-confirm',{...f.input,binding:inspected.review.memos.binding});
  assert.equal(confirmed.review.memos.status,'confirmed');
  assert.equal(confirmed.review.canSign,false);assert.equal(confirmed.review.canSend,false);
  const restarted=createPaymentReviewService({...f.options,memos:()=>assert.fail('must not inspect automatically')});
  assert.deepEqual(await restarted('status',{wallet:'a'}),confirmed);
  const saved=await readFile(join(f.directory,'current.json'),'utf8');
  for(const raw of ['Public synthetic memo',recipientHex,changeHex,'must never escape'])assert(!saved.includes(raw),'Raw memo or extra native material was persisted');
  assert(!Object.hasOwn(confirmed,'memoInspection'));
});
test('same payment amounts with different authenticated memo padding require a different confirmation',async()=>{
  let change=false;
  const f=await fixture(async()=>({...effects,pcztSha256:sha('unsigned'),memos:{recipient:{hex:change?recipientHex.slice(0,-2)+'01':recipientHex},change:{hex:changeHex}}}));
  const first=await f.service('memos',f.input);await f.service('memo-confirm',{...f.input,binding:first.review.memos.binding});
  change=true;const second=await f.service('memos',f.input);
  assert.notEqual(second.review.memos.binding,first.review.memos.binding);
  await assert.rejects(f.service('memo-confirm',{...f.input,binding:first.review.memos.binding}),/Inspect these exact memos again/);
  const status=await f.service('status',{wallet:'a'});assert.equal(status.review.memos.status,'unavailable');assert.equal(status.review.state,'ready');
});
test('a changed-and-restored file cannot bind another parsed transaction to the saved request',async()=>{
  const f=await fixture(async(_,file)=>{
    await writeFile(file,'different authenticated memo transaction');
    const parsedHash=sha(await readFile(file));await writeFile(file,'unsigned');
    return {...effects,pcztSha256:parsedHash,memos:{recipient:{hex:recipientHex},change:{hex:changeHex}}};
  });
  await assert.rejects(f.service('memos',f.input),/Inspected transaction differs/);
  const status=await f.service('status',{wallet:'a'});assert.equal(status.review.memos.status,'unavailable');assert.equal(status.review.id,f.input.id);
});
test('memo confirmation is rejected after service restart until the exact bytes are explicitly reopened',async()=>{
  const f=await fixture(),inspected=await f.service('memos',f.input);
  const restart=createPaymentReviewService(f.options);
  await assert.rejects(restart('memo-confirm',{...f.input,binding:inspected.review.memos.binding}),/Inspect these exact memos again/);
  const opened=await restart('memos',f.input);const confirmed=await restart('memo-confirm',{...f.input,binding:opened.review.memos.binding});
  assert.equal(confirmed.review.memos.status,'confirmed');
});
test('wrong review or account and interrupted inspection invalidate consent without deleting unsigned evidence',async()=>{
  const f=await fixture(),inspected=await f.service('memos',f.input);
  await f.service('memo-confirm',{...f.input,binding:inspected.review.memos.binding});
  for(const input of [{...f.input,id:'wrong'},{...f.input,wallet:'b'}])await assert.rejects(f.service('memos',input),/matching completed review/);
  assert.equal((await f.service('status',{wallet:'a'})).review.memos.status,'unavailable');
  let release;const g=await fixture(()=>new Promise(resolve=>{release=resolve;})),controller=new AbortController();
  const pending=g.service('memos',g.input,{signal:controller.signal});while(!release)await new Promise(resolve=>setTimeout(resolve,5));
  controller.abort();release({...effects,pcztSha256:sha('unsigned'),memos:{recipient:{hex:recipientHex},change:{hex:changeHex}}});
  await assert.rejects(pending,/interrupted/);
  assert.equal((await g.service('status',{wallet:'a'})).review.memos.status,'unavailable');
  assert.equal(await readFile(join(g.directory,g.input.id+'.pczt'),'utf8'),'unsigned');
});
test('a failed saved-file hash check invalidates memo consent even if the original unsigned file is restored later',async()=>{
  const f=await fixture(),inspected=await f.service('memos',f.input);await f.service('memo-confirm',{...f.input,binding:inspected.review.memos.binding});
  const file=join(f.directory,f.input.id+'.pczt');await writeFile(file,'changed');
  await assert.rejects(f.service('status',{wallet:'a'}),/Saved transaction changed/);await writeFile(file,'unsigned');
  assert.equal((await f.service('status',{wallet:'a'})).review.memos.status,'unavailable');
});
test('ZIP 302 display preserves UTF-8 bytes and distinguishes no memo, empty text, binary and unsupported encodings',()=>{
  const review={id:'12345678-1234-1234-1234-123456789abc',wallet:'a',value:1000000,summary,sha256:sha('unsigned')};
  const inspect=hex=>validateMemos({...effects,pcztSha256:review.sha256,memos:{recipient:{hex},change:{hex:changeHex}}},review).inspection.recipient;
  const bom=Buffer.alloc(512);bom.set([0xef,0xbb,0xbf,0x41]);
  assert(inspect(bom.toString('hex')).text==='\ufeffA','UTF-8 BOM was silently removed from displayed memo');
  assert.equal(inspect('00'.repeat(512)).format,'text');assert.equal(inspect('00'.repeat(512)).text,'');
  assert.equal(inspect(changeHex).format,'empty');assert.equal(inspect('ff'+'00'.repeat(511)).format,'binary');
  assert.equal(inspect('f6'+'01'+'00'.repeat(510)).format,'unsupported');assert.equal(inspect('c0af'+'00'.repeat(510)).format,'invalid-text');
});
test('old saved review fields never expose raw memos and incompatible memo records reopen unreviewed without rewriting evidence',async()=>{
  const f=await fixture(),file=join(f.directory,'current.json'),old=JSON.parse(await readFile(file));
  old.memos={status:'confirmed',version:0,text:'old private memo',recipient:{hex:recipientHex},change:{hex:changeHex}};
  await writeFile(file,JSON.stringify(old));const original=await readFile(file,'utf8');
  const reopened=await createPaymentReviewService(f.options)('status',{wallet:'a'});
  assert(reopened.review.memos.status==='unreviewed' && Object.keys(reopened.review.memos).length===1,'Incompatible memo record was exposed');
  assert(!JSON.stringify(reopened).includes('old private memo'));assert.equal(await readFile(file,'utf8'),original);
});
test('a missing saved PCZT invalidates memo consent before restored evidence can be reopened',async()=>{
  const f=await fixture(),inspected=await f.service('memos',f.input);await f.service('memo-confirm',{...f.input,binding:inspected.review.memos.binding});
  const file=join(f.directory,f.input.id+'.pczt');await unlink(file);await assert.rejects(f.service('status',{wallet:'a'}));await writeFile(file,'unsigned');
  assert.equal((await f.service('status',{wallet:'a'})).review.memos.status,'unavailable');
});
