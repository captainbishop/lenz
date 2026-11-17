import {marketJson,MARKET_READS} from './market-discovery.mjs';
import {marketFetch} from './market-http.mjs';
import {readHyperliquidCatalog} from './hyperliquid-catalog.mjs';
import {hyperliquidRequest} from '../web/public/hyperliquid-catalog.js';
import {checkedHyperliquidEvent} from '../web/public/hyperliquid-feed.js';
import {CANDLE_INTERVALS} from '../web/public/market-tape.js';

export async function readHyperliquidTape(input,{fetcher=marketFetch,clock=Date.now,signal,catalog=readHyperliquidCatalog}={}){
  const request=hyperliquidRequest(input),[,,kind,...parts]=request.marketId.split(':'),coin=parts.join(':');
  const scope=kind==='perp'?'core-perps':kind==='spot'?'spot':null;
  const directory=await catalog({signal,...(scope&&{scope})});signal?.throwIfAborted();
  if(!directory.rows.some(row=>row.kind===kind&&(row.coin===coin||row.sides.some(s=>s.coin===coin))))throw Error('Market unavailable');
  const endTime=clock(),startTime=endTime-299*CANDLE_INTERVALS[request.interval];
  const options={fetcher,signal:AbortSignal.any([signal,AbortSignal.timeout(12000)].filter(Boolean)),maxBytes:262144};
  const [book,history]=await Promise.all([
    marketJson(MARKET_READS.hyperliquid,{type:'l2Book',coin},options),
    marketJson(MARKET_READS.hyperliquid,{type:'candleSnapshot',req:{coin,interval:request.interval,startTime,endTime}},options),
  ]);
  if(book?.coin!==coin||!Array.isArray(history))throw Error('Market changed');
  return checkedHyperliquidEvent({kind:'snapshot',tape:{request,observedAt:clock(),bookTime:book.time,levels:book.levels?.map(side=>side.map(l=>({price:l.px,size:l.sz,orders:l.n}))),candles:history.map(c=>({coin:c.s,interval:c.i,time:c.t,open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v,trades:c.n}))}},request,{now:clock()}).tape;
}
