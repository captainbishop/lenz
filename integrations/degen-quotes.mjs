import {baseSnapshot,MARKET_READS} from './market-discovery.mjs';
import {BASE_QUOTER} from './market-quotes.mjs';
import {degenQuoteRequest,checkedDegenPair,checkedDegenQuote} from '../web/public/degen-quote.js';
import {decimalUnits} from '../web/public/market-quote.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export async function poolSnapshot(request,options){
 const snapshot=await baseSnapshot({...options,network:'base'},true),{pool,token}=request;
 await Promise.all([snapshot.code(pool),snapshot.code(MARKET_READS.factory)]);
 const [factory,t0,t1,fee,liquidity,slot]=await Promise.all(['factory','token0','token1','fee','liquidity','slot0'].map(method=>snapshot.call(pool,method)));
 const ids=[t0[0].toLowerCase(),t1[0].toLowerCase()];
 check(factory[0].toLowerCase()===MARKET_READS.factory&&ids[0]<ids[1]&&ids.includes(token),'Not a supported Uniswap V3 pool.');
 check((await snapshot.call(MARKET_READS.factory,'getPool',[...ids,fee[0]]))[0].toLowerCase()===pool,'Pool registration changed.');
 check(liquidity[0]>0n&&slot[0]>0n&&slot[6]===true,'Pool liquidity unavailable.');
 const assets=await Promise.all(ids.map(async id=>{
  await snapshot.code(id);const [decimals,symbol]=await Promise.all([snapshot.call(id,'decimals'),snapshot.call(id,'symbol').catch(()=>null)]);
  const text=symbol?.[0],label=typeof text==='string'&&text.trim().length>0&&text.length<=32&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(text)?text:id.slice(0,6)+'…'+id.slice(-4);
  return {id,symbol:label,decimals:Number(decimals[0])};
 }));
 return {snapshot,assets,feePips:Number(fee[0])};
}
async function envelope(request,pool,extra={}){
 const {snapshot,assets,feePips}=pool,e=await snapshot.finish(),observedAt=snapshot.clock();
 return {version:1,kind:request.kind==='pool'?'degen-pair':'degen-quote',request,assets,feePips,observedAt,expiresAt:Math.min(observedAt+30000,e.blockTimestamp+60000),evidence:{source:e.source,blockNumber:e.blockNumber,blockHash:e.blockHash.toLowerCase(),blockTimestamp:e.blockTimestamp},executable:false,...extra};
}
export async function readDegenPair(input,options={}){
 const request=degenQuoteRequest(input);check(request.kind==='pool','Expected pool request.');
 const pool=await poolSnapshot(request,options);return checkedDegenPair(await envelope(request,pool),request,{now:pool.snapshot.clock()});
}
export async function quoteDegen(input,options={}){
 const request=degenQuoteRequest(input);check(request.kind==='quote','Expected quote request.');
 const pool=await poolSnapshot(request,options),{snapshot,assets,feePips}=pool;
 const selected=assets.find(a=>a.id===request.token),counter=assets.find(a=>a.id!==request.token),from=request.side==='buy'?counter:selected,to=request.side==='buy'?selected:counter;
 const units=decimalUnits(request.amount,from.decimals);await snapshot.code(BASE_QUOTER);
 const [factory,wrapped]=await Promise.all([snapshot.call(BASE_QUOTER,'factory'),snapshot.call(BASE_QUOTER,'WETH9')]);
 check(factory[0].toLowerCase()===MARKET_READS.factory&&wrapped[0].toLowerCase()===MARKET_READS.tokens[0].id,'Quoter identity changed.');
 const [output,after,,gas]=await snapshot.call(BASE_QUOTER,'quoteExactInputSingle',[[from.id,to.id,units,feePips,0]],'0x2dc6c0');
 check(after>4295128740n&&after<1461446703485210103287273052203988822378723970341n,'Incomplete pool fill.');
 return checkedDegenQuote(await envelope(request,pool,{input:from,output:to,inputUnits:units.toString(),outputUnits:output.toString(),minOutputUnits:(output*BigInt(10000-request.slippageBps)/10000n).toString(),gasUnits:gas.toString()}),request,{now:snapshot.clock()});
}
