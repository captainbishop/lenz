import {requireOrder as check,resolveOrderMarket,prepareOrder,checkedOrderReview,inspectOrder} from './hyperliquid-order.js';
const API='https://api.hyperliquid.xyz';
export async function hyperInfo(body,{signal}={}){
  const response=await fetch(API+'/info',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  check(response.ok,'Hyperliquid could not be reached. Try again.');const text=await response.text();check(text.length<=2000000,'Account response is too large.');return JSON.parse(text);
}
export async function readTradingAccount(row,account,{signal}={}){
  check(/^0x[0-9a-f]{40}$/.test(account),'Connect a wallet first.');
  const [spot,perps,mode,spotState,perp,fees,active]=await Promise.all([
    hyperInfo({type:'spotMeta'},{signal}),hyperInfo({type:'meta'},{signal}),hyperInfo({type:'userAbstraction',user:account},{signal}),
    hyperInfo({type:'spotClearinghouseState',user:account},{signal}),hyperInfo({type:'clearinghouseState',user:account},{signal}),hyperInfo({type:'userFees',user:account},{signal}),
    row.kind==='perp'?hyperInfo({type:'activeAssetData',user:account,coin:row.coin},{signal}):Promise.resolve(null),
  ]);
  const market=resolveOrderMarket(row,{spot,perps}),fee=row.kind==='spot'?fees?.userSpotCrossRate:fees?.userCrossRate;
  check(typeof fee==='string'&&Array.isArray(spotState?.balances)&&Array.isArray(perp?.assetPositions),'Account funds are unavailable.');
  if(active)check(active.user?.toLowerCase()===account&&active.coin===row.coin,'Account market changed.');
  return {market,account,observedAt:Date.now(),spotTokens:spot.tokens,funds:{mode,spot:spotState.balances,perp,fee,leverage:active?.leverage??null,markPrice:active?.markPx??null}};
}
export function reviewTradingOrder(snapshot,input){
  check(Date.now()-snapshot.observedAt<30000,'Refresh your account before reviewing.');return prepareOrder(snapshot.market,snapshot.account,input,snapshot.funds);
}
export async function submitTradingAction(action,nonce,expiresAfter,signature){
  const response=await fetch(API+'/exchange',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',cache:'no-store',body:JSON.stringify({action,nonce,signature,expiresAfter}),signal:AbortSignal.timeout(20000)});
  check(response.ok,'Order response was interrupted. Check its status before trying again.');const text=await response.text();check(text.length<64000,'Invalid order response.');
  const value=JSON.parse(text);check(value?.status==='ok','Hyperliquid did not acknowledge the request. Check order status.');return value;
}
export async function readTradingOrder(review){
  const r=checkedOrderReview(review);return inspectOrder(r,await hyperInfo({type:'orderStatus',user:r.account,oid:r.action.orders[0].c}));
}
