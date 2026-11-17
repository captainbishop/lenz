import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import http from 'node:http';
import { createDefiRoute } from './defi-relay.mjs';
function req(url, input = {}, changes = {}) {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(input))]), { url, method: 'POST',
    headers: { host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173', 'content-type': 'application/json' }, ...changes });
}
function res() { return { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(text) { this.body = JSON.parse(text); } }; }
test('local API forwards quote requests to the actual adapter boundary', async () => {
  const calls = [], route = createDefiRoute({
    rheaQuote: async input => { calls.push(input); return { state: 'quote', provider: 'rhea' }; },
    intentsPreview: async input => { calls.push(input); return { state: 'quote', provider: 'near-intents' }; },
    intentsTokens: async () => [],
  });
  for (const name of ['rhea', 'intents']) {
    const response = res(); assert.equal(await route(req(`/api/defi/${name}/quote`, { amount: '20' }), response), true);
    assert.equal(response.status, 200); assert.equal(response.body.state, 'quote'); assert.equal(response.headers['Cache-Control'], 'no-store');
  }
  assert.equal(calls.length, 2);
  const response = res(); await route(req('/api/defi/intents/tokens'), response); assert.deepEqual(response.body, []);
});
test('foreign pages, rebinding hosts and wrong methods cannot invoke providers', async () => {
  const route = createDefiRoute({ rheaQuote: () => assert.fail('Provider must not run') });
  for (const changes of [
    { headers: { host: '127.0.0.1:4173', origin: 'https://foreign.example' } },
    { headers: { host: 'foreign.example:4173', origin: 'http://127.0.0.1:4173' } },
    { method: 'GET' },
  ]) { const response = res(); await route(req('/api/defi/rhea/quote', {}, changes), response); assert([403, 405].includes(response.status)); }
});
test('oversized payloads and unknown routes cannot invoke a provider', async () => {
  const route = createDefiRoute({ rheaQuote: () => assert.fail('Provider must not run') });
  const response = res(); await route(req('/api/defi/rhea/quote', { data: 'x'.repeat(5000) }), response); assert.equal(response.status, 400);
  const missing = res(); await route(req('/api/defi/spend'), missing); assert.equal(missing.status, 404);
  assert.equal(await route(req('/money.html'), res()), false);
});
test('provider failure stays an error instead of a successful quote', async () => {
  const route = createDefiRoute({ rheaQuote: async () => { throw new Error('No liquidity'); } });
  const response = res(); await route(req('/api/defi/rhea/quote'), response);
  assert.equal(response.status, 400); assert.equal(response.body.error, 'No liquidity');
});

test('status route accepts a bounded signed approval and never selects a quote or spending action',async()=>{
  const input={request:{data:'x'.repeat(6000)}},route=createDefiRoute({readDefiStatus:async data=>{assert.deepEqual(data,input);return {state:'pending'};},rheaQuote:()=>assert.fail('Not a quote')});
  const response=res();await route(req('/api/defi/rhea/status',input),response);assert.equal(response.status,200);assert.equal(response.body.state,'pending');
  const large=res();await route(req('/api/defi/rhea/status',{data:'x'.repeat(65536)}),large);assert.equal(large.status,400);
  const foreign=res();await route(req('/api/defi/rhea/status',input,{headers:{host:'127.0.0.1:4173',origin:'https://foreign.example'}}),foreign);assert.equal(foreign.status,403);
});

test('HTTP swap and refund reads share a minute limit and recover without dispatching',async()=>{
  let now=60000,reads=0;
  const route=createDefiRoute({readDefiStatus:async()=>{reads++;return {state:'pending'};},readDefiRefund:async()=>{reads++;return {state:'ready'};}},{now:()=>now});
  const server=http.createServer(route);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const post=name=>new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/api/defi/rhea/'+name,method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'}},response=>{
      let body='';response.setEncoding('utf8');response.on('data',chunk=>{body+=chunk;});response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(body)}));
    });request.on('error',reject);request.end('{}');
  });
  try{
    for(let i=0;i<60;i++)assert.equal((await post(i%2?'refund-status':'status')).status,200);
    for(const name of ['status','refund-status']){const limited=await post(name);assert.equal(limited.status,429);assert.match(limited.body.error,/busy/);}
    assert.equal(reads,60);
    now+=60000;assert.equal((await post('status')).status,200);assert.equal((await post('refund-status')).status,200);assert.equal(reads,62);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
