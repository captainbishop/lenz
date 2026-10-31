import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createZcashRoute } from './zcash-relay.mjs';
const req=(url='/api/zcash/status',input={wallet:'a'},changes={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),{url,method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'},...changes});
const res=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=JSON.parse(body);}});

test('unsigned review routes accept only exact wallet/amount or wallet/id payloads',async()=>{
  const calls=[],route=createZcashRoute(()=>assert.fail('no snapshot'),async(...args)=>{calls.push(args);return {review:null};});
  for(const [path,input]of [['review',{wallet:'a',amount:'0.01'}],['review-status',{wallet:'a'}],['review-discard',{wallet:'a',id:'12345678-1234-1234-1234-123456789abc'}]]){const out=res();await route(req('/api/zcash/'+path,input),out);assert.equal(out.status,200);assert.equal(out.headers['Cache-Control'],'no-store');}
  assert.deepEqual(calls.map(c=>c[0]),['prepare','status','discard']);
  for(const input of [{wallet:'a',amount:'0.01',address:'foreign'},{wallet:'a',amount:1},{wallet:'a',amount:'0.01',path:'keys.toml'}]){const out=res();await route(req('/api/zcash/review',input),out);assert.equal(out.status,400);}assert.equal(calls.length,3);
  const foreign=res();await route(req('/api/zcash/review',{wallet:'a',amount:'0.01'},{headers:{host:'127.0.0.1:4173',origin:'https://foreign.test','content-type':'application/json'}}),foreign);assert.equal(foreign.status,403);assert.equal(calls.length,3);
});

test('review failures sanitize native errors and leave signing/sending routes unavailable',async()=>{
  const route=createZcashRoute(()=>assert.fail('no snapshot'),async()=>{throw Error('secret native path');});
  const out=res();await route(req('/api/zcash/review',{wallet:'a',amount:'0.01'}),out);assert.equal(out.status,503);assert(!JSON.stringify(out.body).includes('secret'));
  for(const action of ['sign','send','prove','export']){const r=res();await route(req('/api/zcash/'+action),r);assert.equal(r.status,404);}
});

test('expiry check accepts only a matching wallet/id payload and sanitizes provider failure',async()=>{
  const id='12345678-1234-1234-1234-123456789abc',calls=[];
  const route=createZcashRoute(()=>assert.fail('no automatic sync'),async(...args)=>{calls.push(args);throw Error('private transaction path');});
  for(const input of [{wallet:'a'},{wallet:'a',id,amount:'0.01'},{wallet:'a',id,server:'foreign'},{wallet:'a',id:3}]){const out=res();await route(req('/api/zcash/review-check',input),out);assert.equal(out.status,400);}
  assert.equal(calls.length,0);
  const out=res();await route(req('/api/zcash/review-check',{wallet:'a',id}),out);
  assert.equal(out.status,503);assert.deepEqual(calls,[['check',{wallet:'a',id}]]);assert(!JSON.stringify(out.body).includes('private'));
});
test('only explicit status/refresh requests invoke the companion; response never cached',async()=>{
  const calls=[],route=createZcashRoute(async(...args)=>{calls.push(args);return {balance:'native'};});
  for(const action of ['status','refresh']){const out=res();await route(req('/api/zcash/'+action,{wallet:'b'}),out);assert.equal(out.status,200);assert.equal(out.headers['Cache-Control'],'no-store');}
  assert.deepEqual(calls,[['b',false],['b',true]]);assert.equal(await route(req('/chat.html'),res()),false);
});
test('foreign origins/hosts, missing origins, non-JSON and wrong methods cannot read the native wallet',async()=>{
  const route=createZcashRoute(()=>assert.fail('no native call'));
  const headers={host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'};
  for(const [changes,expected] of [[{method:'GET'},405],[{headers:{...headers,origin:'https://evil.test'}},403],[{headers:{...headers,host:'evil.test:4173'}},403],[{headers:{...headers,origin:undefined}},403],[{headers:{...headers,'content-type':'text/plain'}},400]]){const out=res();await route(req('/api/zcash/status',{wallet:'a'},changes),out);assert.equal(out.status,expected);}
});
test('path traversal, extra arguments, oversized input and send/seed routes are rejected',async()=>{
  const route=createZcashRoute(()=>assert.fail('no native call'));
  for(const input of [{wallet:'../a'},{wallet:'a',action:'send'},{wallet:'a',path:'keys.toml'},{wallet:'a',data:'x'.repeat(300)},null,[],{}]){const out=res();await route(req('/api/zcash/status',input),out);assert.equal(out.status,400);}
  for(const path of ['send','seed','init','status?wallet=a']){const out=res();await route(req('/api/zcash/'+path),out);assert.equal(out.status,404);}
});
test('native errors return unavailable without leaking paths, secrets or a fake zero',async()=>{
  const route=createZcashRoute(async()=>{throw Error('private C:/wallet/seed');}),out=res();await route(req(),out);assert.equal(out.status,503);assert(!JSON.stringify(out.body).includes('seed'));assert(!Object.hasOwn(out.body,'amounts'));
});
test('native failure diagnostics expose only an allowed operation and timeout code',async()=>{
  const route=createZcashRoute(async()=>{throw Object.assign(Error('private seed path'),{operation:'sync',code:'ZCASH_TIMEOUT'});}),out=res();await route(req(),out);assert.equal(out.body.failedStep,'sync');assert.equal(out.body.code,'ZCASH_TIMEOUT');assert(!JSON.stringify(out.body).includes('seed'));
  const invalid=createZcashRoute(async()=>{throw Object.assign(Error('private seed path'),{operation:'C:/private',code:'secret'});}),other=res();await invalid(req(),other);assert.equal(other.body.failedStep,'validation');assert.equal(other.body.code,'ZCASH_UNAVAILABLE');
});
test('concurrent requests do not overlap native wallet access; lock releases on failure',async()=>{
  let release,calls=0;const route=createZcashRoute(async()=>{calls++;await new Promise(r=>release=r);throw Error('failed');});
  const first=res(),pending=route(req(),first);await new Promise(r=>setImmediate(r));const second=res();await route(req('/api/zcash/refresh'),second);assert.equal(second.status,409);assert.equal(calls,1);release();await pending;
  const third=res(),next=route(req(),third);await new Promise(r=>setImmediate(r));assert.equal(calls,2);release();await next;assert.equal(third.status,503);
});
