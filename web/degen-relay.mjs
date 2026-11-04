import {degenRequest} from './public/degen-model.js';
import {readDegen,readDegenCandles} from '../integrations/degen-discovery.mjs';
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
export function createDegenRoute({read=readDegen,candles=readDegenCandles,clock=Date.now}={}){
  const cache=new Map(),pending=new Map(),calls=[];
  return async(req,res)=>{
    if(!req.url.startsWith('/api/degen/'))return false;
    if(!['127.0.0.1:4173','localhost:4173'].includes(req.headers.host)||req.headers.origin!==`http://${req.headers.host}`){send(res,403,{error:'Open from Lenz'});return true;}
    if(req.url!=='/api/degen/read'){send(res,404,{error:'Unknown route'});return true;}
    if(req.method!=='POST'){send(res,405,{error:'Use POST'});return true;}
    let request;
    try{
      if(req.headers['content-type']!=='application/json')throw Error();
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1024)throw Error();chunks.push(chunk);}
      request=degenRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    }catch{send(res,400,{error:'Invalid discovery request'});return true;}
    const key=JSON.stringify(request),cached=cache.get(key);
    if(cached&&clock()-cached.at<60000){send(res,200,cached.value);return true;}
    if(!pending.has(key)){
      while(calls.length&&clock()-calls[0].at>=60000)calls.shift();
      const cost=request.kind==='candles'?2:1,used=calls.filter(c=>c.provider===request.provider).reduce((sum,c)=>sum+c.cost,0);
      if(pending.size>=4||used+cost>(request.provider==='geckoterminal'?8:40)){send(res,429,{error:'Data limit reached. Try again shortly.'});return true;}
      calls.push({at:clock(),provider:request.provider,cost});
      pending.set(key,Promise.resolve().then(()=>(request.kind==='candles'?candles:read)(request)).then(value=>{cache.delete(key);cache.set(key,{at:clock(),value});while(cache.size>100)cache.delete(cache.keys().next().value);return value;}).finally(()=>pending.delete(key)));
    }
    try{send(res,200,await pending.get(key));}catch{send(res,502,{error:'Source unavailable. Earlier data is retained.'});}
    return true;
  };
}
export const degenRoute=createDegenRoute();
