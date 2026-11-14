import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHyperliquidTestnetFundingHttpRoute} from './hyperliquid-testnet-funding-http.mjs';
const request={version:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account:'0x'+'1'.repeat(40),chainId:'hypercore:testnet'};
async function fixture(t,overrides={}){
 let route,calls=0;const service={configuration:async()=>({version:1,chainId:'hypercore:testnet',environment:'testnet',grants:{spotUSDC:'100',perpsUSDC:'100'},available:false,reason:'operator_unconfigured'}),request:async body=>{calls++;return {...body,environment:'testnet',state:'pending',receipts:[]};},...overrides};
 const server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
 const origin='http://127.0.0.1:'+server.address().port;route=createHyperliquidTestnetFundingHttpRoute({origin,service});
 const send=(body=request,headers={},path='/api/hyperliquid-testnet/funding/request',method='POST')=>new Promise((resolve,reject)=>{const req=http.request(origin+path,{method,headers:{origin,'sec-fetch-site':'same-origin',...(method==='POST'?{'content-type':'application/json'}:{}),...headers}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const raw=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,headers:new Headers(res.headers),text:async()=>raw,json:async()=>JSON.parse(raw)});});});req.on('error',reject);req.end(method==='POST'?(typeof body==='string'?body:JSON.stringify(body)):undefined);});return {origin,send,calls:()=>calls};
}
test('funding rejects cross-origin, nonlocal hosts and foreign fetch contexts before the service',async t=>{
 const f=await fixture(t);for(const headers of [{origin:'https://attacker.example'},{host:'attacker.example'},{'sec-fetch-site':'cross-site'}])assert.equal((await f.send(request,headers)).status,403,JSON.stringify(headers));assert.equal(f.calls(),0);
});
test('funding rejects unknown routes, methods, content types, oversized bodies and source substitutions',async t=>{
 const f=await fixture(t);assert.equal((await f.send(request,{},'/api/hyperliquid-testnet/funding/other')).status,404);assert.equal((await f.send(request,{},'/api/hyperliquid-testnet/funding/request','GET')).status,405);assert.equal((await f.send(request,{'content-type':'text/plain'})).status,415);assert.equal((await f.send('x'.repeat(1025))).status,413);
 for(const body of ['{',{...request,chainId:'hypercore:mainnet'},{...request,amount:'1000'},{...request,key:'secret'}])assert.equal((await f.send(body)).status,400);assert.equal(f.calls(),0);
});
test('same-origin reads expose honest availability, retain the funding request and enforce a bounded HTTP rate',async t=>{
 const f=await fixture(t);const status=await f.send(null,{},'/api/hyperliquid-testnet/funding','GET');assert.equal(status.headers.get('cache-control'),'no-store');assert.equal((await status.json()).reason,'operator_unconfigured');
 const reply=await f.send();assert.equal(reply.status,200);assert.equal((await reply.json()).id,request.id);assert.equal(f.calls(),1);
 for(let i=0;i<28;i++)assert.equal((await f.send(null,{},'/api/hyperliquid-testnet/funding','GET')).status,200);assert.equal((await f.send()).status,429);assert.equal(f.calls(),1);
});
test('upstream errors cannot reveal operator keys or private journal paths through the HTTP response',async t=>{
 const f=await fixture(t,{request:async()=>{throw Error('Private key '+ 'a'.repeat(64)+' at C:/private/operator.json');}});const result=await f.send();assert.equal(result.status,503);const raw=await result.text();assert(!raw.includes('Private key'));assert(!raw.includes('operator.json'));assert.match(raw,/Keep this request/);
});

test('same-origin account recovery reads the original request while rejecting recipient, source and write-field substitutions',async t=>{
 const recovered=[];const f=await fixture(t,{recover:async body=>{recovered.push(body);return {...body,environment:'testnet',request,state:'confirmed',createdAt:1700000000000,receipts:[]};}}),body={version:1,account:request.account,chainId:request.chainId},path='/api/hyperliquid-testnet/funding/recover';
 const reply=await f.send(body,{},path);assert.equal(reply.status,200);assert.deepEqual((await reply.json()).request,request);assert.deepEqual(recovered,[body]);assert.equal(f.calls(),0);
 for(const changed of [{...body,chainId:'hypercore:mainnet'},{...body,id:request.id},{...body,amount:'1000'},{...body,account:'0x'+'0'.repeat(40)}])assert.equal((await f.send(changed,{},path)).status,400);
 assert.equal((await f.send(body,{origin:'https://attacker.example'},path)).status,403);assert.equal(recovered.length,1);assert.equal(f.calls(),0);
});
