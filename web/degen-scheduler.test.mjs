import test from 'node:test';
import assert from 'node:assert/strict';
import {createDegenScheduler} from './degen-scheduler.mjs';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(){let now=0,id=0;const timers=new Map();const scheduler=createDegenScheduler({clock:()=>now,setTimer:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimer:key=>timers.delete(key)});return {scheduler,now:()=>now,async advance(ms){now+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}await flush();}};}
test('cold-pair requests are paced through a minute instead of consuming the budget in one burst',async()=>{
 const f=fixture(),starts=[],run=()=>f.scheduler.run('geckoterminal',()=>{starts.push(f.now());return true;});await run();assert.deepEqual(starts,[0]);
 for(let i=1;i<=24;i++){const pending=run();await f.advance(2500);await pending;}assert.equal(starts.length,25);assert.equal(starts[24],60000);assert(starts.every((time,i)=>!i||time-starts[i-1]===2500));
});

test('queued reads report retry status before the browser deadline and long cooldowns return immediately',async()=>{
 const f=fixture();await f.scheduler.run('geckoterminal',()=>true);
 const jobs=Array.from({length:14},()=>f.scheduler.run('geckoterminal',()=>true).then(()=>({ok:true}),error=>({retryAfterMs:error.retryAfterMs})));
 for(let i=0;i<4;i++)await f.advance(2500);
 const results=await Promise.all(jobs);assert.equal(results.filter(r=>r.ok).length,3);assert(results.filter(r=>!r.ok).every(r=>r.retryAfterMs>0));
 await assert.rejects(f.scheduler.run('geckoterminal',()=>{throw Object.assign(Error('quota'),{retryAfterMs:60000,providerRetryAfter:true});}));
 await assert.rejects(f.scheduler.run('geckoterminal',()=>assert.fail('must not call provider during cooldown')),error=>error.retryAfterMs===60000);
});

test('selected charts displace background queue entries and aging gives saved work a turn',async()=>{
 const f=fixture();await f.scheduler.run('geckoterminal',()=>true);
 const controllers=Array.from({length:32},()=>new AbortController());
 const jobs=controllers.map(c=>f.scheduler.run('geckoterminal',()=>true,{signal:c.signal,priority:3}).catch(error=>error));
 const selected=f.scheduler.run('geckoterminal',()=>true,{priority:0});await f.advance(2500);assert.equal(await selected,true);
 controllers.forEach(c=>c.abort());await Promise.all(jobs);
 const order=[],saved=f.scheduler.run('geckoterminal',()=>order.push('saved'),{priority:3}),cold=[];
 for(let i=0;i<3;i++){cold.push(f.scheduler.run('geckoterminal',()=>order.push('chart'),{priority:0}));await f.advance(2500);}
 await saved;assert.equal(order[2],'saved');await f.advance(2500);await Promise.all(cold);
});
test('cold charts run before queued trades and saved-data refreshes; other sources have independent slots',async()=>{
 const f=fixture(),starts=[],run=(name,priority,provider='geckoterminal')=>f.scheduler.run(provider,()=>{starts.push(name);},{priority});
 const jobs=[run('first',0),run('saved',3),run('trades',1),run('selected-chart',0),run('search',2,'dexscreener')];await flush();assert.deepEqual(starts,['first','search']);
 await f.advance(2500);assert.equal(starts.at(-1),'selected-chart');await f.advance(2500);assert.equal(starts.at(-1),'trades');await f.advance(2500);await Promise.all(jobs);assert.equal(starts.at(-1),'saved');
});
test('a cancelled queued request never starts or consumes the next slot',async()=>{
 const f=fixture(),starts=[],controller=new AbortController();await f.scheduler.run('geckoterminal',()=>starts.push('first'));
 const cancelled=f.scheduler.run('geckoterminal',()=>starts.push('left'),{signal:controller.signal});const rejection=assert.rejects(cancelled,{name:'AbortError'});controller.abort();await rejection;
 const selected=f.scheduler.run('geckoterminal',()=>starts.push('selected'));await f.advance(2500);await selected;assert.deepEqual(starts,['first','selected']);
});
test('provider retry instructions are respected and missing-header throttles use bounded increasing delays',async()=>{
 const f=fixture();let missing=true;
 const fail=()=>{throw Object.assign(Error('quota'),{retryAfterMs:missing?5000:12000,providerRetryAfter:!missing});};
 await assert.rejects(f.scheduler.run('geckoterminal',fail));assert.equal(f.scheduler.delay('geckoterminal'),5000);
 await f.advance(5000);await assert.rejects(f.scheduler.run('geckoterminal',fail));assert.equal(f.scheduler.delay('geckoterminal'),10000);
 await f.advance(10000);missing=false;await assert.rejects(f.scheduler.run('geckoterminal',fail));assert.equal(f.scheduler.delay('geckoterminal'),12000);
 await f.advance(12000);await f.scheduler.run('geckoterminal',()=>true);await f.advance(2500);missing=true;await assert.rejects(f.scheduler.run('geckoterminal',fail));assert.equal(f.scheduler.delay('geckoterminal'),5000);
});

test('queue overload is bounded and cancelling it releases capacity',async()=>{
 const f=fixture();await f.scheduler.run('geckoterminal',()=>true);
 const controllers=Array.from({length:32},()=>new AbortController());
 const jobs=controllers.map(c=>f.scheduler.run('geckoterminal',()=>true,{signal:c.signal}));
 const cancelled=jobs.map(job=>assert.rejects(job,{name:'AbortError'}));
 await assert.rejects(f.scheduler.run('geckoterminal',()=>true),{message:'Data queue busy'});
 controllers.forEach(c=>c.abort());await Promise.all(cancelled);
 const selected=f.scheduler.run('geckoterminal',()=>true);await f.advance(2500);assert.equal(await selected,true);
});
