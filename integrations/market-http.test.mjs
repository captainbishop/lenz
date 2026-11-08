import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {createMarketFetcher} from './market-http.mjs';import {marketJson} from './market-discovery.mjs';
import {gzipSync} from 'node:zlib';
import {boundedMarketJSON,PREDICTION_URLS} from './prediction-catalog.mjs';

test('compressed public event data is decoded before the JSON size boundary',async()=>{
 let encoding;const data=[{title:'Event'}],server=http.createServer((req,res)=>{encoding=req.headers['accept-encoding'];res.setHeader('content-encoding','gzip');res.setHeader('content-type','application/json');res.end(gzipSync(JSON.stringify(data)));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const fetcher=createMarketFetcher((url,options,callback)=>http.request('http://127.0.0.1:'+server.address().port,options,callback));
 try{assert.deepEqual(await boundedMarketJSON(PREDICTION_URLS.polymarket,{fetcher}),data);assert.equal(encoding,'gzip');await assert.rejects(()=>boundedMarketJSON(PREDICTION_URLS.polymarket,{fetcher,maxBytes:5}),/too large/);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('native market transport preserves JSON, rejects redirects and bounds streamed responses',async()=>{
 let mode='ok',requests=0,received;const server=http.createServer(async(req,res)=>{requests++;let text='';for await(const b of req)text+=b;received={method:req.method,type:req.headers['content-type'],body:JSON.parse(text)};if(mode==='redirect'){res.writeHead(302,{location:'https://foreign.example'});res.end();}else if(mode==='large'){res.end(JSON.stringify({data:'x'.repeat(1000)}));}else{res.setHeader('content-type','application/json');res.end(JSON.stringify({price:'1.20'}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const fetcher=createMarketFetcher((url,options,callback)=>{assert.equal(url,'https://api.hyperliquid.xyz/info');assert(options.signal);return http.request('http://127.0.0.1:'+server.address().port,options,callback);});
 try{assert.deepEqual(await marketJson('https://api.hyperliquid.xyz/info',{type:'l2Book'},{fetcher}),{price:'1.20'});assert.deepEqual(received,{method:'POST',type:'application/json',body:{type:'l2Book'}});mode='redirect';await assert.rejects(()=>marketJson('https://api.hyperliquid.xyz/info',{}, {fetcher}),/redirect/);assert.equal(requests,2);mode='large';await assert.rejects(()=>marketJson('https://api.hyperliquid.xyz/info',{}, {fetcher,maxBytes:64}),/too large/);}finally{await new Promise(r=>server.close(r));}
});
test('unapproved endpoints and already aborted signals never start a market request',async()=>{
 const fetcher=createMarketFetcher(()=>assert.fail('Request must not start'));
 await assert.rejects(()=>fetcher('https://foreign.example',{method:'POST',redirect:'error'}));
 await assert.rejects(()=>fetcher('https://api.hyperliquid.xyz/info',{method:'GET',redirect:'error'}));
 await assert.rejects(()=>fetcher('https://api.hyperliquid.xyz/info',{method:'POST',redirect:'follow'}));
 await assert.rejects(()=>fetcher('https://api.hyperliquid.xyz/info',{method:'POST',redirect:'error',signal:AbortSignal.abort()}));
});
test('aborting a pending read cancels the native connection',async()=>{
 let started;const incoming=new Promise(r=>started=r),server=http.createServer(()=>started());await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const fetcher=createMarketFetcher((url,options,callback)=>http.request('http://127.0.0.1:'+server.address().port,options,callback)),controller=new AbortController();
 try{const reading=marketJson('https://api.hyperliquid.xyz/info',{}, {fetcher,signal:controller.signal});await incoming;controller.abort();await assert.rejects(()=>reading,/abort/i);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
