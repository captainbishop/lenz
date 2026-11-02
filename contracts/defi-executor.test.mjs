import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import net from 'node:net';
import { createCarrier } from '../carrier/server.mjs';
import { carrierPost, inboxRequest } from '../web/public/carrier-protocol.js';
import { DatabaseSync } from 'node:sqlite';
import { Account, KeyPair, createTransaction, baseEncode, encodeTransaction } from 'near-api-js';
import { createHash } from 'node:crypto';
import { createIdentity, openMessage, sealMessage, digest } from '../web/public/peer-crypto.js';
import { emptyNearVault, fundingRequest, nearLedger } from '../web/public/near-protocol.js';
import { prepareRheaSwap, redemptionTerms } from '../web/public/rhea-protocol.js';
import { makeDepositRequest, refundSource } from '../web/public/near-deposit.js';
import { createDefiRequest, sealDefiRequest, PUBLIC_TESTNET_DISCLOSURE } from '../web/public/defi-request.js';
import { wrapForCarrier } from '../web/public/carrier-protocol.js';
import { DefiInbox } from '../carrier/defi-inbox.mjs';
import { DefiExecutor } from '../carrier/defi-executor.mjs';
import { createDefiExecutorClients, planDefiAction, inspectDefiTransaction } from './defi-executor-client.mjs';
import { verifyDefiResult } from './defi-result-client.mjs';
const logical={network:'testnet',adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
const c={...logical,ready:true,recoverRedemption:true,codeHash:'2'.repeat(32),exchangeCodeHash:'3'.repeat(32)};
const reserve={network:'testnet',ready:true,contract:c.reserve,wasmSha256:'ab'.repeat(32)};
const blockHash='4'.repeat(32),sponsor='lenz-dev-123.testnet';
const encoded=x=>Buffer.from(JSON.stringify(x)).toString('base64');
async function temporary(fn) {const dir=await mkdtemp(join(tmpdir(),'lenz-executor-'));try{return await fn(dir);}finally{assert.equal(dirname(dir),resolve(tmpdir()));await rm(dir,{recursive:true,force:true});}}
async function fixture(directory,kind='rhea-swap') {
  const owner=await createIdentity('Owner'),identity=await createIdentity('Executor');let clock=1000000,height=10;
  const vault=emptyNearVault(c.reserve),f=await fundingRequest(owner,c.reserve,'10');vault.roots.push({id:f.id,owner:f.owner,amount:f.amount});
  const prepared=await prepareRheaSwap(vault,owner,c,{text:'1',minOutput:'100',receiver:sponsor,deadlineMs:clock+120000},clock);
  const packet=prepared.packet,i=packet.instruction,operation={kind,packet};
  if(kind==='rhea-refund-return')operation.deposit=await makeDepositRequest(owner,c.reserve,sponsor,i.amount,await refundSource(c.adapter,packet.id));
  const request=await createDefiRequest(owner,identity.profile,c,operation,{disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:clock+60000},clock);
  const envelope=await wrapForCarrier(owner,await sealDefiRequest(owner,identity.profile,c,request,clock),clock);
  const inbox=new DefiInbox(join(directory,'inbox'),{identity,config:c,now:()=>clock});await inbox.receive(envelope);
  const data={root:packet.root,note:null,order:kind==='rhea-refund-return'?{id:packet.id,instruction:i,stage:'refunded',output:'0',reason:''}:null,
    consumed:Object.fromEntries([...packet.path.map(s=>s.input),i.input].map(id=>[id,null])),depositRoot:null,depositSpent:null,payerBalance:i.amount,capabilities:['deposit_offline_v1']};
  const sent=[],transactions=new Map(),queries=[];let drop=false,unavailable=false,signers=0;
  const pair=KeyPair.fromRandom('ed25519');
  const rpc={
    async sendJsonRpc(){if(unavailable)throw Error('offline');return {chain_id:'testnet'};},
    async viewBlock(){return {header:{hash:blockHash,height,timestamp_nanosec:String(BigInt(clock)*1000000n)}};},
    async viewAccount({accountId,blockQuery}){queries.push(blockQuery);return {code_hash:accountId===c.adapter?c.codeHash:accountId===c.exchange?c.exchangeCodeHash:baseEncode(Buffer.from(reserve.wasmSha256,'hex'))};},
    async callFunction({contractId,method,args,blockQuery}) {
      queries.push(blockQuery);assert.deepEqual(blockQuery,{blockId:blockHash});
      if(method==='configuration')return logical;
      if(method==='get_order')return structuredClone(data.order);
      if(method==='get_note')return structuredClone(data.note);
      if(method==='get_root')return structuredClone(args.id===packet.root.id?data.root:data.depositRoot);
      if(method==='spent_by')return args.id===operation.deposit?.id?data.depositSpent:data.consumed[args.id];
      if(method==='ft_balance_of')return data.payerBalance;
      if(method==='capabilities')return data.capabilities;
      assert.fail('Unexpected read '+contractId+' '+method);
    },
    async viewTransactionStatus({txHash,waitUntil}){assert.equal(waitUntil,'FINAL');if(!transactions.has(txHash))throw Error('not found');return structuredClone(transactions.get(txHash));},
    async sendTransactionUntil(signed,wait) {
      assert.equal(wait,'FINAL');const t=signed.transaction,a=t.actions[0].functionCall;
      const txHash=baseEncode(createHash('sha256').update(encodeTransaction(t)).digest());
      const db=new DatabaseSync(join(directory,'worker','execution.sqlite'),{readOnly:true});
      try {assert.equal(db.prepare('SELECT hash FROM attempts WHERE hash=?').get(txHash)?.hash,txHash,'Hash must be durable before broadcast');}finally{db.close();}
      sent.push(a.methodName);
      if(a.methodName==='settle')data.note={id:i.input,owner:i.owner,amount:i.amount};
      if(a.methodName==='submit')data.order={id:packet.id,instruction:i,stage:'ready',output:'0',reason:''};
      if(a.methodName==='advance') {
        const next={ready:'funded',funded:'deposited',deposited:'output_on_dex',output_on_dex:'output_available',output_available:'complete'};
        if(data.order.stage==='ready')data.consumed[i.input]=await digest(redemptionTerms(c,i));
        data.order={...data.order,stage:next[data.order.stage],output:data.order.stage==='deposited'?'100':data.order.output};
      }
      if(a.methodName==='recover_redemption')data.order={...data.order,stage:'funded'};
      if(a.methodName==='deposit_offline') {const d=operation.deposit;data.depositRoot={id:d.id,owner:d.owner,amount:d.amount};data.payerBalance='0';}
      height++;
      const value=data.order??data.note,status={SuccessValue:encoded(value)};
      const tx={final_execution_status:'FINAL',transaction:{hash:txHash,signer_id:t.signerId,receiver_id:t.receiverId,actions:[{FunctionCall:{method_name:a.methodName,args:Buffer.from(a.args).toString('base64'),gas:String(a.gas),deposit:String(a.deposit)}}]},
        transaction_outcome:{id:txHash,outcome:{executor_id:t.signerId,receipt_ids:['receipt'],status:{SuccessReceiptId:'receipt'}}},
        receipts_outcome:[{id:'receipt',outcome:{executor_id:t.receiverId,receipt_ids:[],status}}],status};
      transactions.set(txHash,tx);if(drop)throw Error('reply lost');return tx;
    }
  };
  const account=new Account(sponsor,rpc,pair.toString());let nonce=0n;
  account.createTransaction=async({receiverId,actions})=>createTransaction(account.accountId,pair.getPublicKey(),receiverId,++nonce,actions,new Uint8Array(32));
  const clients=await createDefiExecutorClients(c,{rpc,getSigner:async()=>{signers++;return account;},reserveConfig:async()=>reserve,now:()=>clock});
  const make=()=>new DefiExecutor(join(directory,'worker'),{inbox,identity,config:c,clients,now:()=>clock});
  const read=packet=>openMessage(owner,identity.profile,packet);
  return {owner,identity,inbox,request,envelope,operation,prepared,data,sent,transactions,queries,rpc,account,clients,make,read,
    clock:n=>clock=n,drop:()=>drop=true,offline:b=>unavailable=b,signers:()=>signers};
}

test('recipient checks use independent final state despite a signed executor success claim',async()=>temporary(async directory=>{
  const f=await fixture(directory),before=structuredClone(f.prepared.vault);
  try{
    const packet=await sealMessage(f.identity,f.owner.profile,{type:'lenz/defi-observation/v1',requestId:f.request.id,checkedAt:1000000,state:'observed',observation:{state:'observed',order:{stage:'complete',output:'999999'}},transaction:{state:'succeeded'}});
    const result=await verifyDefiResult(f.owner,f.identity.profile,c,f.request,packet,{observe:f.clients.observe,now:1000000});
    assert.equal(result.state,'ready');assert.equal(result.observation.order,null);assert.equal(result.observation.call.method,'settle');
    const unavailable=await verifyDefiResult(f.owner,f.identity.profile,c,f.request,packet,{observe:async()=>{throw Error('offline');},now:1000000});
    assert.equal(unavailable.state,'unverified');assert.equal(unavailable.observation,null);
    assert.deepEqual(f.prepared.vault,before);assert.equal(f.sent.length,0);assert.equal(f.signers(),0);
  }finally{f.inbox.close();}
}));

test('recipient rejects foreign requests, malformed reports and nonfinal independent observations',async()=>temporary(async directory=>{
  const f=await fixture(directory);let reads=0;
  try{
    const base={type:'lenz/defi-observation/v1',requestId:f.request.id,checkedAt:1000000,state:'observed',observation:null,transaction:null};
    for(const change of [{requestId:'a'.repeat(64)},{checkedAt:999999},{checkedAt:1060001},{state:'paid'},{extra:true}]){
      const packet=await sealMessage(f.identity,f.owner.profile,{...base,...change});
      await assert.rejects(verifyDefiResult(f.owner,f.identity.profile,c,f.request,packet,{now:1000000,observe:async()=>{reads++;}}));
    }
    assert.equal(reads,0);
    const packet=await sealMessage(f.identity,f.owner.profile,base),other=await createIdentity('Other');
    await assert.rejects(verifyDefiResult(f.owner,other.profile,c,f.request,packet,{observe:f.clients.observe,now:1000000}));
    await assert.rejects(verifyDefiResult(f.owner,f.identity.profile,c,f.request,packet,{observe:async()=>({finality:'OPTIMISTIC',state:'observed',block:{hash:blockHash,height:10}}),now:1000000}),/not final/);
    await assert.rejects(verifyDefiResult(f.owner,f.identity.profile,c,f.request,packet,{observe:async()=>({finality:'FINAL',state:'paid',block:{hash:blockHash,height:10}}),now:1000000}),/Invalid independent/);
    await assert.rejects(verifyDefiResult(f.owner,f.identity.profile,c,f.request,{...packet,signature:'0'.repeat(128)},{observe:f.clients.observe,now:1000000}));
    const altered=structuredClone(f.request);altered.operation.packet.instruction.amount='999';
    await assert.rejects(verifyDefiResult(f.owner,f.identity.profile,c,altered,packet,{observe:f.clients.observe,now:1000000}));
    assert.equal(f.sent.length,0);
  }finally{f.inbox.close();}
}));

test('recipient recovery remains available after request expiry without dispatch or unlocking',async()=>temporary(async directory=>{
  const f=await fixture(directory,'rhea-refund-return'),worker=f.make();
  try{
    const packet=await worker.run(f.request.id),before=structuredClone(f.prepared.vault),sent=f.sent.length;
    f.clock(1200000);
    const result=await verifyDefiResult(f.owner,f.identity.profile,c,f.request,packet,{observe:f.clients.observe,now:1200000});
    assert.equal(result.state,'observed');assert.equal(result.observation.deposit.root.id,f.operation.deposit.id);
    assert.equal(f.sent.length,sent);assert.deepEqual(f.prepared.vault,before);
  }finally{worker.close();f.inbox.close();}
}));

test('real SDK dispatch progresses settled input through all swap stages, returning encrypted observations',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make(),before=structuredClone(f.prepared.vault);
  try {
    let result;
    for(let n=0;n<7;n++)result=await f.read(await worker.run(f.request.id));
    assert.deepEqual(f.sent,['settle','submit','advance','advance','advance','advance','advance']);
    assert.equal(result.state,'observed');assert.equal(result.observation.order.stage,'complete');assert.equal(result.transaction.state,'succeeded');
    assert.equal(result.observation.block.hash,blockHash);
    await worker.run(f.request.id);assert.equal(f.sent.length,7);
    assert.deepEqual(f.prepared.vault,before);assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
    assert(!JSON.stringify(worker.report(f.request.id)).includes(sponsor));
    assert(f.queries.every(q=>q.blockId===blockHash));
  } finally {worker.close();f.inbox.close();}
  const disk=await readFile(join(directory,'worker','execution.sqlite'));
  assert(!disk.includes(Buffer.from('min_output')));assert(!disk.includes(Buffer.from('redemption_signature')));
}));

test('refund deposit requires the payer and produces a checked new-root observation without a wallet credit',async()=>temporary(async directory=>{
  const f=await fixture(directory,'rhea-refund-return'),worker=f.make(),before=structuredClone(f.prepared.vault);
  try {
    const r=await f.read(await worker.run(f.request.id));assert.equal(r.state,'observed');assert.deepEqual(f.sent,['deposit_offline']);
    assert.equal(r.observation.deposit.root.id,f.operation.deposit.id);assert.equal(r.observation.deposit.spent,null);
    f.data.depositSpent='a'.repeat(64);
    const again=await f.read(await worker.run(f.request.id));assert.equal(again.observation.deposit.spent,'a'.repeat(64));assert.equal(f.sent.length,1);
    assert.deepEqual(f.prepared.vault,before);
  } finally {worker.close();f.inbox.close();}
}));

test('lost replies recover after restart and never resend the same execution step',async()=>temporary(async directory=>{
  const f=await fixture(directory);f.drop();let worker=f.make();
  try {
    await worker.run(f.request.id);assert.deepEqual(f.sent,['settle']);worker.close();worker=f.make();
    const r=await f.read(await worker.run(f.request.id));assert.deepEqual(f.sent,['settle','submit']);assert.equal(r.transaction.state,'succeeded');
    f.offline(true);const before=f.sent.length;await worker.run(f.request.id);assert.equal(f.sent.length,before);
  } finally {worker.close();f.inbox.close();}
}));

test('unresolved attempt is status-only across restart even when the chain still offers the same action',async()=>temporary(async directory=>{
  const f=await fixture(directory);let broadcasts=0;
  f.rpc.sendTransactionUntil=async()=>{broadcasts++;throw Error('uncertain');};let worker=f.make();
  try {
    const r=await f.read(await worker.run(f.request.id));assert.equal(r.state,'pending');assert.equal(r.transaction.state,'unverified');
    worker.close();worker=f.make();await worker.run(f.request.id);assert.equal(broadcasts,1);assert.equal(f.signers(),1);
  } finally {worker.close();f.inbox.close();}
}));

test('parallel workers cannot broadcast the same planned step twice',async()=>temporary(async directory=>{
  const f=await fixture(directory),a=f.make(),b=f.make();
  try {await Promise.all([a.run(f.request.id),b.run(f.request.id)]);assert.equal(f.sent.filter(x=>x==='settle').length,1);}
  finally {a.close();b.close();f.inbox.close();}
}));

test('expired approvals allow state recovery but prevent new signatures and preserve reservations',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();
  try {
    f.clock(f.request.expiresAt);const r=await f.read(await worker.run(f.request.id));assert.equal(r.state,'expired');assert.equal(f.signers(),0);
    f.data.order={id:f.operation.packet.id,instruction:f.operation.packet.instruction,stage:'complete',output:'100',reason:''};
    const final=await f.read(await worker.run(f.request.id));assert.equal(final.state,'observed');assert.equal(f.sent.length,0);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {worker.close();f.inbox.close();}
}));

test('approval expiring during signing cannot broadcast and remains recoverable',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make(),original=f.account.signer.signTransaction.bind(f.account.signer);
  f.account.signer.signTransaction=async t=>{const result=await original(t);f.clock(f.request.expiresAt);return result;};
  try {await worker.run(f.request.id);assert.equal(f.sent.length,0);await worker.run(f.request.id);assert.equal(f.signers(),1);}
  finally {worker.close();f.inbox.close();}
}));

test('unknown request, forged envelope and unavailable chain never open the signer',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();
  try {
    await assert.rejects(worker.run('0'.repeat(64)),/Unknown/);f.offline(true);
    assert.equal((await f.read(await worker.run(f.request.id))).state,'unavailable');assert.equal(f.signers(),0);
    const fake={read:()=>({envelope:{...f.envelope,signature:'0'.repeat(128)},storedAt:1000000})};
    const other=new DefiExecutor(join(directory,'forged'),{inbox:fake,identity:f.identity,config:c,clients:f.clients,now:()=>1000000});
    try{await assert.rejects(other.run(f.request.id));}finally{other.close();}assert.equal(f.signers(),0);
  } finally {worker.close();f.inbox.close();}
}));

test('code hash, chain, freshness, funded root and signed order mismatches stop dispatch',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();
  const original={status:f.rpc.sendJsonRpc,account:f.rpc.viewAccount,block:f.rpc.viewBlock};
  try {
    for(const mutate of [()=>f.rpc.sendJsonRpc=async()=>({chain_id:'mainnet'}),()=>f.rpc.viewAccount=async()=>({code_hash:'bad'}),
      ()=>f.rpc.viewBlock=async()=>({header:{hash:blockHash,height:1,timestamp_nanosec:'0'}}),()=>f.data.root={...f.data.root,amount:'1'},
      ()=>f.data.order={id:f.operation.packet.id,instruction:{...f.operation.packet.instruction,receiver_id:'evil.testnet'},stage:'ready',output:'0'}]) {
      mutate();assert.equal((await f.read(await worker.run(f.request.id))).state,'unavailable');assert.equal(f.signers(),0);
      f.rpc.sendJsonRpc=original.status;f.rpc.viewAccount=original.account;f.rpc.viewBlock=original.block;f.data.root=f.operation.packet.root;f.data.order=null;
    }
  } finally {worker.close();f.inbox.close();}
}));

test('conflicting ancestors or inputs cannot be settled again',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();
  try {
    for(const id of Object.keys(f.data.consumed)) {
      f.data.consumed[id]='a'.repeat(64);assert.equal((await f.read(await worker.run(f.request.id))).state,'conflicted');f.data.consumed[id]=null;
    }
    assert.equal(f.sent.length,0);assert.equal(f.signers(),0);
  } finally {worker.close();f.inbox.close();}
}));

test('in-flight, rejected and attention states wait; redemption recovery needs the exact consumption record',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make(),i=f.operation.packet.instruction;
  try {
    for(const stage of ['checking','redeeming','depositing','swapping','withdrawing_output','paying_refund','rejected','attention']) {
      f.data.order={id:f.operation.packet.id,instruction:i,stage,output:'0',reason:''};await worker.run(f.request.id);assert.equal(f.sent.length,0);
    }
    f.data.order.stage='redeeming';f.data.consumed[i.input]=await digest(redemptionTerms(c,i));
    await worker.run(f.request.id);assert.deepEqual(f.sent,['recover_redemption']);
  } finally {worker.close();f.inbox.close();}
}));

test('refund absent, unfunded or mismatched never dispatches; a different sponsor cannot debit the payer',async()=>temporary(async directory=>{
  const f=await fixture(directory,'rhea-refund-return'),worker=f.make();
  try {
    f.data.order.stage='complete';f.data.order.output='100';await worker.run(f.request.id);assert.equal(f.signers(),0);
    f.data.order.stage='refunded';f.data.payerBalance='0';await worker.run(f.request.id);assert.equal(f.signers(),0);
    f.data.payerBalance=f.operation.deposit.amount;f.data.depositRoot={id:f.operation.deposit.id,owner:f.operation.deposit.owner,amount:'1'};
    await worker.run(f.request.id);assert.equal(f.signers(),0);f.data.depositRoot=null;
    const real=f.account.accountId;f.account.accountId='lenz-dev-456.testnet';await worker.run(f.request.id);f.account.accountId=real;
    assert.equal(f.sent.length,0);
  } finally {worker.close();f.inbox.close();}
}));

test('journal failure before dispatch or signed-reference persistence stops broadcasting',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();worker.close();
  try {await assert.rejects(worker.run(f.request.id));assert.equal(f.sent.length,0);assert.equal(f.signers(),0);
    const observation=await f.clients.observe(f.operation);
    await assert.rejects(f.clients.send(observation.call,()=>{throw Error('disk full');}),/disk full/);assert.equal(f.sent.length,0);
  } finally {f.inbox.close();}
}));

test('receipt checks reject mismatched actions, nonfinal status, missing/cyclic graphs and invented success',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();
  try {
    const observation=await f.clients.observe(f.operation);await worker.run(f.request.id);
    const [txHash,tx]=[...f.transactions][0],ref={sender:sponsor,txHash};assert.equal(inspectDefiTransaction(ref,observation.call,tx).state,'succeeded');
    for(const change of [t=>t.final_execution_status='EXECUTED_OPTIMISTIC',t=>t.transaction.hash='9'.repeat(32),t=>t.transaction.signer_id='other.testnet',
      t=>t.transaction.receiver_id='other.testnet',t=>t.transaction.actions[0].FunctionCall.deposit='0',t=>t.transaction.actions[0].FunctionCall.args=encoded({path:[]}),
      t=>t.receipts_outcome=[],t=>t.receipts_outcome[0].outcome.receipt_ids=['receipt'],t=>t.status={Failure:{error:'invented'}},t=>t.receipts_outcome[0].outcome.executor_id='other.testnet']) {
      const candidate=structuredClone(tx);change(candidate);assert.throws(()=>inspectDefiTransaction(ref,observation.call,candidate));
    }
  } finally {worker.close();f.inbox.close();}
}));

test('unavailable and stale observations cannot overwrite a saved final result',async()=>temporary(async directory=>{
  const f=await fixture(directory,'rhea-refund-return'),worker=f.make();
  try {
    await worker.run(f.request.id);assert.equal((await f.read(worker.report(f.request.id))).state,'observed');
    f.offline(true);await worker.run(f.request.id);assert.equal((await f.read(worker.report(f.request.id))).state,'observed');
    f.offline(false);f.data.depositRoot=null;f.data.payerBalance=f.operation.deposit.amount;
    f.rpc.viewBlock=async()=>({header:{hash:blockHash,height:1,timestamp_nanosec:'1000000000000'}});
    await worker.run(f.request.id);assert.equal((await f.read(worker.report(f.request.id))).observation.block.height,11);
    assert.equal(f.sent.length,1);
  } finally {worker.close();f.inbox.close();}
}));

test('a saved final state prevents dispatch from a later regressed chain response with no prior attempts',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();
  try {
    f.data.order={id:f.operation.packet.id,instruction:f.operation.packet.instruction,stage:'complete',output:'100',reason:''};
    await worker.run(f.request.id);f.data.order=null;
    await worker.run(f.request.id);assert.equal(f.sent.length,0);assert.equal(f.signers(),0);
    assert.equal((await f.read(worker.report(f.request.id))).state,'observed');
  } finally {worker.close();f.inbox.close();}
}));

test('a signer replacing the already checked transaction cannot reach broadcast',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make(),original=f.account.signer.signTransaction.bind(f.account.signer);
  f.account.signer.signTransaction=async t=>{t.receiverId='evil.testnet';return original(t);};
  try {await worker.run(f.request.id);assert.equal(f.sent.length,0);}
  finally {worker.close();f.inbox.close();}
}));

test('encrypted request and completed observation travel over a real HTTP carrier',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+probe.address().port;await new Promise(r=>probe.close(r));
  const carrier=createCarrier({origin,directory:join(directory,'carrier'),now:()=>1000000});await carrier.listen();
  try {
    await carrierPost(origin,'/v1/store',f.envelope);
    const incoming=await carrierPost(origin,'/v1/inbox',await inboxRequest(f.identity,origin,'',1000000));
    assert.equal(incoming.envelopes.length,1);await f.inbox.receive(incoming.envelopes[0]);
    let packet;for(let n=0;n<7;n++)packet=await worker.run(f.request.id);
    await carrierPost(origin,'/v1/store',await wrapForCarrier(f.identity,packet,1000000));
    const received=await carrierPost(origin,'/v1/inbox',await inboxRequest(f.owner,origin,'',1000000));
    const result=await f.read(received.envelopes[0].packet);
    assert.equal(result.requestId,f.request.id);assert.equal(result.state,'observed');assert.equal(result.observation.order.stage,'complete');
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {worker.close();f.inbox.close();await carrier.close();}
}));
