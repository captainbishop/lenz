import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectEngineTransfer,checkEngineTransfer} from './engine-transfer.mjs';
import {transferFixture,transferReceipt,abi} from './engine-transfer-fixtures.mjs';
import {response} from './engine-submission-fixtures.mjs';
const inspect=(f,options={})=>inspectEngineTransfer(f.reference,f.payment,transferReceipt(f.reference,{logs:[f.log],...options}));
test('a strict transfer reports exact base units and addresses, including full-width uint256',()=>{
  for(const amount of ['1','1000000',((1n<<256n)-1n).toString()]){
    const f=transferFixture(amount),r=inspect(f);
    assert.equal(r.execution.state,'evm_succeeded');assert.deepEqual(r.transfer,{state:'reported',token:f.payment.token,from:f.payment.from,to:f.payment.to,amount});
    assert.equal(r.settled,undefined);assert.equal(r.transfer.settled,undefined);
  }
});
test('domain, token, caller, recipient and amount expectations must independently match the exact call',()=>{
  const f=transferFixture(),tx=transferReceipt(f.reference,{logs:[f.log]});
  for(const changes of [{version:2},{network:'mainnet'},{engine:'other'},{token:f.payment.to},{from:f.payment.to},{from:f.payment.token},{to:f.payment.token},{amount:'2'},{extra:true}]){
    assert.throws(()=>inspectEngineTransfer(f.reference,{...f.payment,...changes},tx));
  }
  for(const changes of [{contract:f.payment.to},{sender:'other.testnet'},{value:'1'},{input:'0x095ea7b3'+f.reference.input.slice(10)},{input:f.reference.input+'00'},{input:f.reference.input.slice(0,-2)}]){
    assert.throws(()=>inspectEngineTransfer({...f.reference,...changes},f.payment,tx));
  }
});
test('zero, self, malformed and unsafe payment expectations are rejected before lookup',async()=>{
  const f=transferFixture();let calls=0;const options={fetchImpl:async()=>{calls++;throw Error('No network expected');}};
  for(const changes of [{amount:'0'},{amount:'01'},{amount:'-1'},{amount:1},{amount:'1.0'},{amount:(1n<<256n).toString()},{to:f.payment.from},{token:'0x'+'00'.repeat(20)},{to:'0x'+'AB'.repeat(20)},{from:'0x123'}]){
    await assert.rejects(checkEngineTransfer(f.reference,{...f.payment,...changes},options));
  }
  assert.equal(calls,0);
});
test('false, absent, noncanonical and extra return data never become a reported transfer',()=>{
  const f=transferFixture();
  assert.equal(inspect(f,{output:abi.encodeFunctionResult('transfer',[false])}).transfer.state,'not_reported');
  for(const output of ['0x','0x01','0x'+'0'.repeat(63)+'2',abi.encodeFunctionResult('transfer',[true])+'00']){
    const r=inspect(f,{output});assert.equal(r.transfer.state,'unverified');assert.equal(r.transfer.reason,'unsupported_return');
  }
});
test('wrong log emitter, topic layout, parties and amount cannot confirm a transfer',()=>{
  const f=transferFixture();
  for(const change of [{address:f.payment.to},{topics:f.log.topics.slice(0,2)},{topics:[...f.log.topics,'0x'+'0'.repeat(64)]},
    {topics:[f.log.topics[0],f.log.topics[2],f.log.topics[1]]},{topics:[f.log.topics[0],'0x01'+f.log.topics[1].slice(4),f.log.topics[2]]},
    {data:'0x'+'0'.repeat(63)+'1'},{data:f.log.data+'00'}]){
    assert.equal(inspect(f,{logs:[{...f.log,...change}]}).transfer.state,'unverified');
  }
  for(const topics of [[f.log.topics[0],'0x'+'0'.repeat(64),f.log.topics[2]],[f.log.topics[0],f.log.topics[1],'0x'+'0'.repeat(64)]]){
    assert.equal(inspect(f,{logs:[{...f.log,topics}]}).transfer.state,'unverified');
  }
});
test('missing, duplicate and additional token transfers require review; unrelated events do not substitute',()=>{
  const f=transferFixture(),unrelated={address:f.payment.token,topics:['0x'+'77'.repeat(32)],data:'0x'};
  for(const logs of [[],[unrelated],[f.log,f.log],[f.log,{...f.log,address:f.payment.to}]]){
    assert.equal(inspect(f,{logs}).transfer.reason,'transfer_log_count');
  }
  assert.equal(inspect(f,{logs:[unrelated,f.log]}).transfer.state,'reported');
});
test('pending, failed and side-receipt outcomes never report a completed transfer',()=>{
  const f=transferFixture();
  for(const status of ['NONE','INCLUDED','EXECUTED','EXECUTED_OPTIMISTIC','INCLUDED_FINAL']){
    const r=inspectEngineTransfer(f.reference,f.payment,{final_execution_status:status});
    assert.equal(r.execution.state,'pending');assert.equal(r.transfer.state,'unconfirmed');
  }
  assert.equal(inspect(f,{tag:1}).transfer.reason,'evm_failed');
  assert.equal(inspect(f,{sideFailure:true}).transfer.reason,'needs_review');
  const tx=transferReceipt(f.reference,{logs:[f.log]}),failure={Failure:{ActionError:{kind:'fixture failure'}}};
  tx.status=failure;tx.receipts_outcome[0].outcome.status=failure;
  assert.equal(inspectEngineTransfer(f.reference,f.payment,tx).transfer.reason,'near_failed');
});
test('incomplete final receipts and a substituted transaction cannot bypass the receipt verifier',()=>{
  const f=transferFixture(),tx=transferReceipt(f.reference,{logs:[f.log]});
  tx.receipts_outcome.pop();assert.throws(()=>inspectEngineTransfer(f.reference,f.payment,tx));
  const changed=transferReceipt(f.reference,{logs:[f.log]});changed.transaction.hash='1'.repeat(32);
  assert.throws(()=>inspectEngineTransfer(f.reference,f.payment,changed));
});
test('read-only lookup snapshots both expectations and preserves unavailable or unverified evidence',async()=>{
  const f=transferFixture(),original=structuredClone(f),tx=transferReceipt(f.reference,{logs:[f.log]});let calls=0;
  const r=await checkEngineTransfer(f.reference,f.payment,{fetchImpl:async(url,init)=>{
    calls++;assert.equal(url,'https://test.rpc.fastnear.com');const body=JSON.parse(init.body);
    assert.equal(body.method,'tx');assert.equal(body.params.tx_hash,original.reference.txHash);
    f.payment.amount='99';f.reference.value='99';return response(tx);
  }});
  assert.equal(calls,1);assert.equal(r.transfer.amount,original.payment.amount);
  const absent=await checkEngineTransfer(original.reference,original.payment,{fetchImpl:async()=>{throw Error('Offline');}});
  assert.equal(absent.execution.state,'unavailable');assert.equal(absent.transfer.state,'unconfirmed');
  const bad=await checkEngineTransfer(original.reference,original.payment,{fetchImpl:async()=>response({final_execution_status:'FINAL'})});
  assert.equal(bad.execution.state,'unverified');assert.equal(bad.transfer.state,'unconfirmed');
});

test('an exact event with a failed side receipt cannot be reported as a transfer',()=>{
  const f=transferFixture(),result=inspect(f,{sideFailure:true});
  assert.equal(result.transfer.state,'unconfirmed');assert.equal(result.transfer.reason,'needs_review');
});
