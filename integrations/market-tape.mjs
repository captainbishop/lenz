import {discoverHyperliquid,marketJson,MARKET_READS} from './market-discovery.mjs';
import {tapeRequest,checkedTape,CANDLE_INTERVALS} from '../web/public/market-tape.js';
import {marketFetch} from './market-http.mjs';
export async function readMarketTape(input,{fetcher=marketFetch,clock=Date.now}={}){
  const request=tapeRequest(input),observation=await discoverHyperliquid({fetcher,clock}),market=observation.rows.find(row=>row.id===request.marketId);
  if(!market||market.status!=='listed')throw Error('Market unavailable.');
  const endTime=clock(),startTime=endTime-96*CANDLE_INTERVALS[request.interval];
  const [book,history]=await Promise.all([
    marketJson(MARKET_READS.hyperliquid,{type:'l2Book',coin:market.instrument},{fetcher,maxBytes:65536}),
    marketJson(MARKET_READS.hyperliquid,{type:'candleSnapshot',req:{coin:market.instrument,interval:request.interval,startTime,endTime}},{fetcher,maxBytes:262144}),
  ]);
  if(book?.coin!==market.instrument||!Array.isArray(history))throw Error('Market data mismatch.');
  const observedAt=clock();
  return checkedTape({version:1,kind:'market-tape',request,source:MARKET_READS.hyperliquid,observedAt,bookTime:book.time,expiresAt:Math.min(observedAt+30000,book.time+30000),executable:false,
    levels:book.levels?.map(side=>side.map(l=>({price:l.px,size:l.sz,orders:l.n}))),
    candles:history.map(c=>({coin:c.s,interval:c.i,time:c.t,open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v})),
  },request,{now:observedAt});
}
