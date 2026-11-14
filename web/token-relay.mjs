import {readTokenWatch} from '../integrations/token-watch.mjs';
import {tokenWatchRequest} from './public/token-watch.js';
import {createAssetImageRoute} from './asset-image.mjs';
import {discoverWalletAssets} from '../integrations/asset-discovery.mjs';
import {assetDiscoveryRequest} from './public/asset-discovery.js';
import {resolveTokenMetadata} from '../integrations/token-metadata.mjs';
import {tokenMetadataRequest} from './public/token-metadata.js';
const assetImageRoute=createAssetImageRoute();
export function createTokenRoute({read=readTokenWatch,discover=discoverWalletAssets,metadata=resolveTokenMetadata}={}){
 const pending=new Map();
 return async(req,res)=>{
  if(await assetImageRoute(req,res))return true;
  if(!['/api/tokens/read','/api/tokens/discover','/api/tokens/metadata'].includes(req.url))return false;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  if(req.headers.host!=='127.0.0.1:4173'||req.headers.origin!=='http://127.0.0.1:4173'){send(403,{error:'Open token lookup in Lenz.'});return true;}
  if(req.method!=='POST'||req.headers['content-type']!=='application/json'){send(405,{error:'Use JSON POST.'});return true;}
  try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>512)throw Error('Too large');chunks.push(chunk);}
   const [validate,lookup]=req.url==='/api/tokens/metadata'?[tokenMetadataRequest,metadata]:req.url==='/api/tokens/discover'?[assetDiscoveryRequest,discover]:[tokenWatchRequest,read];
   const request=validate(JSON.parse(Buffer.concat(chunks).toString('utf8'))),key=req.url+JSON.stringify(request);
   if(!pending.has(key)){if(pending.size>=3){send(429,{error:'Token lookup busy.'});return true;}pending.set(key,Promise.resolve().then(()=>lookup(request)).finally(()=>pending.delete(key)));}
   send(200,await pending.get(key));
  }catch{send(400,{error:'Could not read this token. Check the network and address.'});}
  return true;
 };
}
export const tokenRoute=createTokenRoute();
