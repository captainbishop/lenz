import assert from 'node:assert/strict';
import {encodeCall,decodeSubmitResult,MAX_ENGINE_BYTES} from './engine-codec.mjs';

const ENDPOINT='https://test.rpc.fastnear.com',MAX_RPC_BYTES=256*1024,MAX_RECEIPTS=128;
const pending=new Set(['NONE','INCLUDED','EXECUTED_OPTIMISTIC','INCLUDED_FINAL','EXECUTED']);
const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const account=value=>typeof value==='string' && value.length>=2 && value.length<=64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(value);
function keys(value,expected){assert(object(value) && Object.keys(value).length===expected.length && expected.every(key=>Object.hasOwn(value,key)),'Unexpected fields');}
function hash(value){
  assert(typeof value==='string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),'Invalid hash');
  const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n=0n;for(const char of value)n=n*58n+BigInt(alphabet.indexOf(char));
  const leading=value.match(/^1*/)[0].length,bytes=n===0n?0:Math.ceil(n.toString(16).length/2);
  assert(leading+bytes===32,'Hash must encode 32 bytes');
}
function decimal(value,max){assert(typeof value==='string' && /^(?:0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value)<=max,'Invalid unsigned integer');return BigInt(value);}
function base64(value){
  assert(typeof value==='string' && value.length<=4*Math.ceil(MAX_ENGINE_BYTES/3),'Result exceeds byte limit');
  const bytes=Buffer.from(value,'base64');
  assert(bytes.length<=MAX_ENGINE_BYTES && bytes.toString('base64')===value,'Noncanonical base64');return bytes;
}
function validate(reference,maxGas=300000000000000n){
  assert(typeof maxGas==='bigint'&&maxGas>0n&&maxGas<=1000000000000000n,'Invalid Engine gas ceiling');
  keys(reference,['version','network','engine','sender','txHash','gas','contract','value','input']);
  const ref={...reference};
  assert(ref.version===1 && ref.network==='testnet' && ref.engine==='aurora','Unsupported Engine domain');
  assert(account(ref.sender) && (ref.sender.endsWith('.testnet') || /^[0-9a-f]{64}$/.test(ref.sender)),'Expected a testnet sender');
  hash(ref.txHash);assert(decimal(ref.gas,maxGas)>0n,'Gas must be positive');
  const value=decimal(ref.value,(1n<<256n)-1n);
  assert(typeof ref.input==='string' && ref.input.length<=65538 && /^0x(?:[0-9a-fA-F]{2})*$/.test(ref.input),'Invalid calldata');
  const args=encodeCall({contract:ref.contract,value,input:Buffer.from(ref.input.slice(2),'hex')}).toString('base64');
  return {ref,args};
}
function inspect({ref,args},tx){
  assert(object(tx),'Invalid transaction response');
  if(pending.has(tx.final_execution_status))return {state:'pending',finality:tx.final_execution_status,txHash:ref.txHash};
  assert(tx.final_execution_status==='FINAL','Unknown execution finality');
  const t=tx.transaction;
  assert(object(t) && t.hash===ref.txHash && t.signer_id===ref.sender && t.receiver_id===ref.engine,'Different transaction identity');
  assert(Array.isArray(t.actions) && t.actions.length===1,'Expected one Engine call');
  keys(t.actions[0],['FunctionCall']);const call=t.actions[0].FunctionCall;
  keys(call,['method_name','args','gas','deposit']);
  assert(call.method_name==='call' && call.args===args && call.deposit==='0','Different Engine call');
  const gas=typeof call.gas==='number' && Number.isSafeInteger(call.gas)?String(call.gas):call.gas;
  assert(gas===ref.gas,'Different gas allowance');
  const receipts=tx.receipts_outcome,root=tx.transaction_outcome;
  assert(Array.isArray(receipts) && receipts.length<=MAX_RECEIPTS,'Invalid receipt count');
  assert(root?.id===ref.txHash && root.outcome?.executor_id===ref.sender,'Different transaction outcome');
  const byId=new Map();
  for(const receipt of receipts){hash(receipt?.id);assert(receipt.id!==ref.txHash && !byId.has(receipt.id),'Duplicate receipt');byId.set(receipt.id,receipt);}
  for(const receipt of [root,...receipts]){
    const outcome=receipt.outcome;assert(object(outcome) && account(outcome.executor_id),'Invalid receipt executor');
    assert(Array.isArray(outcome.receipt_ids) && outcome.receipt_ids.length<=MAX_RECEIPTS,'Missing or excessive receipt links');
    assert(new Set(outcome.receipt_ids).size===outcome.receipt_ids.length,'Duplicate receipt links');
    for(const child of outcome.receipt_ids)assert(byId.has(child),'Incomplete receipt graph');
    const status=outcome.status;
    assert(object(status) && Object.keys(status).length===1,'Invalid receipt status');
    const key=Object.keys(status)[0];
    assert(['SuccessValue','SuccessReceiptId','Failure'].includes(key),'Unresolved receipt status');
    if(key==='SuccessValue')base64(status[key]);
    if(key==='Failure')assert(object(status.Failure),'Invalid NEAR failure');
    if(key==='SuccessReceiptId')assert(outcome.receipt_ids.includes(status[key]),'Return receipt must be a direct child');
  }
  const visited=new Set();
  function walk(receipt){for(const child of receipt.outcome.receipt_ids){assert(!visited.has(child),'Cyclic or shared receipt');visited.add(child);walk(byId.get(child));}}
  walk(root);assert(visited.size===receipts.length,'Unrelated receipt outcome');
  let returned=root;
  while(Object.hasOwn(returned.outcome.status,'SuccessReceiptId'))returned=byId.get(returned.outcome.status.SuccessReceiptId);
  assert.deepEqual(tx.status,returned.outcome.status,'Summary differs from return outcome');
  const failedReceiptIds=receipts.filter(r=>Object.hasOwn(r.outcome.status,'Failure')).map(r=>r.id);
  const result={finality:'FINAL',txHash:ref.txHash,failedReceiptIds};
  if(Object.hasOwn(tx.status,'Failure'))return {...result,state:'near_failed',failure:structuredClone(tx.status.Failure)};
  assert(returned.outcome.executor_id===ref.engine,'Return value did not come from the Engine');
  const evm=decodeSubmitResult(base64(tx.status.SuccessValue));
  const state=!evm.succeeded?'evm_failed':failedReceiptIds.length?'needs_review':'evm_succeeded';
  return {...result,state,engineReceiptId:returned.id,evm};
}

export function validateEngineReference(reference){return validate(reference).ref;}

// RPC execution evidence only; this never settles a payment or releases a reservation.
export function inspectEngineTransaction(reference,transaction,{maxGas=300000000000000n}={}){return inspect(validate(reference,maxGas),transaction);}
export async function checkEngineTransaction(reference,{fetchImpl=globalThis.fetch,timeoutMs=20000}={}){
  const expected=validate(reference),txHash=expected.ref.txHash;
  assert(typeof fetchImpl==='function' && Number.isSafeInteger(timeoutMs) && timeoutMs>0 && timeoutMs<=60000,'Invalid lookup options');
  const controller=new AbortController(),{signal}=controller;let timer,reader;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error('Engine lookup deadline');controller.abort(error);reject(error);},timeoutMs);});
  async function lookup(){
    const response=await fetchImpl(ENDPOINT,{method:'POST',redirect:'error',signal,headers:{'Content-Type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tx',params:{tx_hash:txHash,sender_account_id:expected.ref.sender,wait_until:'FINAL'}})});
    if(signal.aborted || !response.ok){void response.body?.cancel().catch(()=>{});throw Error('Engine RPC unavailable');}
    assert(response.body,'Empty Engine response');reader=response.body.getReader();
    const chunks=[];let size=0;
    for(;;){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.byteLength;assert(size<=MAX_RPC_BYTES,'Engine RPC reply too large');chunks.push(value);}
    signal.throwIfAborted();
    let reply;
    try{reply=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
    catch{assert.fail('Invalid Engine RPC JSON');}
    assert(object(reply) && reply.jsonrpc==='2.0' && reply.id===1 && Object.hasOwn(reply,'result')!==Object.hasOwn(reply,'error'),'Invalid RPC envelope');
    if(Object.hasOwn(reply,'error')){
      assert(object(reply.error) && Number.isInteger(reply.error.code) && typeof reply.error.message==='string','Malformed RPC error');
      return {state:'unavailable',txHash};
    }
    try{return inspect(expected,reply.result);}catch{return {state:'unverified',txHash};}
  }
  try{return await Promise.race([lookup(),deadline]);}
  catch(error){return {state:!signal.aborted && error.code==='ERR_ASSERTION'?'unverified':'unavailable',txHash};}
  finally{clearTimeout(timer);controller.abort();if(reader){void reader.cancel().catch(()=>{});reader.releaseLock();}}
}
