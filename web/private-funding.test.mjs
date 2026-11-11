import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPrivateFunding,fundingRequest} from './public/private-funding.js';
import {prepareConfidentialFunding} from '../integrations/intents-spend.mjs';
import {fixture,signQuote,verifier,now,owner} from './intents-spend-fixture.mjs';

function funding(){
 const terms={owner,chainId:'0x1',amount:'10000000000000000',refundDeadline:new Date(now+3600000).toISOString()};
 const quote=fixture().quote;quote.quoteRequest=fundingRequest(terms,{now});
 quote.quote={amountIn:terms.amount,minAmountIn:terms.amount,amountOut:'9900000000000000',minAmountOut:'9900000000000000',depositAddress:'0x'+'34'.repeat(20),deadline:terms.refundDeadline,refundFee:'1000',withdrawFee:'0'};
 signQuote(quote);return {terms,quote};
}
test('native funding binds Ethereum ETH, the original owner, net output and refund',()=>{
 const offer=funding(),review=checkPrivateFunding(offer,{now,verifySignature:verifier});
 assert.equal(review.chainId,'0x1');assert.equal(review.depositAddress,'0x'+'34'.repeat(20));assert.equal(review.amountOut,'9900000000000000');assert.equal(review.fees,'100000000000000');assert.equal(review.refundFee,'1000');assert.equal(review.settlementVerified,false);
});
test('funding rejects changed rail, asset, owner, hidden routing and unreviewable economics',()=>{
 for(const change of [
  q=>q.quoteRequest.recipient='0x'+'22'.repeat(20),q=>q.quoteRequest.refundTo='0x'+'22'.repeat(20),q=>q.quoteRequest.depositType='CONFIDENTIAL_INTENTS',q=>q.quoteRequest.destinationAsset='nep141:usdc.near',q=>q.quoteRequest.confidentiality='public',
  q=>q.quoteRequest.customRecipientMsg='',q=>q.quoteRequest.appFees=[{recipient:owner,fee:1}],q=>q.quote.virtualChainRecipient=owner,q=>q.quote.depositMemo='',q=>q.quote.chainDepositAddresses=[],q=>q.quote.depositAddress='ab'.repeat(32),q=>q.quote.amountIn='1',q=>q.quote.minAmountOut='1',q=>q.quote.amountOut='10000000000000001',q=>q.quote.refundFee=undefined
 ]){const offer=funding();change(offer.quote);signQuote(offer.quote);assert.throws(()=>checkPrivateFunding(offer,{now,verifySignature:verifier}));}
 const offer=funding();offer.quote.quote.depositAddress='0x'+'99'.repeat(20);assert.throws(()=>checkPrivateFunding(offer,{now,verifySignature:verifier}),/signature/);
});
test('funding preparation sends only an unfunded fixed-rail quote and returns no authority',async()=>{
 const offer=funding();let calls=0;
 const result=await prepareConfidentialFunding(offer.terms,{apiKey:'test-partner',now:()=>now,verifySignature:verifier,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://1click.chaindefuser.com/v0/quote');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),offer.quote.quoteRequest);return new Response(JSON.stringify(offer.quote));
 }});
 assert.equal(calls,1);assert.equal(result.state,'awaiting-funding-review');assert.equal(result.review.settlementVerified,false);assert.equal(result.signedData,undefined);
});
test('invalid or expired funding terms never reach the partner',async()=>{
 let calls=0;const options={apiKey:'test-partner',now:()=>now,fetcher:async()=>{calls++;throw Error('unexpected');}};
 for(const changes of [{amount:'0'},{amount:'1e18'},{owner:'0x'+'00'.repeat(20)},{chainId:'0x89'},{signedData:{}},{refundDeadline:new Date(now+300000).toISOString()},{refundDeadline:new Date(now+86400001).toISOString()}])await assert.rejects(prepareConfidentialFunding({...funding().terms,...changes},options));
 assert.equal(calls,0);
});
test('new deposit authority expires while the original funding quote stays readable',()=>{
 const offer=funding();assert.throws(()=>checkPrivateFunding(offer,{now:now+3300000,verifySignature:verifier}),/expired/);
 assert.equal(checkPrivateFunding(offer,{now,verifySignature:verifier}).owner,owner);
});
test('source ETH follows the exact Ethereum, Arbitrum or Base native asset without a NEAR conversion',()=>{
 for(const [chainId,asset]of [['0x1','nep141:eth.omft.near'],['0xa4b1','nep141:arb.omft.near'],['0x2105','nep141:base.omft.near']]){
  const offer=funding();offer.terms.chainId=chainId;offer.quote.quoteRequest=fundingRequest(offer.terms,{now});signQuote(offer.quote);
  const review=checkPrivateFunding(offer,{now,verifySignature:verifier});assert.equal(review.chainId,chainId);assert.equal(review.asset,asset);assert.equal(offer.quote.quoteRequest.destinationAsset,asset);
  offer.quote.quoteRequest.originAsset='nep141:near';signQuote(offer.quote);assert.throws(()=>checkPrivateFunding(offer,{now,verifySignature:verifier}),/originAsset/);
 }
});
test('signed RFC3339 provider times retain their original bytes and reject invalid calendar dates',()=>{
 for(const timestamp of [new Date(now).toISOString().replace('.000Z','Z'),'2026-11-09T09:00:00+01:00']){
  const offer=funding();offer.quote.timestamp=timestamp;offer.quote.quote.deadline=offer.terms.refundDeadline.replace('.000Z','Z');signQuote(offer.quote);
  assert.equal(checkPrivateFunding(offer,{now,verifySignature:verifier}).depositDeadline,offer.quote.quote.deadline);assert.equal(offer.quote.timestamp,timestamp);assert(verifier(offer.quote));
 }
 const offer=funding();offer.quote.timestamp='2026-02-30T08:00:00Z';signQuote(offer.quote);assert.throws(()=>checkPrivateFunding(offer,{now,verifySignature:verifier}));
});
