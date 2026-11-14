import test from 'node:test';import assert from 'node:assert/strict';
import {createAssetImageRoute} from './asset-image.mjs';
import {createMarketFetcher} from '../integrations/market-http.mjs';
import {readTokenMarket} from '../integrations/token-market.mjs';
import http from 'node:http';
const url='https://cdn.dexscreener.com/cms/images/example.png';
const req=(source=url)=>({url:'/api/asset-image?url='+encodeURIComponent(source),method:'GET',headers:{host:'127.0.0.1:4173'}});
const response=()=>({status:0,headers:null,body:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}});
test('image proxy accepts bounded raster data, coalesces/cache reads, and never forwards wallet metadata',async()=>{
 let calls=0;const route=createAssetImageRoute({fetcher:async(source,options)=>{calls++;assert.equal(source,url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.deepEqual(Object.keys(options.headers),['accept']);return new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});}});
 const a=response(),b=response();await Promise.all([route(req(),a),route(req(),b)]);assert.equal(calls,1);assert.equal(a.status,200);assert.equal(a.headers['X-Content-Type-Options'],'nosniff');assert.deepEqual(a.body,b.body);await route(req(),response());assert.equal(calls,1);
 const localhost=response();await route({...req(),headers:{host:'localhost:4173'}},localhost);assert.equal(localhost.status,200);assert.equal(calls,1);
});
test('image proxy rejects foreign URLs, scripts, redirects/types and oversized bodies',async()=>{
 let calls=0;const route=createAssetImageRoute({fetcher:()=>{calls++;throw Error();}});
 for(const source of ['https://localhost/secret','file:///C:/secret','https://cdn.dexscreener.com.evil.test/image.png','https://user@cdn.dexscreener.com/image.png']){const r=response();await route(req(source),r);assert.equal(r.status,400);}assert.equal(calls,0);
 for(const host of ['localhost:4173.evil.test','127.0.0.1:4174','evil.test:4173']){const r=response();await route({...req(),headers:{host}},r);assert.equal(r.status,400);}assert.equal(calls,0);
 for(const [type,body] of [['image/svg+xml','<svg/>'],['text/html','<script/>'],['image/png','x'.repeat(300001)]]){const r=response();await createAssetImageRoute({fetcher:async()=>new Response(body,{headers:{'content-type':type}})})(req(),r);assert.equal(r.status,404);}
});
test('production transport permits exact Dexscreener GET paths while rejecting URL injection',async()=>{
 const contract='0x'+'12'.repeat(20),request={network:'ethereum',contract,account:null,publicConsent:true};let observed;
 const server=http.createServer((req,res)=>{observed={method:req.method,url:req.url};res.setHeader('content-type','application/json');res.end('[]');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const fetcher=createMarketFetcher((url,options,callback)=>{assert.equal(url,'https://api.dexscreener.com/token-pairs/v1/ethereum/'+contract);return http.request('http://127.0.0.1:'+server.address().port,options,callback);});
 try{assert.deepEqual(await readTokenMarket(request,{fetcher}),{image:null,price:null});assert.equal(observed.method,'GET');for(const path of ['/../secret','?account=private','/redirect'])await assert.rejects(fetcher('https://api.dexscreener.com/token-pairs/v1/ethereum/'+contract+path,{method:'GET',redirect:'error'}),/Unapproved/);}finally{await new Promise(r=>server.close(r));}
});
