import {tokenImageURL} from './public/token-market.js';
import {marketFetch} from '../integrations/market-http.mjs';
export function createAssetImageRoute({fetcher=marketFetch}={}){
 const cache=new Map(),pending=new Map();let active=0;const waiting=[];
 async function read(url){
  if(active>=4)await new Promise(resolve=>waiting.push(resolve));active++;
  try{
   const response=await fetcher(url,{method:'GET',headers:{accept:'image/png,image/webp,image/jpeg,image/gif'},redirect:'error',signal:AbortSignal.timeout(10000)}),type=response.headers.get('content-type')?.split(';')[0];
   if(!response.ok||!['image/png','image/webp','image/jpeg','image/gif'].includes(type)){await response.body?.cancel();throw Error('Image unavailable');}
   const chunks=[],reader=response.body.getReader();let size=0;
   try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>300000)throw Error('Image too large');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
   const value={type,body:Buffer.concat(chunks),until:Date.now()+3600000};cache.set(url,value);while(cache.size>128)cache.delete(cache.keys().next().value);return value;
  }finally{active--;waiting.shift()?.();}
 }
 return async(req,res)=>{
  if(!req.url.startsWith('/api/asset-image?'))return false;
  const input=new URL(req.url,'http://127.0.0.1:4173'),url=tokenImageURL(input.searchParams.get('url'));
  if(req.method!=='GET'||!['127.0.0.1:4173','localhost:4173'].includes(req.headers.host)||!url||input.searchParams.size!==1){res.writeHead(400);res.end();return true;}
  try{
   let value=cache.get(url);if(!value||value.until<Date.now()){
    if(!pending.has(url)){if(pending.size>=128)throw Error('Image queue full');pending.set(url,read(url).finally(()=>pending.delete(url)));}value=await pending.get(url);
   }
   res.writeHead(200,{'Content-Type':value.type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(value.body);
  }catch{res.writeHead(404,{'Cache-Control':'no-store'});res.end();}return true;
 };
}
