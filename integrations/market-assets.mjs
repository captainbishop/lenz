import {MARKET_ASSETS_URL,normalizeMarketAssets} from '../web/public/market-assets.js';
import {boundedMarketJSON} from './prediction-catalog.mjs';
import {marketFetch} from './market-http.mjs';
export function createMarketAssetsReader({fetcher=marketFetch,clock=Date.now}={}){
 let cached=null,pending=null,nextRead=0;
 return async()=>{if(clock()<nextRead){if(cached)return cached;throw Error('Asset data unavailable');}pending??=(async()=>{try{cached=normalizeMarketAssets(await boundedMarketJSON(MARKET_ASSETS_URL,{fetcher,maxBytes:512000}),clock());nextRead=clock()+300000;return cached;}catch(e){nextRead=clock()+60000;if(cached){cached={...cached,stale:true};return cached;}throw e;}finally{pending=null;}})();return pending;};
}
export const readMarketAssets=createMarketAssetsReader();
