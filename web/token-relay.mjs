import {readTokenWatch} from '../integrations/token-watch.mjs';
import {tokenWatchRequest} from './public/token-watch.js';
export function createTokenRoute({read=readTokenWatch}={}){
 const pending=new Map();
 return async(req,res)=>{
  if(req.url!=='/api/tokens/read')return false;
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  if(req.headers.host!=='127.0.0.1:4173'||req.headers.origin!=='http://127.0.0.1:4173'){send(403,{error:'Open token lookup in Lenz.'});return true;}
  if(req.method!=='POST'||req.headers['content-type']!=='application/json'){send(405,{error:'Use JSON POST.'});return true;}
  try{
   let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>512)throw Error('Too large');chunks.push(chunk);}
   const request=tokenWatchRequest(JSON.parse(Buffer.concat(chunks).toString('utf8'))),key=JSON.stringify(request);
   if(!pending.has(key)){if(pending.size>=3){send(429,{error:'Token lookup busy.'});return true;}pending.set(key,Promise.resolve().then(()=>read(request)).finally(()=>pending.delete(key)));}
   send(200,await pending.get(key));
  }catch{send(400,{error:'Could not read this token. Check the network and address.'});}
  return true;
 };
}
export const tokenRoute=createTokenRoute();
