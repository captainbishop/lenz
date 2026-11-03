import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const {Interface}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const module=await import(process.env.LENZ_DISCOVERY_MODULE?pathToFileURL(process.env.LENZ_DISCOVERY_MODULE):new URL('./market-discovery.mjs',import.meta.url));
const {MARKET_READS,discoverUniswap,discoverAave,discoverHyperliquid,marketJson,discoverMarket}=module;
const abi=new Interface(['function decimals() view returns(uint8)','function getPool(address,address,uint24) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function liquidity() view returns(uint128)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function getReservesList() view returns(address[])','function getConfiguration(address) view returns(uint256)']);
const now=1800000000000,blockHash='0x'+'ab'.repeat(32),pool='0x'+'12'.repeat(20),block={hash:blockHash,number:'0x1234',timestamp:'0x'+(BigInt(now/1000)-60n).toString(16)};
const config=decimals=>8000n+(8500n<<16n)+(BigInt(decimals)<<48n)+(1n<<56n)+(1n<<58n);
function baseMock(edit=()=>{}){
  const calls=[];
  const fetcher=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url,options,request});let result;
    if(request.method==='eth_chainId')result='0x2105';
    else if(request.method==='eth_getBlockByNumber')result={...block};
    else if(request.method==='eth_getCode')result='0x6001';
    else if(request.method==='eth_call'){
      const tx=request.params[0],parsed=abi.parseTransaction({data:tx.data}),name=parsed.name;
      let values={decimals:[tx.to===MARKET_READS.tokens[0].id?18:6],getPool:[pool],token0:[MARKET_READS.tokens[0].id],token1:[MARKET_READS.tokens[1].id],fee:[500],liquidity:[100n],slot0:[2n**96n,0,0,1,1,0,true],getReservesList:[MARKET_READS.tokens.map(t=>t.id)],getConfiguration:[config((parsed.args.length ? parsed.args[0] : '')?.toLowerCase()===MARKET_READS.tokens[0].id?18:6)]}[name];
      const state={request,name,values};edit(state);values=state.values;result=abi.encodeFunctionResult(name,values);
    }else assert.fail('Unexpected RPC method '+request.method);
    const response={jsonrpc:'2.0',id:request.id,result};edit({request,response});
    return Response.json(response);
  };
  return {calls,fetcher,clock:()=>now};
}
function hyperData(){return [{collateralToken:0,universe:[{name:'BTC',szDecimals:5,maxLeverage:40},{name:'ETH',szDecimals:4,maxLeverage:25,isDelisted:true}]},[{markPx:'60000',oraclePx:'60001',funding:'-0.00001',openInterest:'12.5'},{markPx:'2000',oraclePx:'2001',funding:'0.00001',openInterest:'10'}]];}
test('Uniswap discovery validates chain, token contracts, pool identity and one canonical block',async()=>{
  const mock=baseMock(),r=await discoverUniswap(mock);assert.equal(r.rows[0].status,'liquidity-observed');assert.equal(r.rows[0].feePips,500);assert.equal(r.rows[0].assets[1].decimals,6);assert.equal(r.executable,false);
  for(const call of mock.calls){assert.equal(call.url,MARKET_READS.baseRpc);assert.equal(call.options.redirect,'error');if(['eth_call','eth_getCode'].includes(call.request.method))assert.deepEqual(call.request.params.at(-1),{blockHash,requireCanonical:true});}
  assert.equal(r.evidence.blockHash,blockHash);assert.equal(Object.keys(r.evidence.codeSha256).length,4);
});
test('Aave observes listed reserves and paused/frozen flags without asserting availability to supply',async()=>{
  const mock=baseMock(s=>{if(s.name==='getConfiguration')s.values=[s.values[0]|(1n<<60n)|(1n<<57n)];});const r=await discoverAave(mock);
  assert.equal(r.rows.length,2);assert(r.rows.every(x=>x.paused&&x.frozen&&x.status==='paused'&&x.executable===false));assert.equal(r.rows[0].ltvBps,8000);
});
test('wrong chain, stale block and changed canonical block reject the observation',async()=>{
  for(const edit of [s=>{if(s.response&&s.request.method==='eth_chainId')s.response.result='0x1';},s=>{if(s.response&&s.request.method==='eth_getBlockByNumber')s.response.result.timestamp='0x1';},s=>{if(s.response&&s.request.method==='eth_getBlockByNumber'&&s.request.params[0]===block.number)s.response.result.hash='0x'+'cd'.repeat(32);}])await assert.rejects(discoverUniswap(baseMock(edit)),/chain|block/);
});
test('wrong RPC IDs and error envelopes are rejected',async()=>{
  await assert.rejects(discoverUniswap(baseMock(s=>{if(s.response)s.response.id+=1;})),/RPC response/);
  await assert.rejects(discoverUniswap(baseMock(s=>{if(s.response)s.response.error={message:'untrusted'};})),/RPC response/);
});
test('USDC precision, missing code and substituted pools fail closed',async()=>{
  for(const edit of [s=>{if(s.name==='decimals')s.values=[18];},s=>{if(s.response&&s.request.method==='eth_getCode')s.response.result='0x';},s=>{if(s.name==='token0')s.values=[MARKET_READS.tokens[1].id];},s=>{if(s.name==='fee')s.values=[3000];}])await assert.rejects(discoverUniswap(baseMock(edit)),/decimals|code|identity/);
});
test('unavailable or empty pools never become usable liquidity',async()=>{
  await assert.rejects(discoverUniswap(baseMock(s=>{if(s.name==='getPool')s.values=['0x'+'0'.repeat(40)];})),/unavailable/);
  const r=await discoverUniswap(baseMock(s=>{if(s.name==='liquidity')s.values=[0];}));assert.equal(r.rows[0].status,'unavailable');
});
test('reserve membership and reserve precision are independently checked',async()=>{
  await assert.rejects(discoverAave(baseMock(s=>{if(s.name==='getReservesList')s.values=[[MARKET_READS.tokens[0].id]];})),/not an Aave reserve/);
  await assert.rejects(discoverAave(baseMock(s=>{if(s.name==='getConfiguration')s.values=[config(2)];})),/reserve decimals/);
});
test('Hyperliquid contexts bind to universe indexes and retain delisting and timestamp limits',async()=>{
  let sent;const r=await discoverHyperliquid({fetcher:async(url,o)=>{sent={url,body:JSON.parse(o.body)};return Response.json(hyperData());},clock:()=>now});
  assert.deepEqual(sent,{url:MARKET_READS.hyperliquid,body:{type:'metaAndAssetCtxs',dex:''}});assert.equal(r.rows[0].instrument,'BTC');assert.equal(r.rows[1].status,'delisted');assert.equal(r.rows[1].venueIndex,1);assert.equal(r.rows[0].sizeDecimals,5);assert.equal(r.evidence.providerTimestamp,null);assert.equal(r.executable,false);
});
test('misaligned, duplicate or malformed Hyperliquid data is rejected',async()=>{
  for(const edit of [x=>x[1].pop(),x=>x[1].push({...x[1][0]}),x=>x[0].universe[1].name='BTC',x=>x[1][0].markPx='NaN',x=>x[0].universe[0].szDecimals=99,x=>x[0].universe[0].isDelisted='false']){
    const data=hyperData();edit(data);await assert.rejects(discoverHyperliquid({fetcher:async()=>Response.json(data)}));
  }
});
test('network reader rejects unapproved destinations, HTTP failures and oversized responses',async()=>{
  await assert.rejects(marketJson('https://untrusted.example',{}, {fetcher:()=>assert.fail()}),/Unapproved/);
  await assert.rejects(marketJson(MARKET_READS.hyperliquid,{}, {fetcher:async()=>new Response('no',{status:503})}),/503/);
  await assert.rejects(marketJson(MARKET_READS.hyperliquid,{}, {fetcher:async()=>new Response('x'.repeat(101)),maxBytes:100}),/too large/);
  await assert.rejects(discoverMarket('constructor',{fetcher:()=>assert.fail()}),/Unsupported/);
});
test('observations are immutable and contain no execution authority',async()=>{
  const r=await discoverAave(baseMock());assert.throws(()=>r.rows[0].executable=true,TypeError);assert.throws(()=>r.rows[0].assets[0].id=pool,TypeError);assert.equal(r.observedAt,now);assert(r.expiresAt>r.observedAt);
});
