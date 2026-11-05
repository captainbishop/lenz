import {degenRequest} from './public/degen-model.js';
import {readDegen,readDegenCandles} from '../integrations/degen-discovery.mjs';
import {candleHistory} from './degen-history.mjs';
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(value.retryAfterMs?{'Retry-After':String(Math.ceil(value.retryAfterMs/1000))}:{})});res.end(JSON.stringify(value));};
export function createDegenRoute({read=readDegen,candles=readDegenCandles,clock=Date.now,history=null}={}){
  const cache=new Map(),pending=new Map(),calls=[],cooldown=new Map();
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
    let responded=false;const reply=(status,value)=>{if(!responded){responded=true;send(res,status,value);}};
    const saved=()=>{if(['feed','trades'].includes(request.kind))return cached?.value??null;if(request.kind!=='candles'||!history)return null;try{return history.get(request);}catch{console.warn('Candle history could not be read');return null;}};
    const delayed=(delay,error='Waiting for data')=>{const previous=saved();reply(previous?200:429,previous?{...previous,stale:true,retryAfterMs:delay}:{error,retryAfterMs:delay});};
    if(cached&&clock()-cached.at<(request.kind==='trades'?10000:request.kind==='networks'?3600000:60000)){send(res,200,cached.value);return true;}
    if(cached&&request.kind==='feed')reply(200,{...cached.value,stale:true,retryAfterMs:Math.max(10000,(cooldown.get(request.provider)??0)-clock())});
    if(!pending.has(key)){
      if((cooldown.get(request.provider)??0)>clock()){delayed(cooldown.get(request.provider)-clock());return true;}
      while(calls.length&&clock()-calls[0].at>=60000)calls.shift();
      const cost=1,used=calls.filter(c=>c.provider===request.provider).reduce((sum,c)=>sum+c.cost,0);
      if(pending.size>=4||used+cost>(request.provider==='geckoterminal'?24:40)){const oldest=calls.find(c=>c.provider===request.provider);delayed(pending.size>=4?2000:Math.max(1000,60000-(clock()-(oldest?.at??clock()))));return true;}
      calls.push({at:clock(),provider:request.provider,cost});
      pending.set(key,Promise.resolve().then(()=>(request.kind==='candles'?candles:read)(request)).then(value=>{cache.delete(key);cache.set(key,{at:clock(),value});while(cache.size>100)cache.delete(cache.keys().next().value);if(request.kind==='candles'&&history)try{history.put(value);}catch{console.warn('Candle history could not be saved');}return value;}).finally(()=>pending.delete(key)));
    }
    try{reply(200,await pending.get(key));}catch(error){if(error.retryAfterMs){const delay=Math.max(1000,Math.min(300000,error.retryAfterMs));cooldown.set(request.provider,clock()+delay);delayed(delay);}else{const previous=saved();reply(previous?200:502,previous?{...previous,stale:true,retryAfterMs:60000}:{error:'Source unavailable. Earlier data is retained.'});}}
    return true;
  };
}
export const degenRoute=createDegenRoute({history:candleHistory});
