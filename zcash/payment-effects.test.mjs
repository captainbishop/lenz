import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPaymentReviewService } from './payment-review.mjs';
import { validateEffects } from './payment-effects.mjs';
const summary = { fee:'10000',change:'98990000',address:'test-recipient' };
const verified = {status:'verified',version:6,pool:'ironwood',amount:'1000000',fee:'10000',change:'98990000',inputValue:'100000000',recipient:summary.address,changeOwned:true,commitmentsVerified:true,noteEncryptionVerified:true,canSign:false,canSend:false};
async function fixture(effects = async () => verified) {
  const directory = await mkdtemp(join(tmpdir(),'lenz-effects-')); let calls = 0;
  const options = { directory, prepare:async(_,value,file)=>{await writeFile(file,'unsigned');return summary;},
    effects:async(...args)=>{calls++;return effects(...args);} };
  const service = createPaymentReviewService(options), {review} = await service('prepare',{wallet:'a',amount:'0.01'});
  return { directory, service, options, input:{wallet:'a',id:review.id}, calls:()=>calls };
}
test('output checks bind every value and capability, and strip unexpected native fields',()=>{
  assert.deepEqual(validateEffects({...verified,ufvk:'private viewing material'},{value:1000000,summary}),verified);
  for(const change of [{amount:'2'},{fee:'1'},{change:'2'},{change:'98989999',inputValue:'99999999'},{inputValue:'2'},{recipient:'other'},{changeOwned:false},{commitmentsVerified:false},{noteEncryptionVerified:false},{noteEncryptionVerified:undefined},{canSign:true},{canSend:true},{pool:'orchard'},{version:5}]) assert.throws(()=>validateEffects({...verified,...change},{value:1000000,summary}));
});
test('matching review is checked once, survives restart and does not enable signing',async()=>{
  const f=await fixture();
  for(const input of [{...f.input,id:'wrong'},{...f.input,wallet:'b'}])await assert.rejects(f.service('effects',input),/matching/);
  assert.equal(f.calls(),0);const result=await f.service('effects',f.input);assert.equal(result.review.effects.status,'verified');
  assert.equal(result.review.canSign,false);assert.equal(result.review.canSend,false);
  const restart=createPaymentReviewService({...f.options,effects:()=>assert.fail('must not run automatically')});
  assert.deepEqual(await restart('status',{wallet:'a'}),result);
  assert.deepEqual(await restart('prepare',{wallet:'a',amount:'0.01'}),result);assert.equal(f.calls(),1);
});
test('changed PCZT bytes are rejected before native work and after a racing file change',async()=>{
  const f=await fixture();await writeFile(join(f.directory,f.input.id+'.pczt'),'tampered');
  await assert.rejects(f.service('effects',f.input),/Saved transaction changed/);assert.equal(f.calls(),0);
  const g=await fixture(async(_,file)=>{await writeFile(file,'raced');return verified;});
  await assert.rejects(g.service('effects',g.input),/changed during check/);
  for(const x of [f,g])assert.equal(JSON.parse(await readFile(join(x.directory,'current.json'))).effects.status,'unavailable');
});
test('checking is persisted before native I/O and excludes discard or another check',async()=>{
  let release;const f=await fixture(()=>new Promise(r=>{release=r;})), pending=f.service('effects',f.input);
  while(!release)await new Promise(r=>setTimeout(r,5));
  assert.equal(JSON.parse(await readFile(join(f.directory,'current.json'))).effects.status,'checking');
  await assert.rejects(f.service('discard',f.input),/already running/);
  await assert.rejects(f.service('effects',f.input),/already running/);release(verified);await pending;
});
test('native failure or mismatched result invalidates a previous success without deleting the request',async()=>{
  let mode=0;const f=await fixture(async()=>{if(mode===1)throw Error('native failed');return mode===2?{...verified,changeOwned:false}:mode===3?{...verified,noteEncryptionVerified:false}:verified;});
  await f.service('effects',f.input);
  for(mode of [1,2,3]) {
    await assert.rejects(f.service('effects',f.input));
    const result=await f.service('status',{wallet:'a'});assert.equal(result.review.effects.status,'unavailable');assert.equal(result.review.id,f.input.id);
    assert.equal(await readFile(join(f.directory,f.input.id+'.pczt'),'utf8'),'unsigned');
  }
});
test('discarded requests cannot be checked',async()=>{const f=await fixture();await f.service('discard',f.input);await assert.rejects(f.service('effects',f.input),/matching/);assert.equal(f.calls(),0);});
test('older saved output checks reopen without claiming note encryption or rewriting private evidence',async()=>{
  const f=await fixture();await f.service('effects',f.input);
  const path=join(f.directory,'current.json'),old=JSON.parse(await readFile(path));delete old.effects.noteEncryptionVerified;
  await writeFile(path,JSON.stringify(old));const bytes=await readFile(path,'utf8');
  const restarted=createPaymentReviewService({...f.options,effects:()=>assert.fail('must not run automatically')});
  const result=await restarted('status',{wallet:'a'});
  assert.equal(result.review.effects.status,'verified');assert.equal(result.review.effects.noteEncryptionVerified,false);
  assert.equal(result.review.id,f.input.id);assert.equal(result.review.canSign,false);assert.equal(result.review.canSend,false);
  assert.equal(await readFile(path,'utf8'),bytes);
  await restarted('discard',f.input);assert.equal(await readFile(join(f.directory,f.input.id+'.pczt'),'utf8'),'unsigned');
});
