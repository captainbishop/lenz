import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createMarketFetcher} from '../integrations/market-http.mjs';
import {createMarketContextReader} from '../integrations/market-context.mjs';
import {boundedMarketJSON,PREDICTION_URLS} from '../integrations/prediction-catalog.mjs';
import {createMarketRoute} from './market-relay.mjs';
import {createPredictionImageRoute} from './prediction-image.mjs';

const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
const request=(url,input,headers={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),{url,method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json',...headers}});
test('prediction and context routes reject private data, foreign origins and arbitrary upstreams',async()=>{
 let calls=0;const read=async()=>{calls++;return {};},route=createMarketRoute({predictions:read,marketContext:read});
 for(const [url,input] of [['/api/markets/predictions',{provider:'polymarket',privacy:'public'}],['/api/markets/context',{privacy:'public'}]]){
  for(const extra of [{address:'wallet'},{url:'http://127.0.0.1/private'},{privacy:'private'}]){const res=response();await route(request(url,{...input,...extra}),res);assert.equal(res.status,400);}
  for(const headers of [{host:'evil.test'},{origin:'https://evil.test'}]){const res=response();await route(request(url,input,headers),res);assert.equal(res.status,403);}
  assert.equal(calls,0);
 }
 const res=response();await route(request('/api/markets/predictions',{provider:'constructor',privacy:'public'}),res);assert.equal(res.status,400);assert.equal(calls,0);
});

test('market transport rejects private hosts, lookalikes, added queries and GET bodies before requesting',async()=>{
 const read=createMarketFetcher(()=>assert.fail('Unapproved request reached HTTPS'));
 for(const url of ['http://127.0.0.1/private','https://images.polymarket.com.evil.test/a.png','https://name:pass@images.polymarket.com/a.png','https://images.polymarket.com:444/a.png',PREDICTION_URLS.polymarket+'&account=secret','https://pro-api.coinmarketcap.com/public-api/v1/global-metrics/quotes/latest?convert=USD&extra=1'])await assert.rejects(()=>read(url,{method:'GET',redirect:'error'}));
 await assert.rejects(()=>read(PREDICTION_URLS.polymarket,{method:'GET',redirect:'error',body:'private'}));
});

test('image relay rejects markup, oversized bodies and foreign URLs, then caches bounded raster data',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9XkAAAAASUVORK5CYII=','base64');
 let calls=0,mode='svg';const route=createPredictionImageRoute({fetcher:async()=>{calls++;return new Response(mode==='large'?Buffer.alloc(300001):mode==='html'?'<!DOCTYPE html>':png,{headers:{'content-type':mode==='svg'?'image/svg+xml':'image/png'}});}});
 const get=url=>({url:'/api/markets/prediction-image?url='+encodeURIComponent(url),method:'GET',headers:{host:'127.0.0.1:4173'}});
 const rejected=response();await route(get('http://127.0.0.1/private'),rejected);assert.equal(rejected.status,400);assert.equal(calls,0);
 for(mode of ['svg','large','html']){const res=response();await route(get('https://images.polymarket.com/a.png'),res);assert.equal(res.status,404);}
 mode='png';for(let i=0;i<2;i++){const res=response();await route(get('https://images.polymarket.com/a.png'),res);assert.equal(res.status,200);assert.equal(res.headers['X-Content-Type-Options'],'nosniff');assert.equal(res.headers['Content-Security-Policy'],"default-src 'none'; sandbox");}assert.equal(calls,4);
});

test('Kalshi artwork binds metadata to the exact event and falls back from an oversized featured image',async()=>{
 const calls=[],png=Buffer.from([137,80,78,71,13,10,26,10]),route=createPredictionImageRoute({fetcher:async url=>{calls.push(url);if(url.endsWith('/metadata'))return new Response(JSON.stringify({featured_image_url:'https://assets.kalshi.com/large.png',image_url:'https://assets.kalshi.com/event.png',market_details:[{image_url:'https://assets.kalshi.com/large.png'}]}));return new Response(url.endsWith('/large.png')?Buffer.alloc(300001):png,{headers:{'content-type':'image/png'}});}});
 const req=event=>({url:'/api/markets/prediction-image?event='+encodeURIComponent(event),method:'GET',headers:{host:'127.0.0.1:4173'}});
 const bad=response();await route(req('kalshi:../private'),bad);assert.equal(bad.status,400);assert.equal(calls.length,0);
 const good=response();await route(req('kalshi:KXEVENT-27'),good);assert.equal(good.status,200);assert.equal(calls[0],'https://external-api.kalshi.com/trade-api/v2/events/KXEVENT-27/metadata');assert.equal(calls.at(-1),'https://assets.kalshi.com/event.png');
 await route(req('kalshi:KXEVENT-27'),response());assert.equal(calls.length,3);
});

test('grouped Kalshi events never replace a missing event image with a single candidate',async()=>{
 const calls=[],route=createPredictionImageRoute({fetcher:async url=>{calls.push(url);if(url.endsWith('/metadata'))return new Response(JSON.stringify({featured_image_url:'https://assets.kalshi.com/candidate.png',image_url:'https://assets.kalshi.com/event.png',market_details:[{image_url:'https://assets.kalshi.com/a.png'},{image_url:'https://assets.kalshi.com/b.png'}]}));return new Response('',{status:404});}});
 const res=response();await route({url:'/api/markets/prediction-image?event=kalshi:GROUP',method:'GET',headers:{host:'127.0.0.1:4173'}},res);assert.equal(res.status,404);assert(!calls.some(url=>url.includes('candidate.png')));
});

test('market JSON rejects oversized responses',async()=>{
 await assert.rejects(()=>boundedMarketJSON(PREDICTION_URLS.polymarket,{fetcher:async()=>new Response('x'.repeat(200)),maxBytes:100}),/too large/);
});

test('CoinMarketCap reads coalesce and preserve saved values and time across failures',async()=>{
 let now=Date.now(),calls=0,fail=false;
 const read=createMarketContextReader({clock:()=>now,fetcher:async()=>{calls++;if(fail)throw Error('failure');return new Response(JSON.stringify({status:{error_code:0},data:{btc_dominance:60,quote:{USD:{total_market_cap:2500000000000,total_volume_24h:null}}}}));}});
 const [one,two]=await Promise.all([read(),read()]);assert.deepEqual(one,two);assert.equal(calls,1);assert.equal(one.volume24h,null);
 now+=61000;fail=true;const saved=await read();assert.equal(saved.stale,true);assert.equal(saved.observedAt,one.observedAt);assert.equal(saved.marketCap,one.marketCap);await read();assert.equal(calls,2);
});
