import {requireOrder as check,resolveOrderMarket,prepareOrder,checkedOrderReview,checkedOrderAction,inspectOrder,inspectOrderFills,orderAmount} from './hyperliquid-order.js';
import {HYPERLIQUID,checkedHyperliquidDomain} from './hyperliquid-environment.js';
const API=HYPERLIQUID.api;
export async function hyperInfo(body,{signal}={}){
  const response=await fetch(API+'/info',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'omit',cache:'no-store',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  check(response.ok,'Hyperliquid could not be reached. Try again.');const text=await response.text();check(text.length<=2000000,'Account response is too large.');return JSON.parse(text);
}
export async function readTradingAccount(row,account,{signal}={}){
  checkedHyperliquidDomain(row);
  check(/^0x[0-9a-f]{40}$/.test(account),'Connect a wallet first.');
  const [spot,perps,mode,spotState,perp,fees,active]=await Promise.all([
    hyperInfo({type:'spotMeta'},{signal}),hyperInfo({type:'meta'},{signal}),hyperInfo({type:'userAbstraction',user:account},{signal}),
    hyperInfo({type:'spotClearinghouseState',user:account},{signal}),hyperInfo({type:'clearinghouseState',user:account},{signal}),hyperInfo({type:'userFees',user:account},{signal}),
    row.kind==='perp'?hyperInfo({type:'activeAssetData',user:account,coin:row.coin},{signal}):Promise.resolve(null),
  ]);
  const market=resolveOrderMarket(row,{spot,perps}),fee=row.kind==='spot'?fees?.userSpotCrossRate:fees?.userCrossRate;
  check(typeof fee==='string'&&Array.isArray(spotState?.balances)&&Array.isArray(perp?.assetPositions),'Account funds are unavailable.');
  if(active)check(active.user?.toLowerCase()===account&&active.coin===row.coin,'Account market changed.');
  return {environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId,market,account,observedAt:Date.now(),collateralToken:perps.collateralToken,spotTokens:spot.tokens,funds:{mode,spot:spotState.balances,perp,fee,leverage:active?.leverage??null,markPrice:active?.markPx??null}};
}
export function reviewTradingOrder(snapshot,input){
  checkedHyperliquidDomain(snapshot);
  check(Date.now()-snapshot.observedAt<30000,'Refresh your account before reviewing.');return prepareOrder(snapshot.market,snapshot.account,input,snapshot.funds);
}
export async function submitTradingAction(action,nonce,expiresAfter,signature){
  action=checkedOrderAction(action);
  check(Number.isSafeInteger(nonce)&&nonce>0&&Number.isSafeInteger(expiresAfter)&&expiresAfter===nonce+60000&&Date.now()<expiresAfter,'Order expired. Review again.');
  check(signature&&Object.keys(signature).sort().join(',')==='r,s,v'&&/^0x[0-9a-fA-F]{64}$/.test(signature.r)&&/^0x[0-9a-fA-F]{64}$/.test(signature.s)&&[27,28].includes(signature.v),'Invalid order signature.');
  const response=await fetch(API+'/exchange',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',body:JSON.stringify({action,nonce,signature,expiresAfter}),signal:AbortSignal.timeout(20000)});
  check(response.ok,'Order response was interrupted. Check its status before trying again.');const text=await response.text();check(text.length<64000,'Invalid order response.');
  const value=JSON.parse(text);check(value?.status==='ok','Hyperliquid did not acknowledge the request. Check order status.');return value;
}
export async function readTradingOrder(review){
  const r=checkedOrderReview(review),cloid=r.action.orders[0].c;
  let observed=inspectOrder(r,await hyperInfo({type:'orderStatus',user:r.account,oid:cloid}));
  if(observed.state==='unknown'){
    const history=await hyperInfo({type:'historicalOrders',user:r.account});
    check(Array.isArray(history)&&history.length<=2000,'Order history is unavailable.');
    const matches=history.filter(row=>row.order?.cloid===cloid);
    check(matches.length<=1,'Order history is ambiguous. Check on Hyperliquid.');
    if(matches.length)observed=inspectOrder(r,{status:'order',order:matches[0]});
    else{
      const open=await hyperInfo({type:'frontendOpenOrders',user:r.account});
      check(Array.isArray(open)&&open.length<=2000,'Open orders are unavailable.');
      const matches=open.filter(row=>row.cloid===cloid);
      check(matches.length<=1,'Open orders are ambiguous. Check on Hyperliquid.');
      if(matches.length)observed=inspectOrder(r,{status:'order',order:{order:matches[0],status:'open',statusTimestamp:Date.now()}});
    }
  }
  if(observed.state!=='unknown'&&orderAmount(observed.filled)>0n){
    const endTime=Date.now(),fills=await hyperInfo({type:'userFillsByTime',user:r.account,startTime:Math.max(0,r.nonce-60000),endTime,aggregateByTime:false});
    observed=inspectOrderFills(r,observed,fills,{endTime});
  }
  return observed;
}
