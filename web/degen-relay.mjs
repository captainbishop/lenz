import {degenRequest} from './public/degen-model.js';
import {readDegen,readDegenCandles} from '../integrations/degen-discovery.mjs';
import {candleHistory} from './degen-history.mjs';
import {createDegenScheduler} from './degen-scheduler.mjs';
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(value.retryAfterMs?{'Retry-After':String(Math.ceil(value.retryAfterMs/1000))}:{})});res.end(JSON.stringify(value));};
export function createDegenRoute({read=readDegen,candles=readDegenCandles,clock=Date.now,history=null,scheduler=createDegenScheduler({clock})}={}){
  const cache=new Map(),pending=new Map();
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
    let responded=false,closed=false;const reply=(status,value)=>{if(!responded&&!closed){responded=true;send(res,status,value);}};
    const saved=()=>{if(['feed','trades'].includes(request.kind))return cached?.value??null;if(request.kind!=='candles'||!history)return null;try{return history.get(request);}catch{console.warn('Candle history could not be read');return null;}};
    const ttl=request.kind==='trades'?10000:request.kind==='networks'?3600000:60000;
    if(cached&&clock()-cached.at<ttl){reply(200,cached.value);return true;}
    const previous=saved();if(previous)reply(200,{...previous,stale:true,retryAfterMs:Math.max(3000,scheduler.delay(request.provider))});
    let entry=pending.get(key);
    if(!entry){
      entry={controller:new AbortController(),waiters:new Set(),background:Boolean(previous)};pending.set(key,entry);
      const signal=entry.controller.signal;
      entry.promise=scheduler.run(request.provider,()=>(request.kind==='candles'?candles:read)(request,{signal}),{signal,priority:previous?3:request.kind==='candles'?0:request.kind==='trades'?1:2}).then(value=>{
        signal.throwIfAborted();cache.delete(key);cache.set(key,{at:clock(),value});while(cache.size>100)cache.delete(cache.keys().next().value);
        if(request.kind==='candles'&&history)try{history.put(value);}catch{console.warn('Candle history could not be saved');}return value;
      }).finally(()=>{if(pending.get(key)===entry)pending.delete(key);});
    }
    const waiter={};entry.waiters.add(waiter);
    const leave=()=>{closed=true;entry.waiters.delete(waiter);if(!entry.waiters.size&&!entry.background){if(pending.get(key)===entry)pending.delete(key);entry.controller.abort();}};
    if(!responded)res.once?.('close',leave);
    try{reply(200,await entry.promise);}catch(error){if(error.name!=='AbortError'){const delay=error.retryAfterMs?Math.max(1000,Math.min(300000,error.retryAfterMs)):15000;reply(error.retryAfterMs?429:502,{error:'Source unavailable',retryAfterMs:delay});}}
    finally{res.removeListener?.('close',leave);entry.waiters.delete(waiter);}
    return true;
  };
}
export const degenRoute=createDegenRoute({history:candleHistory});
