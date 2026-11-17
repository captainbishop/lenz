import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHyperliquidCatalog} from '../web/public/hyperliquid-catalog.js';
import {createHyperliquidCatalogReader} from './hyperliquid-catalog.mjs';
import {hyperliquidFixtureFetcher} from './hyperliquid-fixtures.mjs';
import {readHyperliquidTape} from './hyperliquid-feed.mjs';

test('spot discovery and charts do not wait for perpetual or prediction sources',async()=>{
 const calls=[],reader=createHyperliquidCatalogReader({fetcher:(url,options)=>{const input=JSON.parse(options.body);calls.push(input);if(['spotMetaAndAssetCtxs','l2Book','candleSnapshot'].includes(input.type))return hyperliquidFixtureFetcher(url,options);return new Promise(()=>{});}}),abort=new AbortController();let timeout;
 try{
  const run=async()=>{const spot=await reader({scope:'spot',signal:abort.signal});assert.deepEqual(spot.rows.map(r=>[r.kind,r.name,r.quote.symbol]),[['spot','HYPE / USDC','USDC'],['spot','HYPE / USDH','USDH']]);const tape=await readHyperliquidTape({marketId:'hypercore:testnet:spot:@107',interval:'1m',privacy:'public'},{catalog:reader,fetcher:hyperliquidFixtureFetcher,signal:abort.signal});assert.equal(tape.candles.length,30);assert.deepEqual(calls.map(c=>c.type),['spotMetaAndAssetCtxs']);};
  await Promise.race([run(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Spot waited for unrelated sources')),200);})]);
 }finally{clearTimeout(timeout);abort.abort();}
});

test('core perpetual discovery does not wait for unrelated catalogue sections',async()=>{
 const releases=[],calls=[];
 const reader=createHyperliquidCatalogReader({fetcher:(url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);
  if(request.type==='spotMeta')return hyperliquidFixtureFetcher(url,{...options,body:JSON.stringify({type:'spotMetaAndAssetCtxs'})}).then(async r=>new Response(JSON.stringify((await r.json())[0])));
  if(['spotMetaAndAssetCtxs','outcomeMeta','outcomeTemplates'].includes(request.type)||request.dex==='xyz')return new Promise(resolve=>releases.push(()=>resolve(hyperliquidFixtureFetcher(url,options))));
  return hyperliquidFixtureFetcher(url,options);
 }});
 const abort=new AbortController(),pending=reader({scope:'core-perps',signal:abort.signal});let timeout;
 try{
  const core=await Promise.race([pending,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Core markets waited for unrelated feeds')),150);})]);
  assert.deepEqual(core.rows.map(r=>[r.kind,r.name,r.quote.symbol]),[['perp','BTC','USDC']]);assert.deepEqual(core.unavailable,[]);assert.deepEqual(calls.map(c=>c.type).sort(),['metaAndAssetCtxs','spotMeta']);
 }finally{clearTimeout(timeout);abort.abort();releases.forEach(r=>r());await pending.catch(()=>{});}
});

test('core and full caches stay separate and shared core cancellation preserves another reader',async()=>{
 let now=Date.now()-61000,calls=0;const releases=[];
 const reader=createHyperliquidCatalogReader({clock:()=>now,fetcher:(url,options)=>{calls++;return new Promise(resolve=>releases.push(()=>resolve(hyperliquidFixtureFetcher(url,options))));}});
 const abort=new AbortController(),one=reader({scope:'core-perps',signal:abort.signal}),rejected=assert.rejects(one),two=reader({scope:'core-perps'});abort.abort();releases.splice(0).forEach(r=>r());await rejected;assert.equal((await two).rows.length,1);assert.equal(calls,2);assert.equal((await reader({scope:'core-perps'})).rows.length,1);assert.equal(calls,2);
 const full=reader();releases.splice(0).forEach(r=>r());await new Promise(r=>setImmediate(r));releases.splice(0).forEach(r=>r());assert.equal((await full).rows.length,5);assert.equal(calls,8);assert.equal((await reader()).rows.length,5);assert.equal(calls,8);
 await assert.rejects(reader({scope:'https://arbitrary.example'}));assert.equal(calls,8);
 now+=61000;const fresh=reader({scope:'core-perps'});releases.splice(0).forEach(r=>r());assert.equal((await fresh).observedAt,now);assert.equal(calls,10);
});

test('core, Spot and full catalogue misses share a four-source concurrency cap',async()=>{
 let active=0,peak=0,calls=0;
 const reader=createHyperliquidCatalogReader({fetcher:async(url,options)=>{active++;calls++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,5));return hyperliquidFixtureFetcher(url,options);}finally{active--;}}});
 const [full,core,spot]=await Promise.all([reader(),reader({scope:'core-perps'}),reader({scope:'spot'})]);assert.equal(full.rows.length,5);assert.equal(core.rows.length,1);assert.equal(spot.rows.length,2);assert.equal(calls,9);assert.equal(peak,4);assert.equal(active,0);
});

test('spot discovery joins sparse token IDs and mixed contexts without losing quote units',()=>{
  const catalog=normalizeHyperliquidCatalog({spot:[{tokens:[{index:360,name:'USDH'},{index:150,name:'HYPE'}],universe:[{index:232,name:'@232',tokens:[150,360]}]},[{coin:'#1230',midPx:'0.5'},{coin:'@232',midPx:null,markPx:'42',dayNtlVlm:'10',prevDayPx:'40'}]],perps:[],outcomes:{outcomes:[],questions:[]},templates:[]},1000);
  assert.equal(catalog.rows.length,1);
  assert.deepEqual(catalog.rows[0].quote,{index:360,symbol:'USDH'});
  assert.equal(catalog.rows[0].name,'HYPE / USDH');
  assert.equal(catalog.rows[0].price,null);
  assert.equal(catalog.rows[0].coin,'@232');
});

test('outcomes expand safe text and retain two sides as one market',()=>{
  const catalog=normalizeHyperliquidCatalog({spot:[{tokens:[],universe:[]},[{coin:'#120',midPx:'0.6'},{coin:'#121',midPx:'0.4'}]],perps:[],outcomes:{questions:[],outcomes:[{outcome:12,name:'template:binary',description:'perp:xyz:GOLD|threshold:4000',quoteToken:'USDH',sideSpecs:[{name:'Yes'},{name:'No'}]}]},templates:[{id:'binary',name:'{perp} above {threshold}?',description:'Source {perp}'}]},1000);
  const row=catalog.rows[0];assert.equal(catalog.rows.length,1);assert.equal(row.name,'xyz:GOLD above 4000?');
  assert.deepEqual(row.sides.map(s=>[s.name,s.coin,s.price]),[['Yes','#120','0.6'],['No','#121','0.4']]);
  assert.equal(row.description,'Source xyz:GOLD');assert.equal(row.quote.symbol,'USDH');
});

test('builder venues retain collateral and exclude delisted markets',()=>{
  const catalog=normalizeHyperliquidCatalog({spot:[{tokens:[{index:360,name:'USDH'}],universe:[]},[]],perps:[{dex:'xyz',meta:{collateralToken:360,universe:[{name:'xyz:GOLD',maxLeverage:25},{name:'xyz:OLD',isDelisted:true}]},contexts:[{midPx:'4000',funding:'-0.0001'},{}]}],outcomes:{outcomes:[],questions:[]},templates:[]},1000);
  assert.equal(catalog.rows.length,1);assert.equal(catalog.rows[0].kind,'builder');
  assert.equal(catalog.rows[0].coin,'xyz:GOLD');assert.equal(catalog.rows[0].quote.symbol,'USDH');
  assert.equal(catalog.rows[0].price,'4000');assert.equal(catalog.rows[0].funding,'-0.0001');
});

test('one unavailable venue keeps the remaining catalogue and successful refreshes are coalesced',async()=>{
  let now=Date.now()-61000,fail=false,requests=0;
  const fetcher=async(url,options)=>{requests++;const request=JSON.parse(options.body);if(fail&&request.dex==='xyz')throw Error('Unavailable');return hyperliquidFixtureFetcher(url,options);};
  const read=createHyperliquidCatalogReader({fetcher,clock:()=>now});
  const [a,b]=await Promise.all([read(),read()]);assert.deepEqual(a,b);assert.equal(a.rows.length,5);assert.equal(requests,6);
  now+=61000;fail=true;const partial=await read();assert.equal(partial.rows.length,4);assert.deepEqual(partial.unavailable,['xyz']);
});

test('tape reads bind to discovered class and coin, and cancellation prevents selected-market reads',async()=>{
  const catalog=createHyperliquidCatalogReader({fetcher:hyperliquidFixtureFetcher});
  const request={marketId:'hypercore:testnet:spot:@1188',interval:'1m',privacy:'public'};
  const tape=await readHyperliquidTape(request,{catalog,fetcher:hyperliquidFixtureFetcher});assert.deepEqual(tape.candles,[]);assert.deepEqual(tape.levels[1],[]);
  await assert.rejects(readHyperliquidTape({...request,marketId:'hypercore:testnet:builder:@1188'},{catalog,fetcher:()=>assert.fail('Unknown market must not read a tape')}));
  const abort=new AbortController();abort.abort();await assert.rejects(readHyperliquidTape(request,{catalog,signal:abort.signal,fetcher:()=>assert.fail('Cancelled read must not contact the source')}));
});

test('a malformed venue cannot discard healthy markets',async()=>{
  const read=createHyperliquidCatalogReader({fetcher:(url,options)=>JSON.parse(options.body).dex==='xyz'?Promise.resolve(new Response(JSON.stringify([{collateralToken:360,universe:[{name:'xyz:GOLD',maxLeverage:20}]},null]))):hyperliquidFixtureFetcher(url,options)});
  const value=await read();assert.equal(value.rows.length,4);assert.deepEqual(value.unavailable,['xyz']);
});

test('invalid expanded predictions do not discard spot and perpetual markets',async()=>{
  for(const name of ['', 'x'.repeat(1001), '{participant}'.repeat(60)]){
    const reader=createHyperliquidCatalogReader({fetcher:(url,options)=>JSON.parse(options.body).type==='outcomeTemplates'?Promise.resolve(new Response(JSON.stringify([{id:'binary',name,description:'text'}]))):hyperliquidFixtureFetcher(url,options)});
    const result=await reader();assert.equal(result.rows.length,4);assert.deepEqual(result.unavailable,['Predictions']);
  }
});

test('catalogue cancellation stops new batches unless another viewer still needs them',async()=>{
  for(const shared of [false,true]){
    const releases=[],signals=[],requests=[];
    const reader=createHyperliquidCatalogReader({fetcher:(url,options)=>{requests.push(JSON.parse(options.body).type);signals.push(options.signal);if(requests.length<=4)return new Promise(resolve=>releases.push(()=>resolve(hyperliquidFixtureFetcher(url,options))));return hyperliquidFixtureFetcher(url,options);}});
    const abort=new AbortController(),first=reader({signal:abort.signal});const cancelled=assert.rejects(first);const second=shared?reader():null;
    abort.abort();releases.forEach(release=>release());await cancelled;
    if(shared){assert.equal((await second).rows.length,5);assert.equal(requests.length,6);}else{await new Promise(r=>setImmediate(r));assert.equal(requests.length,4);assert(signals.every(s=>s.aborted));}
  }
});
