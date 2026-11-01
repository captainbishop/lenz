import {resolveName} from '../aurora/name-resolution.mjs';
const origin='http://127.0.0.1:4173';
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export function createNameRoute(lookup=resolveName){
  let active=0;
  return async function nameRoute(req,res){
    if(!req.url.startsWith('/api/names/'))return false;
    if(req.headers.host!=='127.0.0.1:4173' || req.headers.origin!==origin){send(res,403,{error:'Open name lookup in the local Lenz app.'});return true;}
    if(req.url!=='/api/names/resolve'){send(res,404,{error:'Unknown name route.'});return true;}
    if(req.method!=='POST'){send(res,405,{error:'Use POST.'});return true;}
    if(active>=2){send(res,429,{error:'A name check is already running. Try again shortly.'});return true;}
    active++;
    try{
      if(req.headers['content-type']!=='application/json')throw Error('Expected JSON');
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>2048)throw Error('Name request too large');chunks.push(chunk);}
      const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
      send(res,200,await lookup(input));
    }catch{send(res,400,{error:'Check the name, naming service and selected network.'});}
    finally{active--;}
    return true;
  };
}
export const nameRoute=createNameRoute();
