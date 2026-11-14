import {encode} from './hyperliquid-vendor/msgpack.js';
import {keccak256,TypedDataEncoder,recoverAddress} from './evm-vendor/offline-budget.js';
import {HYPERLIQUID,checkedHyperliquidDomain} from './hyperliquid-environment.js';

export const requireOrder=(ok,message)=>{if(!ok)throw Error(message);};
const check=requireOrder,scale=10n**18n;
export function orderAmount(value){
  check(typeof value==='string'&&/^(0|[1-9][0-9]{0,18})(\.[0-9]{1,18})?$/.test(value),'Enter a decimal amount.');
  const [whole,part='']=value.split('.');return BigInt(whole)*scale+BigInt(part.padEnd(18,'0'));
}
export function orderText(value){const digits=value.toString().padStart(19,'0');return (digits.slice(0,-18)+'.'+digits.slice(-18)).replace(/\.?0+$/,'')||'0';}
const decimal=value=>orderText(orderAmount(value));
const ceilDiv=(a,b)=>(a+b-1n)/b;
const wallet=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const id=()=> '0x'+Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');

export function resolveOrderMarket(row,{spot,perps}){
  checkedHyperliquidDomain(row);
  check(['spot','perp'].includes(row?.kind),'Native orders are not connected for this market yet.');
  let result;
  if(row.kind==='spot'){
    const pair=spot?.universe?.find(p=>`spot:${p.index}`===row.id),base=spot?.tokens?.find(t=>t.index===pair?.tokens?.[0]),quote=spot?.tokens?.find(t=>t.index===pair?.tokens?.[1]);
    check(pair&&base&&quote&&pair.name===row.coin&&quote.index===row.quote.index&&quote.name===row.quote.symbol,'The selected market changed or is unavailable.');
    check(Number.isSafeInteger(pair.index)&&pair.index>=0&&pair.index<1000000,'Invalid market index.');
    check(quote.index===0&&quote.name==='USDC','Native orders currently use USDC markets.');
    result={kind:'spot',id:row.id,coin:pair.name,asset:10000+pair.index,base:base.name,baseIndex:base.index,quote:quote.name,quoteIndex:quote.index,sizeDecimals:base.szDecimals,maxLeverage:1};
  }else{
    const index=Number(row.id?.split(':')[2]),market=perps?.universe?.[index];
    check(row.id===`perp::${index}`&&market&&!market.isDelisted&&market.name===row.coin&&perps.collateralToken===0&&row.quote.index===0&&row.quote.symbol==='USDC','The selected market changed or its collateral is unsupported.');
    result={kind:'perp',id:row.id,coin:market.name,asset:index,base:market.name,baseIndex:null,quote:'USDC',quoteIndex:0,sizeDecimals:market.szDecimals,maxLeverage:market.maxLeverage};
  }
  check(Number.isInteger(result.sizeDecimals)&&result.sizeDecimals>=0&&result.sizeDecimals<=(result.kind==='spot'?8:6),'Unsupported market precision.');
  check([result.base,result.quote].every(s=>typeof s==='string'&&s.length<=80&&!/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/.test(s)),'Invalid market names.');
  return Object.freeze({...result,environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId});
}
function amountPrecision(value,decimals){check((value.split('.')[1]?.length??0)<=decimals,`Use at most ${decimals} decimal places.`);}
export function orderPosition(market,funds){
  check(market.kind==='perp'&&Array.isArray(funds?.perp?.assetPositions),'Position unavailable. Refresh your account.');
  check(funds.perp.assetPositions.every(p=>typeof p?.position?.coin==='string'),'Position unavailable. Refresh your account.');
  const matches=funds.perp.assetPositions.filter(p=>p.position?.coin===market.coin);
  check(matches.length<=1,'Position response is ambiguous. Refresh your account.');
  if(!matches.length)return null;
  const position=matches[0].position,signed=position.szi;
  check(typeof signed==='string','Position amount is unavailable.');
  const negative=signed.startsWith('-'),size=decimal(negative?signed.slice(1):signed);
  if(orderAmount(size)===0n)return null;
  const optional=(value,signed=false)=>{
    if(typeof value!=='string')return null;
    const minus=signed&&value.startsWith('-');
    try{const amount=decimal(minus?value.slice(1):value);return minus&&amount!=='0'?'-'+amount:amount;}catch{return null;}
  };
  return {side:negative?'short':'long',size,entryPrice:optional(position.entryPx),pnl:optional(position.unrealizedPnl,true),liquidationPrice:optional(position.liquidationPx),margin:optional(position.marginUsed)};
}
export function prepareOrder(market,account,input,funds,{now=Date.now(),cloid=id()}={}){
  checkedHyperliquidDomain(market);
  check(wallet(account),'Connect your wallet first.');
  check(funds?.mode==='disabled','Trading for this account mode is not connected in Lenz yet.');
  check(['buy','sell'].includes(input.side)&&typeof input.reduceOnly==='boolean','Choose an order direction.');
  check(market.kind==='perp'||!input.reduceOnly,'Spot orders cannot be reduce-only.');
  const size=decimal(input.size),price=decimal(input.price),s=orderAmount(size),p=orderAmount(price);
  check(s>0n&&p>0n,'Enter an amount and limit price greater than zero.');amountPrecision(size,market.sizeDecimals);
  if(price.includes('.'))amountPrecision(price,(market.kind==='spot'?8:6)-market.sizeDecimals);
  check(!price.includes('.')||price.replace('.','').replace(/^0+/,'').length<=5,'Use at most five significant digits for the limit price.');
  const value=ceilDiv(s*p,scale),fee=orderAmount(funds.fee);
  check(fee<=scale/100n,'Trading fee could not be verified.');
  check(value>=10n*scale||input.reduceOnly,'Minimum order value is 10 USD.');
  check(/^0x[0-9a-f]{32}$/.test(cloid)&&Number.isSafeInteger(now)&&now>0,'Invalid order identifier.');
  let spend=value+ceilDiv(value*fee,scale),spendAsset=market.quote,leverage=1,marginMode=null,markPrice=null;
  if(market.kind==='spot'){
    const token=input.side==='buy'?market.quoteIndex:market.baseIndex;
    if(input.side==='sell'){spend=s;spendAsset=market.base;}
    const balance=funds.spot?.find(b=>b.token===token);
    check(balance&&orderAmount(balance.total)-orderAmount(balance.hold)>=spend,`Not enough ${spendAsset} funds on Hyperliquid.`);
  }else{
    const position=funds.perp?.assetPositions?.find(p=>p.position?.coin===market.coin)?.position;
    const activeLeverage=funds.leverage??position?.leverage;
    leverage=activeLeverage?.value;marginMode=activeLeverage?.type;markPrice=decimal(funds.markPrice);
    check(Number.isInteger(leverage)&&leverage>0&&leverage<=market.maxLeverage,'Current leverage is unavailable. Refresh your account.');
    check(['cross','isolated'].includes(marginMode)&&orderAmount(markPrice)>0n,'Current margin settings are unavailable.');
    if(input.reduceOnly){
      const held=orderPosition(market,funds);
      check(held&&orderAmount(held.size)>=s&&(input.side==='buy')===(held.side==='short'),'This order would not reduce the selected position.');spend=0n;
    }else{
      const markValue=ceilDiv(s*orderAmount(markPrice),scale),budget=markValue>value?markValue:value;
      spend=ceilDiv(budget,BigInt(leverage))+ceilDiv(budget*fee,scale);
      check(orderAmount(funds.perp?.withdrawable)>=spend,'Not enough available margin on Hyperliquid.');
    }
  }
  return Object.freeze({version:2,environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId,market,account,side:input.side,size,price,reduceOnly:input.reduceOnly,leverage,marginMode,markPrice,fee:funds.fee,spend:orderText(spend),spendAsset,nonce:now,expiresAt:now+60000,
    action:{type:'order',orders:[{a:market.asset,b:input.side==='buy',p:price,s:size,r:input.reduceOnly,t:{limit:{tif:'Gtc'}},c:cloid}],grouping:'na'}});
}
export function orderTypedData(action,nonce,expiresAfter){
  check(Number.isSafeInteger(nonce)&&nonce>0&&(expiresAfter===undefined||Number.isSafeInteger(expiresAfter)&&expiresAfter>nonce),'Invalid order lifetime.');
  const packed=encode(action),bytes=new Uint8Array(packed.length+(expiresAfter===undefined?9:18)),view=new DataView(bytes.buffer);bytes.set(packed);view.setBigUint64(packed.length,BigInt(nonce));
  bytes[packed.length+8]=0;if(expiresAfter!==undefined){bytes[packed.length+9]=0;view.setBigUint64(packed.length+10,BigInt(expiresAfter));}
  return {domain:{name:'Exchange',version:'1',chainId:1337,verifyingContract:'0x'+'0'.repeat(40)},types:{Agent:[{name:'source',type:'string'},{name:'connectionId',type:'bytes32'}]},primaryType:'Agent',message:{source:HYPERLIQUID.orderSource,connectionId:keccak256(bytes)}};
}
export function checkedOrderAction(action){
  const exact=(o,keys)=>o&&Object.keys(o).sort().join(',')===keys.sort().join(',');
  if(action?.type==='order'){
    check(exact(action,['type','orders','grouping'])&&action.grouping==='na'&&Array.isArray(action.orders)&&action.orders.length===1,'Only one reviewed order can be signed.');
    const o=action.orders[0];check(exact(o,['a','b','p','s','r','t','c'])&&Number.isSafeInteger(o.a)&&o.a>=0&&o.a<1010000&&typeof o.b==='boolean'&&typeof o.r==='boolean'&&orderAmount(o.p)>0n&&orderAmount(o.s)>0n&&/^0x[0-9a-f]{32}$/.test(o.c),'Invalid order to sign.');
    check(exact(o.t,['limit'])&&exact(o.t.limit,['tif'])&&o.t.limit.tif==='Gtc','Only limit orders can be signed.');
  }else{
    check(exact(action,['type','cancels'])&&action.type==='cancelByCloid'&&Array.isArray(action.cancels)&&action.cancels.length===1,'Unsupported Hyperliquid action.');
    const c=action.cancels[0];check(exact(c,['asset','cloid'])&&Number.isSafeInteger(c.asset)&&c.asset>=0&&c.asset<1010000&&/^0x[0-9a-f]{32}$/.test(c.cloid),'Invalid order cancellation.');
  }
  return structuredClone(action);
}
export function checkedOrderReview(r){
  checkedHyperliquidDomain(r);checkedHyperliquidDomain(r.market);
  check(r?.version===2&&wallet(r.account)&&['spot','perp'].includes(r.market?.kind)&&typeof r.market.coin==='string'&&r.market.coin.length<=80,'Invalid saved order.');
  const action=checkedOrderAction(r.action),o=action.orders?.[0];
  check(o&&o.a===r.market.asset&&o.b===(r.side==='buy')&&o.p===r.price&&o.s===r.size&&o.r===r.reduceOnly&&['buy','sell'].includes(r.side),'Saved order terms changed.');
  check(Number.isSafeInteger(r.nonce)&&r.nonce>0&&r.expiresAt===r.nonce+60000&&Number.isInteger(r.leverage)&&r.leverage>0&&orderAmount(r.fee)<=scale/100n&&orderAmount(r.spend)>=0n,'Invalid saved order limits.');
  check(r.market.kind==='perp'?['cross','isolated'].includes(r.marginMode)&&orderAmount(r.markPrice)>0n:r.marginMode===null&&r.markPrice===null,'Invalid saved margin settings.');
  return structuredClone(r);
}
export function verifyOrderSignature(data,signature,account){
  check(typeof signature==='string'&&/^0x[0-9a-fA-F]{130}$/.test(signature),'Wallet returned an invalid signature.');
  check(recoverAddress(TypedDataEncoder.hash(data.domain,data.types,data.message),signature).toLowerCase()===account,'The signing wallet changed. Review again.');
  const v=parseInt(signature.slice(-2),16);check([0,1,27,28].includes(v),'Invalid signature recovery value.');return {r:signature.slice(0,66),s:'0x'+signature.slice(66,130),v:v<27?v+27:v};
}
export function inspectOrder(review,response){
  if(response?.status==='unknownOid')return {state:'unknown',remaining:review.size,filled:'0',oid:null};
  const wrapped=response?.order,o=wrapped?.order;
  check(response?.status==='order'&&o&&o.coin===review.market.coin&&o.cloid===review.action.orders[0].c&&o.side===(review.side==='buy'?'B':'A')&&decimal(o.limitPx)===review.price&&decimal(o.origSz)===review.size,'Status does not match the reviewed order.');
  check(Number.isSafeInteger(o.oid)&&o.oid>=0&&Number.isSafeInteger(wrapped.statusTimestamp),'Invalid order status.');
  const remaining=orderAmount(o.sz),size=orderAmount(review.size);check(remaining<=size,'Invalid remaining order size.');
  const status=wrapped.status,state=status==='open'?'open':status==='filled'?'filled':status==='scheduledCancel'||status==='canceled'||/Canceled$/.test(status)?'cancelled':status==='rejected'||/Rejected$/.test(status)?'rejected':'unknown';
  check(state!=='filled'||remaining===0n,'Filled order has a remaining amount.');
  return {state,remaining:orderText(remaining),filled:orderText(size-remaining),oid:o.oid,statusTime:wrapped.statusTimestamp};
}
export function inspectOrderFills(review,observation,rows,{endTime=Date.now()}={}){
  check(Array.isArray(rows)&&rows.length<=2000&&Number.isSafeInteger(endTime),'Order fills are unavailable. Check again.');
  const trades=[],ids=new Set(),limit=orderAmount(review.price);let filled=0n;
  for(const row of rows.filter(row=>row.oid===observation.oid)){
    check(row.coin===review.market.coin&&row.side===(review.side==='buy'?'B':'A')&&Number.isSafeInteger(row.tid)&&row.tid>=0&&!ids.has(row.tid)&&/^0x[0-9a-f]{64}$/.test(row.hash)&&Number.isSafeInteger(row.time)&&row.time>=review.nonce-60000&&row.time<=endTime,'Fill does not match the reviewed order.');
    const price=decimal(row.px),size=decimal(row.sz),quantity=orderAmount(size),px=orderAmount(price);
    check(quantity>0n&&px>0n&&(review.side==='buy'?px<=limit:px>=limit),'Fill exceeds the reviewed order limits.');
    check(typeof row.fee==='string'&&[review.market.quote,...(review.market.kind==='spot'?[review.market.base]:[])].includes(row.feeToken),'Order fill fees are unavailable.');
    const rebate=row.fee.startsWith('-'),fee=decimal(rebate?row.fee.slice(1):row.fee);
    ids.add(row.tid);filled+=quantity;
    trades.push({tid:row.tid,hash:row.hash,time:row.time,size,price,fee:rebate&&fee!=='0'?'-'+fee:fee,feeToken:row.feeToken});
  }
  check(filled===orderAmount(observation.filled),'Order fills are not confirmed. Check again.');
  return {...observation,fills:trades.sort((a,b)=>a.time-b.time||a.tid-b.tid)};
}
