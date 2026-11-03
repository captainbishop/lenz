import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readOraclePrices} from './oracle-prices.mjs';
import {ORACLE_NETWORKS,ORACLE_FEEDS,oracleRequest,oracleSnapshot,oracleDecimal,oracleState} from '../web/public/oracle-feeds.js';
const {Interface}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const abi=new Interface(['function decimals() view returns(uint8)','function description() view returns(string)','function latestRoundData() view returns(uint80,int256,uint256,uint256,uint80)']);
const now=1800000000000,hash='0x'+'ab'.repeat(32);
export function oracleMock(network='arbitrum',edit=()=>{}){
  const n=ORACLE_NETWORKS[network],calls=[];
  const fetcher=async(url,options)=>{
    assert.equal(url,n.rpc);const r=JSON.parse(options.body);calls.push(r);let result,name,values;
    if(r.method==='eth_chainId')result='0x'+n.chainId.toString(16);
    else if(r.method==='eth_getBlockByNumber')result={number:'0x1234',hash,timestamp:'0x'+(now/1000-2).toString(16)};
    else{assert.deepEqual(r.params[1],{blockHash:hash,requireCanonical:true});if(r.method==='eth_getCode')result='0x6001';else{assert.equal(r.method,'eth_call');name=abi.parseTransaction({data:r.params[0].data}).name;const address=r.params[0].to,f=ORACLE_FEEDS.find(f=>f.address===address),seq=address===n.sequencer;values={decimals:[8],description:[f?.description],latestRoundData:[5n,seq?0n:232345678901n,BigInt(now/1000-(seq?7200:30)),BigInt(now/1000-(seq?7200:30)),5n]}[name];edit({request:r,name,values,seq});result=abi.encodeFunctionResult(name,values);}}
    const response={jsonrpc:'2.0',id:r.id,result};edit({request:r,name,response});return Response.json(response);
  };return {fetcher,clock:()=>now,calls};
}
test('all reviewed networks decode their exact feeds at one canonical block',async()=>{
  for(const network of Object.keys(ORACLE_NETWORKS)){const mock=oracleMock(network),s=await readOraclePrices({network},mock);assert(s.feeds.every(f=>f.status==='current'));assert(Object.isFrozen(s.feeds));assert.equal(s.chainId,ORACLE_NETWORKS[network].chainId);assert(mock.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(c.method)));assert.equal(oracleDecimal(s.feeds[0]),'2323.45678901');}
});
test('network requests reject arbitrary destinations, account data and inherited keys',()=>{for(const r of [{network:'constructor'},{network:'ethereum',address:'secret'},{network:'base',url:'https://other.test'},{}])assert.throws(()=>oracleRequest(r));});
test('wrong chain and changed canonical block reject the network',async()=>{
  await assert.rejects(()=>readOraclePrices({network:'ethereum'},oracleMock('ethereum',({request,response})=>{if(response&&request.method==='eth_chainId')response.result='0x2';})),/Wrong oracle chain/);
  await assert.rejects(()=>readOraclePrices({network:'ethereum'},oracleMock('ethereum',({request,response})=>{if(response&&request.method==='eth_getBlockByNumber'&&request.params[0]!=='latest')response.result.hash='0x'+'cd'.repeat(32);})),/block changed/);
});
test('stale or future blocks cannot authenticate a price observation',async()=>{for(const delta of [-61,10])await assert.rejects(()=>readOraclePrices({network:'ethereum'},oracleMock('ethereum',({request,response})=>{if(response&&request.method==='eth_getBlockByNumber')response.result.timestamp='0x'+(now/1000+delta).toString(16);})),/Stale oracle block/);});
test('L2 outage, uninitialized status and recovery grace period reject prices',async()=>{
  for(const mutation of [v=>v[1]=1n,v=>v[2]=0n,v=>{v[2]=BigInt(now/1000-300);v[3]=v[2];},v=>v[3]=BigInt(now/1000+20)])await assert.rejects(()=>readOraclePrices({network:'arbitrum'},oracleMock('arbitrum',({seq,name,values})=>{if(seq&&name==='latestRoundData')mutation(values);})),/Sequencer/);
});
test('missing code, mismatched decimals and asset descriptions isolate an unavailable feed',async()=>{
  for(const kind of ['code','decimals','description']){const first=ORACLE_FEEDS.find(f=>f.network==='ethereum').address;const s=await readOraclePrices({network:'ethereum'},oracleMock('ethereum',({request,response,name,values})=>{if(request.params?.[0]===first&&response&&kind==='code')response.result='0x';if(request.params?.[0]?.to===first&&values){if(name==='decimals'&&kind===name)values[0]=18;if(name==='description'&&kind===name)values[0]='FAKE / USD';}}));assert.equal(s.feeds[0].status,'unavailable');assert(s.feeds.slice(1).every(f=>f.status==='current'));}
});
test('nonpositive answers, incomplete rounds and stale or future updates stay unavailable',async()=>{
  for(const mutate of [v=>v[1]=0n,v=>v[1]=-1n,v=>v[0]=0n,v=>v[4]=4n,v=>v[3]=0n,v=>v[3]=BigInt(now/1000+10),v=>v[2]=BigInt(now/1000),v=>{v[2]=1n;v[3]=1n;}]){const s=await readOraclePrices({network:'ethereum'},oracleMock('ethereum',({name,values})=>{if(name==='latestRoundData')mutate(values);}));assert(s.feeds.every(f=>f.status==='unavailable'));}
});
test('browser validation rejects substitutions and injected execution authority',async()=>{
  const s=await readOraclePrices({network:'arbitrum'},oracleMock());
  for(const change of [v=>v.chainId=1,v=>v.network='constructor',v=>v.source='https://wrong.test',v=>v.executable=true,v=>v.feeds.push(v.feeds[0]),v=>v.feeds[1]=v.feeds[0],v=>v.feeds[0].decimals=18,v=>v.feeds[0].address='0x'+'00'.repeat(20),v=>v.feeds[0].updatedAt=now+10000,v=>v.sequencer.answer='1']){const v=structuredClone(s);change(v);assert.throws(()=>oracleSnapshot(v,{now}));}
});
test('old observations require explicit cached parsing and never become current offline',async()=>{
  const s=await readOraclePrices({network:'ethereum'},oracleMock('ethereum'));assert.throws(()=>oracleSnapshot(s,{now:now+86400000}));const cached=oracleSnapshot(s,{now:now+86400000,cached:true});assert.equal(oracleState(cached,cached.feeds[0],{now:now+86400000}),'Earlier price');assert.equal(oracleState(cached,cached.feeds[0],{now,online:false}),'Offline · Saved');assert.equal(oracleState(cached,cached.feeds[0],{now,saved:true}),'Earlier price');
});
