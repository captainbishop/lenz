import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readDegenPair,quoteDegen} from './degen-quotes.mjs';
import {degenQuoteRequest,checkedDegenPair,checkedDegenQuote} from '../web/public/degen-quote.js';

const {Interface}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const abi=new Interface(['function decimals() view returns(uint8)','function symbol() view returns(string)','function getPool(address,address,uint24) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function liquidity() view returns(uint128)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function factory() view returns(address)','function WETH9() view returns(address)','function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)']);
const NOW=1800000000000,token='0x'+'11'.repeat(20),pool='0x'+'22'.repeat(20),weth='0x4200000000000000000000000000000000000006',factory='0x33128a8fc17869897dce68ed026d694621f6fdfd';
const pair={kind:'pool',network:'base',pool,token,privacy:'public'};
export function quoteFixture(edit=()=>{}){
 const calls=[],block={number:'0x1234',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+BigInt((NOW-1000)/1000).toString(16)};
 return {calls,clock:()=>NOW,fetcher:async(url,options)=>{
  assert.equal(url,'https://mainnet.base.org');assert.equal(options.redirect,'error');const request=JSON.parse(options.body);calls.push(request);let result;
  if(request.method==='eth_chainId')result='0x2105';
  else if(request.method==='eth_getBlockByNumber')result={...block};
  else if(request.method==='eth_getCode')result='0x6001';
  else if(request.method==='eth_call'){
   const tx=request.params[0],parsed=abi.parseTransaction({data:tx.data}),name=parsed.name;
   const values={decimals:[tx.to==='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'?6:18],symbol:[tx.to===token?'DGN':'WETH'],getPool:[pool],token0:[token],token1:[weth],fee:[3000],liquidity:[1000],slot0:[2n**96n,0,0,1,1,0,true],factory:[factory],WETH9:[weth],quoteExactInputSingle:[name==='quoteExactInputSingle'&&parsed.args[0].tokenIn.toLowerCase()===weth?42000000000000000000n:10000000000000000n,2n**96n,1,120000]}[name];
   const state={request,parsed,name,values};edit(state);result=abi.encodeFunctionResult(name,state.values);
  }else assert.fail('Unexpected RPC method '+request.method);
  const response={jsonrpc:'2.0',id:request.id,result};edit({request,response});return Response.json(response);
 }};
}
test('Degen buys quote the selected contract using the on-chain counter asset and exact minimum',async()=>{
 const fixture=quoteFixture(),request={...pair,kind:'quote',side:'buy',amount:'0.25',slippageBps:50};
 const metadata=await readDegenPair(pair,fixture);assert.equal(metadata.assets[0].id,token);assert.equal(metadata.assets[0].symbol,'DGN');assert.equal(metadata.assets[1].id,weth);
 const quote=await quoteDegen(request,fixture);assert.equal(quote.input.id,weth);assert.equal(quote.output.id,token);assert.equal(quote.inputUnits,'250000000000000000');assert.equal(quote.outputUnits,'42000000000000000000');assert.equal(quote.minOutputUnits,'41790000000000000000');assert.equal(quote.executable,false);
 assert.equal(checkedDegenQuote(quote,request,{now:NOW}).feePips,3000);assert(fixture.calls.every(r=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(r.method)));
});
test('selling reverses exact input and output without treating ticker text as identity',async()=>{
 const request={...pair,kind:'quote',side:'sell',amount:'2',slippageBps:100},quote=await quoteDegen(request,quoteFixture());
 assert.equal(quote.input.id,token);assert.equal(quote.output.id,weth);assert.equal(quote.inputUnits,'2000000000000000000');assert.equal(quote.minOutputUnits,'9900000000000000');
 const six=quoteFixture(s=>{if(s.name==='decimals'&&s.request.params[0].to===token)s.values=[6];});
 assert.equal((await quoteDegen({...request,amount:'1.123456'},six)).inputUnits,'1123456');
 await assert.rejects(quoteDegen({...request,amount:'1.1234567'},six),/at most 6/);
});
test('unregistered pools, other tokens, absent code and locked liquidity cannot produce quotes',async()=>{
 const request={...pair,kind:'quote',side:'buy',amount:'1',slippageBps:50};
 for(const mutation of [s=>{if(s.name==='factory')s.values=[token];},s=>{if(s.name==='getPool')s.values=[token];},s=>{if(s.name==='token0')s.values=['0x'+'10'.repeat(20)];},s=>{if(s.name==='liquidity')s.values=[0];},s=>{if(s.name==='slot0')s.values[6]=false;},s=>{if(s.response&&s.request.method==='eth_getCode')s.response.result='0x';}])await assert.rejects(quoteDegen(request,quoteFixture(mutation)));
});
test('freshness, canonical block, quoter identity and full-fill bounds hold',async()=>{
 const request={...pair,kind:'quote',side:'buy',amount:'1',slippageBps:50};
 for(const mutation of [s=>{if(s.name==='WETH9')s.values=[token];},s=>{if(s.name==='quoteExactInputSingle')s.values[1]=4295128739n;},s=>{if(s.name==='quoteExactInputSingle')s.values[0]=0;},s=>{if(s.response&&s.request.method==='eth_chainId')s.response.result='0x1';},s=>{if(s.response&&s.request.method==='eth_getBlockByNumber'&&s.request.params[0]!=='latest')s.response.result.hash='0x'+'cd'.repeat(32);},s=>{if(s.response&&s.request.method==='eth_getBlockByNumber')s.response.result.timestamp='0x1';}])await assert.rejects(quoteDegen(request,quoteFixture(mutation)));
});
test('request and response validation rejects injected authority, substitution and fabricated minima',async()=>{
 const request={...pair,kind:'quote',side:'buy',amount:'1',slippageBps:50},quote=await quoteDegen(request,quoteFixture());
 for(const mutation of [{privacy:'private'},{network:'ethereum'},{pool:'https://bad.test'},{recipient:token},{calldata:'0x1234'},{amount:'1e18'},{slippageBps:501}])assert.throws(()=>degenQuoteRequest({...request,...mutation}));
 for(const mutation of [{request:{...request,side:'sell'}},{output:quote.input},{inputUnits:'1'},{minOutputUnits:'1'},{executable:true},{transaction:{to:token}},{assets:[...quote.assets].reverse()}])assert.throws(()=>checkedDegenQuote({...quote,...mutation},request,{now:NOW}));
 assert.throws(()=>checkedDegenQuote(quote,request,{now:quote.expiresAt}),/expired/);
 const data=await readDegenPair(pair,quoteFixture());assert.throws(()=>checkedDegenPair({...data,assets:[{...data.assets[0],symbol:'\u202eDGN'},data.assets[1]]},pair,{now:NOW}));
});
test('cancelled pool reads stop before any further upstream request',async()=>{
 const abort=new AbortController();abort.abort();const fixture=quoteFixture();
 await assert.rejects(readDegenPair(pair,{...fixture,signal:abort.signal}),{name:'AbortError'});
 assert.equal(fixture.calls.length,0);
});
test('display symbols do not decide pool identity and unusable symbols fall back to the address',async()=>{
 for(const symbol of ['$DGN','猫','<img src=x>']){const data=await readDegenPair(pair,quoteFixture(s=>{if(s.name==='symbol'&&s.request.params[0].to===token)s.values=[symbol];}));assert.equal(data.assets[0].id,token);assert.equal(data.assets[0].symbol,symbol);}
 const data=await readDegenPair(pair,quoteFixture(s=>{if(s.name==='symbol')s.values=['\u202eDGN'];}));assert.equal(data.assets[0].symbol,'0x1111…1111');
});
