import {degenQuoteRequest} from './public/degen-quote.js';
import {readDegenPair,quoteDegen} from '../integrations/degen-quotes.mjs';
import {preflightDegen} from '../integrations/degen-preflight.mjs';
import {degenPreflightRequest} from './public/degen-preflight.js';
const send=(res,status,value)=>{if(res.destroyed)return;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
export function createDegenQuoteRoute({readPair=readDegenPair,quote=quoteDegen,preflight=preflightDegen}={}){
 const pending=new Map();
 return async(req,res)=>{
  if(!['/api/degen/quote','/api/degen/preflight'].includes(req.url))return false;
  const checkingWallet=req.url==='/api/degen/preflight';
  if(!['127.0.0.1:4173','localhost:4173'].includes(req.headers.host)||req.headers.origin!==`http://${req.headers.host}`){send(res,403,{error:'Open quotes from Lenz.'});return true;}
  if(req.method!=='POST'){send(res,405,{error:'Use POST.'});return true;}
  let request;
  try{
   if(req.headers['content-type']!=='application/json')throw Error();
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>(checkingWallet?8192:1024))throw Error();chunks.push(chunk);}
   const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));request=checkingWallet?degenPreflightRequest(value):degenQuoteRequest(value);
  }catch{send(res,400,{error:'Invalid swap request.'});return true;}
  const key=req.url+JSON.stringify(request);let entry=pending.get(key);
  if(!entry){
   if(pending.size>=2){send(res,429,{error:'Quotes are busy. Try again shortly.'});return true;}
   const controller=new AbortController();entry={controller,waiters:new Set()};pending.set(key,entry);
   entry.promise=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return (checkingWallet?preflight:request.kind==='pool'?readPair:quote)(request,{signal:controller.signal});}).finally(()=>{if(pending.get(key)===entry)pending.delete(key);});
  }
  const waiter={};entry.waiters.add(waiter);
  const leave=()=>{entry.waiters.delete(waiter);if(!entry.waiters.size){if(pending.get(key)===entry)pending.delete(key);entry.controller.abort();}};
  res.once('close',leave);
  try{send(res,200,await entry.promise);}catch{send(res,502,{error:checkingWallet?'Wallet simulation unavailable. Refresh the quote and try again.':'Quote unavailable. Check that this is a Base Uniswap V3 pool and try again.'});}
  finally{res.off('close',leave);entry.waiters.delete(waiter);}
  return true;
 };
}
export const degenQuoteRoute=createDegenQuoteRoute();
