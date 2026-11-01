import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,dnsEncode,namehash} from 'ethers';
import {nameRequest,resolveName,UNIVERSAL_RESOLVER} from './name-resolution.mjs';
import {nearImplicitAddress} from './engine-codec.mjs';
const ur=new Interface(['function resolve(bytes,bytes) view returns(bytes,address)','error ResolverNotFound(bytes)','error OffchainLookup(address,string[],bytes,bytes4,bytes)']);
const addr=new Interface(['function addr(bytes32,uint256) view returns(bytes)']);
const input=()=>({system:'ens',network:'testnet',name:'Alice.ETH'}),evm='0x'+'12'.repeat(20),resolver='0x'+'34'.repeat(20),hash='0x'+'ab'.repeat(32);
const result=value=>Response.json({jsonrpc:'2.0',id:1,result:value}),failure=data=>Response.json({jsonrpc:'2.0',id:1,error:{code:3,message:'execution reverted',data}});
function ensFetch(value=evm,calls=[]){return async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({url,options,body});
  if(body.method==='eth_chainId')return result('0x1');if(body.method==='eth_getBlockByNumber')return result({hash,number:'0x100'});
  assert.equal(body.method,'eth_call');return value instanceof Response?value:result(ur.encodeFunctionResult('resolve',[addr.encodeFunctionResult('addr',[value]),resolver]));
};}
const nearInput=()=>({system:'near',network:'testnet',name:'alice.testnet'}),nearBlock={hash:'1'.repeat(32),height:100};
const nearAccount=()=>({amount:'100',locked:'0',code_hash:'1'.repeat(32),storage_usage:0,block_hash:nearBlock.hash,block_height:100});
function nearFetch(value=nearAccount(),calls=[]){return async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});
  if(body.method==='status')return result({chain_id:'testnet'});if(body.method==='block')return result({header:nearBlock});
  assert.equal(body.method,'query');return value instanceof Response?value:result(value);
};}

test('ENS normalizes names and requests the exact Aurora coin type through the Universal Resolver at a final block',async()=>{
  const calls=[],original=input(),r=await resolveName(original,{fetchImpl:ensFetch(evm,calls)});
  assert.equal(r.state,'address_found');assert.equal(r.name,'alice.eth');assert.equal(r.chainId,1313161555);assert.equal(r.coinType,'3460645203');
  assert.equal(r.auroraAddress,evm);assert.equal(r.identityBinding,'not_verified');assert.equal(r.authority,'ethereum:mainnet');assert.equal(r.block.height,'256');
  assert.equal(calls.length,3);for(const c of calls){assert.equal(c.url,'https://ethereum-rpc.publicnode.com');assert.equal(c.options.redirect,'error');assert.equal(c.options.method,'POST');}
  assert.deepEqual(calls[1].body.params,['finalized',false]);const [call,block]=calls[2].body.params;
  assert.equal(call.to,UNIVERSAL_RESOLVER);assert.deepEqual(block,{blockHash:hash,requireCanonical:true});
  const [name,data]=ur.decodeFunctionData('resolve',call.data);assert.equal(name,dnsEncode('alice.eth'));
  assert.deepEqual([...addr.decodeFunctionData('addr',data)],[namehash('alice.eth'),3460645203n]);assert.deepEqual(original,input());
  const main=await resolveName({...input(),network:'mainnet'},{fetchImpl:ensFetch()});assert.equal(main.coinType,'3460645202');
});

test('NEAR confirms account existence at the selected final block and labels Aurora address derivation',async()=>{
  const calls=[],r=await resolveName(nearInput(),{fetchImpl:nearFetch(nearAccount(),calls)});
  assert.equal(r.state,'account_found');assert.equal(r.accountId,'alice.testnet');assert.equal(r.auroraAddress,nearImplicitAddress('alice.testnet'));
  assert.equal(r.addressKind,'derived-near-caller');assert.equal(r.identityBinding,'not_verified');
  assert.equal(calls.length,3);assert(calls.every(c=>c.url==='https://test.rpc.fastnear.com'));
  assert.deepEqual(calls[1].body.params,{finality:'final'});assert.deepEqual(calls[2].body.params,{request_type:'view_account',account_id:'alice.testnet',block_id:nearBlock.hash});
});

test('validation rejects suffix/network confusion, malformed names and extra fields before requests',async()=>{
  for(const value of [{...nearInput(),name:'alice.near'},{...nearInput(),name:'Alice.testnet'},{...nearInput(),name:'a..testnet'},
    {...input(),name:' alice.eth'},{...input(),name:'alice'},{...input(),name:'a\u202e.eth'},{...input(),name:'x'.repeat(256)},
    {...input(),network:'__proto__'},{...input(),url:'http://localhost'},{...input(),system:'dns'}]){
    await assert.rejects(resolveName(value,{fetchImpl:()=>assert.fail('Invalid names must not contact a provider')}));
  }
  assert.equal(nameRequest({...input(),name:'RaFFY🚴‍♂️.eTh'}).name.endsWith('.eth'),true);
});

test('no Aurora address remains missing without a fallback request to an Ethereum address',async()=>{
  for(const value of ['0x','0x'+'00'.repeat(20)]){const calls=[],r=await resolveName(input(),{fetchImpl:ensFetch(value,calls)});assert.equal(r.state,'no_address');assert.equal(r.auroraAddress,undefined);assert.equal(calls.length,3);}
});

test('missing ENS resolver and CCIP requirements are explicit and never fetch supplied URLs',async()=>{
  const cases=[['ResolverNotFound',[dnsEncode('alice.eth')],'not_found'],['OffchainLookup',[UNIVERSAL_RESOLVER,['http://127.0.0.1/private'],'0x','0x00000000','0x'],'offchain_required']];
  for(const [name,args,state]of cases){const calls=[],r=await resolveName(input(),{fetchImpl:ensFetch(failure(ur.encodeErrorResult(name,args)),calls)});assert.equal(r.state,state);assert.equal(calls.length,3);assert.equal(r.auroraAddress,undefined);}
});

test('NEAR missing-account errors must identify the requested name',async()=>{
  const missing=name=>failure({cause:{name:'UNKNOWN_ACCOUNT',info:{requested_account_id:name}}});
  assert.equal((await resolveName(nearInput(),{fetchImpl:nearFetch(missing('alice.testnet'))})).state,'not_found');
  assert.equal((await resolveName(nearInput(),{fetchImpl:nearFetch(missing('someone.testnet'))})).state,'unavailable');
});

test('wrong authority network and nonfinal or malformed block responses cannot resolve',async()=>{
  for(const wrong of ['0x89',null]){const valid=ensFetch();assert.equal((await resolveName(input(),{fetchImpl:async(url,options)=>JSON.parse(options.body).method==='eth_chainId'?result(wrong):valid(url,options)})).state,'unverified');}
  for(const block of [{hash,number:'0x00'},{hash:'0x1234',number:'0x1'},null]){
    assert.equal((await resolveName(input(),{fetchImpl:async(_url,options)=>result(JSON.parse(options.body).method==='eth_chainId'?'0x1':block)})).state,'unverified');
  }
  assert.equal((await resolveName(nearInput(),{fetchImpl:async()=>result({chain_id:'mainnet'})})).state,'unverified');
});

test('NEAR account responses must match the final block and retain canonical bounded values',async()=>{
  for(const change of [{block_hash:'2'.repeat(32)},{block_height:101},{amount:'00'},{locked:(1n<<128n).toString()},{code_hash:'invalid'},{storage_usage:-1}]){
    assert.equal((await resolveName(nearInput(),{fetchImpl:nearFetch({...nearAccount(),...change})})).state,'unverified');
  }
});

test('malformed ENS ABI, trailing bytes, wrong-width addresses and zero resolvers remain unverified',async()=>{
  for(const value of ['0x1234',ur.encodeFunctionResult('resolve',[addr.encodeFunctionResult('addr',[evm]),resolver])+'00',ur.encodeFunctionResult('resolve',[addr.encodeFunctionResult('addr',[evm]),resolver])+'00'.repeat(32),
    ur.encodeFunctionResult('resolve',[addr.encodeFunctionResult('addr',['0x1234']),resolver]),ur.encodeFunctionResult('resolve',[addr.encodeFunctionResult('addr',[evm]),'0x'+'00'.repeat(20)])]){
    assert.equal((await resolveName(input(),{fetchImpl:ensFetch(result(value))})).state,'unverified');
  }
});

test('transport and RPC failures never fabricate a destination',async()=>{
  for(const fetchImpl of [async()=>{throw Error('offline');},async()=>new Response('',{status:503}),async()=>failure('0x12345678')]){
    const r=await resolveName(input(),{fetchImpl});assert.equal(r.state,'unavailable');assert.equal(r.auroraAddress,undefined);
  }
});

test('RPC identity, JSON and streamed byte limits fail closed',async()=>{
  for(const value of [{jsonrpc:'2.0',id:2,result:'0x1'},{jsonrpc:'2.0',id:1,result:'0x1',error:{}},[],{jsonrpc:'2.0',id:1,error:{}}]){
    const valid=ensFetch();assert.equal((await resolveName(input(),{fetchImpl:async(url,options)=>JSON.parse(options.body).method==='eth_chainId'?Response.json(value):valid(url,options)})).state,'unverified');
  }
  let cancelled=false;
  const fetchImpl=()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}}));
  assert.equal((await resolveName(input(),{fetchImpl})).state,'unverified');assert(cancelled);
  assert.equal((await resolveName(input(),{fetchImpl:async()=>new Response('{')})).state,'unverified');
});

test('deadline covers an unresponsive fetch and body without accepting stale results',async()=>{
  assert.equal((await resolveName(input(),{timeoutMs:20,fetchImpl:()=>new Promise(()=>{})})).state,'unavailable');
  let cancelled=false;
  assert.equal((await resolveName(input(),{timeoutMs:20,fetchImpl:()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))})).state,'unavailable');assert(cancelled);
});

test('caller mutation during lookup cannot substitute a name or destination network',async()=>{
  const request=input(),fetcher=ensFetch();
  const r=await resolveName(request,{fetchImpl:(...args)=>{request.name='other.eth';request.network='mainnet';return fetcher(...args);}});
  assert.equal(r.name,'alice.eth');assert.equal(r.network,'testnet');
});
