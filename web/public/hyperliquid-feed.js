import {hyperliquidRequest} from './hyperliquid-catalog.js';
import {CANDLE_INTERVALS,checkedBookLevels,checkedCandleValues} from './market-tape.js';
const check=value=>{if(!value)throw Error('Invalid Hyperliquid feed');};

export function checkedHyperliquidEvent(value,expected,{now=Date.now()}={}){
  const request=hyperliquidRequest(expected),coin=request.marketId.split(':').slice(2).join(':'),duration=CANDLE_INTERVALS[request.interval];
  const candle=(c,earliest)=>{
    check(c?.coin===coin&&c.interval===request.interval&&Number.isSafeInteger(c.time)&&c.time%duration===0&&c.time>=earliest&&c.time<=now+5000);
    return {coin,interval:request.interval,time:c.time,...checkedCandleValues(c,{allowZero:request.marketId.startsWith('hypercore:outcome:')})};
  };
  const bookTime=t=>{check(Number.isSafeInteger(t)&&t>=now-30000&&t<=now+5000);return t;};
  if(value?.kind==='snapshot'){
    const tape=value.tape;check(JSON.stringify(hyperliquidRequest(tape?.request))===JSON.stringify(request));
    bookTime(tape.observedAt);bookTime(tape.bookTime);check(Array.isArray(tape.candles)&&tape.candles.length<=300);
    const candles=tape.candles.map(c=>candle(c,now-301*duration));
    check(candles.every((c,i)=>!i||c.time>candles[i-1].time));
    return {kind:'snapshot',tape:{request,observedAt:tape.observedAt,bookTime:tape.bookTime,expiresAt:Math.min(tape.observedAt,tape.bookTime)+30000,candles,levels:checkedBookLevels(tape.levels,{allowEmpty:true})}};
  }
  check(value?.coin===coin);
  if(value.kind==='book')return {kind:'book',coin,time:bookTime(value.time),levels:checkedBookLevels(value.levels,{allowEmpty:true})};
  if(value.kind==='trades'){
    check(Array.isArray(value.trades)&&value.trades.length<=1000);
    return {kind:'trades',coin,trades:value.trades.map(t=>{
      check(t.coin===coin&&['B','A'].includes(t.side)&&Number.isSafeInteger(t.time)&&t.time>0&&t.time<=now+5000);
      check(Number.isSafeInteger(t.tid)&&t.tid>=0&&typeof t.px==='string'&&typeof t.sz==='string'&&Number(t.px)>0&&Number.isFinite(Number(t.px))&&Number(t.sz)>0&&Number.isFinite(Number(t.sz)));
      return {coin,tid:t.tid,time:t.time,side:t.side,px:t.px,sz:t.sz};
    })};
  }
  check(value.kind==='candle');return {kind:'candle',coin,candle:candle(value.candle,now-2*duration)};
}
