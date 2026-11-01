import test from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {encodeCall} from './engine-codec.mjs';
import {inspectEngineTransaction,checkEngineTransaction} from './engine-receipt.mjs';
const id=n=>'1'.repeat(31)+String(n),address='0x'+'12'.repeat(20);
const reference=()=>({version:1,network:'testnet',engine:'aurora',sender:'relay.testnet',txHash:id(1),gas:'250000000000000',contract:address,value:'0',input:'0xaabb'});
const encoded=tag=>Buffer.concat([Buffer.from([7,tag]),Buffer.alloc(4),Buffer.from('0852000000000000','hex'),Buffer.alloc(4)]).toString('base64');
function transaction(tag=0){
  const ref=reference(),status={SuccessValue:encoded(tag)};
  return {final_execution_status:'FINAL',transaction:{hash:ref.txHash,signer_id:ref.sender,receiver_id:'aurora',actions:[{FunctionCall:{method_name:'call',args:encodeCall({contract:address,input:Buffer.from('aabb','hex')}).toString('base64'),gas:250000000000000,deposit:'0'}}]},
    transaction_outcome:{id:ref.txHash,outcome:{executor_id:ref.sender,receipt_ids:[id(2)],status:{SuccessReceiptId:id(2)}}},
    receipts_outcome:[{id:id(2),outcome:{executor_id:'aurora',receipt_ids:[id(3)],status}},
      {id:id(3),outcome:{executor_id:ref.sender,receipt_ids:[],status:{SuccessValue:''}}}],status};
}
const response=result=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200});

test('final Engine success binds exact call and includes finalized refund receipts',()=>{
  const tx=transaction(),original=structuredClone(tx),ref=reference();
  const result=inspectEngineTransaction(ref,tx);
  assert.equal(result.state,'evm_succeeded');assert.equal(result.finality,'FINAL');assert.equal(result.txHash,ref.txHash);
  assert.equal(result.engineReceiptId,id(2));assert.equal(result.evm.gasUsed,21000n);assert.equal(result.evm.output,'0x');
  assert.equal(result.settled,undefined);assert.deepEqual(tx,original);assert.deepEqual(ref,reference());
});

test('an EVM revert is a failure even when the NEAR call returned successfully',()=>{
  const result=inspectEngineTransaction(reference(),transaction(1));
  assert.equal(result.state,'evm_failed');assert.equal(result.evm.status,'Revert');assert.equal(result.evm.succeeded,false);
});

test('known incomplete finality states remain pending, including a hash-only status response',()=>{
  for(const state of ['NONE','INCLUDED','EXECUTED_OPTIMISTIC','INCLUDED_FINAL','EXECUTED']){
    assert.equal(inspectEngineTransaction(reference(),{final_execution_status:state}).state,'pending');
    assert.equal(inspectEngineTransaction(reference(),{...transaction(),final_execution_status:state}).state,'pending');
  }
  for(const state of [undefined,'final','UNKNOWN'])assert.throws(()=>inspectEngineTransaction(reference(),{...transaction(),final_execution_status:state}));
});

test('foreign transaction identities, extra actions and changed call bytes cannot be confirmed',()=>{
  const changes=[t=>t.transaction.hash=id(4),t=>t.transaction.signer_id='other.testnet',t=>t.transaction.receiver_id='other.testnet',
    t=>t.transaction.actions.push(t.transaction.actions[0]),t=>t.transaction.actions[0].Transfer={deposit:'1'},
    t=>t.transaction.actions[0].FunctionCall.method_name='submit',t=>t.transaction.actions[0].FunctionCall.deposit='1',
    t=>t.transaction.actions[0].FunctionCall.gas=1,t=>t.transaction.actions[0].FunctionCall.gas='0250000000000000',
    t=>t.transaction.actions[0].FunctionCall.args+='\n',t=>t.transaction.actions[0].FunctionCall.args=encodeCall({contract:'0x'+'34'.repeat(20)}).toString('base64'),
    t=>t.transaction_outcome.id=id(4),t=>t.transaction_outcome.outcome.executor_id='other.testnet'];
  for(const change of changes){const tx=transaction();change(tx);assert.throws(()=>inspectEngineTransaction(reference(),tx));}
});

test('receipt graph must be complete, bounded, acyclic and contain no unrelated or duplicate outcomes',()=>{
  const changes=[t=>t.receipts_outcome.pop(),t=>t.receipts_outcome.push(structuredClone(t.receipts_outcome[0])),
    t=>t.receipts_outcome[1].id=id(4),t=>t.receipts_outcome[1].outcome.receipt_ids=[id(2)],
    t=>t.receipts_outcome[0].outcome.receipt_ids.push(id(3)),t=>t.transaction_outcome.outcome.receipt_ids.push(id(3)),
    t=>t.receipts_outcome[0].outcome.receipt_ids=[],t=>t.receipts_outcome=Array(129).fill(t.receipts_outcome[0]),
    t=>delete t.receipts_outcome[0].outcome.receipt_ids,t=>t.receipts_outcome[0].outcome.status='Unknown',
    t=>t.receipts_outcome[0].outcome.status={SuccessValue:encoded(0),Failure:{}},t=>t.receipts_outcome[1].outcome.status={Failure:null}];
  for(const change of changes){const tx=transaction();change(tx);assert.throws(()=>inspectEngineTransaction(reference(),tx));}
});

test('return links must be direct children and summaries must match the actual return outcome',()=>{
  const changes=[t=>t.status={Failure:{message:'invented'}},t=>t.status={SuccessValue:encoded(1)},
    t=>t.transaction_outcome.outcome.status={SuccessReceiptId:id(3)},
    t=>{t.transaction_outcome.outcome.status={SuccessReceiptId:id(3)};t.receipts_outcome[1].outcome.executor_id='aurora';t.receipts_outcome[1].outcome.status=t.status;},
    t=>t.receipts_outcome[0].outcome.status={SuccessReceiptId:id(2)},
    t=>t.receipts_outcome[0].outcome.executor_id='other.testnet'];
  for(const change of changes){const tx=transaction();change(tx);assert.throws(()=>inspectEngineTransaction(reference(),tx));}
});

test('NEAR failure and failed side receipts never count as complete execution',()=>{
  const failed=transaction();failed.receipts_outcome[0].outcome.status={Failure:{ActionError:{kind:'FunctionCallError'}}};failed.status=failed.receipts_outcome[0].outcome.status;
  assert.equal(inspectEngineTransaction(reference(),failed).state,'near_failed');
  const sibling=transaction();sibling.receipts_outcome[1].outcome.status={Failure:{ActionError:{kind:'refund failed'}}};
  const result=inspectEngineTransaction(reference(),sibling);assert.equal(result.state,'needs_review');assert.deepEqual(result.failedReceiptIds,[id(3)]);
});

test('non-Engine return bytes, noncanonical base64 and oversized outputs fail closed',()=>{
  for(const bytes of ['','%%%','AA','AA==\n',Buffer.from('true').toString('base64'),Buffer.alloc(65537).toString('base64')]){
    const tx=transaction();tx.status={SuccessValue:bytes};tx.receipts_outcome[0].outcome.status=tx.status;
    assert.throws(()=>inspectEngineTransaction(reference(),tx));
  }
});

test('reference validation rejects wrong domains, unbounded values and unexpected fields before any request',async()=>{
  const changes=[{network:'mainnet'},{engine:'evil.testnet'},{sender:'alice.near'},{txHash:'../escape'},{value:'00'},{value:1},
    {value:(1n<<256n).toString()},{input:'0x1'},{input:'0x'+'00'.repeat(32769)},{gas:'300000000000001'},
    {gas:250000000000000},{extra:'unreviewed'}];
  for(const change of changes){await assert.rejects(checkEngineTransaction({...reference(),...change},{fetchImpl:()=>assert.fail('No network for invalid references')}));}
});

test('status lookup sends one read-only hash request and snapshots its reference',async()=>{
  let calls=0;const ref=reference();
  const result=await checkEngineTransaction(ref,{fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'https://test.rpc.fastnear.com');assert.equal(options.redirect,'error');
    assert.deepEqual(JSON.parse(options.body),{jsonrpc:'2.0',id:1,method:'tx',params:{tx_hash:id(1),sender_account_id:'relay.testnet',wait_until:'FINAL'}});
    ref.txHash=id(4);return response(transaction());
  }});
  assert.equal(result.state,'evm_succeeded');assert.equal(result.txHash,id(1));assert.equal(calls,1);
});

test('lost reply, unknown transaction and HTTP errors retain unavailable state without resending',async()=>{
  for(const fetchImpl of [async()=>{throw Error('connection lost');},async()=>new Response('',{status:503}),
    async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{code:-32000,message:'Server error',data:{cause:{name:'TIMEOUT_ERROR'}}}}))]){
    let calls=0;const result=await checkEngineTransaction(reference(),{fetchImpl:(...args)=>{calls++;return fetchImpl(...args);}});
    assert.equal(result.state,'unavailable');assert.equal(calls,1);assert.equal(result.retryAuthorized,undefined);
  }
  assert.equal((await checkEngineTransaction(reference(),{fetchImpl:async()=>response(transaction())})).state,'evm_succeeded');
});

test('malformed RPC envelopes, oversized streamed data and body deadlines cannot confirm a call',async()=>{
  for(const value of [{jsonrpc:'2.0',id:2,result:transaction()},{jsonrpc:'1.0',id:1,result:transaction()},
    {jsonrpc:'2.0',id:1,result:transaction(),error:{}},{jsonrpc:'2.0',id:1},[]]){
    assert.equal((await checkEngineTransaction(reference(),{fetchImpl:async()=>new Response(JSON.stringify(value))})).state,'unverified');
  }
  let cancelled=false;
  const large=()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(65536));},cancel(){cancelled=true;}}));
  assert.equal((await checkEngineTransaction(reference(),{fetchImpl:large})).state,'unverified');assert(cancelled);
  const stalled=async(_url,{signal})=>new Response(new ReadableStream({start(c){signal.addEventListener('abort',()=>c.error(signal.reason),{once:true});}}));
  assert.equal((await checkEngineTransaction(reference(),{fetchImpl:stalled,timeoutMs:20})).state,'unavailable');
});

test('positive boundaries preserve full-width call value, gas strings and implicit senders',()=>{
  const ref=reference(),tx=transaction();ref.value=((1n<<256n)-1n).toString();ref.input='0x'+'ab'.repeat(32768);ref.gas='300000000000000';
  ref.sender='a'.repeat(64);tx.transaction.signer_id=ref.sender;tx.transaction_outcome.outcome.executor_id=ref.sender;
  tx.transaction.actions[0].FunctionCall.gas=ref.gas;
  tx.transaction.actions[0].FunctionCall.args=encodeCall({contract:ref.contract,value:BigInt(ref.value),input:Buffer.from(ref.input.slice(2),'hex')}).toString('base64');
  assert.equal(inspectEngineTransaction(ref,tx).state,'evm_succeeded');
});

test('a valid promise return chain is followed and a root failure remains a NEAR failure',()=>{
  const tx=transaction(),first=tx.receipts_outcome[0];
  first.outcome.receipt_ids.push(id(4));first.outcome.status={SuccessReceiptId:id(4)};
  tx.receipts_outcome.push({id:id(4),outcome:{executor_id:'aurora',receipt_ids:[],status:tx.status}});
  assert.equal(inspectEngineTransaction(reference(),tx).engineReceiptId,id(4));
  const failed=transaction();failed.status={Failure:{InvalidTxError:'fixture'}};
  failed.receipts_outcome=[];failed.transaction_outcome.outcome={executor_id:'relay.testnet',receipt_ids:[],status:failed.status};
  assert.equal(inspectEngineTransaction(reference(),failed).state,'near_failed');
});

test('wrong-width hashes and invalid reference numbers are rejected before lookup',async()=>{
  for(const change of [{txHash:'2'.repeat(32)},{txHash:'z'.repeat(44)},{sender:'a..testnet'},{gas:'0'},
    {value:'1'.repeat(79)},{contract:'0x1234'},{version:2}]){
    await assert.rejects(checkEngineTransaction({...reference(),...change},{fetchImpl:()=>assert.fail('Must validate first')}));
  }
});

test('successful EVM return bytes do not imply token transfer or payment settlement',()=>{
  const tx=transaction(),output=Buffer.alloc(32),length=Buffer.alloc(4);length.writeUInt32LE(output.length);
  const value=Buffer.concat([Buffer.from([7,0]),length,output,Buffer.alloc(8),Buffer.alloc(4)]).toString('base64');
  tx.status={SuccessValue:value};tx.receipts_outcome[0].outcome.status=tx.status;
  const result=inspectEngineTransaction(reference(),tx);assert.equal(result.state,'evm_succeeded');
  assert.equal(result.evm.output,'0x'+'00'.repeat(32));assert.equal(result.settled,undefined);
});

test('malformed Engine output and JSON are unverified rather than a transport failure',async()=>{
  const tx=transaction();tx.status={SuccessValue:Buffer.from([7,18,1,0,0,0,255]).toString('base64')};tx.receipts_outcome[0].outcome.status=tx.status;
  for(const fetchImpl of [async()=>response(tx),async()=>new Response('{'),async()=>new Response(new Uint8Array([255])),
    async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,error:{}}))]){
    assert.equal((await checkEngineTransaction(reference(),{fetchImpl})).state,'unverified');
  }
});

test('the deadline bounds fetch and streams even when a transport ignores abort',async()=>{
  assert.equal((await checkEngineTransaction(reference(),{timeoutMs:20,fetchImpl:()=>new Promise(()=>{})})).state,'unavailable');
  let cancelled=false;
  const result=await checkEngineTransaction(reference(),{timeoutMs:20,fetchImpl:()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
  assert.equal(result.state,'unavailable');assert(cancelled);
});

test('the status transport rejects actual HTTP redirects without following them',async()=>{
  let followed=false;
  const server=createServer((req,res)=>{if(req.url==='/destination'){followed=true;res.end('{}');}else{res.writeHead(302,{location:'/destination'});res.end();}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const local=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await checkEngineTransaction(reference(),{fetchImpl:(_url,options)=>fetch(local,options)})).state,'unavailable');assert.equal(followed,false);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('the status deadline aborts an actual HTTP body after its headers arrive',async()=>{
  let bodyStarted=false;
  const server=createServer((_req,res)=>{res.writeHead(200);res.write('{');bodyStarted=true;});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const local=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await checkEngineTransaction(reference(),{timeoutMs:250,fetchImpl:(_url,options)=>fetch(local,options)})).state,'unavailable');assert(bodyStarted);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
