import {test} from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {readMarketTape} from './market-tape.mjs';import {TAPE_REQUEST,tapeFixtures} from './market-tape-fixtures.mjs';
const {checkedTape,tapeRequest}=await import(process.env.LENZ_TAPE_MODULE?pathToFileURL(process.env.LENZ_TAPE_MODULE):new URL('../web/public/market-tape.js',import.meta.url));
const now=1793720000000;
test('public tape reads only metadata, order book and bounded candles without an account',async()=>{
 const calls=[],f=tapeFixtures(TAPE_REQUEST,now),fetcher=async(url,options)=>{assert.equal(url,'https://api.hyperliquid.xyz/info');assert.equal(options.redirect,'error');const b=JSON.parse(options.body);calls.push(b);return new Response(JSON.stringify(b.type==='metaAndAssetCtxs'?f.meta:b.type==='l2Book'?f.book:f.history));};
 const value=await readMarketTape(TAPE_REQUEST,{fetcher,clock:()=>now});assert.equal(value.candles.length,96);assert.equal(value.levels[0].length,20);assert.equal(value.executable,false);assert.deepEqual(calls.map(c=>c.type).sort(),['candleSnapshot','l2Book','metaAndAssetCtxs']);assert.equal(calls.find(c=>c.type==='candleSnapshot').req.endTime,now);assert(!JSON.stringify(calls).includes('address'));
});
test('tape consent, fields and market identity reject before a read',()=>{
 for(const change of [{privacy:'private'},{privacy:false},{wallet:'0x1'},{interval:'1s'},{marketId:'https://foreign.example'}])assert.throws(()=>tapeRequest({...TAPE_REQUEST,...change}));
});
test('changed market, source, timestamps and execution claims fail',()=>{
 const f=tapeFixtures(TAPE_REQUEST,now).snapshot;for(const change of [{request:{...TAPE_REQUEST,marketId:'hyperliquid:0:BTC'}},{source:'https://foreign.example'},{executable:true},{bookTime:now-31000},{observedAt:now+6000},{expiresAt:now+60000}])assert.throws(()=>checkedTape({...f,...change},TAPE_REQUEST,{now}));assert.throws(()=>checkedTape(f,TAPE_REQUEST,{now:f.expiresAt}));
});
test('crossed, unordered, empty and oversized books are rejected',()=>{
 for(const alter of [x=>x.levels[0].reverse(),x=>x.levels[0][0].price='9999',x=>x.levels[1]=[],x=>x.levels[1].push(...x.levels[1]),x=>x.levels[0][0].size='0',x=>x.levels[0][0].orders=-1]){const x=tapeFixtures(TAPE_REQUEST,now).snapshot;alter(x);assert.throws(()=>checkedTape(x,TAPE_REQUEST,{now}));}
});
test('candle symbol, interval, order, range, freshness and bounds reject substitutions',()=>{
 for(const alter of [x=>x.candles[0].coin='BTC',x=>x.candles[0].interval='4h',x=>x.candles.reverse(),x=>x.candles[0].low='99999',x=>x.candles[0].volume='-1',x=>x.candles.splice(-3),x=>x.candles.push(...x.candles),x=>x.candles[0].time+=1]){const x=tapeFixtures(TAPE_REQUEST,now).snapshot;alter(x);assert.throws(()=>checkedTape(x,TAPE_REQUEST,{now}));}
});
test('checked display data detaches from the upstream response and is immutable',()=>{const f=tapeFixtures(TAPE_REQUEST,now).snapshot,r=checkedTape(f,TAPE_REQUEST,{now});f.levels[0][0].price='1';assert.equal(r.levels[0][0].price,'3000');assert(Object.isFrozen(r.candles[0]));});
