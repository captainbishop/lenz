import {marketFetch} from './market-http.mjs';
import {readHyperliquidCatalog} from './hyperliquid-catalog.mjs';
import {normalizePredictions,PREDICTION_PROVIDERS} from '../web/public/prediction-model.js';
import {predictionRequest,predictionSourceURL} from '../web/public/prediction-request.js';

export const PREDICTION_URLS=Object.freeze({
 polymarket:predictionSourceURL({provider:'polymarket'}),
 kalshi:predictionSourceURL({provider:'kalshi'}),
});
export async function boundedMarketJSON(url,{fetcher=marketFetch,signal=AbortSignal.timeout(15000),maxBytes=8*1024*1024}={}){
 const response=await fetcher(url,{method:'GET',headers:{accept:'application/json','accept-encoding':'gzip','user-agent':'Lenz/1.0 (public market data)'},redirect:'error',signal});
 if(!response.ok){await response.body?.cancel();throw Error('Market source unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('Empty market response');
 const chunks=[];let size=0;
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes)throw Error('Market response too large');chunks.push(value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
export function createPredictionReader({fetcher=marketFetch,hyperliquid=readHyperliquidCatalog,clock=Date.now}={}){
 const cache=new Map(),pending=new Map(),retryAfter=new Map();
 return async (provider,options={})=>{
  if(!Object.hasOwn(PREDICTION_PROVIDERS,provider))throw Error('Unknown prediction provider');
  const input=predictionRequest({provider,privacy:'public',...options}),key=JSON.stringify(input);
  const saved=cache.get(key),now=clock();
  if(saved&&now-saved.observedAt<60000)return saved;
  if(now<(retryAfter.get(key)??0)){if(saved)return {...saved,stale:true};throw Error('Market source cooling down');}
  if(!pending.has(key)){if(pending.size>=6)throw Error('Market source busy');pending.set(key,(async()=>{
   try{
    let data=provider==='hyperliquid'?await hyperliquid({signal:AbortSignal.timeout(20000)}):await boundedMarketJSON(predictionSourceURL(input),{fetcher,maxBytes:(input.eventId?32:8)*1024*1024});
    if(provider==='hyperliquid'&&data.unavailable?.some(source=>['outcomeMeta','outcomeTemplates','spotMetaAndAssetCtxs','Predictions'].includes(source)))throw Error('Prediction sources unavailable');
    if(input.eventId){const event=provider==='polymarket'?data:data?.event;if(String(provider==='polymarket'?event?.id:event?.event_ticker)!==input.eventId)throw Error('Wrong prediction event');data=provider==='polymarket'?[event]:{events:[event]};}
    const value=normalizePredictions(provider,data,provider==='hyperliquid'?data.observedAt:clock());
    if(Buffer.byteLength(JSON.stringify(value))>8*1024*1024)throw Error('Prediction snapshot too large');
    cache.set(key,value);while(cache.size>128)cache.delete(cache.keys().next().value);return value;
   }catch(error){retryAfter.set(key,clock()+60000);while(retryAfter.size>128)retryAfter.delete(retryAfter.keys().next().value);if(saved)return {...saved,stale:true};throw error;}
   finally{pending.delete(key);}
  })());}
  return pending.get(key);
 };
}
export const readPredictionCatalog=createPredictionReader();
