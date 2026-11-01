import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { CarrierStore } from './store.mjs';
import { CARRIER_DOMAIN, MAX_ENVELOPE_BYTES, PAGE_SIZE, carrierOrigin, validateEnvelope, validateInbox, carrierPost } from '../web/public/carrier-protocol.js';

export function createCarrier({origin, directory, peers=[], allowedOrigins=[], host='127.0.0.1', port, interval=2000, limits, now=Date.now, post=carrierPost}) {
  carrierOrigin(origin); peers.forEach(carrierOrigin); allowedOrigins.forEach(carrierOrigin);
  if(peers.length>4 || new Set(peers).size!==peers.length || peers.includes(origin))throw Error('Choose up to four distinct peer carriers.');
  const store=new CarrierStore(directory,limits), retry=new Map(), controller=new AbortController();
  let active=0, working=false, closed=false, timer;
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    if(active>=8){json(res,503,{error:'Carrier busy.'});return;}
    active++;
    try {
      if(req.headers.host!==new URL(origin).host)throw Error('Incorrect carrier host.');
      const browserOrigin=req.headers.origin;
      if(browserOrigin) {
        if(!allowedOrigins.includes(browserOrigin))throw Error('App origin not allowed.');
        res.setHeader('Access-Control-Allow-Origin',browserOrigin); res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type');
      }
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      if(req.url==='/health' && req.method==='GET'){json(res,200,{type:CARRIER_DOMAIN,role:'encrypted-store-and-forward'});return;}
      if(req.method!=='POST' || !['/v1/store','/v1/inbox'].includes(req.url)) {json(res,404,{error:'Unknown carrier operation.'});return;}
      if(req.headers['content-type']!=='application/json')throw Error('JSON required.');
      const limit=req.url==='/v1/store'?MAX_ENVELOPE_BYTES:2048;
      if(Number(req.headers['content-length']??0)>limit)throw Error('Request too large.');
      const parts=[];let size=0;
      const deadline=setTimeout(()=>req.destroy(),8000);deadline.unref();
      try {for await(const part of req){size+=part.length;if(size>limit)throw Error('Request too large.');parts.push(part);}}
      finally {clearTimeout(deadline);}
      const body=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(req.url==='/v1/store') {
        const envelope=await validateEnvelope(body,now());
        store.put(envelope,now());
        json(res,200,{type:CARRIER_DOMAIN,id:envelope.id,status:'stored',expiresAt:envelope.expiresAt});
      } else {
        const q=await validateInbox(body,origin,now()), envelopes=store.inbox(q.recipient.id,q.after,PAGE_SIZE,now());
        json(res,200,{type:CARRIER_DOMAIN,envelopes,next:envelopes.length===PAGE_SIZE?envelopes.at(-1).id:''});
      }
    }catch(error){if(!res.headersSent&&!res.destroyed)json(res,400,{error:'Carrier rejected request.'});}
    finally{active--;}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=32;server.maxRequestsPerSocket=100;
  async function tick(){
    if(working||closed)return;working=true;
    try{
      const messages=store.all(now()),live=new Set(messages.flatMap(e=>peers.map(p=>p+'/'+e.id)));
      for(const key of retry.keys())if(!live.has(key))retry.delete(key);
      await Promise.allSettled(peers.map(async peer=>{
        const due=messages.filter(e=>(retry.get(peer+'/'+e.id)?.at??0)<=now()).slice(0,8);
        for(const e of due){
          if(closed)break;
          const key=peer+'/'+e.id,old=retry.get(key);
          try{
            const ack=await post(peer,'/v1/store',e,{signal:controller.signal,limit:1024});
            if(ack.type!==CARRIER_DOMAIN||ack.id!==e.id||ack.status!=='stored'||ack.expiresAt!==e.expiresAt)throw Error('Invalid custody response.');
            retry.set(key,{at:now()+300000,failures:0});
          }catch{
            const failures=Math.min((old?.failures??0)+1,8);
            retry.set(key,{at:now()+Math.min(300000,1000*2**failures)+Math.floor(Math.random()*500),failures});
          }
        }
      }));
    }finally{working=false;}
  }
  return {server,store,tick,async listen(){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port??Number(new URL(origin).port),host,resolve);});timer=setInterval(()=>void tick(),interval);timer.unref();return origin;},
    async close(){closed=true;clearInterval(timer);controller.abort();server.closeAllConnections();await new Promise(r=>server.close(r));while(working)await new Promise(r=>setTimeout(r,10));store.close();}};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const {CARRIER_ORIGIN,CARRIER_DATA_DIR,CARRIER_PEERS='[]',CARRIER_APP_ORIGINS='[]',CARRIER_HOST='127.0.0.1',CARRIER_PORT}=process.env;
  if(!CARRIER_ORIGIN||!CARRIER_DATA_DIR)throw Error('Set CARRIER_ORIGIN and CARRIER_DATA_DIR. See carrier/README.md.');
  const carrier=createCarrier({origin:CARRIER_ORIGIN,directory:CARRIER_DATA_DIR,peers:JSON.parse(CARRIER_PEERS),allowedOrigins:JSON.parse(CARRIER_APP_ORIGINS),host:CARRIER_HOST,port:CARRIER_PORT?Number(CARRIER_PORT):undefined});
  await carrier.listen();console.log('Lenz carrier listening at '+CARRIER_ORIGIN);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void carrier.close().then(()=>process.exit(0));});
}
