import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPrivateExecutorRoute} from './private-executor-relay.mjs';
import {fixture as approvalFixture,verifier,wallet,owner,now} from './intents-spend-fixture.mjs';
import {confidentialSignedData} from './public/intents-spend.js';

async function fixture(run,options={}){
 let route,calls=0;const server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 route=createPrivateExecutorRoute({origin,submit:async()=>{calls++;},observe:async()=>{calls++;},...options});
 const request=(endpoint,body,headers={})=>fetch(origin+'/api/private-executor/'+endpoint,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
 try{await run(request,()=>calls);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('an unconfigured executor advertises no execution and accepts no signed request',()=>fixture(async(request,calls)=>{
 const response=await request('config');assert.deepEqual(await response.json(),{ready:false});
 const rejected=await request('submit',{offer:{},signedData:{}});assert.equal(rejected.status,503);assert.equal(calls(),0);assert.match((await rejected.json()).error,/unavailable/);
}));
test('the configured executor submits one exact signed approval and never claims settlement',async()=>{
 const offer=approvalFixture(),signedData=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);let submitted=0;
 await fixture(async(request)=>{assert.deepEqual(await(await request('config')).json(),{ready:true});const response=await request('submit',{offer,signedData});assert.equal(response.status,200);assert.deepEqual(await response.json(),{state:'submitted',intentHash:'2'.repeat(44),depositAddress:offer.quote.quote.depositAddress,settlementVerified:false});assert.equal(submitted,1);},
 {apiKey:'synthetic',now:()=>now,verifySignature:verifier,submit:async(value,signature,options)=>{submitted++;assert.deepEqual(value,offer);assert.deepEqual(signature,signedData);assert.equal(options.apiKey,'synthetic');return {state:'submitted',intentHash:'2'.repeat(44),depositAddress:value.quote.quote.depositAddress,settlementVerified:false};}});
});
test('foreign origins, invalid signatures and oversized requests cannot reach execution',async()=>{
 const offer=approvalFixture(),signedData=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
 await fixture(async(request,calls)=>{assert.equal((await request('submit',{offer,signedData},{origin:'https://attacker.invalid'})).status,403);assert.equal((await request('submit',{offer,signedData:{...signedData,payload:signedData.payload+' '}})).status,400);assert.equal((await request('submit',{offer,signedData,extra:true})).status,400);assert.equal((await request('submit',{extra:'x'.repeat(65540)})).status,413);assert.equal(calls(),0);},{apiKey:'synthetic',now:()=>now,verifySignature:verifier});
});

test('a stalled request body times out and releases its execution slot',()=>fixture(async(request,calls)=>{
 const config=await request('config'),origin=new URL(config.url).origin;
 const response=await new Promise((resolve,reject)=>{
  const req=http.request(origin+'/api/private-executor/submit',{method:'POST',headers:{origin,'content-type':'application/json'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{req.destroy();resolve({status:res.statusCode,body});});});
  req.on('error',reject);req.write('{');setTimeout(()=>{req.destroy();reject(Error('Body timeout did not respond'));},1000).unref();
 });
 assert.equal(response.status,503);assert.equal(calls(),0);assert.equal((await request('submit',{})).status,400);
},{apiKey:'synthetic',timeoutMs:40}));

test('expired approvals remain checkable and provider activity stays unverified',async()=>{
 const offer=approvalFixture();let reads=0;
 await fixture(async(request)=>{
  const response=await request('status',{offer});assert.equal(response.status,200);const result=await response.json();assert.equal(result.status,'SUCCESS');assert.equal(result.settlementVerified,false);assert.equal(reads,1);
  const signedData=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
  assert.equal((await request('submit',{offer,signedData})).status,400);
 },{apiKey:'synthetic',now:()=>now+400000000,verifySignature:verifier,observe:async()=>{reads++;return {type:'lenz/private-status/v1',depositAddress:offer.quote.quote.depositAddress,status:'SUCCESS',updatedAt:new Date(now+400000000).toISOString(),observedAt:now+400000000,amountIn:offer.terms.amount,amountOut:offer.terms.amount,refundedAmount:null,withdrawFee:'0',settlementVerified:false,providerReportSigned:false};}});
});

test('a lost or malformed submission result produces no automatic retry',async()=>{
 const offer=approvalFixture(),signedData=confidentialSignedData(offer.generated.intent.payload,await wallet.signMessage(offer.generated.intent.payload),owner);
 for(const mode of ['lost','wrong-hash','settled']){let calls=0;await fixture(async(request)=>{
  const response=await request('submit',{offer,signedData});assert.equal(response.status,503);assert.match((await response.json()).error,/unknown/);assert.equal(calls,1);
 },{apiKey:'synthetic',now:()=>now,verifySignature:verifier,submit:async()=>{calls++;if(mode==='lost')throw Error('Reply lost');return {state:'submitted',intentHash:mode==='wrong-hash'?'1'.repeat(44):'2'.repeat(44),depositAddress:offer.quote.quote.depositAddress,settlementVerified:mode==='settled'};}});}
});
