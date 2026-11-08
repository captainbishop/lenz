import {boundedMarketJSON} from './prediction-catalog.mjs';
import {marketFetch} from './market-http.mjs';
export function createMarketContextReader({fetcher=marketFetch,clock=Date.now}={}){
 let cached=null,pending=null,retryAt=0;
 return async()=>{
  if(cached&&clock()-cached.observedAt<60000)return cached;
  if(clock()<retryAt){if(cached)return {...cached,stale:true};throw Error('Market context unavailable');}
  pending??=(async()=>{
   try{
    const response=await boundedMarketJSON('https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD',{fetcher,maxBytes:128000});
    if(![0,'0'].includes(response.status?.error_code))throw Error('Market context unavailable');
    const d=response.data,q=d?.quote?.USD;
    if(!q)throw Error('Market context unavailable');
    const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
    cached={version:1,provider:'coinmarketcap',observedAt:clock(),updatedAt:Date.parse(q.last_updated)||null,marketCap:number(q.total_market_cap),volume24h:number(q.total_volume_24h),btcDominance:number(d.btc_dominance)};
    return cached;
   }catch(error){retryAt=clock()+60000;if(cached)return {...cached,stale:true};throw error;}
   finally{pending=null;}
  })();return pending;
 };
}
export const readMarketContext=createMarketContextReader();
