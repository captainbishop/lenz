import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMarketStream} from './market-stream.mjs';
import {TAPE_REQUEST,tapeFixtures} from '../integrations/market-tape-fixtures.mjs';
import {checkedMarketEvent,mergeMarketEvent} from './public/market-stream-data.js';

test('reconnect history cannot roll a newer book or current candle backwards',()=>{
 const now=Date.now(),old=tapeFixtures(TAPE_REQUEST,now).snapshot;
 old.candles.at(-1).trades=3;
 const book=checkedMarketEvent({kind:'book',coin:'ETH',time:now,levels:[[{price:'4000',size:'2',orders:1}],[{price:'4001',size:'2',orders:1}]]},TAPE_REQUEST,{now});
 let current=mergeMarketEvent(old,book,now);
 current=mergeMarketEvent(current,{kind:'candle',coin:'ETH',candle:{...old.candles.at(-1),close:'3010',high:'3020',low:'2700',trades:5}},now);
 const restored=mergeMarketEvent(current,{kind:'snapshot',tape:old},now);
 assert.equal(restored.levels[0][0].price,'4000');assert.equal(restored.candles.at(-1).close,'3010');assert.equal(restored.candles.length,96);
 assert.strictEqual(mergeMarketEvent(current,{kind:'candle',coin:'ETH',candle:old.candles.at(-1)},now),current);
});

test('stream binding and candle rollover work across markets and intervals',()=>{
 const now=Date.now();
 for(const coin of ['BTC','ETH','SOL'])for(const interval of ['1m','5m','1h','1w']){
  const request={...TAPE_REQUEST,marketId:'hyperliquid:0:'+coin,interval},tape=tapeFixtures(request,now).snapshot;
  const c={...tape.candles.at(-1),coin,close:'3010',high:'3020',low:'2700'};
  const event=checkedMarketEvent({kind:'candle',coin,candle:c},request,{now});assert.equal(mergeMarketEvent(tape,event,now).candles.at(-1).close,'3010');
 }
});

test('wrong symbols, intervals, stale books and invalid prices never reach the chart',()=>{
  const now=Date.now(),f=tapeFixtures(TAPE_REQUEST,now),c=f.snapshot.candles.at(-1);
  for(const value of [
    {kind:'candle',coin:'BTC',candle:c},
    {kind:'candle',coin:'ETH',candle:{...c,interval:'5m'}},
    {kind:'candle',coin:'ETH',candle:{...c,close:'999999'}},
    {kind:'candle',coin:'ETH',candle:{...c,time:now+100000}},
    {kind:'book',coin:'ETH',time:now-31000,levels:f.snapshot.levels},
    {kind:'book',coin:'ETH',time:now,levels:[f.snapshot.levels[1],f.snapshot.levels[0]]},
  ])assert.throws(()=>checkedMarketEvent(value,TAPE_REQUEST,{now}));
});

test('leaving during bootstrap cancels the read, ignores its late result and releases capacity',async()=>{
  let release,signal,sockets=0;const events=[];
  const stream=createMarketStream({read:(_,options)=>{signal=options.signal;return new Promise(r=>release=r);},Socket:class{constructor(){sockets++;}}});
  const stop=stream.subscribe(TAPE_REQUEST,x=>events.push(x));await new Promise(r=>setImmediate(r));stop();assert(signal.aborted);
  release(tapeFixtures().snapshot);await new Promise(r=>setImmediate(r));assert.equal(sockets,0);assert.deepEqual(events,[]);
  const stops=Array.from({length:8},()=>stream.subscribe(TAPE_REQUEST,()=>{}));assert.throws(()=>stream.subscribe(TAPE_REQUEST,()=>{}),/busy/);stops.forEach(fn=>fn());
});

test('malformed upstream data closes the connection and reports a recoverable end',async()=>{
  let socket,ended=0;const events=[];
  class Socket extends EventTarget {constructor(){super();socket=this;}close(){this.closed=true;}}
  const stream=createMarketStream({read:async()=>tapeFixtures().snapshot,Socket});
  const stop=stream.subscribe(TAPE_REQUEST,x=>events.push(x),()=>ended++);await new Promise(r=>setImmediate(r));
  socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({channel:'candle',data:{s:'BTC'}})}));
  assert.equal(ended,1);assert(socket.closed);assert.equal(events.length,1);stop();assert.equal(ended,1);
});

test('selected chart receives candle changes without another history request, and release closes upstream',async()=>{
  const now=Date.now(),fixture=tapeFixtures(TAPE_REQUEST,now),events=[],sockets=[];let reads=0;
  class Socket extends EventTarget {
    readyState=0;sent=[];
    constructor(url){super();assert.equal(url,'wss://api.hyperliquid.xyz/ws');sockets.push(this);}
    send(text){this.sent.push(JSON.parse(text));}
    close(){this.readyState=3;}
    emit(data){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(data)}));}
  }
  const stream=createMarketStream({read:async()=>{reads++;return fixture.snapshot;},Socket,clock:()=>now});
  const stop=stream.subscribe(TAPE_REQUEST,event=>events.push(event));
  await new Promise(r=>setImmediate(r));
  const socket=sockets[0];socket.readyState=1;socket.dispatchEvent(new Event('open'));
  socket.emit({channel:'candle',data:{...fixture.history.at(-1),c:'3010',h:'3020',l:'2700'}});
  assert.equal(events.at(-1).kind,'candle');assert.equal(events.at(-1).candle.close,'3010');
  assert.equal(reads,1);assert.deepEqual(socket.sent.map(x=>x.subscription?.type),['candle','l2Book']);
  stop();assert.equal(socket.readyState,3);
});
