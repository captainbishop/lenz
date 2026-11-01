import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createNameRoute} from './name-relay.mjs';
const req=(input={},changes={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]),{url:'/api/names/resolve',method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'},...changes});
const res=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(text){this.body=JSON.parse(text);}});
test('name API forwards only explicit same-origin lookups and disables caching',async()=>{
  const input={system:'near',network:'testnet',name:'alice.testnet'},response=res();let received;
  const route=createNameRoute(async value=>{received=value;return {state:'account_found'};});
  assert.equal(await route(req(input),response),true);assert.deepEqual(received,input);assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'no-store');
  assert.equal(await route(req({}, {url:'/chat.html'}),res()),false);
});
test('foreign origins, hosts, methods, content types and unknown routes never call the resolver',async()=>{
  const route=createNameRoute(()=>assert.fail('No lookup permitted'));
  for(const changes of [{headers:{host:'evil',origin:'http://127.0.0.1:4173'}},{headers:{host:'127.0.0.1:4173',origin:'https://evil.example'}},{method:'GET'},
    {url:'/api/names/sign'},{headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'text/plain'}}]){
    const response=res();await route(req({},changes),response);assert([400,403,404,405].includes(response.status));
  }
});
test('oversized requests fail before lookup and provider details are not reflected to the page',async()=>{
  const response=res();await createNameRoute(()=>assert.fail('No lookup'))(req({name:'a'.repeat(2049)}),response);assert.equal(response.status,400);
  const failed=res();await createNameRoute(()=>{throw Error('private diagnostic text');})(req(),failed);assert.equal(failed.status,400);assert(!JSON.stringify(failed.body).includes('private diagnostic'));
});
test('two in-flight lookups bound concurrency and release capacity after completion',async()=>{
  const releases=[],route=createNameRoute(()=>new Promise(resolve=>releases.push(resolve)));
  const a=route(req(),res()),b=route(req(),res());while(releases.length<2)await new Promise(resolve=>setImmediate(resolve));
  const blocked=res();await route(req(),blocked);assert.equal(blocked.status,429);
  releases.forEach(resolve=>resolve({state:'not_found'}));await Promise.all([a,b]);
  const c=route(req(),res());while(releases.length<3)await new Promise(resolve=>setImmediate(resolve));releases[2]({state:'not_found'});await c;
});
