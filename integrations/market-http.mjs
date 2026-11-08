import {predictionImageURL} from '../web/public/prediction-model.js';
import https from 'node:https';
import {Readable,pipeline} from 'node:stream';
import {createGunzip} from 'node:zlib';
import {ORACLE_NETWORKS} from '../web/public/oracle-feeds.js';
// Fixed public market endpoints only. Native HTTPS retains OS networking behavior.
export function createMarketFetcher(request=https.request){
 return async function marketFetch(url,{method,headers,body,signal,redirect}={}){
  const rpc=method==='POST'&&['https://mainnet.base.org','https://api.hyperliquid.xyz/info',...Object.values(ORACLE_NETWORKS).map(n=>n.rpc)].includes(url);
  const predictions=method==='GET'&&body===undefined&&(predictionImageURL(url)===url||/^https:\/\/external-api\.kalshi\.com\/trade-api\/v2\/events\/[A-Z0-9][A-Z0-9_-]{0,159}\/metadata$/.test(url)||[
   'https://gamma-api.polymarket.com/events?active=true&closed=false&limit=30&order=volume24hr&ascending=false',
   'https://external-api.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=30',
   'https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD',
  ].includes(url));
  if((!rpc&&!predictions)||redirect!=='error')throw Error('Unapproved market request');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const req=request(url,{method,headers,signal},response=>{
    const status=response.statusCode;
    if(status>=300&&status<400){response.destroy();reject(Error('Market redirect rejected'));return;}
    try{const empty=[204,205].includes(status),headers={...response.headers};let stream=response;if(empty)response.resume();
     if(!empty&&headers['content-encoding']==='gzip'){stream=createGunzip();pipeline(response,stream,()=>{});delete headers['content-encoding'];delete headers['content-length'];}
     resolve(new Response(empty?null:Readable.toWeb(stream),{status,headers}));}
    catch(error){response.destroy();reject(error);}
   });req.on('error',reject);req.end(body);
  });
 };
}
export const marketFetch=createMarketFetcher();
