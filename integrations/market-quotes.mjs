import {createHash} from 'node:crypto';
import {MARKET_READS,baseSnapshot,discoverHyperliquid,marketJson} from './market-discovery.mjs';
import {marketQuoteRequest,checkedMarketQuote,decimalUnits,canonicalAmount,requireQuote as check} from '../web/public/market-quote.js';
import {marketFetch} from './market-http.mjs';
export const BASE_QUOTER='0x3d4e44eb1374240ce5f1b871ab261cd16335b76a';
function preview(request,result,evidence,sourceTime,clock){
  const observedAt=clock(),maxAge=request.provider==='uniswap'?60000:30000;
  return checkedMarketQuote({version:1,kind:'market-quote-preview',request,executable:false,result,evidence,sourceTime,observedAt,expiresAt:Math.min(observedAt+30000,sourceTime+maxAge)},request,{now:observedAt});
}
async function uniswapQuote(request,options){
  const s=await baseSnapshot(options,true),[weth,usdc]=MARKET_READS.tokens;
  const input=request.side==='usdc-to-weth'?usdc:weth,output=input===usdc?weth:usdc,amount=decimalUnits(request.amount,input.decimals);
  await Promise.all([s.code(BASE_QUOTER),s.code(MARKET_READS.factory)]);
  const [factory,wrapped,poolResult]=await Promise.all([s.call(BASE_QUOTER,'factory'),s.call(BASE_QUOTER,'WETH9'),s.call(MARKET_READS.factory,'getPool',[weth.id,usdc.id,500])]);
  check(factory[0].toLowerCase()===MARKET_READS.factory&&wrapped[0].toLowerCase()===weth.id,'Quoter identity mismatch.');
  const pool=poolResult[0].toLowerCase();check(`uniswap:${pool}`===request.marketId,'Pool identity changed.');await s.code(pool);
  const [token0,token1,fee,liquidity,slot]=await Promise.all(['token0','token1','fee','liquidity','slot0'].map(name=>s.call(pool,name)));
  check(token0[0].toLowerCase()===weth.id&&token1[0].toLowerCase()===usdc.id&&fee[0]===500n,'Pool assets changed.');
  check(liquidity[0]>0n&&slot[0]>0n&&slot[6]===true,'Pool unavailable.');
  const [amountOut,after,,gas]=await s.call(BASE_QUOTER,'quoteExactInputSingle',[[input.id,output.id,amount,500,0]],'0x2dc6c0');
  // At an extreme price the simulated pool may not consume all exact-input funds.
  check(after>4295128740n&&after<1461446703485210103287273052203988822378723970341n,'Incomplete pool fill.');
  check(amountOut>0n&&gas>0n,'Empty quote.');
  const min=amountOut*BigInt(10000-request.slippageBps)/10000n;check(min>0n,'Minimum output rounds to zero.');
  const evidence=await s.finish();
  return preview(request,{inputUnits:amount.toString(),inputSymbol:input.symbol,inputDecimals:input.decimals,outputUnits:amountOut.toString(),outputSymbol:output.symbol,outputDecimals:output.decimals,minOutputUnits:min.toString(),feePips:500,gasUnits:gas.toString()},evidence,evidence.blockTimestamp,s.clock);
}
export function estimateBook(request,market,book,{now=Date.now()}={}){
  check(market.id===request.marketId&&market.status==='listed'&&market.sizeDecimals<=6,'Perpetual market unavailable.');
  check(book?.coin===market.instrument&&Number.isSafeInteger(book.time)&&book.time>=now-30000&&book.time<=now+5000,'Stale or mismatched order book.');
  check(Array.isArray(book.levels)&&book.levels.length===2,'Invalid order book.');
  const sides=book.levels.map((levels,side)=>{
    check(Array.isArray(levels)&&levels.length>0&&levels.length<=20,'Order book depth unavailable.');
    const rows=levels.map(level=>{
      const px=canonicalAmount(level.px),fraction=px.split('.')[1]??'';
      check(fraction.length<=6-market.sizeDecimals&&(!fraction||px.replace('.','').replace(/^0+/,'').length<=5),'Invalid order-book price precision.');
      check(Number.isSafeInteger(level.n)&&level.n>0,'Invalid order count.');
      return {px:decimalUnits(px,6),sz:decimalUnits(level.sz,market.sizeDecimals),price:px};
    });
    check(rows.every((row,i)=>i===0||(side===0?row.px<rows[i-1].px:row.px>rows[i-1].px)),'Unsorted order book.');return rows;
  });
  check(sides[0][0].px<sides[1][0].px,'Crossed order book.');
  const size=decimalUnits(request.amount,market.sizeDecimals),levels=sides[request.side==='buy'?1:0];
  let remaining=size,total=0n,used=0,worst;
  for(const level of levels){const take=remaining<level.sz?remaining:level.sz;total+=take*level.px;remaining-=take;used++;worst=level.price;if(remaining===0n)break;}
  check(remaining===0n,'Insufficient visible order-book depth.');
  const scale=10n**BigInt(market.sizeDecimals),notional=request.side==='buy'?(total+scale-1n)/scale:total/scale;
  check(notional>0n,'Estimate rounds to zero.');
  return {instrument:market.instrument,sizeUnits:size.toString(),sizeDecimals:market.sizeDecimals,notionalUnits:notional.toString(),notionalDecimals:6,worstPrice:worst,levelsUsed:used,fullDepth:true};
}
async function hyperliquidQuote(request,{fetcher=marketFetch,clock=Date.now}={}){
  const observation=await discoverHyperliquid({fetcher,clock}),market=observation.rows.find(row=>row.id===request.marketId);
  check(market&&market.status==='listed','Perpetual market unavailable.');decimalUnits(request.amount,market.sizeDecimals);
  const book=await marketJson(MARKET_READS.hyperliquid,{type:'l2Book',coin:market.instrument},{fetcher});
  const result=estimateBook(request,market,book,{now:clock()});
  return preview(request,result,{source:MARKET_READS.hyperliquid,assurance:'provider-order-book',bookSha256:createHash('sha256').update(JSON.stringify(book)).digest('hex'),metaSha256:observation.evidence.responseSha256},book.time,clock);
}
export async function quoteMarket(input,options={}){
  const request=marketQuoteRequest(input);
  return request.provider==='uniswap'?uniswapQuote(request,options):hyperliquidQuote(request,options);
}
