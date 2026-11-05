import {readReceiveAssets} from '../integrations/intents-receive.mjs';
import {receiveAssets} from './public/receive-assets.js';

export function createReceiveRoute({read=readReceiveAssets,now=Date.now}={}){
  let saved=null,pending=null,retryAt=0;
  return async(req,res)=>{
    if(req.url!=='/api/receive/assets')return false;
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    if(req.headers.host!=='127.0.0.1:4173'){send(403,{error:'Open receiving assets in Lenz.'});return true;}
    if(req.method!=='GET'){send(405,{error:'Use an asset lookup.'});return true;}
    try{
      if(!saved||now()-saved.observedAt>=300000){
        if(!pending&&now()>=retryAt)pending=Promise.resolve().then(()=>read()).then(tokens=>{saved={tokens:receiveAssets(tokens),observedAt:now()};}).catch(()=>{retryAt=now()+30000;}).finally(()=>{pending=null;});
        if(pending)await pending;
      }
      if(!saved)throw Error('No assets');
      send(200,{...saved,stale:now()-saved.observedAt>=300000,provider:'near-intents',depositAvailable:false});
    }catch{send(503,{error:'Asset list unavailable. Try again shortly.'});}return true;
  };
}
export const receiveRoute=createReceiveRoute();
