import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {pathToFileURL} from 'node:url';
const {createMarketRoute}=await import(process.env.LENZ_RELAY_MODULE?pathToFileURL(process.env.LENZ_RELAY_MODULE):new URL('./market-relay.mjs',import.meta.url));
const quoteInput={provider:'uniswap',marketId:'uniswap:0xd0b53d9277642d899df5c87a3966a349a798f224',side:'usdc-to-weth',amount:'1',slippageBps:50,privacy:'public'};
const req=(input={provider:'uniswap'},changes={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),{url:'/api/markets/read',method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'},...changes});
const res=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.data=JSON.parse(body);}});
test('market API coalesces simultaneous reads and retains observation time on cache hits',async()=>{
  let calls=0,release,now=1000;const route=createMarketRoute({discover:async()=>{calls++;await new Promise(r=>release=r);return {observedAt:900};},clock:()=>now});
  const a=res(),b=res(),one=route(req(),a),two=route(req(),b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();await Promise.all([one,two]);assert.equal(a.status,200);assert.deepEqual(a.data,b.data);
  const cached=res();now=2000;await route(req(),cached);assert.equal(calls,1);assert.equal(cached.data.observedAt,900);assert.equal(cached.headers['Cache-Control'],'no-store');
});
test('foreign origins, unknown routes and injected fields cannot call a market provider',async()=>{
  const route=createMarketRoute({discover:()=>assert.fail('Should not call upstream')});
  for(const [input,changes] of [[{},{}],[{provider:'hyperliquid',address:'private'},{}],[{provider:'uniswap',url:'https://evil.example'},{}],[{provider:'constructor'},{}],[{provider:'x'.repeat(300)},{}],[{provider:'aave'},{method:'GET'}],[{provider:'aave'},{url:'/api/markets/spend'}],[{provider:'aave'},{headers:{host:'127.0.0.1:4173',origin:'https://evil.example'}}]]){const r=res();await route(req(input,changes),r);assert(r.status>=400);}
});
test('provider errors are sanitized, uncached and never returned as successful observations',async()=>{
  let calls=0;const route=createMarketRoute({discover:async()=>{calls++;throw Error('private upstream detail');}});
  for(let i=0;i<2;i++){const r=res();await route(req(),r);assert.equal(r.status,400);assert(!JSON.stringify(r.data).includes('private upstream'));}assert.equal(calls,2);
});
test('a valid body with foreign Origin or Host cannot trigger a public read',async()=>{
 let calls=0;const route=createMarketRoute({discover:async()=>{calls++;return {};}});
 for(const change of [{origin:'https://foreign.example'},{host:'foreign.example'}]){
  const request=req();Object.assign(request.headers,change);const response=res();await route(request,response);assert.equal(response.status,403);
 }
 assert.equal(calls,0);
});
test('quote API requires public consent and rejects injected terms before upstream reads',async()=>{
 let calls=0;const route=createMarketRoute({quote:async()=>{calls++;return {};}});
 for(const change of [{privacy:'private'},{recipient:'someone'},{url:'https://foreign.example'},{amount:'x'.repeat(600)}]){const response=res();await route(req({...quoteInput,...change},{url:'/api/markets/quote'}),response);assert.equal(response.status,400);}assert.equal(calls,0);
});
test('quote API coalesces identical requests only while pending and never reuses a completed quote',async()=>{
 let calls=0,release;const route=createMarketRoute({quote:async input=>{assert(Object.isFrozen(input));calls++;await new Promise(r=>release=r);return {observedAt:calls};}});
 const a=res(),b=res(),one=route(req(quoteInput,{url:'/api/markets/quote'}),a),two=route(req(quoteInput,{url:'/api/markets/quote'}),b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();await Promise.all([one,two]);assert.deepEqual(a.data,b.data);
 const c=res(),three=route(req(quoteInput,{url:'/api/markets/quote'}),c);await new Promise(r=>setImmediate(r));assert.equal(calls,2);release();await three;assert.equal(c.data.observedAt,2);assert.equal(c.headers['Cache-Control'],'no-store');
});
test('quote concurrency is bounded and failed reads release their slots',async()=>{
 const releases=[];const route=createMarketRoute({quote:()=>new Promise((resolve,reject)=>releases.push(()=>reject(Error('provider details'))))});
 const requests=Array.from({length:4},(_,i)=>{const response=res();return {response,promise:route(req({...quoteInput,amount:String(i+1)},{url:'/api/markets/quote'}),response)};});await new Promise(r=>setImmediate(r));
 const busy=res(),fifth=route(req({...quoteInput,amount:'5'},{url:'/api/markets/quote'}),busy);await new Promise(r=>setImmediate(r));
 try{assert.equal(busy.status,429);assert.equal(releases.length,4);}finally{releases.forEach(release=>release());await Promise.all([...requests.map(r=>r.promise),fifth]);}
 assert(requests.every(r=>r.response.status===400&&!JSON.stringify(r.response.data).includes('provider details')));
});
