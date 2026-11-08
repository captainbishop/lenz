import {marketFetch} from '../integrations/market-http.mjs';
import {predictionImageURL} from './public/prediction-model.js';
import {boundedMarketJSON} from '../integrations/prediction-catalog.mjs';
export function createPredictionImageRoute({fetcher=marketFetch}={}){
 const cache=new Map(),pending=new Map();
 async function read(key){
  let urls=[key];
  if(key.startsWith('kalshi:')){
   const metadata=await boundedMarketJSON('https://external-api.kalshi.com/trade-api/v2/events/'+key.slice(7)+'/metadata',{fetcher,maxBytes:128000,signal:AbortSignal.timeout(10000)});
   const marketImages=Array.isArray(metadata.market_details)?metadata.market_details.map(m=>predictionImageURL(m.image_url)):[];
   const oneSubject=marketImages.length>0&&marketImages.every(value=>value&&value===marketImages[0]);
   const images=oneSubject?[metadata.featured_image_url,metadata.image_url]:[metadata.image_url];
   urls=[...new Set(images.map(predictionImageURL).filter(value=>value&&new URL(value).hostname==='assets.kalshi.com'))];
  }
  for(const url of urls){try{const result=await raster(url);cache.set(key,result);while(cache.size>80)cache.delete(cache.keys().next().value);return result;}catch{}}
  throw Error('Event image unavailable');
 }
 async function raster(url){
  const response=await fetcher(url,{method:'GET',headers:{accept:'image/png,image/jpeg,image/webp'},redirect:'error',signal:AbortSignal.timeout(10000)}),type=response.headers.get('content-type')?.split(';')[0];
  if(!response.ok||!['image/png','image/jpeg','image/webp'].includes(type)){await response.body?.cancel();throw Error('Image unavailable');}
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>300000)throw Error('Image too large');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
  const body=Buffer.concat(chunks),valid=type==='image/png'?body.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):type==='image/jpeg'?body[0]===255&&body[1]===216&&body[2]===255:body.toString('ascii',0,4)==='RIFF'&&body.toString('ascii',8,12)==='WEBP';
  if(!valid)throw Error('Invalid image');return {type,body};
 }
 return async(req,res)=>{
  const input=new URL(req.url,'http://127.0.0.1:4173'),event=input.searchParams.get('event'),url=event&&/^kalshi:[A-Z0-9][A-Z0-9_-]{0,159}$/.test(event)?event:predictionImageURL(input.searchParams.get('url'));
  if(req.method!=='GET'||req.headers.host!=='127.0.0.1:4173'||!url||input.searchParams.size!==1){res.writeHead(400);res.end();return;}
  try{
   if(!cache.has(url)&&!pending.has(url)){if(pending.size>=6)throw Error('Image service busy');pending.set(url,read(url).finally(()=>pending.delete(url)));}
   const value=cache.get(url)??await pending.get(url);
   res.writeHead(200,{'Content-Type':value.type,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(value.body);
  }catch{res.writeHead(404,{'Cache-Control':'no-store'});res.end();}
 };
}
