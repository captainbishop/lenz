import {HYPERLIQUID} from '../web/public/hyperliquid-environment.js';
import {MARKET_ASSETS_URL} from '../web/public/market-assets.js';
import {INDEX_ENDPOINTS} from '../web/public/market-indices.js';
import https from 'node:https';
import {Readable,pipeline} from 'node:stream';
import {createGunzip} from 'node:zlib';
import {predictionImageURL} from '../web/public/prediction-model.js';
import {isPredictionSourceURL} from '../web/public/prediction-request.js';
import {ORACLE_NETWORKS} from '../web/public/oracle-feeds.js';
import {tokenImageURL} from '../web/public/token-market.js';
export const METADATA_RPC=Object.freeze({solana:'https://api.mainnet-beta.solana.com',near:'https://rpc.mainnet.near.org'});
// Fixed public market endpoints only. Native HTTPS retains OS networking behavior.
export function createMarketFetcher(request=https.request){
 return async function marketFetch(url,{method,headers,body,signal,redirect}={}){
  const rpc=method==='POST'&&['https://mainnet.base.org',HYPERLIQUID.info,...Object.values(ORACLE_NETWORKS).map(n=>n.rpc),...Object.values(METADATA_RPC)].includes(url);
  const token=method==='GET'&&/^https:\/\/api\.dexscreener\.com\/token-pairs\/v1\/(ethereum|arbitrum|base)\/0x[0-9a-f]{40}$/.test(url)&&body===undefined;
  const image=method==='GET'&&body===undefined&&tokenImageURL(url)===url;
  const holdings=method==='GET'&&body===undefined&&/^https:\/\/(eth|arbitrum|base)\.blockscout\.com\/api\/v2\/addresses\/0x[0-9a-f]{40}\/tokens\?type=ERC-20$/.test(url);
  const predictions=method==='GET'&&body===undefined&&(isPredictionSourceURL(url)||predictionImageURL(url)===url||/^https:\/\/external-api\.kalshi\.com\/trade-api\/v2\/events\/[A-Z0-9][A-Z0-9_-]{0,159}\/metadata$/.test(url)||[
   'https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD',
   MARKET_ASSETS_URL,...Object.values(INDEX_ENDPOINTS).map(p=>'https://pro-api.coinmarketcap.com/public-api'+p),
  ].includes(url));
  if((!rpc&&!token&&!image&&!holdings&&!predictions)||redirect!=='error')throw Error('Unapproved market request');
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
