import test from 'node:test';
import assert from 'node:assert/strict';
import {liveRead} from './public/market-live.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}){
  const timers=new Map(),states=[],values=[];let id=0;
  const poll=liveRead({read:async()=>1,accept:v=>values.push(v),status:v=>states.push(v),allowed:()=>true,setTimer:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimer:key=>timers.delete(key),...options});
  const tick=()=>{const [key,timer]=timers.entries().next().value;timers.delete(key);timer.fn();};
  return {poll,timers,states,values,tick};
}
test('opt-in starts reads, completion schedules the next read and stop removes it',async()=>{
  let reads=0;const f=setup({read:async()=>++reads});assert.equal(reads,0);f.poll.setEnabled(true);await settle();assert.deepEqual(f.values,[1]);assert.equal([...f.timers.values()][0].ms,20000);f.tick();await settle();assert.deepEqual(f.values,[1,2]);f.poll.stop();assert.equal(f.timers.size,0);
});
test('a slow read cannot accumulate timer-driven concurrent reads',async()=>{
  let resolve,reads=0;const f=setup({read:()=>{reads++;return new Promise(r=>resolve=r);}});f.poll.setEnabled(true);assert.equal(f.timers.size,0);await settle();assert.equal(reads,1);resolve(3);await settle();assert.deepEqual(f.values,[3]);assert.equal(f.timers.size,1);f.poll.stop();
});
test('opt-out rejects late replies even if transport ignores abort',async()=>{
  let resolve,signal;const f=setup({read:s=>{signal=s;return new Promise(r=>resolve=r);}});f.poll.setEnabled(true);f.poll.stop();assert(signal.aborted);resolve(7);await settle();assert.deepEqual(f.values,[]);assert.equal(f.timers.size,0);
});
test('hidden or offline state rejects replies; returning wakes only an enabled feed',async()=>{
  let allowed=true,resolve;const f=setup({allowed:()=>allowed,read:()=>new Promise(r=>resolve=r)});f.poll.setEnabled(true);allowed=false;resolve(2);await settle();assert.deepEqual(f.values,[]);assert.equal(f.timers.size,0);f.poll.wake();assert.equal(f.states.at(-1),'paused');allowed=true;f.poll.wake();resolve(4);await settle();assert.deepEqual(f.values,[4]);f.poll.stop();f.poll.wake();assert.equal(f.timers.size,0);
});
test('failed reads back off to a bounded delay and recover',async()=>{
  let fail=true;const f=setup({read:async()=>{if(fail)throw Error('offline');return 9;}});f.poll.setEnabled(true);await settle();assert.equal(f.states.at(-1),'retrying');assert.equal([...f.timers.values()][0].ms,40000);f.tick();await settle();assert.equal([...f.timers.values()][0].ms,60000);fail=false;f.tick();await settle();assert.deepEqual(f.values,[9]);assert.equal([...f.timers.values()][0].ms,20000);f.poll.stop();
});
test('restarting cannot let a superseded request replace the current value',async()=>{
  const pending=[];const f=setup({read:()=>new Promise(r=>pending.push(r))});f.poll.setEnabled(true);f.poll.wake();pending[1](2);await settle();pending[0](1);await settle();assert.deepEqual(f.values,[2]);assert.equal(f.timers.size,1);f.poll.stop();
});
test('a rejected snapshot is a feed failure, never a live success',async()=>{
  const f=setup({accept:()=>{throw Error('stale');}});f.poll.setEnabled(true);await settle();assert(!f.states.includes('live'));assert.equal(f.states.at(-1),'retrying');f.poll.stop();
});
