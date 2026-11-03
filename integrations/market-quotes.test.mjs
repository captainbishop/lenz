import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {SWAP,PERP,NOW,quoteMock} from './market-quote-fixtures.mjs';
const {checkedMarketQuote,marketQuoteRequest,decimalUnits,formatUnits}=await import(process.env.LENZ_QUOTE_VIEW_MODULE?pathToFileURL(process.env.LENZ_QUOTE_VIEW_MODULE):new URL('../web/public/market-quote.js',import.meta.url));
const {quoteMarket}=await import(process.env.LENZ_QUOTES_MODULE?pathToFileURL(process.env.LENZ_QUOTES_MODULE):new URL('./market-quotes.mjs',import.meta.url));
test('Uniswap quote binds canonical recent block, exact input, fee and floor-rounded minimum without a transaction',async()=>{
 let tuple;const mock=quoteMock(s=>{if(s.name==='quoteExactInputSingle')tuple=s.parsed.args[0];});const q=await quoteMarket(SWAP,mock);
 assert.equal(tuple.amountIn,2000000n);assert.equal(tuple.fee,500n);assert.equal(tuple.sqrtPriceLimitX96,0n);assert.equal(q.result.outputUnits,'777777777');assert.equal(q.result.minOutputUnits,'773888888');assert.equal(q.executable,false);assert.equal(q.evidence.assurance,'rpc-latest-block');
 assert(mock.calls.some(c=>c.request.params?.[0]==='latest'));assert(mock.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_call','eth_getCode'].includes(c.request.method)));
 for(const c of mock.calls.filter(c=>['eth_call','eth_getCode'].includes(c.request.method)))assert.deepEqual(c.request.params.at(-1),{blockHash:mock.block.hash,requireCanonical:true});
 const tx=mock.calls.find(c=>c.request.params?.[0]?.to===mock.quoter&&c.request.params[0].gas)?.request.params[0];assert.equal(tx.gas,'0x2dc6c0');assert(!Object.hasOwn(tx,'from'));assert(Object.isFrozen(q));
});
test('quote request rejects private downgrade, hidden fields, wrong pool, amount precision and side before reads',async()=>{
 for(const change of [{privacy:'private'},{privacy:undefined},{calldata:'0x'},{marketId:SWAP.marketId.replace(/.$/,'0')},{amount:'1e6'},{amount:'0'},{amount:'1.0000001'},{amount:'-1'},{side:'buy'},{slippageBps:501},{slippageBps:1.5}])await assert.rejects(quoteMarket({...SWAP,...change},{fetcher:()=>assert.fail('No read allowed')}));
 assert.equal(decimalUnits('0.000001',6),1n);assert.equal(formatUnits('1000001',6),'1.000001');assert.equal(marketQuoteRequest({...SWAP,amount:'2.00'}).amount,'2');
 assert.throws(()=>marketQuoteRequest({...SWAP,privacy:'private'}));assert.throws(()=>marketQuoteRequest({...SWAP,calldata:'0x'}));assert.throws(()=>decimalUnits('0.0000001',6));
});
test('reverse quote preserves 18-decimal input and 6-decimal output',async()=>{
 let tuple;const mock=quoteMock(s=>{if(s.name==='quoteExactInputSingle')tuple=s.parsed.args[0];});const q=await quoteMarket({...SWAP,side:'weth-to-usdc',amount:'0.000000000000000001'},mock);
 assert.equal(tuple.amountIn,1n);assert.equal(q.result.inputSymbol,'WETH');assert.equal(q.result.outputDecimals,6);
});
test('quoter substitution, empty code, pool identity, precision and stopped pools fail',async()=>{
 for(const edit of [s=>{if(s.name==='factory')s.values=['0x'+'12'.repeat(20)];},s=>{if(s.name==='WETH9')s.values=['0x'+'12'.repeat(20)];},s=>{if(s.name==='getPool')s.values=['0x'+'12'.repeat(20)];},s=>{if(s.name==='token0')s.values=['0x'+'12'.repeat(20)];},s=>{if(s.name==='fee')s.values=[3000];},s=>{if(s.name==='decimals')s.values=[18];},s=>{if(s.name==='liquidity')s.values=[0];},s=>{if(s.name==='slot0')s.values[6]=false;},s=>{if(s.response&&s.request.method==='eth_getCode')s.response.result='0x';}])await assert.rejects(quoteMarket(SWAP,quoteMock(edit)));
});
test('old, wrong-chain, future and reorged quote blocks fail',async()=>{
 for(const edit of [s=>{if(s.response&&s.request.method==='eth_chainId')s.response.result='0x1';},s=>{if(s.response&&s.request.method==='eth_getBlockByNumber')s.response.result.timestamp='0x1';},s=>{if(s.response&&s.request.method==='eth_getBlockByNumber')s.response.result.timestamp='0x'+BigInt((NOW+10000)/1000).toString(16);},s=>{if(s.response&&s.request.params[0]==='0x1234')s.response.result.hash='0x'+'cd'.repeat(32);}])await assert.rejects(quoteMarket(SWAP,quoteMock(edit)));
});
test('extreme-price partial fills, zero output, invalid ABI and zero minimum fail',async()=>{
 for(const edit of [s=>{if(s.name==='quoteExactInputSingle')s.values[1]=4295128740n;},s=>{if(s.name==='quoteExactInputSingle')s.values[0]=0n;},s=>{if(s.name==='quoteExactInputSingle')s.values[0]=1n;},s=>{if(s.response&&s.request.method==='eth_call')s.response.result+='00';}])await assert.rejects(quoteMarket(SWAP,quoteMock(edit)));
});
test('Hyperliquid estimates walk the correct side and never send size or account to the venue',async()=>{
 for(const [side,notional]of [['buy','1501550000'],['sell','1500100000']]){
  const mock=quoteMock(),q=await quoteMarket({...PERP,side},mock);assert.equal(q.result.notionalUnits,notional);assert.equal(q.result.levelsUsed,2);assert.equal(q.result.fullDepth,true);assert.equal(q.executable,false);assert.equal(q.sourceTime,NOW-500);
  assert.deepEqual(mock.calls.map(c=>c.request),[{type:'metaAndAssetCtxs',dex:''},{type:'l2Book',coin:'ETH'}]);
 }
});
test('insufficient depth, missing levels, stale time, coin substitution and malformed prices reject estimates',async()=>{
 for(const edit of [s=>{if(s.request.type==='l2Book')s.value.levels[1]=s.value.levels[1].slice(0,1);},s=>{if(s.request.type==='l2Book')s.value.levels[0]=[];},s=>{if(s.request.type==='l2Book')s.value.time=NOW-31000;},s=>{if(s.request.type==='l2Book')s.value.time=NOW+6000;},s=>{if(s.request.type==='l2Book')s.value.coin='BTC';},s=>{if(s.request.type==='l2Book')s.value.levels[1][0].px='NaN';},s=>{if(s.request.type==='l2Book')s.value.levels[1][0].px='1001.11';}])await assert.rejects(quoteMarket(PERP,quoteMock(edit)));
});
test('crossed or unordered books, delisting, size precision and changed market indexes fail',async()=>{
 for(const edit of [s=>{if(s.request.type==='l2Book')s.value.levels[1].reverse();},s=>{if(s.request.type==='l2Book')s.value.levels[0][0].px='1002';},s=>{if(s.request.type==='metaAndAssetCtxs')s.value[0].universe[0].isDelisted=true;},s=>{if(s.request.type==='metaAndAssetCtxs')s.value[0].universe[0].name='BTC';}])await assert.rejects(quoteMarket(PERP,quoteMock(edit)));
 await assert.rejects(quoteMarket({...PERP,amount:'1.0001'},quoteMock()));
});
test('caller mutation during a read cannot change quoted terms',async()=>{
 const input={...SWAP};const q=await quoteMarket(input,quoteMock(()=>{input.amount='100';input.privacy='private';}));assert.deepEqual(q.request,SWAP);assert.equal(q.result.inputUnits,'2000000');
});
test('returned preview rejects altered request, execution authority, output identity, minimum and expiry',async()=>{
 const original=await quoteMarket(SWAP,quoteMock());
 for(const edit of [q=>q.request.amount='3',q=>q.executable=true,q=>q.result.outputSymbol='ETH',q=>q.result.minOutputUnits='1',q=>q.expiresAt=NOW,q=>q.expiresAt=NOW+60000,q=>q.evidence.source='https://foreign.example']){const q=structuredClone(original);edit(q);assert.throws(()=>checkedMarketQuote(q,SWAP,{now:NOW}));}
});
test('book previews reject altered fill size, partial-depth claims and stale source time',async()=>{
 const original=await quoteMarket(PERP,quoteMock());
 for(const edit of [q=>q.result.sizeUnits='1',q=>q.result.fullDepth=false,q=>q.result.instrument='BTC',q=>q.sourceTime=NOW-60000]){const q=structuredClone(original);edit(q);assert.throws(()=>checkedMarketQuote(q,PERP,{now:NOW}));}
});
