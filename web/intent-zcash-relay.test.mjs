import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPaymentReviewService} from '../zcash/payment-review.mjs';
import {createShieldedPaymentService} from '../zcash/payment-execution.mjs';
import {openZcashIntentRelay} from './intent-zcash-relay.mjs';
import {zcashTestSelection,zcashPaymentTerms} from './public/intent-zcash-plan.js';
const owner='native-zcash:a:'+'1'.repeat(64),recipient='utest1'+'q'.repeat(70),txid='a'.repeat(64);
async function setup(options={},nativeOptions={}){
 const stateDir=await mkdtemp(join(tmpdir(),'lenz-zcash-relay-')),backendConfigFile=join(stateDir,'backend.json');await writeFile(backendConfigFile,'{}');
 const effect={status:'verified',version:6,pool:'ironwood',amount:'1000000',fee:'10000',change:'98990000',inputValue:'100000000',recipient,changeOwned:true,commitmentsVerified:true,noteEncryptionVerified:true,canSign:false,canSend:false};
 const check=nativeOptions.check??(async()=>({serverHeight:100,walletHeight:100,expiryHeight:150,targetHeight:101,branchMatches:true}));
 const native={source:async wallet=>({wallet,accountId:wallet==='a'?owner:'native-zcash:b:'+'2'.repeat(64),address:wallet==='a'?'utest1'+'p'.repeat(70):recipient,balance:'100000000',walletHeight:100}),
  sync:nativeOptions.sync??(async()=>{}),
  createReview:({directory})=>createPaymentReviewService({directory,prepare:async(wallet,value,file)=>{nativeOptions.onPrepare?.();await writeFile(file,'unsigned');return {txid,fee:'10000',change:'98990000',totalDebit:'1010000',recipient:'b',address:recipient};},check,effects:async()=>effect,memos:async(_wallet,_file,record)=>({...effect,pcztSha256:record.sha256,memos:{recipient:{hex:'f6'+'00'.repeat(511)},change:{hex:'f6'+'00'.repeat(511)}}})}),
  createPayment:settings=>createShieldedPaymentService({...settings,check,effects:async()=>effect,preflight:async()=>({network:'testnet',wallet:'a',txid,currentInputs:true,witnessVerified:true,walletHeight:100}),sign:async(_wallet,_file,file)=>{await writeFile(file,'signed');return {txid};},recover:async()=>({txid}),submit:async()=>({txid}),observe:async()=>({network:'testnet',wallet:'a',txid,status:'unknown'}),expire:async()=>({network:'testnet',wallet:'a',txid,status:'unknown'}),...options})};
 const open=()=>openZcashIntentRelay({stateDir,backendConfigFile,openNative:async()=>native});
 return {stateDir,relay:await open(),open,chosen:zcashTestSelection(owner,recipient,'0.01')};
}
test('configured native review requires explicit signing and preserves the original signature after restart',async()=>{
 const f=await setup();try{const review=await f.relay.prepare(f.chosen);assert.equal((await f.relay.status({owner})).history[0].state,'reviewed');
 const authorization=await f.relay.authorize({review});assert.equal(authorization.txid,txid);assert.equal((await (await f.open()).recoverAuthorization({review:review,authorization:null})).artifactId,authorization.artifactId);
 await assert.rejects(()=>f.relay.authorize({review}),/sign|already|existing/i);
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('changed payment terms cannot sign or submit another request',async()=>{
 const f=await setup();try{const review=await f.relay.prepare(f.chosen),changed=structuredClone(review);changed.native.fee='9999';await assert.rejects(()=>f.relay.authorize({review:changed}));
 const authorization=await f.relay.authorize({review});await assert.rejects(()=>f.relay.submit({review,authorization:{...authorization,txid:'b'.repeat(64)}}));assert.equal((await f.relay.status({owner})).history[0].state,'signed');
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('lost native submission reply is retained once and cannot produce a replacement spend',async()=>{
 let submissions=0;const f=await setup({submit:async()=>{submissions++;throw Error('reply lost');}});try{
 const review=await f.relay.prepare(f.chosen),authorization=await f.relay.authorize({review}),attempt={review,authorization};
 const result=await f.relay.submit(attempt);assert.equal(result.status,'unknown');assert.equal(result.resubmissionSafe,false);
 const restarted=await f.open();assert.equal((await restarted.reconcile(attempt)).status,'unknown');await assert.rejects(()=>restarted.submit(attempt));
 await assert.rejects(()=>restarted.prepare({...f.chosen,requestId:'22222222-2222-4222-8222-222222222222'}));assert.equal(submissions,1);
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('interrupted native signing recovers the original artifact without another signature',async()=>{
 let signatures=0;const f=await setup({sign:async(_wallet,_file,file)=>{signatures++;await writeFile(file,'signed');throw Error('signing reply lost');}});try{
 const review=await f.relay.prepare(f.chosen);await assert.rejects(()=>f.relay.authorize({review}));assert.equal((await f.relay.status({owner})).history[0].state,'signing-unknown');
 const restarted=await f.open(),authorization=await restarted.recoverAuthorization({review,authorization:null});assert.equal(authorization.txid,txid);assert.equal(signatures,1);assert.equal((await restarted.reconcile({review,authorization})).resubmissionSafe,true);
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('reopening an unsigned native request synchronizes its source and rechecks the same artifact',async()=>{
 let serverHeight=100,walletHeight=100,preparations=0,synchronizations=0;
 const f=await setup({preflight:async()=>{assert.equal(walletHeight,serverHeight,'Incrementally synchronize the native input snapshot');return {network:'testnet',wallet:'a',txid,currentInputs:true,witnessVerified:true,walletHeight,serverHeight,canonicalHeight:walletHeight,canonicalHash:'c'.repeat(64),maximumScanLag:10};}},{
  check:async()=>({serverHeight,walletHeight,expiryHeight:200,targetHeight:serverHeight+1,branchMatches:true}),onPrepare:()=>{preparations++;},sync:async(wallet)=>{assert.equal(wallet,'a');synchronizations++;walletHeight=serverHeight;}
 });
 try{
  const original=await f.relay.prepare(f.chosen);serverHeight=115;
  const reopened=await(await f.open()).prepare(f.chosen);
  assert.deepEqual(reopened.native,original.native);assert.equal(reopened.authorityId,original.authorityId);assert.equal(reopened.id,original.id);assert.equal(preparations,1);assert.equal(synchronizations,1);
  assert.equal((await f.relay.status({owner})).history[0].state,'reviewed');
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('an interrupted source sync keeps the original native unsigned request without regenerating it',async()=>{
 let preparations=0;
 const f=await setup({}, {onPrepare:()=>{preparations++;},sync:async()=>{throw Error('Source synchronization interrupted');}});
 try{
  const original=await f.relay.prepare(f.chosen);await assert.rejects(()=>(f.relay.prepare(f.chosen)),/synchronization interrupted/);
  const history=await(await f.open()).status({owner});assert.equal(history.history[0].id,original.id);assert.equal(history.history[0].state,'reviewed');assert.equal(history.history[0].txid,original.native.txid);assert.equal(preparations,1);
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('refreshing the original source cannot bypass the native near-expiry signing margin',async()=>{
 let serverHeight=100,walletHeight=100,preparations=0,signatures=0;
 const f=await setup({sign:async()=>{signatures++;throw Error('must not sign');},preflight:async()=>({network:'testnet',wallet:'a',txid,currentInputs:true,witnessVerified:true,walletHeight})},{
  check:async()=>({serverHeight,walletHeight,expiryHeight:150,targetHeight:serverHeight+1,branchMatches:true}),onPrepare:()=>{preparations++;},sync:async()=>{walletHeight=serverHeight;}
 });
 try{
  const original=await f.relay.prepare(f.chosen);serverHeight=135;
  await assert.rejects(()=>f.relay.prepare(f.chosen),/before signing/);await assert.rejects(()=>f.relay.authorize({review:original}),/before signing/);
  assert.equal(preparations,1);assert.equal(signatures,0);assert.equal((await f.relay.status({owner})).history[0].state,'reviewed');
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('native approval and submission synchronize the exact source before using the original artifact',async()=>{
 const calls=[];let original;
 const f=await setup({
  sign:async(wallet,file,output,terms)=>{calls.push('sign');assert.equal(wallet,'a');assert.deepEqual(terms,zcashPaymentTerms(original));assert(file.endsWith(original.native.id+'.pczt'));await writeFile(output,'signed');return {txid};},
  submit:async(wallet,file,terms)=>{calls.push('submit');assert.equal(wallet,'a');assert(file.endsWith(original.native.id+'.signed.pczt'));assert.deepEqual({...terms,signedSha256:undefined},{...zcashPaymentTerms(original),signedSha256:undefined});return {txid};}
 },{sync:async wallet=>{assert.equal(wallet,'a');calls.push('sync');}});
 try{
  original=await f.relay.prepare(f.chosen);const authorization=await f.relay.authorize({review:original});await f.relay.submit({review:original,authorization});
  assert.deepEqual(calls,['sync','sign','sync','submit']);assert.equal((await f.relay.status({owner})).history[0].txid,original.native.txid);
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('failed native synchronization prevents signing or submission and preserves the retained authority',async()=>{
 let fail=true,signatures=0,submissions=0,preparations=0;
 const f=await setup({sign:async(_wallet,_file,output)=>{signatures++;await writeFile(output,'signed');return {txid};},submit:async()=>{submissions++;return {txid};}},{onPrepare:()=>{preparations++;},sync:async()=>{if(fail)throw Error('Native synchronization interrupted');}});
 try{
  const review=await f.relay.prepare(f.chosen);await assert.rejects(()=>f.relay.authorize({review}),/synchronization interrupted/);assert.equal(signatures,0);assert.equal((await f.relay.status({owner})).history[0].state,'reviewed');
  fail=false;const authorization=await f.relay.authorize({review});fail=true;
  await assert.rejects(()=>f.relay.submit({review,authorization}),/synchronization interrupted/);assert.equal(submissions,0);assert.equal(signatures,1);assert.equal(preparations,1);assert.equal((await f.relay.status({owner})).history[0].state,'signed');assert.deepEqual(await f.relay.recoverAuthorization({review}),authorization);
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});

test('verified unused native expiry is terminal without refund and alone allows a fresh bounded request',async()=>{
 let verified=false,submissions=0;
 const f=await setup({submit:async()=>{submissions++;return {txid};},expire:async(_wallet,_file,terms)=>verified?{network:'testnet',wallet:'a',recipient:'b',pool:'ironwood',txid,status:'expired',verifier:'native-canonical-expiry/v1',signedSha256:terms.signedSha256,unsignedSha256:terms.unsignedSha256,expiryHeight:150,sourceHeight:160,recipientHeight:160,sourceCanonicalHash:'c'.repeat(64),recipientCanonicalHash:'d'.repeat(64),paymentAbsent:true,inputUnspent:true}:{network:'testnet',wallet:'a',txid,status:'unknown'}});
 try{
  const review=await f.relay.prepare(f.chosen),authorization=await f.relay.authorize({review}),attempt={review,authorization};
  assert.equal((await f.relay.reconcile(attempt)).status,'pending');const next={...f.chosen,requestId:'22222222-2222-4222-8222-222222222222'};
  await assert.rejects(()=>f.relay.prepare(next),/original unresolved/);
  verified=true;const result=await f.relay.reconcile(attempt);assert.equal(result.status,'expired');assert.equal(result.verified,true);assert.equal(result.resubmissionSafe,false);assert.equal(result.evidence.inputUnspent,true);assert.equal(result.evidence.inputAmount,undefined);assert.equal(result.evidence.outputAmount,undefined);assert.equal(submissions,0);
  assert.equal((await f.relay.status({owner})).pending,false);assert.equal((await f.relay.status({owner})).history[0].state,'expired');assert.deepEqual(await f.relay.recoverAuthorization({review}),authorization);assert.deepEqual(await(await f.open()).reconcile(attempt),result);
  await assert.rejects(()=>f.relay.submit(attempt));assert.equal((await f.relay.prepare(next)).id,next.requestId);assert.equal(submissions,0);
 }finally{await rm(f.stateDir,{recursive:true,force:true});}
});
