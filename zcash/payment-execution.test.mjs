import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createShieldedPaymentService } from './payment-execution.mjs';
import { validateMemos } from './payment-memos.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const id = '12345678-1234-4234-8234-123456789abc';
const txid = 'a'.repeat(64);
const summary = { txid, fee:'10000', change:'98990000', totalDebit:'1010000', recipient:'b', address:'utest1' + 'q'.repeat(100) };
const effects = { status:'verified', version:6, pool:'ironwood', amount:'1000000', fee:'10000', change:'98990000', inputValue:'100000000', recipient:summary.address, changeOwned:true, commitmentsVerified:true, noteEncryptionVerified:true, canSign:false, canSend:false };
const freshness = { serverHeight:100, walletHeight:100, expiryHeight:150, targetHeight:101, branchMatches:true };
const ready = { network:'testnet', wallet:'a', txid, currentInputs:true, witnessVerified:true, walletHeight:100 };
const expired = terms => ({network:'testnet',wallet:'a',recipient:'b',pool:'ironwood',txid,status:'expired',verifier:'native-canonical-expiry/v1',signedSha256:terms.signedSha256,unsignedSha256:terms.unsignedSha256,expiryHeight:150,sourceHeight:160,recipientHeight:160,sourceCanonicalHash:'c'.repeat(64),recipientCanonicalHash:'d'.repeat(64),paymentAbsent:true,inputUnspent:true});
async function fixture(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lenz-shielded-execution-'));
  const reviewDirectory = join(directory, 'reviews');
  const executionDirectory = join(directory, 'executions');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(reviewDirectory);
  const record = { id, wallet:'a', value:1000000, state:'ready', createdAt:'2026-11-13T00:00:00.000Z', summary, sha256:sha('unsigned') };
  const descriptor = validateMemos({ ...effects, pcztSha256:record.sha256, memos:{ recipient:{hex:'f6'+'00'.repeat(511)}, change:{hex:'f6'+'00'.repeat(511)} } }, record).descriptor;
  record.memos = { ...descriptor, status:'confirmed', inspectedAt:record.createdAt, confirmedAt:record.createdAt };
  await writeFile(join(reviewDirectory, 'current.json'), JSON.stringify(record));
  await writeFile(join(reviewDirectory, id+'.pczt'), 'unsigned');
  const options = { reviewDirectory, directory:executionDirectory,
    check:async()=>freshness, effects:async()=>effects,
    preflight:async()=>ready,
    sign:async(_wallet, _file, output)=>{ await writeFile(output, 'signed'); return { txid }; },
    submit:async()=>({ txid }),
    observe:async()=>({ network:'testnet', wallet:'a', txid, status:'unknown' }),
    ...overrides,
  };
  return { directory, reviewDirectory, executionDirectory, record, options, service:createShieldedPaymentService(options), input:{wallet:'a',id} };
}

test('an explicit exact review signs once and restart retains the same signed transaction', async()=>{
  const f = await fixture();
  const opened = await f.service('review', f.input);
  assert.equal(opened.payment.state, 'reviewed');
  assert.equal(opened.payment.canSign, true);
  assert.equal(opened.payment.canSubmit, false);
  const signed = await f.service('sign', {...f.input, binding:opened.payment.binding});
  assert.equal(signed.payment.state, 'signed');
  assert.equal(signed.payment.txid, txid);
  assert.equal(signed.payment.canSign, false);
  assert.equal(signed.payment.canSubmit, true);
  const restarted = createShieldedPaymentService({...f.options,sign:()=>assert.fail('must not sign on restart')});
  assert.deepEqual(await restarted('status',f.input),signed);
  await assert.rejects(restarted('sign',{...f.input,binding:opened.payment.binding}),/already|review/i);
});

test('an unused signed payment retires only with canonical expiry and keeps its exact artifact after restart',async()=>{
 let signatures=0,submissions=0,checks=0;
 const f=await fixture({sign:async(_wallet,_file,output)=>{signatures++;await writeFile(output,'signed');return {txid};},submit:async()=>{submissions++;return {txid};},expire:async(wallet,file,terms,options)=>{checks++;assert.equal(wallet,'a');assert(file.endsWith(id+'.signed.pczt'));assert(options.unsignedFile.endsWith(id+'.pczt'));assert.equal(terms.signedSha256,sha('signed'));assert.equal(terms.unsignedSha256,sha('unsigned'));return expired(terms);}});
 const opened=await f.service('review',f.input),approval={...f.input,binding:opened.payment.binding};
 await f.service('sign',approval);const result=await f.service('reconcile',f.input);
 assert.equal(result.payment.state,'expired');assert.equal(result.payment.canSign,false);assert.equal(result.payment.canSubmit,false);assert.equal(result.payment.expiryEvidence.paymentAbsent,true);assert.equal(signatures,1);assert.equal(submissions,0);assert.equal(checks,1);
 const restarted=createShieldedPaymentService(f.options);assert.deepEqual(await restarted('status',f.input),result);assert.deepEqual(await restarted('reconcile',f.input),result);
 await assert.rejects(()=>restarted('submit',approval));await assert.rejects(()=>restarted('sign',approval));assert.equal(signatures,1);assert.equal(submissions,0);
});

test('unverified expiry or changed exact signature leaves an unused payment fenced',async()=>{
 for(const change of [value=>{value.sourceHeight=159;},value=>{value.recipientHeight=159;},value=>{value.expiryHeight=149;},value=>{value.paymentAbsent=false;},value=>{value.inputUnspent=false;},value=>{value.txid='9'.repeat(64);},value=>{value.signedSha256='8'.repeat(64);},value=>{value.sourceCanonicalHash='bad';},value=>{value.verifier='provider-claim';}]){
  const f=await fixture({expire:async(_wallet,_file,terms)=>{const value=expired(terms);change(value);return value;}});const opened=await f.service('review',f.input);await f.service('sign',{...f.input,binding:opened.payment.binding});
  await assert.rejects(()=>f.service('reconcile',f.input));assert.equal((await f.service('status',f.input)).payment.state,'signed');
 }
 const f=await fixture({expire:async()=>assert.fail('changed signature must not reach expiry check')});const opened=await f.service('review',f.input);await f.service('sign',{...f.input,binding:opened.payment.binding});await writeFile(join(f.executionDirectory,id+'.signed.pczt'),'changed');await assert.rejects(()=>f.service('reconcile',f.input),/Signed transaction changed/);
});

test('a lost submission reply survives restart as one unresolved payment without a replacement spend',async()=>{
  let attempts = 0;
  const f = await fixture({submit:async()=>{attempts++;throw Error('connection lost');}});
  const opened = await f.service('review',f.input);
  await f.service('sign',{...f.input,binding:opened.payment.binding});
  await assert.rejects(f.service('submit',{...f.input,binding:opened.payment.binding}),/connection lost/);
  const restarted = createShieldedPaymentService(f.options);
  const status = await restarted('status',f.input);
  assert.equal(status.payment.state,'unknown');
  assert.equal(status.payment.txid,txid);
  assert.equal(status.payment.canSubmit,false);
  await assert.rejects(restarted('submit',{...f.input,binding:opened.payment.binding}),/already attempted/);
  assert.equal((await restarted('reconcile',f.input)).payment.state,'unknown');
  assert.equal(attempts,1);
});

test('historical expiry/effects checks cannot sign without current input and witness readiness',async()=>{
  for (const change of [{currentInputs:false},{witnessVerified:false},{walletHeight:99},{txid:'b'.repeat(64)},{network:'mainnet'}]) {
    const f = await fixture({preflight:async()=>({...ready,...change}),sign:()=>assert.fail('no signature')});
    await assert.rejects(f.service('review',f.input),/readiness/);
    assert.equal((await f.service('status',f.input)).payment,null);
  }
  const f = await fixture();
  const disabled = createShieldedPaymentService({...f.options,preflight:undefined});
  await assert.rejects(disabled('review',f.input),/readiness is unavailable/);
});

test('expired reviews, changed outputs and unconfirmed memos never reach signing',async()=>{
  for(const overrides of [{check:async()=>({...freshness,expiryHeight:100})},{effects:async()=>({...effects,noteEncryptionVerified:false})}]) {
    const f=await fixture({...overrides,sign:()=>assert.fail('no signature')});
    await assert.rejects(f.service('review',f.input));
    assert.equal((await f.service('status',f.input)).payment,null);
  }
  const f=await fixture();f.record.memos.status='inspected';
  await writeFile(join(f.reviewDirectory,'current.json'),JSON.stringify(f.record));
  await assert.rejects(f.service('review',f.input),/confirm the exact memos/);
});

test('changing a reviewed transaction or its recipient invalidates the exact signing approval',async()=>{
  for(const change of ['bytes','recipient']) {
    const f=await fixture({sign:()=>assert.fail('no signature')});
    const opened=await f.service('review',f.input);
    if(change==='bytes')await writeFile(join(f.reviewDirectory,id+'.pczt'),'changed');
    else { f.record.summary={...summary,address:'utest1'+'p'.repeat(100)}; await writeFile(join(f.reviewDirectory,'current.json'),JSON.stringify(f.record)); }
    await assert.rejects(f.service('sign',{...f.input,binding:opened.payment.binding}));
    assert.equal((await f.service('status',f.input)).payment.canSign,false);
  }
});

test('signing approval expires and service restart requires an explicit fresh review',async()=>{
  let now=1000;
  const f=await fixture({now:()=>now,sign:()=>assert.fail('no signature')});
  const opened=await f.service('review',f.input);now+=120000;
  await assert.rejects(f.service('sign',{...f.input,binding:opened.payment.binding}),/Reopen/);
  now=200000;const again=await f.service('review',f.input);
  const restarted=createShieldedPaymentService(f.options);
  assert.equal((await restarted('status',f.input)).payment.canSign,false);
  await assert.rejects(restarted('sign',{...f.input,binding:again.payment.binding}),/Reopen/);
});

test('a clock rollback invalidates approval before any signature is created',async()=>{
  let now=1000;
  const f=await fixture({now:()=>now,sign:()=>assert.fail('no signature')});
  const opened=await f.service('review',f.input);now=999;
  assert.equal((await f.service('status',f.input)).payment.canSign,false);
  now=1001;
  assert.equal((await f.service('status',f.input)).payment.canSign,false);
  await assert.rejects(f.service('sign',{...f.input,binding:opened.payment.binding}),/Reopen/);
  assert.equal((await f.service('status',f.input)).payment.state,'reviewed');
});

test('a recently scanned canonical input snapshot survives ordinary head advancement',async()=>{
  let serverHeight=101;
  const f=await fixture({check:async()=>({...freshness,serverHeight,targetHeight:serverHeight+1}),
    preflight:async()=>({...ready,canonicalHeight:100,canonicalHash:'c'.repeat(64),serverHeight,maximumScanLag:10})});
  const opened=await f.service('review',f.input);
  assert.equal(opened.payment.canSign,true);
  serverHeight=103;
  const signed=await f.service('sign',{...f.input,binding:opened.payment.binding});
  assert.equal(signed.payment.state,'signed');assert.equal(signed.payment.txid,txid);
});

test('old or unbound canonical input snapshots cannot authorize a signature',async()=>{
  const canonical={...ready,canonicalHeight:100,canonicalHash:'c'.repeat(64),serverHeight:105,maximumScanLag:10};
  for(const change of [{canonicalHeight:99},{canonicalHash:'bad'},{serverHeight:104},{serverHeight:111},{maximumScanLag:100}]) {
    const f=await fixture({check:async()=>({...freshness,serverHeight:105,targetHeight:106}),preflight:async()=>({...canonical,...change}),sign:()=>assert.fail('no signature')});
    await assert.rejects(f.service('review',f.input),/canonical input snapshot/);
    assert.equal((await f.service('status',f.input)).payment,null);
  }
  const f=await fixture({preflight:async()=>({...canonical,serverHeight:111}),sign:()=>assert.fail('no signature')});
  await assert.rejects(f.service('review',f.input),/canonical input snapshot/);
});

test('a signing failure after artifact creation keeps unresolved authority and cannot sign again',async()=>{
  const f=await fixture({sign:async(_wallet,_file,output)=>{await writeFile(output,'signed');throw Error('native reply lost');}});
  const opened=await f.service('review',f.input);
  await assert.rejects(f.service('sign',{...f.input,binding:opened.payment.binding}),/native reply lost/);
  const restarted=createShieldedPaymentService(f.options);
  assert.equal((await restarted('status',f.input)).payment.state,'signing-unknown');
  await assert.rejects(restarted('review',f.input),/already has signing/);
  await assert.rejects(restarted('submit',{...f.input,binding:opened.payment.binding}),/Reconcile/);
});

test('explicit recovery verifies the saved signature without signing or submitting again',async()=>{
  const f=await fixture({sign:async(_wallet,_file,output)=>{await writeFile(output,'signed');throw Error('native reply lost');},
    recover:async(_wallet,_file,terms)=>{assert.equal(terms.signedSha256,sha('signed'));return{txid};},
    submit:()=>assert.fail('recovery cannot submit')});
  const opened=await f.service('review',f.input);
  await assert.rejects(f.service('sign',{...f.input,binding:opened.payment.binding}),/native reply lost/);
  const restarted=createShieldedPaymentService({...f.options,sign:()=>assert.fail('recovery cannot sign')});
  await assert.rejects(restarted('recover-signature',{...f.input,binding:'b'.repeat(64)}));
  assert.equal((await restarted('status',f.input)).payment.state,'signing-unknown');
  const recovered=await restarted('recover-signature',{...f.input,binding:opened.payment.binding});
  assert.equal(recovered.payment.state,'signed');
  assert.equal(recovered.payment.txid,txid);
  assert.equal(recovered.payment.canSubmit,true);
  await assert.rejects(restarted('recover-signature',{...f.input,binding:opened.payment.binding}));
  assert.deepEqual(await createShieldedPaymentService(f.options)('status',f.input),recovered);
});

test('invalid or changing signature recovery preserves unresolved signing state',async()=>{
  for(const change of ['txid','bytes','abort','unavailable']) {
    const controller=new AbortController();
    const f=await fixture({sign:async(_wallet,_file,output)=>{await writeFile(output,'signed');throw Error('native reply lost');},
      recover:change==='unavailable'?undefined:async(_wallet,file)=>{
        if(change==='bytes')await writeFile(file,'changed');
        if(change==='abort')controller.abort();
        return{txid:change==='txid'?'b'.repeat(64):txid};
      }});
    const opened=await f.service('review',f.input);
    await assert.rejects(f.service('sign',{...f.input,binding:opened.payment.binding}));
    const restarted=createShieldedPaymentService(f.options);
    await assert.rejects(restarted('recover-signature',{...f.input,binding:opened.payment.binding},{signal:controller.signal}));
    const status=await restarted('status',f.input);
    assert.equal(status.payment.state,'signing-unknown');
    assert.equal(status.payment.canSubmit,false);
  }
});

test('confirmed effects require the same transaction and exact debit/payout in both wallets',async()=>{
  const result={network:'testnet',wallet:'a',recipient:'b',pool:'ironwood',txid,status:'confirmed',minedHeight:101,recipientMinedHeight:101,sourceHeight:110,recipientHeight:110,sourceDelta:'1010000',recipientDelta:'1000000'};
  let observation=result;
  const f=await fixture({observe:async()=>observation});
  const opened=await f.service('review',f.input);
  await f.service('sign',{...f.input,binding:opened.payment.binding});
  await f.service('submit',{...f.input,binding:opened.payment.binding});
  for(const change of [{txid:'b'.repeat(64)},{recipient:'a'},{pool:'transparent'},{recipientMinedHeight:102},{sourceDelta:'1000000'},{recipientDelta:'1010000'},{sourceHeight:109}]) {
    observation={...result,...change};await assert.rejects(f.service('reconcile',f.input));
    assert.notEqual((await f.service('status',f.input)).payment.state,'confirmed');
  }
  observation=result;const confirmed=await f.service('reconcile',f.input);
  assert.equal(confirmed.payment.state,'confirmed');assert.equal(confirmed.payment.confirmations,10);
  observation={network:'testnet',wallet:'a',txid,status:'unknown'};
  const uncertain=await f.service('reconcile',f.input);
  assert.equal(uncertain.payment.state,'unknown');
  assert(!Object.hasOwn(uncertain.payment,'confirmations'));
});

test('different service instances exclude concurrent signatures on the same private journal',async()=>{
  let release,started;
  const waiting=new Promise(resolve=>started=resolve);
  const f=await fixture({sign:async(_wallet,_file,output)=>{started();await new Promise(resolve=>release=resolve);await writeFile(output,'signed');return{txid};}});
  const opened=await f.service('review',f.input);
  const pending=f.service('sign',{...f.input,binding:opened.payment.binding});await waiting;
  const other=createShieldedPaymentService(f.options);
  await assert.rejects(other('review',f.input),/running or needs interruption recovery/);
  assert.equal((await other('status',f.input)).payment.state,'signing');
  release();await pending;
  assert.equal((await other('status',f.input)).payment.state,'signed');
});

test('wrong account, extra arguments and changed signed bytes cannot submit',async()=>{
  let attempts=0;
  const f=await fixture({submit:async()=>{attempts++;return{txid};}});
  const opened=await f.service('review',f.input);
  await f.service('sign',{...f.input,binding:opened.payment.binding});
  for(const input of [{...f.input,wallet:'b',binding:opened.payment.binding},{...f.input,binding:opened.payment.binding,path:'foreign.pczt'},{...f.input,binding:'b'.repeat(64)}])await assert.rejects(f.service('submit',input));
  await writeFile(join(f.executionDirectory,id+'.signed.pczt'),'changed');
  await assert.rejects(f.service('submit',{...f.input,binding:opened.payment.binding}),/Signed transaction changed/);
  assert.equal(attempts,0);
});

test('losing connectivity during approval invalidates the in-memory signing lease',async()=>{
  const controller=new AbortController();
  const f=await fixture({check:async()=>{controller.abort();return freshness;},sign:()=>assert.fail('no signature')});
  await assert.rejects(f.service('review',f.input,{signal:controller.signal}),/interrupted/);
  assert.equal((await f.service('status',f.input)).payment,null);
});
