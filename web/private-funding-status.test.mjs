import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readConfidentialFundingStatus} from '../integrations/intents-spend.mjs';
import {checkFundingObservation,fundingRequest} from './public/private-funding.js';
import {createPrivateSpendRoute} from './private-spend-relay.mjs';
import {fixture,signQuote,verifier,now,owner} from './intents-spend-fixture.mjs';

function funding(){
 const terms={owner,chainId:'0x1',amount:'10000000000000000',refundDeadline:new Date(now+3600000).toISOString()},quote=fixture().quote;
 quote.quoteRequest=fundingRequest(terms,{now});quote.quote={amountIn:terms.amount,minAmountIn:terms.amount,amountOut:'9900000000000000',minAmountOut:'9900000000000000',depositAddress:'0x'+'34'.repeat(20),deadline:terms.refundDeadline,refundFee:'1000',withdrawFee:'0'};
 return {terms,quote:signQuote(quote)};
}
const provider=offer=>({quoteResponse:structuredClone(offer.quote),status:'SUCCESS',updatedAt:new Date(now+400000000).toISOString(),swapDetails:{amountIn:'10000000000000000',amountOut:'9900000000000000',withdrawFee:'0'}});
const options=response=>({apiKey:'test-partner',verifySignature:verifier,now:()=>now+400000000,fetcher:async()=>Response.json(response)});

test('funding reads its original source deposit after expiry without acquiring spending authority',async()=>{
 const offer=funding(),response=provider(offer),seen=[];
 const result=await readConfidentialFundingStatus(offer,{...options(response),fetcher:async(url,request)=>{seen.push({url,request});return Response.json(response);}});
 assert.equal(seen.length,1);assert.equal(seen[0].url,'https://1click.chaindefuser.com/v0/status?depositAddress=0x'+'34'.repeat(20));assert.equal(seen[0].request.method,'GET');assert.equal(seen[0].request.body,undefined);assert.equal(seen[0].request.redirect,'error');
 assert.equal(result.status,'SUCCESS');assert.equal(result.owner,owner);assert.equal(result.amountOut,'9900000000000000');assert.equal(result.settlementVerified,false);assert.equal(result.providerReportSigned,false);assert.equal(result.signedData,undefined);
});

test('funding status rejects substituted signed quotes and changes to unsigned fee and routing fields',async()=>{
 for(const change of [q=>q.quoteRequest.recipient='0x'+'22'.repeat(20),q=>q.quoteRequest.originAsset='nep141:arb.omft.near',q=>q.quote.depositAddress='0x'+'56'.repeat(20),q=>q.quote.amountOut='9900000000000001',q=>q.quote.refundFee='1001',q=>q.quote.withdrawFee='1',q=>q.quoteRequest.confidentiality='basic',q=>q.quoteRequest.deadline=new Date(now+3600001).toISOString(),q=>q.quote.deadline=new Date(now+3600001).toISOString()]){
  const offer=funding(),response=provider(offer);change(response.quoteResponse);signQuote(response.quoteResponse);assert(verifier(response.quoteResponse));await assert.rejects(readConfidentialFundingStatus(offer,options(response)),/original quote/);
 }
 const offer=funding(),response=provider(offer);response.quoteResponse=Object.fromEntries(Object.entries(response.quoteResponse).reverse());assert.equal((await readConfidentialFundingStatus(offer,options(response))).status,'SUCCESS');
});

test('funding status retains absent quantities and reports bounded partial refunds as unverified',async()=>{
 const offer=funding(),response=provider(offer);response.status='PENDING_DEPOSIT';response.swapDetails={};const pending=await readConfidentialFundingStatus(offer,options(response));assert.equal(pending.amountIn,null);assert.equal(pending.amountOut,null);assert.equal(pending.refundedAmount,null);assert.equal(pending.withdrawFee,null);
 response.status='REFUNDED';response.swapDetails={refundedAmount:'9999999999999000'};const refund=await readConfidentialFundingStatus(offer,options(response));assert.equal(refund.refundedAmount,'9999999999999000');assert.equal(refund.settlementVerified,false);
});

test('funding result economics, status vocabulary and calendar dates cannot fabricate acceptable observations',async()=>{
 for(const change of [r=>r.status='COMPLETE',r=>r.updatedAt='2026-02-30T08:00:00Z',r=>r.updatedAt='2026-11-09T08:00:00',r=>r.updatedAt=new Date(now+500000000).toISOString(),r=>r.swapDetails.amountIn='1',r=>r.swapDetails.amountIn='10000000000000001',r=>r.swapDetails.amountOut='9899999999999999',r=>r.swapDetails.amountOut='10000000000000001',r=>r.swapDetails.withdrawFee='1',r=>r.swapDetails.amountOut='1e16',r=>r.swapDetails.refundedAmount='10000000000000001',r=>{r.status='REFUNDED';r.swapDetails.refundedAmount=undefined;}]){
  const offer=funding(),response=provider(offer);change(response);await assert.rejects(readConfidentialFundingStatus(offer,options(response)));
 }
 const offer=funding(),result=await readConfidentialFundingStatus(offer,options(provider(offer)));
 for(const changes of [{owner:'0x'+'22'.repeat(20)},{chainId:'0x2105'},{asset:'nep141:base.omft.near'},{depositAddress:'0x'+'56'.repeat(20)},{quoteSignature:'changed'},{settlementVerified:true},{providerReportSigned:true}])assert.throws(()=>checkFundingObservation(offer,{...result,...changes},{now:now+400000000,verifySignature:verifier}));
});

test('known funding output and refund cannot exceed the deposited or observed input',async()=>{
 for(const changes of [{amountOut:'9900000000000000',refundedAmount:'10000000000000000'},{amountIn:'5000000000000000',amountOut:'4000000000000000',refundedAmount:'2000000000000000'}]){
  const offer=funding(),response=provider(offer);response.status='PROCESSING';Object.assign(response.swapDetails,changes);await assert.rejects(readConfidentialFundingStatus(offer,options(response)),/input|deposit/);
 }
});

test('malformed or failed funding reads never call a spending endpoint',async()=>{
 const offer=funding(),seen=[];
 for(const response of [new Response('failure',{status:503}),new Response(new Uint8Array([0xff,0xfe])),new Response(JSON.stringify({...provider(offer),padding:'x'.repeat(66000)})),new Response('',{status:307,headers:{location:'https://attacker.invalid'}})]){
  await assert.rejects(readConfidentialFundingStatus(offer,{...options(null),fetcher:async(url,request)=>{seen.push({url,request});return response;}}));
 }
 assert.equal(seen.length,4);assert(seen.every(call=>call.url.includes('/v0/status?')&&call.request.method==='GET'&&call.request.body===undefined));
 let calls=0;const aborted=new AbortController();aborted.abort();await assert.rejects(readConfidentialFundingStatus(offer,{...options(null),signal:aborted.signal,fetcher:async()=>{calls++;throw Error();}}));assert.equal(calls,0);
});

test('local funding status bridge accepts only the original offer and keeps preparation input bounds',async()=>{
 const offer=funding(),observation=await readConfidentialFundingStatus(offer,options(provider(offer)));let calls=0,route;
 const server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 route=createPrivateSpendRoute({origin,apiKey:'test-partner',verifySignature:verifier,now:()=>now+400000000,observeFunding:async value=>{calls++;assert.deepEqual(value,offer);return observation;}});
 const send=(body,{path='/fund-status',...headers}={})=>fetch(origin+'/api/private-spend'+path,{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await send({offer})).status,200);assert.equal(calls,1);
  assert.equal((await send({offer,signedData:{}})).status,400);assert.equal((await send({offer},{origin:'https://attacker.invalid'})).status,403);
  assert.equal((await send({offer,padding:'x'.repeat(71000)})).status,413);assert.equal((await send({...offer.terms,padding:'x'.repeat(5000)},{path:'/fund-prepare'})).status,413);assert.equal(calls,1);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
