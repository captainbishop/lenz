import test from 'node:test';
import assert from 'node:assert/strict';
const {checkConfidentialSpendTerms,checkConfidentialSpend,signConfidentialSpend}=await import(process.env.LENZ_SPEND_MODULE??'./public/intents-spend.js');
import {fixture,verifier,signQuote,owner,wallet,now} from './intents-spend-fixture.mjs';

test('owner terms enforce canonical quantities, bounded lifetimes and explicit destinations',()=>{
 const {terms}=fixture();
 for(const changes of [{amount:'0'},{amount:'01'},{amount:'1e16'},{amount:'340282366920938463463374607431768211456'},{minOutput:'0'},{owner:'0x'+'00'.repeat(20)},{recipient:'0x'+'00'.repeat(20)},{originAsset:'eth'},{destinationAsset:'nep141:'},{slippageBps:-1},{slippageBps:1001},{slippageBps:0.5},{refundDeadline:new Date(now+60000).toISOString()},{signingDeadline:new Date(now+345600001).toISOString()},{signingDeadline:new Date(now+120000).toISOString()},{extra:true}]){
  assert.throws(()=>checkConfidentialSpendTerms({...terms,...changes},now));
 }
 const maximum='340282366920938463463374607431768211455',checked=checkConfidentialSpendTerms({...terms,amount:maximum,minOutput:maximum},now);
 assert.equal(checked.amount,maximum);assert.equal(checked.minOutput,maximum);assert.notEqual(checked,terms);
});
test('private spending review binds the signed deposit and exact owner terms without equating refund time and signature expiry',()=>{
 const f=fixture(),review=checkConfidentialSpend(f,{now,verifySignature:verifier});
 assert.equal(review.payload,f.generated.intent.payload);assert.equal(review.signingDeadline,'2026-11-12T09:00:00.000Z');
 assert.equal(review.refundDeadline,'2026-11-09T09:00:00.000Z');assert.equal(review.amount,'10000000000000000');
 assert.equal(review.privacyVerified,false);assert.equal(review.refundDeadlineSigned,false);
 assert.throws(()=>checkConfidentialSpend(f,{now}),/quote signature/i,'The production verifier must not accept the fixture manager');
});
test('an offline owner signs only the exact private transfer without a balance, code, gas or network fetch',async()=>{
 const f=fixture(),calls=[],handlers=new Map(),provider={on:(e,h)=>handlers.set(e,h),removeListener:e=>handlers.delete(e),async request({method,params}){
  calls.push(method);if(['eth_requestAccounts','eth_accounts'].includes(method))return [owner];if(method==='eth_chainId')return '0x1';
  if(method==='personal_sign'){assert.equal(params[1],owner);assert.equal(Buffer.from(params[0].slice(2),'hex').toString(),f.generated.intent.payload);return wallet.signMessage(f.generated.intent.payload);}
  assert.fail('Offline signing must not use '+method);
 }};
 const signed=await signConfidentialSpend(provider,f,{now:()=>now,verifySignature:verifier});
 assert.equal(signed.standard,'erc191');assert.equal(signed.payload,f.generated.intent.payload);assert.match(signed.signature,/^secp256k1:/);
 assert.equal(handlers.size,0);assert.equal(calls.filter(m=>m==='personal_sign').length,1);
 assert.deepEqual(new Set(calls),new Set(['eth_requestAccounts','eth_accounts','eth_chainId','personal_sign']));
});
test('signed refund and withdrawal charges cannot consume unapproved value',()=>{
 for(const key of ['refundFee','withdrawFee']){const f=fixture();f.quote.quote[key]=f.terms.amount;signQuote(f.quote);assert.throws(()=>checkConfidentialSpend(f,{now,verifySignature:verifier}),/fee/i);}
});
test('signed net economics do not claim to authenticate omitted provider policy fields',()=>{
 const f=fixture();f.quote.quoteRequest.appFees=[{recipient:'fee.near',fee:500}];f.quote.quoteRequest.insured=true;signQuote(f.quote);
 f.quote.quoteRequest.appFees=[];f.quote.quoteRequest.insured=false;
 const review=checkConfidentialSpend(f,{now,verifySignature:verifier});
 assert.equal(review.feeBreakdownVerified,false);assert.equal(review.privacyVerified,false);assert.equal(review.refundDeadlineSigned,false);
 f.quote.quote.depositAddress='cd'.repeat(32);assert.throws(()=>checkConfidentialSpend(f,{now,verifySignature:verifier}),/quote signature/i);
});

test('quote-level routing instructions cannot change an approved private destination',()=>{
 for(const key of ['virtualChainRefundRecipient','customRecipientMsg']){
  const f=fixture();f.quote.quote[key]='unapproved routing';
  assert.equal(verifier(f.quote),true,'The SDK omits this routing field');
  assert.throws(()=>checkConfidentialSpend(f,{now,verifySignature:verifier}),/routing/);
 }
});
test('a signed offer cannot substitute the owner recipient source output refund or expiry',()=>{
 const changes=[f=>f.quote.quoteRequest.recipient='0x'+'33'.repeat(20),f=>f.quote.quoteRequest.refundTo='0x'+'33'.repeat(20),f=>f.quote.quoteRequest.depositType='INTENTS',f=>f.quote.quoteRequest.refundType='ORIGIN_CHAIN',f=>f.quote.quoteRequest.recipientType='DESTINATION_CHAIN',f=>f.quote.quoteRequest.originAsset='nep141:wrap.near',f=>f.quote.quoteRequest.destinationAsset='nep141:wrap.near',f=>f.quote.quoteRequest.amount='10000000000000001',f=>f.quote.quote.minAmountOut='1',f=>f.quote.quote.minAmountIn='1',f=>f.quote.quoteRequest.slippageTolerance=1,f=>f.quote.quote.deadline=new Date(now+345600001).toISOString(),f=>f.quote.quoteRequest.deadline=new Date(now+7200000).toISOString(),f=>f.quote.quoteRequest.confidentiality='basic',f=>f.quote.quoteRequest.appFees=[{recipient:'fee.near',fee:1}],f=>f.quote.quoteRequest.customRecipientMsg='hidden',f=>f.quote.quote.depositMemo='hidden'];
 for(const change of changes){const f=fixture();change(f);signQuote(f.quote);assert.throws(()=>checkConfidentialSpend(f,{now,verifySignature:verifier}));}
});
test('generated payload cannot add key management or alter a transfer bound to the signed quote',()=>{
 for(const change of [p=>p.verifying_contract='intents.near',p=>p.signer_id='0x'+'33'.repeat(20),p=>p.intents.push({intent:'add_public_key',public_key:'attacker'}),p=>p.intents[0].intent='token_diff',p=>p.intents[0].receiver_id='cd'.repeat(32),p=>p.intents[0].msg='hidden',p=>p.intents[0].tokens.extra='1',p=>p.intents[0].tokens[Object.keys(p.intents[0].tokens)[0]]='10000000000000001',p=>p.nonce='A'.repeat(44),p=>p.deadline=new Date(now+7200000).toISOString()]){
  const f=fixture();change(f.payload);f.generated.intent.payload=JSON.stringify(f.payload);assert.throws(()=>checkConfidentialSpend(f,{now,verifySignature:verifier}));
 }
 const f=fixture();f.generated.intent.payload=f.generated.intent.payload.replace('{','{"signer_id":"hidden",');assert.throws(()=>checkConfidentialSpend(f,{now,verifySignature:verifier}));
});
function providerFixture(){
 const calls=[],handlers=new Map();
 const provider={owner,chain:'0x1',sign:text=>wallet.signMessage(text),on:(e,h)=>handlers.set(e,h),removeListener:e=>handlers.delete(e),async request({method,params}){
  calls.push(method);if(['eth_requestAccounts','eth_accounts'].includes(method))return [provider.owner];if(method==='eth_chainId')return provider.chain;
  if(method==='personal_sign')return provider.sign(Buffer.from(params[0].slice(2),'hex').toString());assert.fail('Unexpected method '+method);
 }};return {provider,calls,handlers};
}
test('cancellation returns promptly but prevents a second prompt until the original wallet promise settles',async()=>{
 const f=fixture(),{provider,calls,handlers}=providerFixture(),controller=new AbortController();let started,release;
 const ready=new Promise(r=>started=r);provider.sign=()=>new Promise(r=>{release=r;started();});
 const first=signConfidentialSpend(provider,f,{signal:controller.signal,now:()=>now,verifySignature:verifier}),rejected=assert.rejects(first);
 await ready;controller.abort();await rejected;await assert.rejects(signConfidentialSpend(provider,f,{now:()=>now,verifySignature:verifier}),/still open/);
 assert.equal(calls.filter(m=>m==='personal_sign').length,1);release(await wallet.signMessage(f.generated.intent.payload));await new Promise(r=>setImmediate(r));assert.equal(handlers.size,0);
 provider.sign=text=>wallet.signMessage(text);assert.equal((await signConfidentialSpend(provider,f,{now:()=>now,verifySignature:verifier})).standard,'erc191');
});
test('account or network changes and expiry during approval cannot release a usable signature',async()=>{
 for(const mode of ['account-event','network-event','silent-account','silent-network','expired','wrong-signature']){
  const f=fixture(),{provider,handlers}=providerFixture();let clock=now;
  provider.sign=async text=>{if(mode==='account-event')handlers.get('accountsChanged')(['0x'+'33'.repeat(20)]);if(mode==='network-event')handlers.get('chainChanged')('0x2105');if(mode==='silent-account')provider.owner='0x'+'33'.repeat(20);if(mode==='silent-network')provider.chain='0x2105';if(mode==='expired')clock+=3600000;if(mode==='wrong-signature')return '0x'+'00'.repeat(65);return wallet.signMessage(text);};
  await assert.rejects(signConfidentialSpend(provider,f,{now:()=>clock,verifySignature:verifier}));await new Promise(r=>setImmediate(r));assert.equal(handlers.size,0,mode);
 }
});
test('invalid and already-cancelled approvals never reach the wallet; caller edits cannot change an in-flight review',async()=>{
 const f=fixture(),{provider,calls}=providerFixture(),controller=new AbortController();controller.abort();
 await assert.rejects(signConfidentialSpend(provider,f,{signal:controller.signal,now:()=>now,verifySignature:verifier}));assert.deepEqual(calls,[]);
 const bad=structuredClone(f);bad.terms.amount='1';await assert.rejects(signConfidentialSpend(provider,bad,{now:()=>now,verifySignature:verifier}));assert.deepEqual(calls,[]);
 const pending=signConfidentialSpend(provider,f,{now:()=>now,verifySignature:verifier}),original=f.generated.intent.payload;f.terms.amount='1';f.generated.intent.payload='changed';assert.equal((await pending).payload,original);
});
