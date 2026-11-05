import test from 'node:test';
import assert from 'node:assert/strict';
import {readDegenCandles} from './degen-discovery.mjs';
import {DEGEN_INTERVALS,checkedCandles} from '../web/public/degen-model.js';
import {candleFixture,pool,token} from './degen-fixtures.mjs';
import {readMarketTape} from './market-tape.mjs';
import {tapeFixtures,TAPE_REQUEST} from './market-tape-fixtures.mjs';
const frames={'1m':['minute',1],'5m':['minute',5],'15m':['minute',15],'30m':['minute',15],'1h':['hour',1],'4h':['hour',4],'1d':['day',1],'1w':['day',1]};
for(const [interval,[frame,aggregate]]of Object.entries(frames))test('exact OHLC construction for '+interval,async()=>{
 const request={provider:'geckoterminal',kind:'candles',network:'base',pool,address:token,interval},sourceInterval=interval==='30m'?'15m':interval==='1w'?'1d':interval,now=Date.now(),input=candleFixture(sourceInterval,now),urls=[];
 const result=await readDegenCandles(request,{clock:()=>now,fetchImpl:async url=>{urls.push(url);return Response.json({data:{attributes:{ohlcv_list:input.map(c=>[c.time/1000,c.open,c.high,c.low,c.close,c.volume]).reverse()}},meta:{base:{address:token},quote:{address:'quote'}}});}});
 assert.equal(urls.length,1);assert.equal(new URL(urls[0]).pathname.endsWith('/ohlcv/'+frame),true);assert.equal(new URL(urls[0]).searchParams.get('aggregate'),String(aggregate));assert(result.candles.length>0);
 for(const c of result.candles){const bucket=input.filter(x=>x.time>=c.time&&x.time<c.time+DEGEN_INTERVALS[interval]);assert.equal(c.open,bucket[0].open);assert.equal(c.close,bucket.at(-1).close);assert.equal(c.high,Math.max(...bucket.map(x=>x.high)));assert.equal(c.low,Math.min(...bucket.map(x=>x.low)));assert.equal(c.volume,bucket.reduce((n,x)=>n+x.volume,0));}
 if(interval==='1w')assert(result.candles.every(c=>new Date(c.time).getUTCDay()===1));assert.throws(()=>checkedCandles({...result,request:{...request,interval:'invalid'}},request));
});
for(const interval of Object.keys(frames))test('Hyperliquid receives exact '+interval+' interval and bounded history',async()=>{const now=Date.now(),request={...TAPE_REQUEST,interval},f=tapeFixtures(request,now),calls=[];const result=await readMarketTape(request,{clock:()=>now,fetcher:async(url,options)=>{const b=JSON.parse(options.body);calls.push(b);return Response.json(b.type==='metaAndAssetCtxs'?f.meta:b.type==='l2Book'?f.book:f.history);}});const body=calls.find(c=>c.type==='candleSnapshot');assert.equal(body.req.interval,interval);assert.equal(now-body.req.startTime,299*DEGEN_INTERVALS[interval]);assert.equal(result.candles.length,96);if(interval==='1w')assert(result.candles.every(c=>new Date(c.time).getUTCDay()===4));});
