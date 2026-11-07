import {marketJson,MARKET_READS} from './market-discovery.mjs';
import {marketFetch} from './market-http.mjs';
import {normalizeHyperliquidCatalog,checkedHyperliquidCatalog} from '../web/public/hyperliquid-catalog.js';

export function createHyperliquidCatalogReader({fetcher=marketFetch,clock=Date.now}={}){
  let cached,pending;
  return async function readCatalog({signal}={}){
    signal?.throwIfAborted();
    if(cached&&clock()-cached.observedAt<(cached.unavailable.length?10000:60000))return cached;
    if(!pending){
    const group={abort:new AbortController(),readers:0};pending=group;
    group.promise=(async()=>{
      const unavailable=[];
      const read=async(type,extra={})=>{
        group.abort.signal.throwIfAborted();
        try{
          const value=await marketJson(MARKET_READS.hyperliquid,{type,...extra},{fetcher,signal:AbortSignal.any([group.abort.signal,AbortSignal.timeout(12000)]),maxBytes:2*1024*1024});
          // Validate each source before it can affect the healthy catalogue sections.
          if(type==='spotMetaAndAssetCtxs'){
            if(!Array.isArray(value?.[0]?.tokens)||!Array.isArray(value?.[0]?.universe)||!Array.isArray(value?.[1]))throw Error();
            checkedHyperliquidCatalog(normalizeHyperliquidCatalog({spot:value}));
          }else if(type==='metaAndAssetCtxs')checkedHyperliquidCatalog(normalizeHyperliquidCatalog({perps:[{dex:extra.dex,meta:value?.[0],contexts:value?.[1]}]}));
          else if(type==='outcomeMeta'){
            if(!Array.isArray(value?.outcomes)||!Array.isArray(value?.questions))throw Error();
            checkedHyperliquidCatalog(normalizeHyperliquidCatalog({outcomes:value}));
          }else if(!Array.isArray(value))throw Error();
          if(type==='outcomeTemplates'&&!value.every(t=>typeof t?.id==='string'&&typeof t.name==='string'&&typeof t.description==='string'))throw Error();
          return value;
        }catch(error){if(group.abort.signal.aborted)throw error;unavailable.push(type==='metaAndAssetCtxs'?extra.dex||'Perps':type);return null;}
      };
      const [spot,dexs,outcomes,templates]=await Promise.all(['spotMetaAndAssetCtxs','perpDexs','outcomeMeta','outcomeTemplates'].map(type=>read(type)));
      const names=['',...[...new Set((dexs??[]).filter(d=>d&&/^[a-z0-9]{1,20}$/.test(d.name)).map(d=>d.name))].slice(0,50)];
      const perps=[];
      // A directory refresh has bounded parallelism, regardless of venue count.
      for(let start=0;start<names.length;start+=3){
        group.abort.signal.throwIfAborted();
        await Promise.all(names.slice(start,start+3).map(async dex=>{
          const response=await read('metaAndAssetCtxs',{dex});
          if(response)perps.push({dex,meta:response[0],contexts:response[1]});
        }));
      }
      if(!spot&&!outcomes&&!perps.length)throw Error('Catalogue unavailable');
      group.abort.signal.throwIfAborted();
      const value=normalizeHyperliquidCatalog({spot,perps},clock());
      if(outcomes){
        try{
          const section=checkedHyperliquidCatalog(normalizeHyperliquidCatalog({spot,outcomes,templates},value.observedAt));
          value.rows.push(...section.rows.filter(row=>row.kind==='outcome'));
        }catch{unavailable.push('Predictions');}
      }
      value.unavailable=unavailable;
      cached=checkedHyperliquidCatalog(value);return cached;
    })().finally(()=>{if(pending===group)pending=null;});
    }
    const group=pending;group.readers++;
    return new Promise((resolve,reject)=>{
      let finished=false;
      const finish=(callback,value)=>{
        if(finished)return;finished=true;signal?.removeEventListener('abort',cancel);group.readers--;
        if(!group.readers&&pending===group){pending=null;group.abort.abort();}
        callback(value);
      };
      const cancel=()=>finish(reject,signal.reason);signal?.addEventListener('abort',cancel,{once:true});
      group.promise.then(value=>finish(resolve,value),error=>finish(reject,error));
    });
  };
}
export const readHyperliquidCatalog=createHyperliquidCatalogReader();
