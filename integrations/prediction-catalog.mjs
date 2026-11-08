import {marketFetch} from './market-http.mjs';
import {readHyperliquidCatalog} from './hyperliquid-catalog.mjs';
import {normalizePredictions,PREDICTION_PROVIDERS} from '../web/public/prediction-model.js';

export const PREDICTION_URLS=Object.freeze({
 polymarket:'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=30&order=volume24hr&ascending=false',
 kalshi:'https://external-api.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=30',
});
export async function boundedMarketJSON(url,{fetcher=marketFetch,signal=AbortSignal.timeout(15000),maxBytes=8*1024*1024}={}){
 const response=await fetcher(url,{method:'GET',headers:{accept:'application/json','accept-encoding':'gzip'},redirect:'error',signal});
 if(!response.ok){await response.body?.cancel();throw Error('Market source unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('Empty market response');
 const chunks=[];let size=0;
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Market response too large');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
export function createPredictionReader({fetcher=marketFetch,hyperliquid=readHyperliquidCatalog,clock=Date.now}={}){
 const cache=new Map(),pending=new Map(),retryAfter=new Map();
 return async provider=>{
  if(!Object.hasOwn(PREDICTION_PROVIDERS,provider))throw Error('Unknown prediction provider');
  const saved=cache.get(provider),now=clock();
  if(saved&&now-saved.observedAt<60000)return saved;
  if(now<(retryAfter.get(provider)??0)){if(saved)return {...saved,stale:true};throw Error('Market source cooling down');}
  if(!pending.has(provider))pending.set(provider,(async()=>{
   try{
    const data=provider==='hyperliquid'?await hyperliquid({signal:AbortSignal.timeout(20000)}):await boundedMarketJSON(PREDICTION_URLS[provider],{fetcher,maxBytes:(provider==='polymarket'?32:8)*1024*1024});
    if(provider==='hyperliquid'&&data.unavailable?.some(source=>['outcomeMeta','outcomeTemplates','spotMetaAndAssetCtxs','Predictions'].includes(source)))throw Error('Prediction sources unavailable');
    const value=normalizePredictions(provider,data,provider==='hyperliquid'?data.observedAt:clock());
    if(Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw Error('Prediction snapshot too large');
    cache.set(provider,value);return value;
   }catch(error){retryAfter.set(provider,clock()+60000);if(saved)return {...saved,stale:true};throw error;}
   finally{pending.delete(provider);}
  })());
  return pending.get(provider);
 };
}
export const readPredictionCatalog=createPredictionReader();
