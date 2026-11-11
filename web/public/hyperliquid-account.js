import {orderAmount,orderText} from './hyperliquid-order.js';
const amount=value=>{try{return orderText(orderAmount(value));}catch{return null;}};
export function accountBalances(funds,tokens){
 if(funds?.mode!=='disabled')return null;
 const spot=[],seen=new Set();let partial=false;
 for(const row of funds.spot??[]){
  const matches=tokens.filter(t=>t.index===row.token),total=amount(row.total),hold=amount(row.hold);
  if(matches.length!==1||seen.has(row.token)||typeof matches[0].name!=='string'||matches[0].name.length>80||total===null||hold===null||orderAmount(hold)>orderAmount(total)){partial=true;continue;}
  seen.add(row.token);spot.push({symbol:matches[0].name,available:orderText(orderAmount(total)-orderAmount(hold))});
 }
 return {spot,partial,equity:amount(funds.perp?.marginSummary?.accountValue),withdrawable:amount(funds.perp?.withdrawable),margin:amount(funds.perp?.marginSummary?.totalMarginUsed)};
}
