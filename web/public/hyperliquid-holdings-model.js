import {HYPERLIQUID,checkedHyperliquidDomain} from './hyperliquid-environment.js';
import {orderAmount,orderText} from './hyperliquid-order.js';
const check=value=>{if(!value)throw Error('Hyperliquid holdings could not be verified.');};
const text=value=>typeof value==='string'&&value.length>0&&value.length<=80&&!/[\u0000-\u001f\u007f]/.test(value);
const quantity=value=>{try{return orderText(orderAmount(value));}catch{return null;}};
export function checkedHyperliquidHoldings(value){
 checkedHyperliquidDomain(value);check(value.version===1&&value.source===HYPERLIQUID.info&&/^0x[0-9a-f]{40}$/.test(value.account)&&Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=Date.now()+5000&&text(value.mode)&&typeof value.partial==='boolean'&&Array.isArray(value.spot)&&value.spot.length<=256);
 const indices=new Set();for(const row of value.spot){check(Number.isSafeInteger(row.tokenIndex)&&row.tokenIndex>=0&&!indices.has(row.tokenIndex)&&text(row.symbol)&&(row.tokenId===null||/^0x[0-9a-f]{32}$/.test(row.tokenId))&&(row.decimals===null||Number.isInteger(row.decimals)&&row.decimals>=0&&row.decimals<=18)&&orderAmount(row.total)>0n&&orderAmount(row.hold)<=orderAmount(row.total)&&orderAmount(row.available)===orderAmount(row.total)-orderAmount(row.hold));indices.add(row.tokenIndex);}
 check(value.perps&&['totalRawUSDC','accountValue','withdrawable','marginUsed'].every(key=>value.perps[key]===null||quantity(value.perps[key])===value.perps[key]));check(value.mode==='disabled'||value.spot.length===0&&Object.values(value.perps).every(item=>item===null));return structuredClone(value);
}
export function hyperliquidHoldingsSnapshot(snapshot){
 checkedHyperliquidDomain(snapshot);check(snapshot.collateralToken===0&&Array.isArray(snapshot.spotTokens)&&Array.isArray(snapshot.funds?.spot)&&text(snapshot.funds.mode));const spot=[],indices=new Set();let partial=false;
 if(snapshot.funds.mode==='disabled')for(const row of snapshot.funds.spot){
  const total=quantity(row.total),hold=quantity(row.hold),matches=snapshot.spotTokens.filter(token=>token.index===row.token);if(total===null||hold===null||matches.length!==1||indices.has(row.token)||!text(matches[0].name)||orderAmount(hold)>orderAmount(total)){partial=true;continue;}indices.add(row.token);if(orderAmount(total)===0n)continue;
  const token=matches[0];spot.push({tokenIndex:row.token,symbol:token.name,tokenId:/^0x[0-9a-f]{32}$/.test(token.tokenId)?token.tokenId:null,decimals:Number.isInteger(token.weiDecimals)&&token.weiDecimals>=0&&token.weiDecimals<=18?token.weiDecimals:null,total,hold,available:orderText(orderAmount(total)-orderAmount(hold))});
 }
 const perp=snapshot.funds.perp,enabled=snapshot.funds.mode==='disabled',perps={totalRawUSDC:enabled?quantity(perp?.marginSummary?.totalRawUsd):null,accountValue:enabled?quantity(perp?.marginSummary?.accountValue):null,withdrawable:enabled?quantity(perp?.withdrawable):null,marginUsed:enabled?quantity(perp?.marginSummary?.totalMarginUsed):null};
 if(!enabled||Object.values(perps).some(value=>value===null))partial=true;
 return checkedHyperliquidHoldings({version:1,environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId,account:snapshot.account,observedAt:snapshot.observedAt,source:HYPERLIQUID.info,mode:snapshot.funds.mode,partial,spot,perps});
}
