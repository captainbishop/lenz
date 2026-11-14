import {INDEX_ENDPOINTS,marketIndex} from '../web/public/market-indices.js';
import {boundedMarketJSON} from './prediction-catalog.mjs';
import {marketFetch} from './market-http.mjs';
export function createMarketIndicesReader({fetcher=marketFetch,clock=Date.now}={}){
 let cached={},pending=null,nextRead=0;
 return async()=>{
  if(clock()<nextRead)return cached;
  pending??=(async()=>{try{const results=await Promise.allSettled(Object.entries(INDEX_ENDPOINTS).map(async([key,path])=>[key,marketIndex(key,await boundedMarketJSON('https://pro-api.coinmarketcap.com/public-api'+path,{fetcher,maxBytes:128000}),clock())]));for(const r of results)if(r.status==='fulfilled')cached[r.value[0]]=r.value[1];nextRead=clock()+300000;return cached;}finally{pending=null;}})();return pending;
 };
}
export const readMarketIndices=createMarketIndicesReader();
