import test from 'node:test';
import assert from 'node:assert/strict';
import {accountRequest,createBackupRunner} from './public/account-sync.js';
import * as accountSync from './public/account-sync.js';
import {createIdentity,digest,verifyValue} from './public/peer-crypto.js';
import {ACCOUNT_REQUEST} from './public/account-keys.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function memory({beforeCommit=async()=>{}}={}){
 let value={identity:{profile:{id:'profile-a'}},contacts:[],messages:[],accountSync:{accountId:'backup-a',revision:0,digest:'',version:1,savedVersion:0,pending:null,status:'pending'}};
 return {read:async()=>structuredClone(value),update:async(fn,{signal}={})=>{signal?.throwIfAborted();const next=structuredClone(value),result=await fn(next);await beforeCommit();signal?.throwIfAborted();value=next;return result;}};
}
function browserHost(){
 const saved=new Map(),timers=new Map(),listeners=new Map(),channels=[];let next=0;
 const replace=(key,value)=>{saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});};
 replace('setTimeout',(work,delay)=>{const id=++next;timers.set(id,{work,delay});return id;});replace('clearTimeout',id=>timers.delete(id));
 replace('addEventListener',(type,listener)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);});
 replace('removeEventListener',(type,listener)=>listeners.get(type)?.delete(listener));
 replace('dispatchEvent',event=>{for(const listener of listeners.get(event.type)??[])listener(event);return true;});
 replace('BroadcastChannel',class extends EventTarget{constructor(name){super();this.name=name;this.closed=false;channels.push(this);}postMessage(){}close(){this.closed=true;}});
 replace('navigator',{onLine:true,locks:{request:async(name,options,work)=>{if(typeof options==='function')return options();options.signal?.throwIfAborted();return work();}}});
 return {timers,channels,listeners,replace,fire(){const [id,{work}]=timers.entries().next().value;timers.delete(id);return work();},restore(){for(const [key,descriptor]of saved)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
}

test('stopping a backup aborts its request and retains its exact uncertain archive after a late reply',async()=>{
 const storage=memory(),entered=deferred(),reply=deferred();let requestSignal,requests=0;
 const run=createBackupRunner({...storage,capture:async()=>({ciphertext:'saved-encrypted-candidate'}),request:async(sync,operation,pending,{signal}={})=>{
  requests++;requestSignal=signal;entered.resolve();await reply.promise;
  return {revision:1,digest:await digest(pending.archive),savedAt:1234};
 }});
 const pending=run(),rejected=assert.rejects(pending,/stopped/i);await entered.promise;
 const before=await storage.read();run.stop();await rejected;
 assert.equal(run.signal.aborted,true);assert.equal(requestSignal.aborted,true);
 reply.resolve();await flush();await flush();
 assert.deepEqual(await storage.read(),before);
 assert.deepEqual(before.accountSync.pending.archive,{ciphertext:'saved-encrypted-candidate'});
 assert.equal(before.accountSync.savedVersion,0);assert.equal(requests,1);
 await assert.rejects(run(),/stopped/i);
});

test('stopping during a challenge aborts transport and cannot issue the authenticated upload',async()=>{
 const controller=new AbortController(),entered=deferred(),reply=deferred();let fetchSignal,requests=0;
 const pending=accountRequest({accountId:'backup-a'},'write',{signal:controller.signal},async(url,{signal})=>{
  requests++;fetchSignal=signal;entered.resolve();await reply.promise;return {ok:true,json:async()=>({nonce:'a'.repeat(64)})};
 });
 const outcome=pending.then(()=>null,error=>error);await entered.promise;controller.abort(Error('Account stopped.'));
 try{assert.equal(fetchSignal.aborted,true);assert.match((await outcome)?.message??'',/stopped/i);}finally{reply.resolve();await outcome;}
 await flush();assert.equal(requests,1);
});

test('a delayed session dispatcher cannot invoke a request after cancellation',async()=>{
 const controller=new AbortController(),release=deferred();let requests=0,entered=false;
 const pending=accountRequest({accountId:'backup-a'},'read',{signal:controller.signal,dispatch:async invoke=>{entered=true;await release.promise;return invoke();}},async()=>{requests++;throw Error('Unexpected network request');});
 const outcome=pending.then(()=>null,error=>error);await flush();
 try{assert.equal(entered,true);controller.abort(Error('Account stopped.'));assert.match((await outcome)?.message??'',/stopped/i);}
 finally{release.resolve();await outcome;}
 await flush();assert.equal(requests,0);
});

test('parent cancellation during capture creates neither an archive candidate nor a request',async()=>{
 const storage=memory(),controller=new AbortController(),entered=deferred(),capture=deferred();let requests=0;
 const run=createBackupRunner({...storage,signal:controller.signal,capture:async()=>{entered.resolve();return capture.promise;},request:async()=>requests++});
 const before=await storage.read(),pending=run(),rejected=assert.rejects(pending,/workspace ended/);await entered.promise;
 controller.abort(Error('workspace ended'));await rejected;capture.resolve({ciphertext:'obsolete'});await flush();
 assert.equal(run.signal.aborted,true);assert.equal(requests,0);assert.deepEqual(await storage.read(),before);
});

test('stop during an acknowledgement commit leaves the pending archive available for retry',async()=>{
 const entered=deferred(),commit=deferred();let updates=0;
 const storage=memory({beforeCommit:async()=>{if(++updates===3){entered.resolve();await commit.promise;}}});
 const run=createBackupRunner({...storage,capture:async()=>({ciphertext:'retained-candidate'}),request:async(sync,op,pending)=>({revision:1,digest:await digest(pending.archive),savedAt:1234})});
 const pending=run(),rejected=assert.rejects(pending,/stopped/i);await entered.promise;const before=await storage.read();run.stop();await rejected;commit.resolve();await flush();
 assert.deepEqual(await storage.read(),before);assert.equal(before.accountSync.revision,0);assert(before.accountSync.pending);
});

test('a late upload conflict after stop cannot trigger another challenge or reconciliation read',async()=>{
 const storage=memory(),entered=deferred(),reply=deferred(),operations=[];
 const run=createBackupRunner({...storage,capture:async()=>({ciphertext:'retained-candidate'}),request:async(sync,operation)=>{operations.push(operation);entered.resolve();await reply.promise;throw Object.assign(Error('Late conflict'),{code:'CONFLICT'});}});
 const pending=run(),rejected=assert.rejects(pending,/stopped/i);await entered.promise;run.stop();await rejected;reply.resolve();await flush();await flush();
 assert.deepEqual(operations,['write']);assert((await storage.read()).accountSync.pending);
});

test('a live dispatcher fences both request invocations and preserves authenticated backup terms',async()=>{
 const host=browserHost(),authority=await createIdentity('Disposable backup authority'),archive={ciphertext:'encrypted-only'},calls=[];let fences=0;
 host.replace('location',{origin:'http://localhost:43121'});
 try{
  const result=await accountRequest({accountId:'backup-a',authority},'write',{archive,expected:4,previous:'old-digest',dispatch:invoke=>{fences++;return invoke();}},async(url,options)=>{
   calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('/challenge')?{nonce:'a'.repeat(64)}:{revision:5}};
  });
  assert.deepEqual(result,{revision:5});assert.equal(fences,2);assert.deepEqual(calls.map(c=>c.url),['/api/accounts/challenge','/api/accounts/write']);
  assert.equal(await verifyValue(authority.profile.signingPublic,[ACCOUNT_REQUEST,location.origin,'write','backup-a','a'.repeat(64),4,'old-digest',await digest(archive)],calls[1].body.signature),true);
 }finally{host.restore();}
});

test('the exported account request can be injected into a runner without losing dispatch or cancellation',async()=>{
 const host=browserHost(),storage=memory(),authority=await createIdentity('Disposable injected backup authority'),session=new AbortController(),calls=[];let fences=0,run;
 host.replace('location',{origin:'http://localhost:43121'});
 host.replace('fetch',async(url,options)=>{
  calls.push({url,body:JSON.parse(options.body),signal:options.signal});
  return {ok:true,json:async()=>url.endsWith('/challenge')?{nonce:'a'.repeat(64)}:{revision:1,digest:await digest(calls[1].body.archive),savedAt:1234}};
 });
 try{
  await storage.update(state=>{state.accountSync.authority=authority;});
  run=createBackupRunner({...storage,request:accountRequest,signal:session.signal,capture:async()=>({ciphertext:'injected-encrypted-candidate'}),dispatch:invoke=>{fences++;return invoke();}});
  await run();const state=await storage.read();
  assert.equal(state.accountSync.status,'saved');assert.equal(state.accountSync.pending,null);assert.equal(state.accountSync.revision,1);assert.equal(fences,2);
  assert.deepEqual(calls.map(call=>call.url),['/api/accounts/challenge','/api/accounts/write']);
  assert.equal(await verifyValue(authority.profile.signingPublic,[ACCOUNT_REQUEST,location.origin,'write','backup-a','a'.repeat(64),0,'',await digest(calls[1].body.archive)],calls[1].body.signature),true);
  session.abort(Error('Injected workspace ended'));assert(calls.every(call=>call.signal.aborted));await assert.rejects(run(),/Injected workspace ended/);assert.equal(calls.length,2);
 }finally{run?.stop();host.restore();}
});

test('page restoration starts a fresh runner only while its enclosing session remains live',async()=>{
 const host=browserHost(),storage=memory(),session=new AbortController(),entered=deferred(),reply=deferred();let requests=0,controller;
 try{
  controller=accountSync.startAccountSync({...storage,signal:session.signal,capture:async()=>({ciphertext:'page-candidate'}),request:async(sync,op,pending)=>{requests++;if(requests===1){entered.resolve();await reply.promise;}return {revision:1,digest:await digest(pending.archive),savedAt:1234};}});
  const oldTick=host.fire();await entered.promise;dispatchEvent(new Event('pagehide'));await oldTick;
  assert.equal(host.timers.size,0);assert.equal(controller.signal.aborted,false);await assert.rejects(controller.backupNow(),/suspended/);
  dispatchEvent(new Event('pageshow'));await host.fire();assert.equal((await storage.read()).accountSync.status,'saved');assert.equal(requests,2);
  const saved=await storage.read();reply.resolve();await flush();assert.deepEqual(await storage.read(),saved);
  session.abort(Error('workspace ended'));assert.equal(controller.signal.aborted,true);assert.equal(host.timers.size,0);
  dispatchEvent(new Event('pageshow'));dispatchEvent(new Event('online'));assert.equal(host.timers.size,0);await assert.rejects(accountSync.backupNow(),/workspace ended/);
 }finally{reply.resolve();controller?.stop();host.restore();}
});

test('explicit stop before a scheduled timer fires sends nothing and permits deliberate fresh startup',async()=>{
 const host=browserHost(),storage=memory();let requests=0,controller;
 const options={...storage,capture:async()=>({ciphertext:'fresh-candidate'}),request:async(sync,op,pending)=>{requests++;return {revision:1,digest:await digest(pending.archive),savedAt:1234};}};
 try{
  controller=accountSync.startAccountSync(options);accountSync.stopAccountSync();assert.equal(host.timers.size,0);assert.equal(requests,0);
  await assert.rejects(accountSync.backupNow(),/stopped/);const previous=controller;controller=accountSync.startAccountSync(options);assert.notEqual(controller,previous);
  await controller.backupNow();assert.equal(requests,1);assert.equal((await storage.read()).accountSync.status,'saved');
 }finally{controller?.stop();host.restore();}
});

test('stopping a scheduled upload removes wakeups and prevents its callback from rescheduling',async()=>{
 const host=browserHost(),storage=memory(),entered=deferred(),reply=deferred();let requests=0,controller;
 try{
  controller=accountSync.startAccountSync({...storage,capture:async()=>({ciphertext:'scheduled-candidate'}),request:async(sync,op,pending)=>{requests++;entered.resolve();await reply.promise;return {revision:1,digest:await digest(pending.archive),savedAt:1234};}});
  assert.equal(typeof controller?.stop,'function');assert.equal(accountSync.startAccountSync(),controller);
  const tick=host.fire();await entered.promise;const before=await storage.read();controller.stop();await tick;
  assert.equal(controller.signal.aborted,true);assert.equal(host.timers.size,0);
  assert(host.channels.every(channel=>channel.closed));assert.equal([...host.listeners.values()].reduce((n,set)=>n+set.size,0),0);
  for(const type of ['online','pageshow','lenz-account-changed'])dispatchEvent(new Event(type));
  for(const channel of host.channels)channel.dispatchEvent(new Event('message'));
  reply.resolve();await flush();await flush();
  assert.equal(host.timers.size,0);assert.equal(requests,1);assert.deepEqual(await storage.read(),before);
  await assert.rejects(controller.backupNow(),/stopped/i);
 }finally{reply.resolve();controller?.stop();host.restore();}
});
