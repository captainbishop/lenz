import {tapeRequest,checkedTape,checkedBookLevels,checkedCandleValues,CANDLE_INTERVALS} from './market-tape.js';
const check=(value)=>{if(!value)throw Error('Invalid market stream');};

// Each event carries its own source time; receiving a book must not freshen a candle.
export function checkedMarketEvent(value,expected,{now=Date.now()}={}){
  const request=tapeRequest(expected),coin=request.marketId.split(':').slice(2).join(':'),duration=CANDLE_INTERVALS[request.interval];
  if(value?.kind==='snapshot')return {kind:'snapshot',tape:checkedTape(value.tape,request,{now})};
  check(value?.coin===coin);
  if(value.kind==='book'){
    check(Number.isSafeInteger(value.time)&&value.time>=now-30000&&value.time<=now+5000);
    return {kind:'book',coin,time:value.time,levels:checkedBookLevels(value.levels)};
  }
  check(value.kind==='candle');const c=value.candle;
  check(c?.coin===coin&&c.interval===request.interval&&Number.isSafeInteger(c.time)&&c.time%duration===0&&c.time<=now+5000&&c.time>=now-2*duration);
  return {kind:'candle',coin,candle:{coin,interval:request.interval,time:c.time,...checkedCandleValues(c)}};
}

const newerCandle=(a,b)=>a.time>b.time||a.time===b.time&&a.trades!==undefined&&(b.trades===undefined||a.trades>b.trades);
export function mergeMarketEvent(tape,event,now=Date.now()){
  if(event.kind==='snapshot'){
    const next=event.tape;if(!tape||JSON.stringify(tape.request)!==JSON.stringify(next.request))return next;
    const merged=new Map(next.candles.map(c=>[c.time,c])),first=next.candles[0]?.time??0;
    for(const c of tape.candles){const incoming=merged.get(c.time);if(c.time>=first&&(!incoming||newerCandle(c,incoming)))merged.set(c.time,c);}
    const candles=[...merged.values()].sort((a,b)=>a.time-b.time).slice(-300);
    const book=tape.bookTime>next.bookTime?tape:next;
    return {...next,observedAt:Math.max(tape.observedAt,next.observedAt),bookTime:book.bookTime,expiresAt:Math.min(Math.max(tape.observedAt,next.observedAt)+30000,book.bookTime+30000),levels:book.levels,candles};
  }
  if(!tape)return tape;
  if(event.kind==='book')return event.time<tape.bookTime?tape:{...tape,observedAt:now,bookTime:event.time,expiresAt:Math.min(now+30000,event.time+30000),levels:event.levels};
  const c=event.candle,last=tape.candles.at(-1);if(last&&newerCandle(last,c))return tape;
  return {...tape,candles:[...tape.candles.slice(c.time===last?.time?0:-299,c.time===last?.time?-1:undefined),c]};
}
