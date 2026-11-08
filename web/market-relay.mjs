import {marketReadRequest} from './public/evm-markets.js';
import {discoverMarket} from '../integrations/market-discovery.mjs';
import {quoteMarket} from '../integrations/market-quotes.mjs';
import {marketQuoteRequest} from './public/market-quote.js';
import {readMarketTape} from '../integrations/market-tape.mjs';
import {tapeRequest} from './public/market-tape.js';
import {readPoolPrice} from '../integrations/pool-price.mjs';
import {QUOTE_POOL} from './public/market-quote.js';
import {readOraclePrices} from '../integrations/oracle-prices.mjs';
import {oracleRequest,ORACLE_NETWORKS} from './public/oracle-feeds.js';
import {createMarketStream,createMarketStreamLimits} from './market-stream.mjs';
import {readHyperliquidCatalog} from '../integrations/hyperliquid-catalog.mjs';
import {readHyperliquidTape} from '../integrations/hyperliquid-feed.mjs';
import {hyperliquidRequest} from './public/hyperliquid-catalog.js';
import {checkedHyperliquidEvent} from './public/hyperliquid-feed.js';
import {readPredictionCatalog} from '../integrations/prediction-catalog.mjs';
import {createPredictionImageRoute} from './prediction-image.mjs';
import {readMarketContext} from '../integrations/market-context.mjs';
const origin='http://127.0.0.1:4173';
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export function createMarketRoute({discover=discoverMarket,quote=quoteMarket,tape=readMarketTape,price=readPoolPrice,oracle=readOraclePrices,clock=Date.now,stream,catalog=readHyperliquidCatalog,hyperTape=readHyperliquidTape,hyperStream,predictions=readPredictionCatalog,marketContext=readMarketContext}={}){
  const predictionImage=createPredictionImageRoute();
  const limits=createMarketStreamLimits({clock});
  stream??=createMarketStream({read:tape,clock,limits});
  hyperStream??=createMarketStream({read:hyperTape,parse:hyperliquidRequest,checkEvent:checkedHyperliquidEvent,includeTrades:true,clock,limits});
  const pending=new Map(),recent=new Map(),quotePending=new Map(),tapePending=new Map();
  let hyperReads=0;
  let pricePending=null,priceCache=null;
  const oraclePending=new Map(),oracleCache=new Map();
  return async function marketRoute(req,res){
    if(!req.url.startsWith('/api/markets/'))return false;
    if(req.url.startsWith('/api/markets/prediction-image?')){await predictionImage(req,res);return true;}
    if(req.headers.host!=='127.0.0.1:4173'||req.headers.origin!==origin){send(res,403,{error:'Open market data from the local Lenz app.'});return true;}
    if(req.method!=='POST'){send(res,405,{error:'Use POST'});return true;}
    if(!['/api/markets/read','/api/markets/quote','/api/markets/tape','/api/markets/stream','/api/markets/price','/api/markets/oracles','/api/markets/hyper-catalog','/api/markets/hyper-tape','/api/markets/hyper-stream','/api/markets/predictions','/api/markets/context'].includes(req.url)){send(res,404,{error:'Unknown market route'});return true;}
    try{
      if(req.headers['content-type']!=='application/json')throw Error('Expected JSON');
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>(req.url==='/api/markets/quote'?512:256))throw Error('Request too large');chunks.push(chunk);}
      const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(req.url==='/api/markets/context'){
        if(!input||Object.keys(input).length!==1||input.privacy!=='public')throw Error('Public reads only');
        try{send(res,200,await marketContext());}catch{send(res,503,{error:'Market context unavailable.'});}return true;
      }
      if(req.url==='/api/markets/predictions'){
        if(!input||Object.keys(input).length!==2||input.privacy!=='public'||!['polymarket','kalshi','hyperliquid'].includes(input.provider))throw Error('Invalid prediction request');
        try{send(res,200,await predictions(input.provider));}catch{send(res,503,{error:'Prediction source unavailable.'});}return true;
      }
      if(req.url==='/api/markets/hyper-catalog'){
        if(!input||Object.keys(input).length!==1||input.privacy!=='public')throw Error('Public reads only');
        const abort=new AbortController(),cancel=()=>abort.abort();res.once?.('close',cancel);
        try{const value=await catalog({signal:abort.signal});if(!res.destroyed)send(res,200,value);}finally{res.off?.('close',cancel);}return true;
      }
      if(req.url==='/api/markets/hyper-tape'){
        const request=hyperliquidRequest(input);if(hyperReads+tapePending.size>=4){send(res,429,{error:'Market data busy.'});return true;}
        const abort=new AbortController(),cancel=()=>abort.abort();res.once?.('close',cancel);hyperReads++;
        try{const value=await hyperTape(request,{signal:abort.signal});if(!res.destroyed)send(res,200,value);}finally{hyperReads--;res.off?.('close',cancel);}return true;
      }
      if(['/api/markets/stream','/api/markets/hyper-stream'].includes(req.url)){
        const hyper=req.url==='/api/markets/hyper-stream',request=(hyper?hyperliquidRequest:tapeRequest)(input);let release,heartbeat;
        const close=()=>{clearInterval(heartbeat);release?.();if(!res.writableEnded)res.end();};
        release=(hyper?hyperStream:stream).subscribe(request,event=>{if(res.destroyed)return;const frame=JSON.stringify(event)+'\n';if(!res.write(frame)&&res.writableLength>524288)close();},close);
        res.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Accel-Buffering':'no'});res.flushHeaders();
        res.on('close',close);heartbeat=setInterval(()=>{if(!res.destroyed)res.write('\n');},15000);heartbeat.unref?.();
        return true;
      }
      if(req.url==='/api/markets/oracles'){
        const request=oracleRequest(input),key=request.network,cached=oracleCache.get(key);
        if(cached&&clock()-cached.at<ORACLE_NETWORKS[key].period){send(res,200,cached.value);return true;}
        if(!oraclePending.has(key))oraclePending.set(key,Promise.resolve().then(()=>oracle(request)).then(value=>{oracleCache.set(key,{at:clock(),value});return value;}).finally(()=>oraclePending.delete(key)));
        send(res,200,await oraclePending.get(key));return true;
      }
      if(req.url==='/api/markets/price'){
        if(!input||Object.keys(input).length!==1||input.marketId!==QUOTE_POOL)throw Error('Unsupported pool');
        if(priceCache&&clock()-priceCache.at<2000){send(res,200,priceCache.value);return true;}
        if(!pricePending)pricePending=Promise.resolve().then(()=>price()).then(value=>{priceCache={at:clock(),value};return value;}).finally(()=>pricePending=null);
        send(res,200,await pricePending);return true;
      }
      if(req.url==='/api/markets/tape'){
        const request=tapeRequest(input),key=JSON.stringify(request);
        if(!tapePending.has(key)){
          if(tapePending.size+hyperReads>=4){send(res,429,{error:'Market data busy.'});return true;}
          tapePending.set(key,Promise.resolve().then(()=>tape(request)).finally(()=>tapePending.delete(key)));
        }
        send(res,200,await tapePending.get(key));return true;
      }
      if(req.url==='/api/markets/quote'){
        const request=marketQuoteRequest(input),key=JSON.stringify(request);
        if(!quotePending.has(key)){
          if(quotePending.size>=4){send(res,429,{error:'Quote service busy. Try again.'});return true;}
          quotePending.set(key,Promise.resolve().then(()=>quote(request)).finally(()=>quotePending.delete(key)));
        }
        send(res,200,await quotePending.get(key));return true;
      }
      const request=marketReadRequest(input),provider=request.provider+(request.network&&request.network!=='base'?':'+request.network:''),cached=recent.get(provider);
      if(cached&&clock()-cached.at<(provider==='hyperliquid'?1000:15000)){send(res,200,cached.value);return true;}
      if(!pending.has(provider)){
        const promise=Promise.resolve().then(()=>discover(request.provider,request.network?{network:request.network}:{})).then(value=>{recent.set(provider,{at:clock(),value});return value;}).finally(()=>pending.delete(provider));
        pending.set(provider,promise);
      }
      send(res,200,await pending.get(provider));
    }catch{send(res,400,{error:'Market data could not be checked. Try again.'});}
    return true;
  };
}
export const marketRoute=createMarketRoute();
