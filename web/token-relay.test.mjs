import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';import {createTokenRoute} from './token-relay.mjs';
const value={network:'ethereum',contract:'0x'+'11'.repeat(20),account:null,publicConsent:true};
const req=(data=value,headers={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify(data))]),{url:'/api/tokens/read',method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json',...headers}});
const res=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(text){this.data=JSON.parse(text);}});
const discoveryValue={network:'ethereum',account:'0x'+'22'.repeat(20),publicConsent:true};
const discoveryReq=(data=discoveryValue,headers={})=>Object.assign(req(data,headers),{url:'/api/tokens/discover'});
test('automatic metadata lookup accepts a token address only and never accepts account or RPC injection',async()=>{
 let calls=0;const route=createTokenRoute({metadata:request=>{calls++;return {request,matches:[],unavailable:[]};}}),metadataReq=(value,headers={})=>Object.assign(req(value,headers),{url:'/api/tokens/metadata'});
 for(const request of [metadataReq({contract:'wrap.near',account:discoveryValue.account}),metadataReq({contract:'https://evil.invalid'}),metadataReq({contract:'wrap.near',rpc:'https://evil.invalid'}),metadataReq({contract:'wrap.near'},{origin:'https://evil.invalid'})]){const response=res();await route(request,response);assert(response.status>=400);}assert.equal(calls,0);
 const response=res();await route(metadataReq({contract:'wrap.near'}),response);assert.equal(response.status,200);assert.equal(calls,1);
});
test('discovery HTTP boundary rejects foreign callers, invalid consent and extra fields before indexer reads',async()=>{
 let calls=0;const route=createTokenRoute({discover:()=>{calls++;return {tokens:[]};}});
 for(const request of [discoveryReq(discoveryValue,{origin:'https://evil.invalid'}),discoveryReq(discoveryValue,{host:'evil.invalid'}),discoveryReq({...discoveryValue,publicConsent:false}),discoveryReq({...discoveryValue,network:'solana'}),discoveryReq({...discoveryValue,account:null}),discoveryReq({...discoveryValue,note:'private'}),discoveryReq(discoveryValue,{'content-type':'text/plain'}),Object.assign(discoveryReq(),{method:'GET'})]){const response=res();await route(request,response);assert(response.status>=400);}assert.equal(calls,0);
 const response=res();await route(discoveryReq(),response);assert.equal(response.status,200);assert.equal(calls,1);assert.equal(response.headers['Cache-Control'],'no-store');
});
test('token HTTP boundary rejects foreign hosts/origins and injected fields before reads',async()=>{
 let calls=0;const route=createTokenRoute({read:()=>{calls++;}});
 for(const r of [req(value,{origin:'https://evil.invalid'}),req(value,{host:'evil.invalid'}),req({...value,publicConsent:false}),req({...value,note:'secret'})]){const response=res();await route(r,response);assert(response.status>=400);}assert.equal(calls,0);
});
test('concurrent identical reads coalesce, bound parallelism, retain no account cache',async()=>{
 let calls=0;const releases=[],route=createTokenRoute({read:async()=>{calls++;await new Promise(r=>releases.push(r));return {balance:'1'};}});
 const a=res(),b=res(),one=route(req(),a),two=route(req(),b);await new Promise(r=>setImmediate(r));assert.equal(calls,1);releases.shift()();await Promise.all([one,two]);assert.equal(a.status,200);assert.equal(a.headers['Cache-Control'],'no-store');
 const later=res(),again=route(req(),later);await new Promise(r=>setImmediate(r));assert.equal(calls,2);releases.shift()();await again;
 const pending=[1,2,3].map(n=>route(req({...value,account:'0x'+String(n).repeat(40)}),res()));await new Promise(r=>setImmediate(r));const busy=res();await route(req({...value,account:'0x'+'4'.repeat(40)}),busy);assert.equal(busy.status,429);releases.splice(0).forEach(r=>r());await Promise.all(pending);
});
