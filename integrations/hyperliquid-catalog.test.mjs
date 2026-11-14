import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHyperliquidCatalog} from '../web/public/hyperliquid-catalog.js';
import {createHyperliquidCatalogReader} from './hyperliquid-catalog.mjs';
import {hyperliquidFixtureFetcher} from './hyperliquid-fixtures.mjs';
import {readHyperliquidTape} from './hyperliquid-feed.mjs';

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
