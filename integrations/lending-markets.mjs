import {marketJson,MARKET_READS} from './market-discovery.mjs';
import {marketFetch} from './market-http.mjs';
import {normalizeHyperLending} from '../web/public/lending-markets.js';
export function createHyperLendingReader({fetcher=marketFetch,clock=Date.now}={}){
 let cached=null,pending=null,nextRead=0;
 return async()=>{
  if(clock()<nextRead){if(cached)return cached;throw Error('Lending source unavailable');}
  pending??=(async()=>{try{
   const [reserves,meta]=await Promise.all(['allBorrowLendReserveStates','spotMeta'].map(type=>marketJson(MARKET_READS.hyperliquid,{type},{fetcher,maxBytes:1500000})));
   cached=normalizeHyperLending(reserves,meta,clock());nextRead=clock()+60000;return cached;
  }catch(e){nextRead=clock()+60000;if(cached){cached={...cached,stale:true};return cached;}throw e;}finally{pending=null;}})();return pending;
 };
}
export const readHyperLending=createHyperLendingReader();
