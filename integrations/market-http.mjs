import https from 'node:https';
import {Readable} from 'node:stream';
import {ORACLE_NETWORKS} from '../web/public/oracle-feeds.js';
// Fixed public market endpoints only. Native HTTPS retains OS networking behavior.
export function createMarketFetcher(request=https.request){
 return async function marketFetch(url,{method,headers,body,signal,redirect}={}){
  if(!['https://mainnet.base.org','https://api.hyperliquid.xyz/info',...Object.values(ORACLE_NETWORKS).map(n=>n.rpc)].includes(url)||method!=='POST'||redirect!=='error')throw Error('Unapproved market request');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const req=request(url,{method,headers,signal},response=>{
    const status=response.statusCode;
    if(status>=300&&status<400){response.destroy();reject(Error('Market redirect rejected'));return;}
    try{const empty=[204,205].includes(status);if(empty)response.resume();resolve(new Response(empty?null:Readable.toWeb(response),{status,headers:response.headers}));}
    catch(error){response.destroy();reject(error);}
   });req.on('error',reject);req.end(body);
  });
 };
}
export const marketFetch=createMarketFetcher();
