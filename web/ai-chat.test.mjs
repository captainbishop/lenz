import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createIdentity,signValue} from './public/peer-crypto.js';
import {aiConversation,aiIdentity,aiTerms,AI_REQUEST} from './public/ai-conversation.js';
import {createAIChat} from '../integrations/ai-chat.mjs';
import {createAIRoute} from './ai-relay.mjs';
import {AIUsageStore,aiConfigured,runAIWorker} from './ai-service.mjs';
const input={messages:[{role:'user',content:'Explain a limit order.'}]},config={apiKey:'synthetic',model:'test/tee'},origin='http://127.0.0.1:4173';
test('AI context accepts only bounded alternating text; wallet, contacts and tools are rejected',()=>{
 assert.deepEqual(aiConversation(input),input);
 for(const bad of [{...input,contacts:[]},{messages:[{role:'system',content:'x'}]},{messages:[{role:'user',content:'x',tools:[]}]},{messages:[{role:'user',content:'x'.repeat(2001)}]},{messages:[{role:'user',content:'x'},{role:'assistant',content:'y'}]},{messages:Array.from({length:11},(_,i)=>({role:i%2?'assistant':'user',content:'x'}))}])assert.throws(()=>aiConversation(bad));
});
test('inference returns text only after exact completion model verification; gateway fallback and tools fail',async()=>{
 let release,kind='provider_tee',id='reply',tool=false,seen,options;class InferenceClient{constructor(o){options=o;this.chat={completions:{create:async body=>{seen=body;return {id:'reply',choices:[{message:{content:'A limit order sets a price.',...(tool?{tool_calls:[{}]}:{})}}]};}}};}async verifyResponse(){await new Promise(resolve=>release=resolve);return {id,signatureKind:kind};}}
 const ask=await createAIChat(config,{nodeVersion:'24.22.1',loadSDK:async()=>({InferenceClient})});let done=false;const first=ask(input).then(r=>{done=true;return r;});await new Promise(setImmediate);assert.equal(done,false);assert.equal(options.e2ee,true);assert.deepEqual(options.modelVerification.policy.acceptedTcbStatuses,['UpToDate']);assert.deepEqual(options.gatewayVerification,options.modelVerification);assert.deepEqual(seen.messages,input.messages);assert.equal(seen.tools,undefined);assert.equal(seen.stream,false);release();assert.equal((await first).executable,false);
 for(const change of [()=>kind='gateway',()=>{kind='provider_tee';id='other';},()=>{id='reply';tool=true;}]){change();const pending=ask(input);await new Promise(setImmediate);release();await assert.rejects(pending,/could not verify/);}
});
test('runtime and missing access disable AI before any SDK call',async()=>{
 assert.equal(aiConfigured(config,['a'.repeat(64)],{nodeVersion:'24.22.1'}),true);assert.equal(aiConfigured(config,['a'.repeat(64)],{nodeVersion:'24.21.0'}),false);assert.equal(aiConfigured({},['a'.repeat(64)],{nodeVersion:'24.22.1'}),false);assert.equal(aiConfigured(config,[],{nodeVersion:'24.22.1'}),false);
 let loaded=false;await assert.rejects(createAIChat(config,{nodeVersion:'24.21.0',loadSDK:async()=>{loaded=true;}}));assert.equal(loaded,false);
});
test('daily allowance persists across restart and rejects excess use without storing prompts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lenz-ai-test-')),path=join(dir,'usage.sqlite'),now=Date.now();let store;
 try{store=new AIUsageStore(path);store.consume('a',now,{perAccount:1,total:2});assert.throws(()=>store.consume('a',now,{perAccount:1,total:2}));store.close();store=new AIUsageStore(path);assert.throws(()=>store.consume('a',now,{perAccount:1,total:2}));store.consume('b',now,{perAccount:1,total:2});assert.throws(()=>store.consume('c',now,{perAccount:1,total:2}));assert.equal(store.db.prepare('SELECT SUM(count) AS n FROM ai_usage').get().n,2);assert.deepEqual(store.db.prepare('PRAGMA table_info(ai_usage)').all().map(c=>c.name),['day','id','count']);store.close();store=null;assert(!(await readFile(path)).includes(Buffer.from(input.messages[0].content)));}
 finally{store?.close();await rm(dir,{recursive:true,force:true});}
});
test('worker timeout and cancellation terminate computation before releasing the caller',async()=>{
 let terminated=0;class FakeWorker extends EventEmitter{async terminate(){await new Promise(setImmediate);terminated++;}}
 await assert.rejects(runAIWorker(config,input,{WorkerClass:FakeWorker,timeoutMs:10}));assert.equal(terminated,1);
 const abort=new AbortController(),pending=runAIWorker(config,input,{WorkerClass:FakeWorker,signal:abort.signal});abort.abort();await assert.rejects(pending);assert.equal(terminated,2);
});
async function harness(options){const route=createAIRoute(options),server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 return {post:(path,value,headers={})=>new Promise((resolve,reject)=>{const req=http.request(url+'/api/ai/'+path,{method:'POST',headers:{host:'127.0.0.1:4173',origin,'content-type':'application/json',...headers}},res=>{let body='';res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({code:res.statusCode,data:JSON.parse(body)}));});req.on('error',reject);req.end(JSON.stringify(value));}),close:()=>new Promise(resolve=>server.close(resolve))};}
test('signed HTTP requests bind origin, identity, one-use nonce and exact AI context',async()=>{
 const identity=await createIdentity('Synthetic profile'),id=identity.profile.id;let calls=0,consumes=0,seen,now=Date.now();const h=await harness({enabled:true,allowedIds:[id],now:()=>now,consume:()=>consumes++,ask:async data=>{calls++;seen=data;return {text:'A verified reply.',verified:true,executable:false};}});
 async function signed(){const {data:{nonce}}=await h.post('challenge',{id});return {identity:aiIdentity(identity.profile),nonce,input,signature:await signValue(identity,await aiTerms(origin,id,nonce,input))};}
 try{
  const body=await signed();assert.equal((await h.post('chat',body,{origin:'https://evil.example'})).code,403);assert.equal((await h.post('chat',body)).code,200);assert.equal((await h.post('chat',body)).code,400);assert.equal(calls,1);assert.equal(consumes,1);assert.deepEqual(seen,input);assert(!JSON.stringify(seen).includes('Synthetic profile'));
  const changed=await signed();changed.input={messages:[{role:'user',content:'different'}]};assert.equal((await h.post('chat',changed)).code,400);
  const stale=await signed();now+=60001;assert.equal((await h.post('chat',stale)).code,400);
  const extra=await signed();extra.wallet={balance:'private'};assert.equal((await h.post('chat',extra)).code,400);
  const wrongDomain=await signed();wrongDomain.signature=await signValue(identity,['lenz/account-backup/v1',origin,id,wrongDomain.nonce,input]);assert.equal((await h.post('chat',wrongDomain)).code,400);assert.equal(calls,1);
  assert.equal((await h.post('challenge',{id:'f'.repeat(64)})).code,400);
 }finally{await h.close();}
});
test('unconfigured AI, quota failure and busy inference never create a second provider request',async()=>{
 let calls=0;const off=await harness({ask:()=>calls++});try{assert.equal((await off.post('chat',{})).code,503);assert.equal(calls,0);}finally{await off.close();}
 const identity=await createIdentity('Synthetic'),id=identity.profile.id;let release,failQuota=false,consumes=0;const h=await harness({enabled:true,allowedIds:[id],consume:()=>{consumes++;if(failQuota)throw Error('quota');},ask:async()=>{calls++;await new Promise(resolve=>release=resolve);return {text:'reply',verified:true,executable:false};}});
 async function signed(){const {data:{nonce}}=await h.post('challenge',{id});return {identity:aiIdentity(identity.profile),nonce,input,signature:await signValue(identity,await aiTerms(origin,id,nonce,input))};}
 try{const first=h.post('chat',await signed());while(!release)await new Promise(setImmediate);const second=await h.post('chat',await signed());assert.equal(second.code,429);assert.equal(calls,1);release();assert.equal((await first).code,200);failQuota=true;assert.equal((await h.post('chat',await signed())).code,429);assert.equal(calls,1);assert.equal(consumes,2);}finally{await h.close();}
});
test('recovered chat accounts can authorize AI without gaining payment signing access',async()=>{
 const identity=await createIdentity('Recovered fixture');identity.access='lenz/recovered-chat/v1';await signValue(identity,[AI_REQUEST,'text']);await assert.rejects(signValue(identity,['proof-u/near-transfer/v1','funds']),/Offline funds/);
});
