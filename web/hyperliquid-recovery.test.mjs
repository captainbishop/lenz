import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOrder,resolveOrderMarket} from './public/hyperliquid-order.js';
import {readTradingOrder} from './public/hyperliquid-trading.js';

const account='0x1111111111111111111111111111111111111111',nonce=1700000000000,cloid='0x'+'ab'.repeat(16);
const spot={tokens:[{index:0,name:'USDC',szDecimals:8},{index:150,name:'HYPE',szDecimals:2}],universe:[{index:107,name:'@107',tokens:[150,0]}]};
const market=resolveOrderMarket({environment:'testnet',chainId:'hypercore:testnet',id:'spot:107',kind:'spot',coin:'@107',quote:{index:0,symbol:'USDC'}},{spot});
const review=prepareOrder(market,account,{side:'buy',size:'1.25',price:'20',reduceOnly:false},{mode:'disabled',fee:'0.001',spot:[{token:0,total:'100',hold:'0'}]},{now:nonce,cloid});
const order={coin:'@107',side:'B',limitPx:'20',sz:'0',origSz:'1.25',oid:321,timestamp:nonce+10,cloid};
const fill={coin:'@107',side:'B',px:'19.5',sz:'1.25',oid:321,tid:123,hash:'0x'+'12'.repeat(32),time:nonce+20,fee:'0.001',feeToken:'HYPE'};
async function withInfo(values,operation){
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.hyperliquid-testnet.xyz/info');const request=JSON.parse(options.body);assert.equal(request.user,account);calls.push(request);assert(Object.hasOwn(values,request.type),'Unexpected '+request.type);return Response.json(values[request.type]);};
 try{return await operation(calls);}finally{globalThis.fetch=previous;}
}

test('an interrupted client-ID lookup recovers the exact filled order from provider history and trade IDs',async()=>{
 await withInfo({orderStatus:{status:'unknownOid'},historicalOrders:[{order,status:'filled',statusTimestamp:nonce+30}],userFillsByTime:[fill]},async calls=>{
  const result=await readTradingOrder(review);
  assert.equal(result.state,'filled');assert.equal(result.filled,'1.25');assert.equal(result.oid,321);
  assert.deepEqual(result.fills,[{tid:123,hash:fill.hash,time:nonce+20,size:'1.25',price:'19.5',fee:'0.001',feeToken:'HYPE'}]);
  assert.deepEqual(calls.map(call=>call.type),['orderStatus','historicalOrders','userFillsByTime']);
 });
});

test('missing history and open orders leave an interrupted request unresolved',async()=>{
 await withInfo({orderStatus:{status:'unknownOid'},historicalOrders:[],frontendOpenOrders:[]},async()=>{
  assert.equal((await readTradingOrder(review)).state,'unknown');
 });
});

test('a still-open exact client order can be recovered without replaying its action',async()=>{
 await withInfo({orderStatus:{status:'unknownOid'},historicalOrders:[],frontendOpenOrders:[{...order,sz:'1.25'}]},async calls=>{
  const result=await readTradingOrder(review);assert.equal(result.state,'open');assert.equal(result.filled,'0');assert.equal(result.remaining,'1.25');
  assert(calls.every(call=>!Object.hasOwn(call,'action')));
 });
});

test('wrong, duplicate, oversized or missing fills cannot establish a completed trade',async()=>{
 const response={status:'order',order:{order,status:'filled',statusTimestamp:nonce+30}};
 for(const rows of [[],[{...fill,oid:322}],[fill,fill],[{...fill,sz:'0.625'},{...fill,sz:'0.625'}],[{...fill,coin:'@108'}],[{...fill,side:'A'}],[{...fill,px:'20.01'}],[{...fill,sz:'1.26'}],[{...fill,hash:'invalid'}],[{...fill,time:nonce-60001}],[{...fill,feeToken:'BAD'}]]){
  await withInfo({orderStatus:response,userFillsByTime:rows},async()=>{await assert.rejects(readTradingOrder(review),/fills|Fill|fees/);});
 }
});

test('partial fills survive cancellation with exact trade evidence and fees',async()=>{
 const response={status:'order',order:{order:{...order,sz:'0.75'},status:'canceled',statusTimestamp:nonce+30}};
 await withInfo({orderStatus:response,userFillsByTime:[{...fill,sz:'0.5',fee:'-0.001'}]},async()=>{
  const result=await readTradingOrder(review);assert.equal(result.state,'cancelled');assert.equal(result.filled,'0.5');assert.equal(result.remaining,'0.75');assert.equal(result.fills[0].fee,'-0.001');
 });
});

test('a reused or changed client ID in history never substitutes different order terms',async()=>{
 for(const history of [[{order:{...order,origSz:'1'},status:'filled',statusTimestamp:nonce+30}],[{order,status:'filled',statusTimestamp:nonce+30},{order:{...order,oid:322},status:'filled',statusTimestamp:nonce+30}]]){
  await withInfo({orderStatus:{status:'unknownOid'},historicalOrders:history},async()=>{await assert.rejects(readTradingOrder(review),/match|ambiguous/);});
 }
});
