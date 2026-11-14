import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createAuroraFundingHttpRoute} from './intent-aurora-funding-http.mjs';

async function fixture({configured=true}={}){
 let opened=0,calls=0,clock=1000;const server=http.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const route=createAuroraFundingHttpRoute({origin,stateDir:configured?'C:/private-fixture':undefined,deployerKeyFile:'C:/private-fixture/key.json',operatorId:'fixture.testnet',engineCodeHash:'fixture',now:()=>clock,openService:async()=>{opened++;return {configuration:async()=>{calls++;return {available:false};},prepare:async()=>{calls++;throw Error('PRIVATE_SECRET_JSON');},close:async()=>{}};}});
 server.on('request',(request,response)=>void route(request,response));
 return {origin,counts:()=>({opened,calls}),advance:duration=>{clock+=duration;},async post(operation,body,headers={}){return fetch(origin+'/api/intent-aurora-funds/'+operation,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});},async close(){await route.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
test('private faucet HTTP reads require exact local origin and body',async()=>{const f=await fixture();try{assert.equal((await f.post('config',{})).status,200);assert.deepEqual(f.counts(),{opened:1,calls:1});assert.equal((await f.post('config',{}, {Origin:'https://other.example'})).status,403);assert.equal((await f.post('prepare',{owner:'fixture',commitment:'fixture',secret:'never allowed'})).status,400);assert.equal((await f.post('prepare',{owner:'fixture',commitment:'fixture',nullifierHash:'never allowed'})).status,400);assert.equal((await f.post('config',{owner:'fixture'})).status,400);assert.deepEqual(f.counts(),{opened:1,calls:1});}finally{await f.close();}});
test('malformed, oversized, unknown and private service errors remain sanitized',async()=>{const f=await fixture();try{assert.equal((await f.post('prepare','{broken')).status,400);assert.equal((await f.post('prepare',' '.repeat(16385))).status,413);assert.equal((await f.post('unlisted',{})).status,404);const response=await f.post('prepare',{owner:'fixture',commitment:'fixture'});assert.equal(response.status,503);assert(!(await response.text()).includes('PRIVATE_SECRET_JSON'));}finally{await f.close();}});

test('host, fetch site, method and content type guards reject before opening financial authority',async()=>{const f=await fixture();try{
 for(const headers of [{Host:'attacker.example',Origin:'http://attacker.example'},{Host:'localhost:1',Origin:'http://localhost:1'},{Origin:f.origin,'Sec-Fetch-Site':'cross-site'},{Origin:'null'},{'Content-Type':'text/plain'}])assert.notEqual((await f.post('config',{},headers)).status,200);
 assert.equal((await fetch(f.origin+'/api/intent-aurora-funds/config',{headers:{Origin:f.origin}})).status,405);
 assert.deepEqual(f.counts(),{opened:0,calls:0});assert.equal((await f.post('config',{}, {'Content-Type':'application/json; charset=utf-8'})).status,200);assert.deepEqual(f.counts(),{opened:1,calls:1});
 }finally{await f.close();}});

test('only exact plain request objects reach the service and unconfigured funding stays closed',async()=>{const f=await fixture(),unconfigured=await fixture({configured:false});try{
 for(const body of [null,[],1,'"string"','true',{}])assert.equal((await f.post('prepare',body)).status,400);
 for(const operation of ['submit','reconcile','resume','cleanup'])for(const body of [{review:{}},{signed:{}},{review:{},signed:{},secret:'forbidden'}])assert.equal((await f.post(operation,body)).status,400);
 assert.deepEqual(f.counts(),{opened:0,calls:0});assert.equal((await unconfigured.post('config',{})).status,503);assert.deepEqual(unconfigured.counts(),{opened:0,calls:0});
 }finally{await f.close();await unconfigured.close();}});

test('request budget limits service calls and resets after its exact window',async()=>{const f=await fixture();try{for(let i=0;i<30;i++)assert.equal((await f.post('config',{})).status,200);assert.equal((await f.post('config',{})).status,429);assert.deepEqual(f.counts(),{opened:1,calls:30});f.advance(60000);const response=await f.post('config',{});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(f.counts(),{opened:1,calls:31});}finally{await f.close();}});

test('private faucet origin configuration accepts only loopback HTTP',()=>{for(const origin of ['https://localhost:4173','http://attacker.example','http://192.168.1.5:4173'])assert.throws(()=>createAuroraFundingHttpRoute({origin}),/local Lenz origin/);});
