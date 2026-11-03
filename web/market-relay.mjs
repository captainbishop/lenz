import {discoverMarket} from '../integrations/market-discovery.mjs';
import {quoteMarket} from '../integrations/market-quotes.mjs';
import {marketQuoteRequest} from './public/market-quote.js';
const origin='http://127.0.0.1:4173';
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export function createMarketRoute({discover=discoverMarket,quote=quoteMarket,clock=Date.now}={}){
  const pending=new Map(),recent=new Map(),quotePending=new Map();
  return async function marketRoute(req,res){
    if(!req.url.startsWith('/api/markets/'))return false;
    if(req.headers.host!=='127.0.0.1:4173'||req.headers.origin!==origin){send(res,403,{error:'Open market data from the local Lenz app.'});return true;}
    if(req.method!=='POST'){send(res,405,{error:'Use POST'});return true;}
    if(!['/api/markets/read','/api/markets/quote'].includes(req.url)){send(res,404,{error:'Unknown market route'});return true;}
    try{
      if(req.headers['content-type']!=='application/json')throw Error('Expected JSON');
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>(req.url==='/api/markets/quote'?512:256))throw Error('Request too large');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(req.url==='/api/markets/quote'){
        const request=marketQuoteRequest(input),key=JSON.stringify(request);
        if(!quotePending.has(key)){
          if(quotePending.size>=4){send(res,429,{error:'Quote service busy. Try again.'});return true;}
          quotePending.set(key,Promise.resolve().then(()=>quote(request)).finally(()=>quotePending.delete(key)));
        }
        send(res,200,await quotePending.get(key));return true;
      }
      if(!input||Object.keys(input).length!==1||!['uniswap','aave','hyperliquid'].includes(input.provider))throw Error('Choose a discovery provider');
      const provider=input.provider,cached=recent.get(provider);
      if(cached&&clock()-cached.at<15000){send(res,200,cached.value);return true;}
      if(!pending.has(provider)){
        const promise=Promise.resolve().then(()=>discover(provider)).then(value=>{recent.set(provider,{at:clock(),value});return value;}).finally(()=>pending.delete(provider));
        pending.set(provider,promise);
      }
      send(res,200,await pending.get(provider));
    }catch{send(res,400,{error:'Market data could not be checked. Try again.'});}
    return true;
  };
}
export const marketRoute=createMarketRoute();
