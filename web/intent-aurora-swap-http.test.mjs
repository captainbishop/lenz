import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {auroraVaultAddress} from './public/intent-aurora-plan.js';
import {createAuroraSwapHttpRoute} from './intent-aurora-swap-http.mjs';

async function fixture(){
 let opened=0,calls=0;const server=http.createServer();await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 const route=createAuroraSwapHttpRoute({origin,stateDir:'C:/outside-fixture',deployerKeyFile:'C:/outside-fixture/key.json',operatorId:'fixture.testnet',engineCodeHash:'fixture',openService:async()=>{opened++;return {configuration:async()=>{calls++;return {available:false,execute:false};},prepare:async body=>{calls++;return {...body,available:true,execute:true};},submit:async()=>{calls++;throw Error('PRIVATE_OPERATOR_CONTENT');},close:async()=>{}};}});
 server.on('request',(request,response)=>void route(request,response));const plan={beneficiary:'0x'+'34'.repeat(20),refundRecipient:'0x'+'34'.repeat(20),relayer:'0x'+'0'.repeat(40),relayerFee:'0',minOutput:'2000000',deadline:'1794620300',salt:'0x'+'56'.repeat(32)},selection={plan,vault:auroraVaultAddress(plan),root:'0x'+'01'.repeat(32),nullifierHash:'0x'+'02'.repeat(32)};
 return {origin,selection,counts:()=>({opened,calls}),post:(operation,body,headers={})=>fetch(origin+'/api/intent-aurora-swap/'+operation,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}),async close(){await route.close();server.closeAllConnections();await new Promise(done=>server.close(done));}};
}
test('private swap HTTP accepts only the local public selection and excludes note secrets before opening the signer',async()=>{
 const f=await fixture();try{
  for(const body of [{...f.selection,owner:'forbidden'},{...f.selection,commitment:'forbidden'},{...f.selection,note:'forbidden'},{...f.selection,plan:{...f.selection.plan,secret:'forbidden'}},null,[]])assert.equal((await f.post('prepare',body)).status,400);
  assert.deepEqual(f.counts(),{opened:0,calls:0});const response=await f.post('prepare',f.selection);assert.equal(response.status,200);assert.deepEqual((await response.json()).plan,f.selection.plan);assert.deepEqual(f.counts(),{opened:1,calls:1});
 }finally{await f.close();}
});
test('private swap host, origin, body size, method and content-type guards run before any service opens',async()=>{
 const f=await fixture();try{
  for(const headers of [{Origin:'null'},{Origin:'https://attacker.example'},{Host:'attacker.example',Origin:'http://attacker.example'},{'Sec-Fetch-Site':'cross-site'},{'Content-Type':'text/plain'}])assert.notEqual((await f.post('config',{},headers)).status,200);
  assert.equal((await fetch(f.origin+'/api/intent-aurora-swap/config',{headers:{Origin:f.origin}})).status,405);assert.equal((await f.post('prepare','x'.repeat(16385))).status,413);assert.equal((await f.post('unlisted',{})).status,404);assert.deepEqual(f.counts(),{opened:0,calls:0});
 }finally{await f.close();}
});
