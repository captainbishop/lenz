import {immutable} from './defi-catalog.js';
import {canonicalAmount,requireQuote as check} from './market-quote.js';
export const CANDLE_INTERVALS=immutable({'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000});
export function tapeRequest(value){
  check(value&&Object.keys(value).length===3&&value.privacy==='public','Public market-data consent required.');
  check(typeof value.marketId==='string'&&/^hyperliquid:(?:0|[1-9][0-9]{0,3}):[A-Za-z0-9][A-Za-z0-9:._/-]{0,39}$/.test(value.marketId),'Invalid perpetual market.');
  check(Object.hasOwn(CANDLE_INTERVALS,value.interval),'Unsupported candle interval.');
  return immutable({marketId:value.marketId,interval:value.interval,privacy:'public'});
}
const decimal=(value,zero=false)=>{const text=canonicalAmount(value);check(Number.isFinite(Number(text))&&(zero?Number(text)>=0:Number(text)>0),'Invalid market value.');return text;};
export function checkedBookLevels(value,{allowEmpty=false}={}){
  check(Array.isArray(value)&&value.length===2,'Invalid order book.');
  const levels=value.map((side,index)=>{check(Array.isArray(side)&&(allowEmpty||side.length>0)&&side.length<=20,'Invalid book depth.');return side.map((level,i)=>{
    const price=decimal(level.price),size=decimal(level.size);check(Number.isSafeInteger(level.orders)&&level.orders>0,'Invalid order count.');
    check(i===0||(index===0?Number(price)<Number(side[i-1].price):Number(price)>Number(side[i-1].price)),'Unsorted order book.');return {price,size,orders:level.orders};
  });});check(!levels[0].length||!levels[1].length||Number(levels[0][0].price)<Number(levels[1][0].price),'Crossed order book.');return levels;
}
export function checkedCandleValues(c,{allowZero=false}={}){
  const open=decimal(c.open,allowZero),high=decimal(c.high,allowZero),low=decimal(c.low,allowZero),close=decimal(c.close,allowZero),volume=decimal(c.volume,true);
  check(Number(low)<=Math.min(Number(open),Number(close))&&Number(high)>=Math.max(Number(open),Number(close)),'Invalid candle range.');
  check(c.trades===undefined||Number.isSafeInteger(c.trades)&&c.trades>=0,'Invalid candle trade count.');
  return {open,high,low,close,volume,...(c.trades===undefined?{}:{trades:c.trades})};
}
export function checkedTape(value,expected,{now=Date.now()}={}){
  const request=tapeRequest(expected),coin=request.marketId.split(':').slice(2).join(':'),duration=CANDLE_INTERVALS[request.interval];
  check(value?.version===1&&value.kind==='market-tape'&&value.executable===false&&JSON.stringify(tapeRequest(value.request))===JSON.stringify(request),'Market data changed.');
  check(value.source==='https://api.hyperliquid.xyz/info'&&Number.isSafeInteger(value.observedAt)&&value.observedAt<=now+5000&&value.observedAt>=now-30000,'Market data expired.');
  check(Number.isSafeInteger(value.bookTime)&&value.bookTime>=now-30000&&value.bookTime<=now+5000,'Order book expired.');
  check(value.expiresAt===Math.min(value.observedAt+30000,value.bookTime+30000)&&value.expiresAt>now,'Order book expired.');
  const levels=checkedBookLevels(value.levels);
  check(Array.isArray(value.candles)&&value.candles.length>=2&&value.candles.length<=300,'Price history unavailable.');
  const candles=value.candles.map((c,i)=>{
    check(c.coin===coin&&c.interval===request.interval&&Number.isSafeInteger(c.time)&&c.time%duration===0&&c.time<=now&&c.time>=now-301*duration&&(i===0||c.time>value.candles[i-1].time),'Candle identity or time changed.');
    return {coin,interval:request.interval,time:c.time,...checkedCandleValues(c)};
  });check(candles.at(-1).time>=now-2*duration,'Price history expired.');
  return immutable({version:1,kind:'market-tape',request,source:value.source,observedAt:value.observedAt,bookTime:value.bookTime,expiresAt:value.expiresAt,levels,candles,executable:false});
}
