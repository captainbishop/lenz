import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {createDegenQuoteRoute} from './degen-quote-relay.mjs';
import {quoteFixture,account} from './degen-preflight-fixtures.mjs';
const input={kind:'pool',network:'base',pool:'0x'+'22'.repeat(20),token:'0x'+'11'.repeat(20),privacy:'public'};
function request(body=input,change={}){return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{method:'POST',url:'/api/degen/quote',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'},...change});}
function response(){return Object.assign(new EventEmitter(),{writeHead(status,headers){this.status=status;this.headers=headers;},end(value){this.value=JSON.parse(value);}});}
test('Degen quote endpoint requires same-origin public reads and bounded fields',async()=>{
 let calls=0;const route=createDegenQuoteRoute({readPair:async()=>{calls++;return {ok:true};}});
 for(const body of [{...input,privacy:'private'},{...input,network:'solana'},{...input,url:'https://bad.test'},{...input,amount:'1'},{...input,extra:'x'.repeat(1100)}]){const res=response();await route(request(body),res);assert.equal(res.status,400);}
 const foreign=response();await route(request(input,{headers:{host:'127.0.0.1:4173',origin:'https://bad.test'}}),foreign);assert.equal(foreign.status,403);assert.equal(calls,0);
 const good=response();await route(request(),good);assert.equal(good.status,200);assert.equal(good.headers['Cache-Control'],'no-store');assert.equal(calls,1);
});
test('duplicate quotes coalesce, distinct reads are bounded and closing the last viewer aborts work',async()=>{
 const pending=[];const route=createDegenQuoteRoute({readPair:async(r,{signal})=>new Promise((resolve,reject)=>{pending.push({r,signal,resolve});signal.addEventListener('abort',()=>reject(signal.reason));})});
 const a=response(),b=response(),c=response(),first=route(request(),a),duplicate=route(request(),b),second=route(request({...input,pool:'0x'+'33'.repeat(20)}),c);await new Promise(setImmediate);assert.equal(pending.length,2);
 const busy=response();await route(request({...input,pool:'0x'+'44'.repeat(20)}),busy);assert.equal(busy.status,429);
 a.destroyed=true;a.emit('close');assert.equal(pending[0].signal.aborted,false);b.destroyed=true;b.emit('close');assert.equal(pending[0].signal.aborted,true);pending[1].resolve({ok:true});await Promise.all([first,duplicate,second]);
 assert.equal(c.status,200);
});
test('upstream errors are sanitized and the next request can retry',async()=>{
 let calls=0;const route=createDegenQuoteRoute({readPair:async()=>{if(!calls++)throw Error('private upstream details');return {ok:true};}});
 const bad=response();await route(request(),bad);assert.equal(bad.status,502);assert(!JSON.stringify(bad.value).includes('private upstream'));
 const retry=response();await route(request(),retry);assert.equal(retry.status,200);
});

test('wallet preflight rejects foreign requests, extra authority, missing consent and stale quotes before reads',async()=>{
 let calls=0;const route=createDegenQuoteRoute({preflight:async r=>{calls++;return {account:r.account};}}),body={quote:quoteFixture(),account,privacy:'public'},endpoint={url:'/api/degen/preflight'};
 for(const bad of [{...body,privacy:'private'},{...body,account:'0x'+'00'.repeat(20)},{...body,transaction:{to:account}},{...body,quote:{...body.quote,expiresAt:Date.now()-1}},{...body,extra:'x'.repeat(8192)}]){const res=response();await route(request(bad,endpoint),res);assert.equal(res.status,400);}
 const foreign=response();await route(request(body,{...endpoint,headers:{host:'127.0.0.1:4173',origin:'https://bad.test','content-type':'application/json'}}),foreign);assert.equal(foreign.status,403);assert.equal(calls,0);
 const good=response();await route(request(body,endpoint),good);assert.equal(good.status,200);assert.equal(good.headers['Cache-Control'],'no-store');assert.equal(good.value.account,account);assert.equal(calls,1);
});

test('wallet checks coalesce only identical accounts and share the quote concurrency limit and cancellation',async()=>{
 const pending=[],read=async(r,{signal})=>new Promise((resolve,reject)=>{pending.push({r,signal,resolve});signal.addEventListener('abort',()=>reject(signal.reason));}),route=createDegenQuoteRoute({preflight:read,readPair:read}),body={quote:quoteFixture(),account,privacy:'public'},endpoint={url:'/api/degen/preflight'};
 const a=response(),b=response(),c=response(),first=route(request(body,endpoint),a),duplicate=route(request(body,endpoint),b),other=route(request({...body,account:'0x'+'44'.repeat(20)},endpoint),c);await new Promise(setImmediate);assert.equal(pending.length,2);
 const full=response();await route(request(),full);assert.equal(full.status,429);
 a.destroyed=true;a.emit('close');assert.equal(pending[0].signal.aborted,false);b.destroyed=true;b.emit('close');assert.equal(pending[0].signal.aborted,true);pending[1].resolve({account:pending[1].r.account});await Promise.all([first,duplicate,other]);assert.equal(c.value.account,'0x'+'44'.repeat(20));
 const pair=response(),next=route(request(),pair);await new Promise(setImmediate);pending[2].resolve({ok:true});await next;assert.equal(pair.status,200);
});

test('wallet simulation failures hide upstream details and release their slot for retry',async()=>{
 let calls=0;const route=createDegenQuoteRoute({preflight:async()=>{if(!calls++)throw Error('private RPC account details');return {ok:true};}}),body={quote:quoteFixture(),account,privacy:'public'},endpoint={url:'/api/degen/preflight'};
 const bad=response();await route(request(body,endpoint),bad);assert.equal(bad.status,502);assert.equal(bad.value.error,'Wallet simulation unavailable. Refresh the quote and try again.');
 const retry=response();await route(request(body,endpoint),retry);assert.equal(retry.status,200);
});
