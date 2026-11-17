import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {pathToFileURL} from 'node:url';
const {createMarketRoute}=await import(process.env.LENZ_RELAY_MODULE?pathToFileURL(process.env.LENZ_RELAY_MODULE):new URL('./market-relay.mjs',import.meta.url));
const quoteInput={provider:'uniswap',marketId:'uniswap:0xd0b53d9277642d899df5c87a3966a349a798f224',side:'usdc-to-weth',amount:'1',slippageBps:50,privacy:'public'};
const req=(input={provider:'uniswap'},changes={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),{url:'/api/markets/read',method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'},...changes});
const res=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.data=JSON.parse(body);}});

test('catalogue scope permits only public core perpetual or Spot reads and preserves the full default',async()=>{
 const calls=[],route=createMarketRoute({catalog:async options=>{calls.push(options.scope);return {rows:[]};}});
 for(const input of [{privacy:'public',scope:'everything'},{privacy:'private',scope:'core-perps'},{privacy:'public',scope:'core-perps',address:'private'},{privacy:'public',scope:'core-perps',url:'https://foreign.example'},{privacy:'private',scope:'spot'},{privacy:'public',scope:'spot',address:'private'},{privacy:'public',scope:'spot',url:'https://foreign.example'}]){const response=res();await route(req(input,{url:'/api/markets/hyper-catalog'}),response);assert.equal(response.status,400);}assert.deepEqual(calls,[]);
 for(const input of [{privacy:'public',scope:'core-perps'},{privacy:'public',scope:'spot'},{privacy:'public'}]){const response=res();await route(req(input,{url:'/api/markets/hyper-catalog'}),response);assert.equal(response.status,200);}
 assert.deepEqual(calls,['core-perps','spot',undefined]);
});
test('stream requests reject foreign origins, account fields and arbitrary upstreams before subscribing',async()=>{
 const route=createMarketRoute({stream:{subscribe(){assert.fail('Unauthorized subscription');}}}),input={marketId:'hyperliquid:0:ETH',interval:'1h',privacy:'public'};
 for(const change of [{address:'private'},{url:'wss://foreign.example'},{privacy:'private'},{interval:'1s'}]){const r=res();await route(req({...input,...change},{url:'/api/markets/stream'}),r);assert.equal(r.status,400);}
 for(const change of [{host:'evil.test'},{origin:'https://evil.test'}]){const r=res(),q=req(input,{url:'/api/markets/stream'});Object.assign(q.headers,change);await route(q,r);assert.equal(r.status,403);}
});
test('network reads reject arbitrary inputs and never reuse another network cache',async()=>{
 const calls=[],route=createMarketRoute({discover:async(provider,options)=>{calls.push([provider,options]);return {provider,network:options.network};}});
 for(const input of [{provider:'uniswap',network:'constructor'},{provider:'aave',network:'https://bad.test'},{provider:'hyperliquid',network:'ethereum'},{provider:'aave',network:'arbitrum',address:'private'}]){
  const r=res();await route(req(input),r);assert.equal(r.status,400);
 }assert.equal(calls.length,0);
 for(const network of ['ethereum','arbitrum','base','ethereum']){const r=res();await route(req({provider:'aave',network}),r);assert.equal(r.status,200);assert.equal(r.data.network,network);}
 assert.deepEqual(calls,[['aave',{network:'ethereum'}],['aave',{network:'arbitrum'}],['aave',{network:'base'}]]);
});
test('oracle route permits only fixed networks, coalesces reads and preserves cached timestamps',async()=>{
 let calls=0,release,now=100000,defer=false;const route=createMarketRoute({oracle:request=>{calls++;if(!defer)return {network:request.network,observedAt:now};return new Promise(r=>release=()=>r({network:request.network,observedAt:now}));},clock:()=>now});
 for(const input of [{network:'constructor'},{network:'ethereum',address:'private'},{network:'https://bad.test'},{}]){const r=res();await route(req(input,{url:'/api/markets/oracles'}),r);assert.equal(r.status,400);}assert.equal(calls,0);
 for(const change of [{origin:'https://bad.test'},{host:'bad.test'}]){const r=res(),q=req({network:'ethereum'},{url:'/api/markets/oracles'});Object.assign(q.headers,change);await route(q,r);assert.equal(r.status,403);}assert.equal(calls,0);
 defer=true;const a=res(),b=res(),first=route(req({network:'ethereum'},{url:'/api/markets/oracles'}),a),second=route(req({network:'ethereum'},{url:'/api/markets/oracles'}),b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();await Promise.all([first,second]);assert.deepEqual(a.data,b.data);
 now+=1000;const cached=res();await route(req({network:'ethereum'},{url:'/api/markets/oracles'}),cached);assert.equal(cached.data.observedAt,100000);assert.equal(calls,1);
 now+=15000;const c=res(),third=route(req({network:'ethereum'},{url:'/api/markets/oracles'}),c);await new Promise(r=>setImmediate(r));assert.equal(calls,2);release();await third;
});
test('pool-price route accepts only the fixed pool, coalesces and expires its short cache',async()=>{
 let calls=0,release,now=1000;const route=createMarketRoute({price:()=>{calls++;return new Promise(r=>release=()=>r({observedAt:now}));},clock:()=>now});
 for(const input of [{marketId:quoteInput.marketId,amount:'1'},{marketId:'unknown'},{}]){const r=res();await route(req(input,{url:'/api/markets/price'}),r);assert.equal(r.status,400);}assert.equal(calls,0);
 const input={marketId:quoteInput.marketId},a=res(),b=res(),one=route(req(input,{url:'/api/markets/price'}),a),two=route(req(input,{url:'/api/markets/price'}),b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();await Promise.all([one,two]);assert.deepEqual(a.data,b.data);
 now=2000;const cached=res();await route(req(input,{url:'/api/markets/price'}),cached);assert.equal(cached.data.observedAt,1000);assert.equal(calls,1);
 now=4000;const next=res(),pending=route(req(input,{url:'/api/markets/price'}),next);await new Promise(r=>setImmediate(r));assert.equal(calls,2);release();await pending;
});
test('tape route requires public consent and coalesces bounded market reads',async()=>{
 const input={marketId:'hyperliquid:0:ETH',interval:'1h',privacy:'public'};let calls=0,release;const route=createMarketRoute({tape:async r=>{assert(Object.isFrozen(r));calls++;await new Promise(r=>release=r);return {executable:false};}});
 for(const change of [{privacy:'private'},{address:'reader'},{interval:'1s'}]){const response=res();await route(req({...input,...change},{url:'/api/markets/tape'}),response);assert.equal(response.status,400);}assert.equal(calls,0);
 const a=res(),b=res(),one=route(req(input,{url:'/api/markets/tape'}),a),two=route(req(input,{url:'/api/markets/tape'}),b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();await Promise.all([one,two]);assert.deepEqual(a.data,b.data);assert.equal(a.status,200);
});
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
