import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createNearIntentHttpRoute} from './intent-near-http.mjs';

async function run(options,operation){
 let calls=0,opens=0;const origin='http://localhost:4173';
 const route=createNearIntentHttpRoute({origin,stateDir:'private',deployerKeyFile:'key',deploymentStateFile:'deployment',openRelay:async()=>{opens++;return {configuration:async()=>{calls++;return {network:'testnet',ready:true};},close:async()=>{}};},...options});
 const server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const request=async(overrides={})=>{
  const {body='{}',headers={},path='/api/intent-near/config',method='POST'}=overrides;
  return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{host:'localhost:4173',origin,'content-type':'application/json','content-length':Buffer.byteLength(body),...headers}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:text?JSON.parse(text):null}));});req.on('error',reject);req.end(body);});
 };
 try{await operation(request,()=>({calls,opens}));}finally{await route.close();await new Promise(resolve=>server.close(resolve));}
}
test('local JSON route returns the configured testnet check',()=>run({},async(request,counts)=>{const result=await request();assert.equal(result.status,200);assert.equal(result.body.network,'testnet');assert.deepEqual(counts(),{calls:1,opens:1});}));
test('foreign origins and host rebinding never open the signer',()=>run({},async(request,counts)=>{for(const headers of [{origin:'https://attacker.example'},{host:'attacker.example:4173'},{origin:''},{'sec-fetch-site':'cross-site'}])assert.equal((await request({headers})).status,403);assert.deepEqual(counts(),{calls:0,opens:0});}));
test('unknown operations, malformed JSON and oversized requests never open the signer',()=>run({},async(request,counts)=>{assert.equal((await request({path:'/api/intent-near/__proto__'})).status,404);assert.equal((await request({method:'GET'})).status,405);assert.equal((await request({headers:{'content-type':'text/plain'}})).status,415);assert.equal((await request({body:'[]'})).status,400);assert.equal((await request({body:'bad'})).status,400);assert.equal((await request({body:JSON.stringify({text:'a'.repeat(65536)})})).status,413);assert.deepEqual(counts(),{calls:0,opens:0});}));
test('absent real deployment stays unavailable',()=>run({stateDir:null},async(request,counts)=>{assert.equal((await request()).status,503);assert.deepEqual(counts(),{calls:0,opens:0});}));

test('an unconfigured testnet route preserves HTTPS and LAN app startup',async()=>{
 for(const origin of ['https://lenz.example','http://192.168.1.20:4173']){
  await run({origin,stateDir:null},async(request,counts)=>{assert.equal((await request({headers:{host:new URL(origin).host,origin}})).status,403);assert.deepEqual(counts(),{calls:0,opens:0});});
  assert.throws(()=>createNearIntentHttpRoute({origin,stateDir:'private',deployerKeyFile:'key',deploymentStateFile:'deployment'}),/local Lenz origin/);
 }
});
test('private configuration parse failures cannot expose file fragments',()=>run({openRelay:async()=>JSON.parse('ed25519:private-file-fragment')},async request=>{const result=await request();assert.equal(result.status,503);assert(!result.body.error.includes('ed25519'));assert(!result.body.error.includes('private-file-fragment'));}));
test('rate bound rejects before invoking the route again',()=>run({},async(request,counts)=>{for(let i=0;i<120;i++)assert.equal((await request()).status,200);assert.equal((await request()).status,429);assert.equal(counts().calls,120);}));
