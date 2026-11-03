import test from 'node:test';import assert from 'node:assert/strict';
import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {readTokenWatch as read} from './token-watch.mjs';
import {tokenWatchRequest,tokenWatchSnapshot,tokenUsd,tokenDecimal,readTokenWatch,saveTokenWatch} from '../web/public/token-watch.js';
import {createIdentity} from '../web/public/peer-crypto.js';
const now=1800000000000,abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)']);
const request={network:'ethereum',contract:'0x'+'11'.repeat(20),account:'0x'+'22'.repeat(20),publicConsent:true};
function source(change={}){const calls=[];return {calls,fetcher:async(url,options)=>{const q=JSON.parse(options.body);calls.push(q);let result;
 if(q.method==='eth_chainId')result=change.chain??'0x1';
 else if(q.method==='eth_getBlockByNumber')result={number:'0x42',timestamp:'0x'+BigInt(now/1000).toString(16),transactions:Array(400).fill('0x'+'55'.repeat(32)),hash:q.params[0]==='latest'||!change.reorg?'0x'+'33'.repeat(32):'0x'+'44'.repeat(32)};
 else if(q.method==='eth_getCode')result=change.code??'0x6060';
 else {assert.equal(q.params[1].requireCanonical,true);const call=abi.parseTransaction({data:q.params[0].data});result=abi.encodeFunctionResult(call.name,[{name:change.name??'Sample',symbol:'USDC',decimals:6n,balanceOf:1234500n}[call.name]]);}
 return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));}};}
test('contract lookup reads an exact network and canonical block without sending a transaction',async()=>{
 const s=source(),v=await read(request,{fetcher:s.fetcher,clock:()=>now});assert.equal(v.balance,'1234500');assert.equal(v.price,null);assert.equal(tokenDecimal(v.balance,v.decimals),'1.2345');assert.equal(tokenDecimal('1000000',6),'1');assert.equal(v.executable,false);
 assert(s.calls.every(q=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(q.method)));assert.equal(v.request.account,request.account);
});
test('no account means no balance lookup; familiar token names cannot acquire a price',async()=>{
 const s=source(),v=await read({...request,account:null},{fetcher:s.fetcher,clock:()=>now,oracle:()=>assert.fail('Unknown token must not look up a price by symbol')});
 assert.equal(v.balance,null);assert.equal(v.price,null);assert(!s.calls.some(q=>q.method==='eth_call'&&abi.parseTransaction({data:q.params[0].data}).name==='balanceOf'));
});
test('missing consent, endpoint injection, wrong chain, missing code and reorgs fail',async()=>{
 for(const change of [{publicConsent:false},{contract:'https://evil.invalid'},{account:'bad'},{network:'constructor'},{url:'https://evil.invalid'}])assert.throws(()=>tokenWatchRequest({...request,...change}));
 for(const change of [{chain:'0x2105'},{code:'0x'},{reorg:true},{name:'bad\u202etoken'}])await assert.rejects(read(request,{fetcher:source(change).fetcher,clock:()=>now}));
});
test('snapshots bind addresses, quantities, freshness and exact contract price mapping',async()=>{
 const v=await read(request,{fetcher:source().fetcher,clock:()=>now});
 assert.throws(()=>tokenWatchSnapshot(v,{...request,account:'0x'+'55'.repeat(20)},{now}));
 assert.throws(()=>tokenWatchSnapshot({...v,balance:'-1'},request,{now}));assert.throws(()=>tokenWatchSnapshot(v,request,{now:now+60000}));
 assert.throws(()=>tokenWatchSnapshot({...v,price:{id:'ethereum:USDC',answer:'100000000',decimals:8,updatedAt:now,observedAt:now}},request,{now}));
 assert.equal(tokenUsd({...v,price:{answer:'123456789',decimals:8}}),'1.52');
});
test('watched account and balances persist encrypted, bound to the existing identity',async()=>{
 const state={identity:await createIdentity('Wallet test')};
 // Use a current timestamp on the synthetic snapshot; no native wallet is opened.
 const row={...await read(request,{fetcher:source().fetcher,clock:()=>now}),observedAt:Date.now()};
 await saveTokenWatch(state,[row]);assert(!JSON.stringify(state).includes(request.account));assert(!JSON.stringify(state).includes('1234500'));assert.equal(state.tokenWatchKey.extractable,false);assert.deepEqual(await readTokenWatch(state),[row]);
 const changed={...state,identity:await createIdentity('Other')};await assert.rejects(readTokenWatch(changed));
});
