// Synthetic data for parser and UI tests only; never bundled as product market data.
import {CANDLE_INTERVALS} from '../web/public/market-tape.js';
export const TAPE_REQUEST={marketId:'hyperliquid:0:ETH',interval:'1h',privacy:'public'};
export function tapeFixtures(request=TAPE_REQUEST,now=Date.now()){
 const duration=CANDLE_INTERVALS[request.interval],coin=request.marketId.split(':').slice(2).join(':'),end=Math.floor(now/duration)*duration;
 const history=Array.from({length:96},(_,i)=>{const open=2800+i*2+Math.sin(i*.6)*30,close=open+Math.cos(i*.8)*12;return {s:coin,i:request.interval,t:end-(95-i)*duration,o:open.toFixed(2),c:close.toFixed(2),h:(Math.max(open,close)+8).toFixed(2),l:(Math.min(open,close)-9).toFixed(2),v:String(30+(i*17)%200)};});
 const book={coin,time:now-500,levels:[Array.from({length:20},(_,i)=>({px:(3000-i*.1).toFixed(1),sz:(1+(i*7)%14).toFixed(2),n:i+1})),Array.from({length:20},(_,i)=>({px:(3000.1+i*.1).toFixed(1),sz:(1+(i*3)%11).toFixed(2),n:i+2}))]};
 const meta=[{collateralToken:0,universe:[{name:coin,szDecimals:3,maxLeverage:25}]},[{markPx:'3000.1',oraclePx:'3000',funding:'0.0000125',openInterest:'45231'}]];
 const snapshot={version:1,kind:'market-tape',request,source:'https://api.hyperliquid-testnet.xyz/info',observedAt:now,bookTime:book.time,expiresAt:book.time+30000,executable:false,levels:book.levels.map(side=>side.map(l=>({price:l.px,size:l.sz,orders:l.n}))),candles:history.map(c=>({coin:c.s,interval:c.i,time:c.t,open:c.o,high:c.h,low:c.l,close:c.c,volume:c.v}))};
 return {history,book,meta,snapshot};
}
