import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePredictions,checkedPredictions} from '../web/public/prediction-model.js';
import {predictionImageURL} from '../web/public/prediction-model.js';
import {createPredictionReader} from './prediction-catalog.mjs';
import {createHyperliquidCatalogReader} from './hyperliquid-catalog.mjs';
import {hyperliquidFixtureFetcher} from './hyperliquid-fixtures.mjs';
import {normalizeHyperliquidCatalog,checkedHyperliquidCatalog} from '../web/public/hyperliquid-catalog.js';

test('event discovery keeps independent markets and filters closed children before previews',()=>{
 const data=[{id:'7',slug:'an-event',title:'An event',active:true,closed:false,volume24hr:123,markets:[
  {id:'1',question:'Closed',closed:true,outcomes:'["Yes","No"]',outcomePrices:'["1","0"]'},
  {id:'2',question:'First question',active:true,closed:false,acceptingOrders:true,outcomes:'["Yes","No"]',outcomePrices:'["0.31","0.69"]'},
  {id:'3',question:'Second question',active:true,closed:false,acceptingOrders:true,outcomes:'["A","B"]',outcomePrices:'["0.8","0.2"]'}]}];
 const result=checkedPredictions(normalizePredictions('polymarket',data));
 assert.equal(result.events.length,1);assert.equal(result.events[0].markets.length,2);
 assert.deepEqual(result.events[0].markets[0].outcomes,[{name:'Yes',probability:0.31},{name:'No',probability:0.69}]);
 assert.equal(result.events[0].markets[1].outcomes[0].probability,0.8);
 assert.equal(result.events[0].url,'https://polymarket.com/event/an-event');
 assert.equal(result.events[0].volumeUnit,'USD');
});

test('Kalshi dollar quotes use the payout and retain contract volume; missing bids remain unknown',()=>{
 const market={ticker:'M',status:'active',title:'A question',yes_sub_title:'One outcome',notional_value_dollars:'1.0000',yes_bid_dollars:'0.1000',yes_ask_dollars:'0.1200',volume_24h_fp:'42.50'};
 const read=m=>normalizePredictions('kalshi',{events:[{event_ticker:'E',title:'An event',category:'Economics',markets:[m]}]});
 const e=read(market).events[0];assert.equal(e.markets[0].outcomes[0].probability,0.11);assert.equal(e.volume,42.5);assert.equal(e.volumeUnit,'contracts');
 assert.equal(read({...market,yes_bid_dollars:'0'}).events[0].markets[0].outcomes[0].probability,null);
 assert.equal(read({...market,status:'finalized'}).events.length,0);
});

test('malformed numeric values remain unknown rather than becoming zero or certain outcomes',()=>{
 for(const value of [false,true,[],[0.3],' ',{},null]){
  const result=normalizePredictions('kalshi',{events:[{event_ticker:'E',title:'Question',markets:[{ticker:'M',status:'active',title:'Question',yes_bid_dollars:value,yes_ask_dollars:'1',notional_value_dollars:'1',volume_24h_fp:value}]}]});
  assert.equal(result.events[0].volume,null);assert.equal(result.events[0].markets[0].outcomes[0].probability,null);
  result.events[0].markets[0].outcomes[0].probability=value;assert.equal(checkedPredictions(result).events[0].markets[0].outcomes[0].probability,null);
 }
});

test('saved event data rejects cross-provider identity and strips unsafe image/navigation URLs',()=>{
 const s=normalizePredictions('polymarket',[{id:'7',slug:'safe',title:'<img onerror=alert(1)>',active:true,closed:false,markets:[{id:'3',question:'Q',active:true,closed:false,acceptingOrders:true,outcomes:'["Yes","No"]',outcomePrices:'["0.5","0.5"]'}]}]);
 s.events[0].image='http://127.0.0.1/secrets';s.events[0].url='javascript:alert(1)';const clean=checkedPredictions(s);assert.equal(clean.events[0].url,null);assert.equal(clean.events[0].image,null);
 s.events[0].provider='kalshi';assert.throws(()=>checkedPredictions(s));
 for(const bad of ['https://polymarket-upload.s3.us-east-2.amazonaws.com.evil.test/x','https://name:pass@images.polymarket.com/x','https://images.polymarket.com:444/x'])assert.equal(predictionImageURL(bad),null);
});

test('provider failures retain original observation time and coalesce retries within the cooldown',async()=>{
 let now=Date.now(),reads=0,fail=false;
 const read=createPredictionReader({clock:()=>now,fetcher:async()=>{reads++;if(fail)throw Error('offline');return new Response('[]');}});
 const [first,second]=await Promise.all([read('polymarket'),read('polymarket')]);assert.equal(reads,1);assert.equal(first.observedAt,second.observedAt);
 now+=61000;fail=true;const stale=await read('polymarket');assert.equal(stale.observedAt,first.observedAt);assert.equal(stale.stale,true);
 await read('polymarket');assert.equal(reads,2);await assert.rejects(read('untrusted'));
});

test('partial Hyperliquid failures preserve saved prediction events and their observation time',async()=>{
 const catalog=await createHyperliquidCatalogReader({fetcher:hyperliquidFixtureFetcher})();
 for(const dependency of ['outcomeMeta','outcomeTemplates','spotMetaAndAssetCtxs','Predictions']){
  let now=Date.now(),unavailable=false;
  const read=createPredictionReader({clock:()=>now,hyperliquid:async()=>unavailable?{...catalog,rows:[],unavailable:[dependency],observedAt:Date.now()}:catalog});
  const first=await read('hyperliquid');assert(first.events.length>0);
  now+=61000;unavailable=true;
  const saved=await read('hyperliquid');assert.deepEqual(saved.events,first.events,dependency);assert.equal(saved.observedAt,first.observedAt);assert.equal(saved.stale,true);
 }
});

test('large Polymarket metadata can produce a bounded event snapshot',async()=>{
 const read=createPredictionReader({fetcher:async()=>new Response(JSON.stringify([{active:false,metadata:'x'.repeat(9*1024*1024)}]))});
 assert.deepEqual((await read('polymarket')).events,[]);
});

test('Hyperliquid event categories follow their subject rather than the trading provider',async()=>{
 const catalog=await createHyperliquidCatalogReader({fetcher:hyperliquidFixtureFetcher})();const outcome=catalog.rows.find(r=>r.kind==='outcome');
 for(const [name,category]of [['2026/2027 English Premier League winner','Sports'],['Federal Open Market Committee rate decision','Economy'],['Bitcoin price tomorrow','Crypto'],['Unclassified question','Other']])assert.equal(normalizePredictions('hyperliquid',{rows:[{...outcome,name}]}).events[0].category,category);
});

test('subject artwork follows an exact template parameter and survives saved catalogue validation',()=>{
 const outcome={outcome:12,name:'template:price',description:'asset:BTC',quoteToken:'USDC',sideSpecs:[{name:'Yes'},{name:'No'}]},template={id:'price',name:'{asset} price',description:'Price event',keywords:[['asset','hlPerp']]};
 const read=(o=outcome,t=template)=>normalizePredictions('hyperliquid',checkedHyperliquidCatalog(normalizeHyperliquidCatalog({outcomes:{outcomes:[o],questions:[]},templates:[t]}))).events[0];
 assert.equal(read().artworkSymbol,'BTC');
 assert.equal(read({...outcome,description:'asset:../../private'}).artworkSymbol,null);
 assert.equal(read(outcome,{...template,keywords:[]}).artworkSymbol,null);
 assert.equal(read({...outcome,name:'template:companyIpoConfirmed',description:'company:Anthropic'},{id:'companyIpoConfirmed',name:'{company} IPO',description:'IPO event',keywords:[['company','string']]}).artworkSymbol,'xyz:ANT');
});
