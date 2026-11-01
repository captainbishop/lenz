import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {checkEngineAccessKey} from './engine-access.mjs';
import {validateSignedEngineCall} from './engine-signed.mjs';
import {EngineJournal} from './engine-journal.mjs';
import {fixture,operation,rpcFixture,accessKey,response,finalTransaction} from './engine-submission-fixtures.mjs';
const restricted=(changes={})=>({FunctionCall:{receiver_id:'aurora',method_names:['call'],allowance:null,...changes}});
const writes=rpc=>rpc.requests.filter(r=>r.method==='send_tx');
function setup(t){
  const directory=mkdtempSync(join(tmpdir(),'lenz-engine-access-')),journal=new EngineJournal(directory),f=fixture();
  journal.record(operation,f.reference,f.signedTxBase64);
  t.after(()=>{journal.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,journal,f};
}
test('full and restricted keys are queried for the exact signed sender and public key at finality',async()=>{
  for(const permission of ['FullAccess',restricted(),restricted({method_names:[]}),restricted({method_names:['view','call'],allowance:'340282366920938463463374607431768211455'})]){
    const f=fixture(),signed=validateSignedEngineCall(f.reference,f.signedTxBase64),rpc=rpcFixture({access:{...accessKey(),permission}});
    const result=await checkEngineAccessKey(f.reference,f.signedTxBase64,rpc);
    assert.equal(result.state,'permitted');assert.equal(result.txHash,f.reference.txHash);
    assert.equal(result.permission,permission==='FullAccess'?'FullAccess':'FunctionCall');
    assert.equal(result.allowance,permission==='FullAccess'?null:permission.FunctionCall.allowance);
    assert.deepEqual(rpc.requests.map(r=>[r.method,r.params]),[['query',{request_type:'view_access_key',finality:'final',account_id:f.reference.sender,public_key:signed.publicKey}]]);
  }
});
test('receiver, exact method and zero allowance restrictions stop access',async()=>{
  for(const [changes,reason] of [[{receiver_id:'other.testnet'},'receiver_not_permitted'],[{method_names:['Call']},'method_not_permitted'],[{method_names:['view']},'method_not_permitted'],[{allowance:'0'},'allowance_exhausted']]){
    const f=fixture(),rpc=rpcFixture({access:{...accessKey(),permission:restricted(changes)}});
    assert.equal((await checkEngineAccessKey(f.reference,f.signedTxBase64,rpc)).reason,reason);
  }
});
test('nonce checks retain integer precision and enforce the recorded height boundary',async()=>{
  for(const [nonce,current,height,state,reason] of [
    [1n,1,1000,'blocked','nonce_used'],[1n,2,1000,'blocked','nonce_used'],
    [999999999n,0,1000,'permitted',undefined],[1000000000n,0,1000,'blocked','nonce_too_large'],
    [9007199254740992n,9007199254740991,10000000000,'permitted',undefined],
    [(1n<<64n)-1n,0,Number.MAX_SAFE_INTEGER,'blocked','nonce_too_large']
  ]){
    const f=fixture({wire:{nonce}}),rpc=rpcFixture({access:{...accessKey(),nonce:current,block_height:height}});
    const result=await checkEngineAccessKey(f.reference,f.signedTxBase64,rpc);
    assert.equal(result.state,state);assert.equal(result.reason,reason);
  }
});
test('malformed and unsupported permission evidence stays unverified',async()=>{
  const bad=[
    {nonce:9007199254740992},{nonce:1.5},{nonce:-1},{nonce:'0'},{block_hash:'1'},{block_hash:'z'.repeat(44)},
    {block_height:0},{block_height:1.5},{extra:true},{permission:null},{permission:{}},
    {permission:{GasKeyFullAccess:{balance:'1',num_nonces:2}}},{permission:{FullAccess:{}}},
    {permission:restricted({method_names:'call'})},{permission:restricted({method_names:[1]})},
    {permission:restricted({method_names:Array(129).fill('call')})},{permission:restricted({method_names:['x'.repeat(257)]})},
    {permission:restricted({allowance:1})},{permission:restricted({allowance:'01'})},
    {permission:restricted({allowance:'-1'})},{permission:restricted({allowance:(1n<<128n).toString()})},
    {permission:restricted({extra:true})}
  ];
  for(const change of bad){
    const f=fixture(),rpc=rpcFixture({access:{...accessKey(),...change}});
    assert.equal((await checkEngineAccessKey(f.reference,f.signedTxBase64,rpc)).state,'unverified',JSON.stringify(change));
  }
});
test('invalid signed input is rejected before any query and reference mutation cannot redirect the query',async()=>{
  const f=fixture(),rpc=rpcFixture(),original={...f.reference};
  await assert.rejects(checkEngineAccessKey(f.reference,'AA==',rpc));assert.equal(rpc.requests.length,0);
  const result=await checkEngineAccessKey(f.reference,f.signedTxBase64,{fetchImpl:async(url,init)=>{
    f.reference.sender='other.testnet';f.reference.txHash='1'.repeat(32);
    return rpc.fetchImpl(url,init);
  }});
  assert.equal(result.txHash,original.txHash);assert.equal(rpc.requests[0].params.account_id,original.sender);
});
test('denied, missing and malformed key reads leave the original prepared record without an attempt',async t=>{
  for(const access of [{...accessKey(),permission:restricted({method_names:['view']})},Error('UNKNOWN_ACCESS_KEY'),{}]){
    const {journal,f}=setup(t),rpc=rpcFixture({access}),before=journal.inspect(operation);
    const result=await journal.send(operation,rpc);
    assert.equal(writes(rpc).length,0);assert(result.preflight);assert.notEqual(result.preflight.state,'permitted');
    assert.deepEqual(journal.inspect(operation),before);assert.equal(result.txHash,f.reference.txHash);
  }
});
test('explicit retry rechecks permissions while ordinary receipt recovery survives revoked keys',async t=>{
  const {journal,f}=setup(t);await journal.send(operation,rpcFixture());
  const revoked=rpcFixture({access:Error('UNKNOWN_ACCESS_KEY')});
  const denied=await journal.send(operation,{...revoked,retry:true});
  assert.equal(writes(revoked).length,0);assert.equal(denied.preflight?.state,'unavailable');assert.equal(denied.attempts,1);
  assert.deepEqual(revoked.requests.map(r=>r.method),['tx','status','query']);
  const recovered=rpcFixture({read:finalTransaction(f.reference),access:Error('Revoked')});
  const result=await journal.send(operation,recovered);
  assert.equal(result.outcome.state,'evm_succeeded');assert.deepEqual(recovered.requests.map(r=>r.method),['tx']);
});
test('permissions are not cached and an explicit retry still sends only the original bytes',async t=>{
  const {journal,f}=setup(t),blocked=rpcFixture({access:{...accessKey(),nonce:1}});
  assert.equal((await journal.send(operation,blocked)).preflight?.reason,'nonce_used');
  const allowed=rpcFixture();await journal.send(operation,allowed);
  await journal.send(operation,{...allowed,retry:true});
  assert.equal(allowed.requests.filter(r=>r.method==='query').length,2);
  assert.deepEqual(writes(allowed).map(r=>r.params.signed_tx_base64),[f.signedTxBase64,f.signedTxBase64]);
});
test('a final receipt arriving during the access query prevents a concurrent send',async t=>{
  const {journal,directory,f}=setup(t),second=new EngineJournal(directory),rpc=rpcFixture();
  try{
    const fetchImpl=async(url,init)=>{
      if(JSON.parse(init.body).method==='query')await second.check(operation,rpcFixture({read:finalTransaction(f.reference)}));
      return rpc.fetchImpl(url,init);
    };
    const result=await journal.send(operation,{fetchImpl});
    assert.equal(result.outcome.state,'evm_succeeded');assert.equal(result.attempts,0);assert.equal(writes(rpc).length,0);
  }finally{second.close();}
});
test('actual access-key HTTP errors, redirects, unsafe integers and body limits prevent dispatch',async t=>{
  let mode='missing',sends=0,followed=0;
  const server=createServer(async(req,res)=>{
    if(req.url==='/redirect'){followed++;res.end('{}');return;}
    let raw='';for await(const chunk of req)raw+=chunk;
    const request=JSON.parse(raw);
    if(request.method==='status'){res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:{chain_id:'testnet'}}));return;}
    if(request.method==='send_tx'){sends++;res.end('{}');return;}
    if(mode==='missing'){res.end(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'Server error',data:{name:'UNKNOWN_ACCESS_KEY'}}}));return;}
    if(mode==='redirect'){res.writeHead(302,{location:'/redirect'});res.end();return;}
    if(mode==='overflow'){res.end(' '.repeat(256*1024+1));return;}
    if(mode==='stall'){res.writeHead(200);res.write('{');return;}
    res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:{...accessKey(),nonce:9007199254740992}}));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    for(const [kind,state] of [['missing','unavailable'],['redirect','unavailable'],['overflow','unverified'],['stall','unavailable'],['unsafe','unverified']]){
      mode=kind;const {journal}=setup(t);
      const result=await journal.send(operation,{timeoutMs:250,fetchImpl:(_url,init)=>fetch('http://127.0.0.1:'+server.address().port,init)});
      assert.equal(sends,0);assert.equal(result.preflight?.state,state);assert.equal(result.attempts,0);assert.equal(journal.inspect(operation).outcome.state,'prepared');
    }
    assert.equal(sends,0);assert.equal(followed,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('a final receipt takes priority over a concurrent rejected access query',async t=>{
  const {journal,directory,f}=setup(t),second=new EngineJournal(directory),rpc=rpcFixture({access:{...accessKey(),nonce:1}});
  try{
    const result=await journal.send(operation,{fetchImpl:async(url,init)=>{
      if(JSON.parse(init.body).method==='query')await second.check(operation,rpcFixture({read:finalTransaction(f.reference)}));
      return rpc.fetchImpl(url,init);
    }});
    assert.equal(result.outcome.state,'evm_succeeded');assert.equal(result.preflight,undefined);
    assert.equal(result.attempts,0);assert.equal(writes(rpc).length,0);
  }finally{second.close();}
});
