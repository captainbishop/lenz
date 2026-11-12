import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
const {prepareConfidentialSpend,submitConfidentialSpend,readConfidentialSpendStatus}=await import(process.env.LENZ_SPEND_ADAPTER_MODULE??'./intents-spend.mjs');
import {fixture,verifier,signQuote,owner,wallet,now} from '../web/intents-spend-fixture.mjs';
import {checkConfidentialSpend,confidentialSignedData} from '../web/public/intents-spend.js';
test('connected preparation obtains a bound private quote and unsigned payload without signing or submitting',async()=>{
 const f=fixture(),{signingDeadline,...request}=f.terms,calls=[];
 const result=await prepareConfidentialSpend(request,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body)});assert.equal(options.redirect,'error');assert.equal(options.headers['X-API-Key'],'synthetic');
  if(url.endsWith('/quote'))return Response.json(f.quote);if(url.endsWith('/generate-intent'))return Response.json(f.generated);assert.fail(url);
 }});
 assert.equal(result.state,'awaiting-owner-review');assert.equal(result.offer.terms.signingDeadline,signingDeadline);assert.equal(result.offer.terms.refundDeadline,request.refundDeadline);
 assert.equal(result.offer.generated.intent.payload,f.generated.intent.payload);assert.equal(calls.length,2);assert.equal(calls[0].body.depositType,'CONFIDENTIAL_INTENTS');assert.equal(calls[1].body.signerId,owner);
});
test('submission verifies the exact owner signature once and returns submission evidence without claiming settlement',async()=>{
 const f=fixture(),signedData=confidentialSignedData(f.generated.intent.payload,await wallet.signMessage(f.generated.intent.payload),owner),calls=[];
 const result=await submitConfidentialSpend(f,signedData,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async(url,options)=>{calls.push(JSON.parse(options.body));assert.equal(url,'https://1click.chaindefuser.com/v0/submit-intent');return Response.json({intentHash:'2'.repeat(44),correlationId:'test'});}});
 assert.equal(calls.length,1);assert.deepEqual(calls[0],{type:'swap_transfer',signedData});assert.equal(result.state,'submitted');assert.equal(result.settlementVerified,false);
});

test('local validation and pre-dispatch cancellation do not send or report an unknown submission',async()=>{
 const f=fixture(),signed=confidentialSignedData(f.generated.intent.payload,await wallet.signMessage(f.generated.intent.payload),owner);
 for(const mode of ['no-access','aborted','expired','changed-payload','wrong-owner']){
  const controller=new AbortController(),offer=structuredClone(f),approval=structuredClone(signed);let calls=0;
  if(mode==='aborted')controller.abort();
  if(mode==='changed-payload')approval.payload+=' ';
  if(mode==='wrong-owner')approval.signature='secp256k1:'+'1'.repeat(88);
  await assert.rejects(submitConfidentialSpend(offer,approval,{apiKey:mode==='no-access'?'':'synthetic',signal:controller.signal,now:()=>mode==='expired'?now+3600000:now,verifySignature:verifier,fetcher:async()=>{calls++;return Response.json({intentHash:'2'.repeat(44)});}}),error=>error.submissionUnknown!==true,mode);
  assert.equal(calls,0,mode);
 }
});

test('lost, rejected and malformed submission responses remain unknown without automatic retries',async()=>{
 const f=fixture(),signed=confidentialSignedData(f.generated.intent.payload,await wallet.signMessage(f.generated.intent.payload),owner);
 for(const mode of ['lost','http-error','redirect','malformed','wrong-hash','oversized','invalid-utf8','aborted-after-send']){
  let calls=0;const controller=new AbortController();
  await assert.rejects(submitConfidentialSpend(f,signed,{apiKey:'synthetic',signal:controller.signal,now:()=>now,verifySignature:verifier,fetcher:async(url,options)=>{
   calls++;assert.equal(options.redirect,'error');
   if(mode==='lost')throw Error('Transport lost after accepting request');
   if(mode==='http-error')return new Response('Server error',{status:500});
   if(mode==='redirect')return new Response('',{status:307,headers:{Location:'https://untrusted.example'}});
   if(mode==='malformed')return new Response('{');
   if(mode==='wrong-hash')return Response.json({intentHash:'1'});
   if(mode==='oversized')return new Response(' '.repeat(65537));
   if(mode==='invalid-utf8')return new Response(Uint8Array.of(255));
   controller.abort();return Response.json({intentHash:'2'.repeat(44)});
  }}),error=>error.submissionUnknown===true,mode);
  assert.equal(calls,1,mode);
 }
});

test('changed quote and generated authority fail preparation before an offer can be reviewed',async()=>{
 for(const mode of ['changed-recipient','bad-quote-signature','generated-key-action','oversized-quote','aborted']){
  const f=fixture(),{signingDeadline,...input}=f.terms;let calls=0;const controller=new AbortController();
  if(mode==='changed-recipient')f.quote.quoteRequest.recipient='0x'+'33'.repeat(20);
  if(mode==='bad-quote-signature')f.quote.signature='ed25519:invalid';
  if(mode==='generated-key-action'){const p=JSON.parse(f.generated.intent.payload);p.intents.push({intent:'add_public_key',public_key:'attacker'});f.generated.intent.payload=JSON.stringify(p);}
  if(mode==='aborted')controller.abort();
  await assert.rejects(prepareConfidentialSpend(input,{apiKey:'synthetic',signal:controller.signal,now:()=>now,verifySignature:verifier,fetcher:async url=>{
   calls++;return url.endsWith('/quote')?(mode==='oversized-quote'?new Response(' '.repeat(65537)):Response.json(f.quote)):Response.json(f.generated);
  }}));
  assert.equal(calls,mode==='aborted'?0:mode==='generated-key-action'?2:1,mode);
 }
});

test('status checks the original signed deposit after expiry and keeps provider observations separate from settlement',async()=>{
 const f=fixture(),time=now+4*86400000;let calls=0;
 const result=await readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>time,verifySignature:verifier,fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://1click.chaindefuser.com/v0/status?depositAddress='+f.quote.quote.depositAddress);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
  return Response.json({quoteResponse:f.quote,status:'SUCCESS',updatedAt:new Date(time-1000).toISOString(),swapDetails:{amountIn:f.terms.amount,amountOut:f.terms.amount,withdrawFee:'0'}});
 }});
 assert.equal(calls,1);assert.equal(result.status,'SUCCESS');assert.equal(result.amountOut,f.terms.amount);assert.equal(result.settlementVerified,false);assert.equal(result.providerReportSigned,false);
});

test('status recovery retains approvals accepted at the quote clock and lifetime boundaries',async()=>{
 for(const mode of ['future-quote','older-quote']){
  const f=fixture(),time=now+4*86400000;let calls=0;
  if(mode==='future-quote'){
   f.quote.timestamp=new Date(now+30000).toISOString();f.terms.refundDeadline=new Date(now+75000).toISOString();f.quote.quoteRequest.deadline=f.terms.refundDeadline;
  }else f.quote.timestamp=new Date(now-86400000).toISOString();
  signQuote(f.quote);checkConfidentialSpend(f,{now,verifySignature:verifier});
  const result=await readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>time,verifySignature:verifier,fetcher:async()=>{
   calls++;return Response.json({quoteResponse:f.quote,status:'PROCESSING',updatedAt:new Date(time).toISOString(),swapDetails:{}});
  }});
  assert.equal(calls,1);assert.equal(result.depositAddress,f.quote.quote.depositAddress);assert.equal(result.settlementVerified,false);
  assert.throws(()=>checkConfidentialSpend(f,{now:time,verifySignature:verifier}),/expired/);
 }
});

test('status cannot treat a future review window as an already valid approval',async()=>{
 const f=fixture(),deadline=new Date(now+5*86400000).toISOString();let calls=0;
 f.terms.signingDeadline=deadline;f.quote.quote.deadline=deadline;f.quote.quote.timeWhenInactive=deadline;f.payload.deadline=deadline;
 f.terms.refundDeadline=new Date(now+2*86400000).toISOString();f.quote.quoteRequest.deadline=f.terms.refundDeadline;
 const nonce=Buffer.from(f.payload.nonce,'base64');nonce.writeBigUInt64LE(BigInt(Date.parse(deadline))*1000000n,9);f.payload.nonce=nonce.toString('base64');
 f.generated.intent.payload=JSON.stringify(f.payload);signQuote(f.quote);
 assert.throws(()=>checkConfidentialSpend(f,{now,verifySignature:verifier}),/four days/);
 checkConfidentialSpend(f,{now:now+86400000,verifySignature:verifier});
 await assert.rejects(readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async()=>{
  calls++;return Response.json({quoteResponse:f.quote,status:'PROCESSING',updatedAt:new Date(now).toISOString(),swapDetails:{}});
 }}),/valid review/);
 assert.equal(calls,0);
});

test('provider update times must be explicit valid timestamps before normalization',async()=>{
 const f=fixture(),time=now+4*86400000;
 for(const updatedAt of [[new Date(time).toISOString()],new Date(time).toISOString().slice(0,10),'2026-11-12T24:00:00Z','2026-11-13 08:00:00 GMT']){
  await assert.rejects(readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>time,verifySignature:verifier,fetcher:async()=>Response.json({quoteResponse:f.quote,status:'PROCESSING',updatedAt,swapDetails:{}})}),/time/);
 }
});

test('invalid local status context fails before contacting the provider',async()=>{
 for(const mode of ['clock','quote-signature','quote-future','no-access','aborted']){
  const f=fixture(),controller=new AbortController();let calls=0;
  if(mode==='quote-signature')f.quote.signature='ed25519:invalid';
  if(mode==='quote-future'){f.quote.timestamp=new Date(now+30001).toISOString();signQuote(f.quote);}
  if(mode==='aborted')controller.abort();
  await assert.rejects(readConfidentialSpendStatus(f,{apiKey:mode==='no-access'?'':'synthetic',signal:controller.signal,now:()=>mode==='clock'?Infinity:now,verifySignature:verifier,fetcher:async()=>{calls++;return Response.json({});}}),error=>error.submissionUnknown!==true,mode);
  assert.equal(calls,0,mode);
 }
});

test('status cannot replace the original quote even with another valid provider signature',async()=>{
 for(const mode of ['signed-quote','unsigned-deposit','unsigned-recipient','unsigned-fee-policy','missing-quote']){
  const f=fixture(),returned=structuredClone(f.quote);let calls=0;
  if(mode==='signed-quote'){returned.quote.amountOut='10000000000000001';signQuote(returned);}
  if(mode==='unsigned-deposit')returned.quote.depositAddress='cd'.repeat(32);
  if(mode==='unsigned-recipient')returned.quoteRequest.recipient='0x'+'33'.repeat(20);
  if(mode==='unsigned-fee-policy')returned.quoteRequest.appFees=[{recipient:'fee.near',fee:100}];
  await assert.rejects(readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async()=>{
   calls++;return Response.json({quoteResponse:mode==='missing-quote'?undefined:returned,status:'SUCCESS',updatedAt:new Date(now).toISOString(),swapDetails:{amountIn:f.terms.amount,amountOut:f.terms.amount,withdrawFee:'0'}});
  }}),error=>error.submissionUnknown!==true,mode);
  assert.equal(calls,1,mode);
 }
});

test('pending status keeps absent amounts unknown and normalizes explicit time zones',async()=>{
 const f=fixture();
 for(const updatedAt of ['2026-11-09T08:00:00Z','2026-11-09T09:00:00+01:00','2026-11-09t08:00:00.000000z']){
  const result=await readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async()=>Response.json({quoteResponse:f.quote,status:'PROCESSING',updatedAt,swapDetails:{},settlementVerified:true,providerReportSigned:true})});
  assert.deepEqual(result,{type:'lenz/private-status/v1',depositAddress:'ab'.repeat(32),status:'PROCESSING',updatedAt:'2026-11-09T08:00:00.000Z',observedAt:now,amountIn:null,amountOut:null,refundedAmount:null,withdrawFee:null,settlementVerified:false,providerReportSigned:false});
 }
});

test('provider status amounts and times must agree with the approved request',async()=>{
 const f=fixture(),base={quoteResponse:f.quote,status:'SUCCESS',updatedAt:new Date(now).toISOString(),swapDetails:{amountIn:f.terms.amount,amountOut:f.terms.amount,withdrawFee:'0'}};
 const changes=[{status:'FINAL'},{swapDetails:null},{swapDetails:[]},{swapDetails:{}},{swapDetails:{...base.swapDetails,amountIn:'9999999999999999'}},{swapDetails:{...base.swapDetails,amountOut:'9999999999999999'}},{swapDetails:{...base.swapDetails,withdrawFee:'1'}},{swapDetails:{...base.swapDetails,amountOut:10000000000000000}},{status:'REFUNDED',swapDetails:{refundedAmount:'10000000000000001'}},{updatedAt:new Date(now+60001).toISOString()},{updatedAt:new Date(now-60001).toISOString()}];
 for(const change of changes)await assert.rejects(readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async()=>Response.json({...base,...change})}));
 const result=await readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async()=>Response.json({...base,status:'REFUNDED',swapDetails:{refundedAmount:'7500000000000000'}})});
 assert.equal(result.refundedAmount,'7500000000000000');assert.equal(result.amountOut,null);assert.equal(result.settlementVerified,false);
});

test('failed status reads never resubmit or classify a read failure as an unknown submission',async()=>{
 for(const mode of ['lost','http','redirect','malformed','oversized','invalid-utf8','aborted']){
  const f=fixture(),controller=new AbortController(),body={quoteResponse:f.quote,status:'PROCESSING',updatedAt:new Date(now).toISOString(),swapDetails:{}};let calls=0;
  await assert.rejects(readConfidentialSpendStatus(f,{apiKey:'synthetic',signal:controller.signal,now:()=>now,verifySignature:verifier,fetcher:async(url,options)=>{
   calls++;assert.match(url,/\/status\?/);assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
   if(mode==='lost')throw Error('Connection lost');
   if(mode==='http')return new Response('Unavailable',{status:503});
   if(mode==='redirect')return new Response('',{status:307});
   if(mode==='malformed')return new Response('{');
   if(mode==='oversized')return Response.json({...body,padding:' '.repeat(65536)});
   if(mode==='invalid-utf8')return new Response(Buffer.concat([Buffer.from('{"comment":"'),Buffer.from([255]),Buffer.from('",'+JSON.stringify(body).slice(1))]));
   controller.abort();return Response.json(body);
  }}),error=>error.submissionUnknown!==true,mode);
  assert.equal(calls,1,mode);
 }
});

test('real HTTP status reads reject redirects and abort stalled bodies',async()=>{
 const f=fixture(),requests=[];let received;
 const server=http.createServer((req,res)=>{
  requests.push(req.url);
  if(req.url==='/redirect'){res.writeHead(307,{Location:'/leak'});res.end();return;}
  if(req.url==='/leak'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({quoteResponse:f.quote,status:'PROCESSING',updatedAt:new Date(now).toISOString(),swapDetails:{}}));return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.write('{');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  await assert.rejects(readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:(_url,options)=>fetch(base+'/redirect',options)}));
  assert.deepEqual(requests,['/redirect']);
  const controller=new AbortController(),headers=new Promise(resolve=>received=resolve);
  const pending=readConfidentialSpendStatus(f,{apiKey:'synthetic',signal:controller.signal,now:()=>now,verifySignature:verifier,fetcher:async(_url,options)=>{const response=await fetch(base+'/stall',options);received();return response;}});
  const rejected=assert.rejects(pending,error=>error.name==='AbortError'&&error.submissionUnknown!==true);
  await headers;controller.abort();await rejected;assert.deepEqual(requests,['/redirect','/stall']);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('caller edits during a status read cannot replace its original request',async()=>{
 const f=fixture(),quote=structuredClone(f.quote);let received,release;
 const started=new Promise(resolve=>received=resolve);
 const pending=readConfidentialSpendStatus(f,{apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async()=>{received();return new Promise(resolve=>release=resolve);}});
 await started;f.terms.amount='1';f.quote.quote.depositAddress='cd'.repeat(32);
 release(Response.json({quoteResponse:quote,status:'PROCESSING',updatedAt:new Date(now).toISOString(),swapDetails:{}}));
 const result=await pending;assert.equal(result.depositAddress,'ab'.repeat(32));assert.equal(result.settlementVerified,false);
});

test('cross-asset private preparation preserves the chosen output floor and exact unsigned deposit authority',async()=>{
 const offer=fixture();offer.terms.destinationAsset=offer.quote.quoteRequest.destinationAsset='nep141:usdc.near';offer.terms.recipient=offer.quote.quoteRequest.recipient=owner;offer.terms.minOutput='25000000';offer.quote.quote.amountOut='27000000';offer.quote.quote.minAmountOut='26000000';signQuote(offer.quote);
 const {signingDeadline,...input}=offer.terms,calls=[];
 const options={apiKey:'synthetic',now:()=>now,verifySignature:verifier,fetcher:async(url,request)=>{calls.push({url,body:JSON.parse(request.body)});return Response.json(url.endsWith('/quote')?offer.quote:offer.generated);}};
 const result=await prepareConfidentialSpend(input,options);assert.equal(result.review.amount,'10000000000000000');assert.equal(result.review.minAmountOut,'26000000');assert.equal(result.review.destinationAsset,'nep141:usdc.near');assert.equal(result.review.recipient,owner);assert.equal(result.offer.generated.intent.payload,offer.generated.intent.payload);
 assert.deepEqual(calls.map(c=>c.url),['https://1click.chaindefuser.com/v0/quote','https://1click.chaindefuser.com/v0/generate-intent']);assert.equal(calls[1].body.type,'swap_transfer');assert.equal(calls[1].body.standard,'erc191');assert.equal(calls[1].body.signerId,owner);assert.equal(result.review.privacyVerified,false);
 offer.quote.quote.minAmountOut='24000000';signQuote(offer.quote);await assert.rejects(prepareConfidentialSpend(input,options),/amount changed/);
});
