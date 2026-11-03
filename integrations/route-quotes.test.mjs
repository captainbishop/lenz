import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {routeQuoteFixture,NOW} from './route-quote-fixtures.mjs';
const {bindRouteQuote}=await import(process.env.LENZ_ROUTE_QUOTE_MODULE?pathToFileURL(process.env.LENZ_ROUTE_QUOTE_MODULE):new URL('../web/public/defi-route-quote.js',import.meta.url));
const bind=(o,q)=>bindRouteQuote(o,q,{now:NOW});
test('both swap directions bind exact deployed assets, amount and minimum without fee or recipient authority',async()=>{
  for(const side of ['usdc-to-weth','weth-to-usdc']){
    const {objective:o,quote}=await routeQuoteFixture('uniswap',side),q=structuredClone(quote),m=bind(o,q);
    assert.equal(m.executable,false);assert.equal(m.expiresAt,q.expiresAt);assert(m.unverified.includes('total-fees'));assert(m.unverified.includes('recipient-control'));
    assert(Object.isFrozen(m.quote.result));assert(Object.isFrozen(m.objective));
    q.result.outputUnits='1';assert.notEqual(m.quote.result.outputUnits,'1');
  }
});
test('private policy, provider, chain, action, funding and return substitutions fail closed',async()=>{
  const f=await routeQuoteFixture();
  for(const change of [o=>o.privacy='private',o=>o.destination.marketId='aave',o=>o.destination.action='supply',o=>{o.source.asset.chainId=o.destination.chainId=o.destination.outputAsset.chainId=o.recipient.chainId='eip155:1';},o=>o.source.asset.chainId='eip155:1',o=>o.returnTo={asset:o.destination.outputAsset,address:o.recipient.address,minAmount:'1'}]){
    const o=structuredClone(f.objective);change(o);assert.throws(()=>bind(o,f.quote));
  }
});
test('wrong token, decimals, exact input and received minimum are rejected',async()=>{
  const f=await routeQuoteFixture();
  for(const change of [o=>o.source.asset.id='0x'+'11'.repeat(20),o=>o.destination.outputAsset.id='0x'+'22'.repeat(20),o=>o.source.asset.decimals=5,o=>o.source.amount='1',o=>o.limits.minReceive=(BigInt(f.quote.result.minOutputUnits)+1n).toString()]){
    const o=structuredClone(f.objective);change(o);assert.throws(()=>bind(o,f.quote));
  }
});
test('both order sides bind explicitly scaled size and price while collateral and position checks stay open',async()=>{
  for(const side of ['buy','sell']){
    const {objective:o,quote:q}=await routeQuoteFixture('hyperliquid',side),m=bind(o,q);
    assert.equal(m.executable,false);assert.equal(m.objective.source.amount,'1000000');assert.notEqual(o.source.amount,q.result.sizeUnits);
    for(const limit of ['collateral-sufficiency','margin-and-leverage','reduce-only-and-position','order-size-rules'])assert(m.unverified.includes(limit));
  }
});
test('unscaled legacy orders, mismatched size, instrument, side and collateral cannot attach a quote',async()=>{
  const f=await routeQuoteFixture('hyperliquid');
  for(const change of [o=>{delete o.destination.order.sizeDecimals;delete o.destination.order.priceDecimals;},o=>o.destination.order.sizeDecimals=2,o=>o.destination.order.priceDecimals=2,o=>o.destination.order.size='1',o=>o.destination.order.instrument='BTC',o=>o.destination.order.side='sell',o=>o.source.asset.id='USDT']){
    const o=structuredClone(f.objective);change(o);assert.throws(()=>bind(o,f.quote));
  }
});
test('buy and sell price limits constrain worst fill price',async()=>{
  for(const side of ['buy','sell']){
    const {objective:o,quote:q}=await routeQuoteFixture('hyperliquid',side);o.destination.order.limitPrice=side==='buy'?'1':'999999999999';assert.throws(()=>bind(o,q));
  }
});
test('quote and objective expiry, future observations, executable and oversized quotes are rejected',async()=>{
  const {objective:o,quote:q}=await routeQuoteFixture();
  for(const change of [q=>q.expiresAt=NOW,q=>q.executable=true,q=>{q.observedAt=NOW+1;},q=>q.extra='x'.repeat(17000)]){
    const copy=structuredClone(q);change(copy);assert.throws(()=>bind(o,copy));
  }
  o.limits.deadline=NOW+100;assert.equal(bind(o,q).expiresAt,NOW+100);o.limits.deadline=NOW;assert.throws(()=>bind(o,q));
});
