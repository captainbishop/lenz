import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPrivateSpendRoute} from './private-spend-relay.mjs';

const terms={owner:'0x'+'11'.repeat(20),originAsset:'nep141:eth.omft.near',destinationAsset:'nep141:eth.omft.near',amount:'100',minOutput:'100',recipient:'0x'+'22'.repeat(20),refundDeadline:new Date(Date.now()+3600000).toISOString(),slippageBps:0};
async function fixture(run,options={}){
 let calls=0;
 let route;const server=http.createServer((req,res)=>route(req,res));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 route=createPrivateSpendRoute({origin,apiKey:'test-partner',prepare:async value=>{calls++;return {state:'awaiting-owner-review',offer:{terms:value}};},...options});
 try{await run(async(body=terms,headers={})=>fetch(origin+'/api/private-spend/prepare',{method:'POST',headers:{origin,'content-type':'application/json',...headers},body:JSON.stringify(body)}),()=>calls);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
test('preparation accepts chosen terms and never accepts wallet signatures',()=>fixture(async(send,calls)=>{
 assert.equal((await send()).status,200);assert.equal(calls(),1);
 assert.equal((await send({...terms,signedData:{payload:'do not submit'}})).status,400);assert.equal(calls(),1);
}));
test('cross-origin requests and oversized bodies do not reach the partner',()=>fixture(async(send,calls)=>{
 assert.equal((await send(terms,{origin:'https://attacker.invalid'})).status,403);
 assert.equal((await send({...terms,extra:'x'.repeat(5000)})).status,413);assert.equal(calls(),0);
}));
test('unconfigured partner access fails without disclosing configuration',()=>fixture(async(send,calls)=>{
 const response=await send();assert.equal(response.status,503);assert.match((await response.json()).error,/unavailable/);assert.equal(calls(),0);
},{apiKey:undefined}));
test('payment preparation rejects alternate assets, reduced minimums and slippage',()=>fixture(async(send,calls)=>{
 for(const changes of [{destinationAsset:'nep141:usdc.near'},{minOutput:'1'},{slippageBps:1}])assert.equal((await send({...terms,...changes})).status,400);
 assert.equal(calls(),0);
}));

test('native funding endpoint prepares only explicit ETH terms and rejects signatures',async()=>{
 let calls=0;const funding={owner:terms.owner,chainId:'0x1',amount:terms.amount,refundDeadline:terms.refundDeadline};
 let route;const server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 route=createPrivateSpendRoute({origin,apiKey:'test-partner',prepareFunding:async input=>{calls++;assert.deepEqual(input,funding);return {state:'awaiting-funding-review'};}});
 const send=body=>fetch(origin+'/api/private-spend/fund-prepare',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
 try{assert.equal((await send(funding)).status,200);assert.equal((await send({...funding,signedData:{}})).status,400);assert.equal((await send({...funding,chainId:'0x89'})).status,400);assert.equal(calls,1);}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
