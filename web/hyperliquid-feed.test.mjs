import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkedHyperliquidEvent} from './public/hyperliquid-feed.js';
import {mergeMarketEvent} from './public/market-stream-data.js';
import {createMarketRoute} from './market-relay.mjs';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';

test('an empty listed spot market can start streaming and accept its first candle',()=>{
  const now=Date.now(),request={marketId:'hypercore:spot:@1188',interval:'1m',privacy:'public'};
  const event=checkedHyperliquidEvent({kind:'snapshot',tape:{request,observedAt:now,bookTime:now,candles:[],levels:[[{price:'1',size:'1',orders:1}],[]]}},request,{now});
  const candle=checkedHyperliquidEvent({kind:'candle',coin:'@1188',candle:{coin:'@1188',interval:'1m',time:Math.floor(now/60000)*60000,open:'1',high:'1',low:'1',close:'1',volume:'1',trades:1}},request,{now});
  assert.equal(mergeMarketEvent(event.tape,candle,now).candles.length,1);
});

test('both stream routes share concurrent and per-minute limits',async()=>{
  let now=Date.now();const route=createMarketRoute({clock:()=>now,tape:()=>new Promise(()=>{}),hyperTape:()=>new Promise(()=>{})});
  const opened=[];
  const open=async hyper=>{
    const input={privacy:'public',interval:'1m',marketId:hyper?'hypercore:spot:@107':'hyperliquid:0:BTC'};
    const req=Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),{url:hyper?'/api/markets/hyper-stream':'/api/markets/stream',method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'}});
    const res=Object.assign(new EventEmitter(),{writeHead(status){this.status=status;},flushHeaders(){},write(){return true;},end(){this.writableEnded=true;}});
    await route(req,res);return res;
  };
  try{
    for(let i=0;i<8;i++){const res=await open(i%2);assert.equal(res.status,200);opened.push(res);}
    assert.equal((await open(true)).status,400);opened.forEach(res=>res.emit('close'));
    for(let i=0;i<16;i++){const res=await open(i%2);assert.equal(res.status,200);res.emit('close');}
    assert.equal((await open(false)).status,400);now+=60001;const res=await open(true);assert.equal(res.status,200);res.emit('close');
  }finally{opened.forEach(res=>res.emit('close'));}
});

test('catalogue routes reject foreign origins, private fields and arbitrary source URLs',async()=>{
  let reads=0;const route=createMarketRoute({catalog:async()=>{reads++;return {rows:[]};},hyperTape:async()=>{reads++;return {};},hyperStream:{subscribe(){reads++;}}});
  for(const [url,input,origin] of [
    ['/api/markets/hyper-catalog',{privacy:'public'},'https://elsewhere.invalid'],
    ['/api/markets/hyper-catalog',{privacy:'public',address:'do-not-send'},'http://127.0.0.1:4173'],
    ['/api/markets/hyper-stream',{privacy:'public',marketId:'https://elsewhere.invalid',interval:'1m'},'http://127.0.0.1:4173'],
    ['/api/markets/hyper-tape',{privacy:'public',marketId:'hypercore:spot:@107',interval:'1m',address:'do-not-send'},'http://127.0.0.1:4173'],
  ]){
    const req=Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),{url,method:'POST',headers:{host:'127.0.0.1:4173',origin,'content-type':'application/json'}}),res={writeHead(status){this.status=status;},end(){}};
    await route(req,res);assert([400,403].includes(res.status));
  }
  assert.equal(reads,0);
});

test('older recent trades remain dated observations and zero-valued outcomes remain valid',()=>{
  const now=Date.now(),request={marketId:'hypercore:outcome:#120',interval:'1m',privacy:'public'};
  const trades=checkedHyperliquidEvent({kind:'trades',coin:'#120',trades:[{coin:'#120',side:'A',px:'0.2',sz:'1',tid:42,time:now-3*86400000,users:['not public UI data']}]},request,{now});
  assert.equal(trades.trades[0].time,now-3*86400000);assert(!Object.hasOwn(trades.trades[0],'users'));
  const event=checkedHyperliquidEvent({kind:'candle',coin:'#120',candle:{coin:'#120',interval:'1m',time:Math.floor(now/60000)*60000,open:'0',high:'0',low:'0',close:'0',volume:'1'}},request,{now});
  assert.equal(event.candle.close,'0');
});
