import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import net from 'node:net';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createCarrier } from '../carrier/server.mjs';
import { carrierPost, inboxRequest } from '../web/public/carrier-protocol.js';
import { DatabaseSync } from 'node:sqlite';
import { Account, KeyPair, createTransaction, baseEncode, encodeTransaction, decodeSignedTransaction } from 'near-api-js';
import { createHash } from 'node:crypto';
import { createIdentity, openMessage, sealMessage, digest } from '../web/public/peer-crypto.js';
import { emptyNearVault, fundingRequest, nearLedger } from '../web/public/near-protocol.js';
import { prepareRheaSwap, redemptionTerms } from '../web/public/rhea-protocol.js';
import { makeDepositRequest, refundSource } from '../web/public/near-deposit.js';
import { createDefiRequest, sealDefiRequest, openDefiReceipt, PUBLIC_TESTNET_DISCLOSURE } from '../web/public/defi-request.js';
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
async function fixture(directory,kind='rhea-swap',{realTime=false,lifetime=60000,intake=true}={}) {
  const owner=await createIdentity('Owner'),identity=await createIdentity('Executor');let clock=realTime?Date.now():1000000,height=10;
  const now=()=>realTime?Date.now():clock;
  const vault=emptyNearVault(c.reserve),f=await fundingRequest(owner,c.reserve,'10');vault.roots.push({id:f.id,owner:f.owner,amount:f.amount});
  const prepared=await prepareRheaSwap(vault,owner,c,{text:'1',minOutput:'100',receiver:sponsor,deadlineMs:clock+120000},clock);
  const packet=prepared.packet,i=packet.instruction,operation={kind,packet};
  if(kind==='rhea-refund-return')operation.deposit=await makeDepositRequest(owner,c.reserve,sponsor,i.amount,await refundSource(c.adapter,packet.id));
  const request=await createDefiRequest(owner,identity.profile,c,operation,{disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:clock+lifetime},clock);
  const envelope=await wrapForCarrier(owner,await sealDefiRequest(owner,identity.profile,c,request,clock),clock);
  const inbox=new DefiInbox(join(directory,'inbox'),{identity,config:c,now});if(intake)await inbox.receive(envelope);
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
  const clients=await createDefiExecutorClients(c,{rpc,getSigner:async()=>{signers++;return account;},reserveConfig:async()=>reserve,now});
  const make=()=>new DefiExecutor(join(directory,'worker'),{inbox,identity,config:c,clients,now});
  const read=packet=>openMessage(owner,identity.profile,packet);
  return {owner,identity,inbox,request,envelope,operation,prepared,data,sent,transactions,queries,rpc,account,clients,make,read,now,
    clock:n=>clock=n,drop:()=>drop=true,offline:b=>unavailable=b,signers:()=>signers};
}

test('status checks never start or advance an approved action, including after expiry',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make(),before=structuredClone(f.prepared.vault);
  try {
    let report=await f.read(await worker.check(f.request.id));
    assert.equal(report.state,'ready');assert.equal(report.observation.call.method,'settle');
    assert.equal(f.signers(),0);assert.deepEqual(f.sent,[]);
    await worker.run(f.request.id);
    assert.deepEqual(f.sent,['settle']);assert.equal(f.signers(),1);
    report=await f.read(await worker.check(f.request.id));
    assert.equal(report.state,'ready');assert.equal(report.observation.call.method,'submit');
    assert.equal(report.transaction.state,'succeeded');
    f.clock(f.request.expiresAt);
    report=await f.read(await worker.check(f.request.id));
    assert.equal(report.state,'expired');assert.equal(report.transaction.state,'succeeded');
    assert.deepEqual(f.sent,['settle']);assert.equal(f.signers(),1);
    assert.deepEqual(f.prepared.vault,before);
  } finally {worker.close();f.inbox.close();}
}));

test('wallet status uses locally configured chain evidence after expiry without opening a signer',async()=>temporary(async directory=>{
  const {readDefiStatus}=await import('../web/defi-status.mjs');
  const f=await fixture(directory),input={sender:f.owner.profile,executor:f.identity.profile,request:f.request};
  const options={configuration:async()=>c,createClients:async(config,controls)=>{
    assert.deepEqual(config,c);assert.throws(controls.getSigner,/cannot sign/);
    return createDefiExecutorClients(config,{...controls,rpc:f.rpc,reserveConfig:async()=>reserve,now:f.now});
  }};
  try {
    f.clock(f.request.expiresAt+1);
    let result=await readDefiStatus(input,options);assert.equal(result.state,'ready');assert.equal(result.observation.order,null);
    f.data.order={id:f.operation.packet.id,instruction:f.operation.packet.instruction,stage:'complete',output:'100',reason:''};
    result=await readDefiStatus(input,options);assert.equal(result.state,'observed');assert.equal(result.observation.order.stage,'complete');
    assert.equal(result.observation.call,undefined);assert.equal(result.requestId,f.request.id);
    const bad=structuredClone(input);bad.request.operation.packet.instruction.receiver_id='other.testnet';
    await assert.rejects(readDefiStatus(bad,options));
    f.rpc.viewAccount=async()=>({code_hash:'9'.repeat(32)});await assert.rejects(readDefiStatus(input,options),/code changed/);
    assert.deepEqual(f.sent,[]);assert.equal(f.signers(),0);
  } finally {f.inbox.close();}
}));

test('status checks retain unresolved submissions after restart without rebroadcasting',async()=>temporary(async directory=>{
  const f=await fixture(directory);let worker=f.make(),broadcasts=0;
  f.rpc.sendTransactionUntil=async()=>{broadcasts++;throw Error('reply lost');};
  try {
    await worker.run(f.request.id);worker.close();worker=f.make();
    const report=await f.read(await worker.check(f.request.id));
    assert.equal(report.state,'pending');assert.equal(report.transaction.state,'unverified');
    assert.equal(broadcasts,1);assert.equal(f.signers(),1);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {worker.close();f.inbox.close();}
}));

test('status checks preserve final failures when transaction status becomes unavailable',async()=>temporary(async directory=>{
  const f=await fixture(directory),send=f.rpc.sendTransactionUntil;let worker=f.make();
  f.rpc.sendTransactionUntil=async(signed,wait)=>{
    const tx=await send(signed,wait);f.data.note=null;
    tx.status={Failure:{ActionError:{kind:'FunctionCallError'}}};tx.receipts_outcome[0].outcome.status=tx.status;
    return tx;
  };
  try {
    await worker.run(f.request.id);worker.close();worker=f.make();
    f.rpc.viewTransactionStatus=async()=>{throw Error('status unavailable');};
    const report=await f.read(await worker.check(f.request.id));
    assert.equal(report.state,'needs_review');assert.equal(report.transaction.state,'failed');
    assert.equal(report.transaction.finality,'FINAL');assert.deepEqual(f.sent,['settle']);assert.equal(f.signers(),1);
  } finally {worker.close();f.inbox.close();}
}));

test('status checks save completed outcomes after expiry and retain them through outage or regression',async()=>temporary(async directory=>{
  const f=await fixture(directory,'rhea-refund-return');let worker=f.make();
  try {
    const d=f.operation.deposit;f.data.depositRoot={id:d.id,owner:d.owner,amount:d.amount};
    f.clock(f.request.expiresAt+1);
    const complete=await f.read(await worker.check(f.request.id));
    assert.equal(complete.state,'observed');assert.deepEqual(complete.observation.deposit.root,f.data.depositRoot);
    worker.close();worker=f.make();f.offline(true);
    assert.equal((await f.read(await worker.check(f.request.id))).state,'unavailable');
    assert.deepEqual(await f.read(worker.report(f.request.id)),complete);
    f.offline(false);f.data.depositRoot=null;
    assert.equal((await f.read(await worker.check(f.request.id))).state,'needs_review');
    assert.deepEqual(await f.read(worker.report(f.request.id)),complete);
    assert.deepEqual(f.sent,[]);assert.equal(f.signers(),0);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {worker.close();f.inbox.close();}
}));

test('status checks authenticate intake and reject changed chain configuration before returning evidence',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();let other;
  try {
    await assert.rejects(worker.check('a'.repeat(64)),/Unknown DeFi request/);
    const envelope=structuredClone(f.envelope);envelope.packet.signature='0'.repeat(128);
    other=new DefiExecutor(join(directory,'forged-status'),{
      inbox:{read:()=>({envelope,storedAt:1000000})},identity:f.identity,config:c,clients:f.clients,now:()=>1000000,
    });
    await assert.rejects(other.check(f.request.id));
    f.rpc.viewAccount=async()=>({code_hash:'9'.repeat(32)});
    const report=await f.read(await worker.check(f.request.id));
    assert.equal(report.state,'unavailable');assert.equal(report.observation,null);
    assert.deepEqual(f.sent,[]);assert.equal(f.signers(),0);
  } finally {other?.close();worker.close();f.inbox.close();}
}));

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

test('explicit recovery sends the saved signed bytes after restart without creating another signature',async()=>temporary(async directory=>{
  const f=await fixture(directory),send=f.rpc.sendTransactionUntil;let first,resent,worker=f.make();
  f.rpc.sendTransactionUntil=async signed=>{first=Buffer.from(encodeTransaction(signed));throw Error('connection lost before delivery');};
  try {
    await worker.run(f.request.id);assert.equal(f.sent.length,0);assert.equal(f.signers(),1);
    worker.close();worker=f.make();
    f.rpc.sendTransactionUntil=async(signed,wait)=>{resent=Buffer.from(encodeTransaction(signed));return send(signed,wait);};
    const result=await f.read(await worker.retry(f.request.id));
    assert(resent?.equals(first),'Recovery must resend the exact signed bytes');assert.deepEqual(f.sent,['settle']);assert.equal(f.signers(),1);
    assert.equal(result.transaction.state,'succeeded');assert.equal(result.observation.call.method,'submit');
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
    await worker.retry(f.request.id);assert.deepEqual(f.sent,['settle']);assert.equal(f.signers(),1);
  } finally {worker.close();f.inbox.close();}
  const journal=await readFile(join(directory,'worker','execution.sqlite'));
  assert(!journal.includes(first) && !journal.includes(Buffer.from(first.toString('base64'))),'Signed submission must stay encrypted on disk');
}));

test('recovery retains legacy attempts without bytes and failed durable writes without broadcasting',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make();let broadcasts=0;
  f.rpc.sendTransactionUntil=async()=>{broadcasts++;throw Error('offline');};
  const db=new DatabaseSync(join(directory,'worker','execution.sqlite'));
  try {
    db.exec("CREATE TRIGGER fail_saved_transaction BEFORE INSERT ON signed_transactions BEGIN SELECT RAISE(ABORT,'disk full'); END");
    await worker.run(f.request.id);assert.equal(broadcasts,0);
    db.exec('DROP TRIGGER fail_saved_transaction');
    const result=await f.read(await worker.retry(f.request.id));
    assert.equal(result.state,'needs_review');assert.equal(result.transaction,null);
    await worker.run(f.request.id);assert.equal(broadcasts,0);assert.equal(f.signers(),1);
  } finally {db.close();worker.close();f.inbox.close();}
}));

test('concurrent explicit recoveries retain one transaction identity and never open another signer',async()=>temporary(async directory=>{
  const f=await fixture(directory),a=f.make(),b=f.make(),sent=[];
  f.rpc.sendTransactionUntil=async signed=>{sent.push(Buffer.from(encodeTransaction(signed)).toString('base64'));throw Error('reply unavailable');};
  try {
    assert.equal((await f.read(await a.retry(f.request.id))).state,'needs_review');assert.equal(f.signers(),0);
    await a.run(f.request.id);
    await Promise.all([a.retry(f.request.id),b.retry(f.request.id)]);
    assert.equal(sent.length,3);assert.equal(new Set(sent).size,1);assert.equal(f.signers(),1);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {a.close();b.close();f.inbox.close();}
}));

test('a final transaction failure survives restart and unavailable status checks without resubmission',async()=>temporary(async directory=>{
  const f=await fixture(directory),send=f.rpc.sendTransactionUntil;let worker=f.make();
  f.rpc.sendTransactionUntil=async(signed,wait)=>{
    const tx=await send(signed,wait);f.data.note=null;
    tx.status={Failure:{ActionError:{kind:'FunctionCallError'}}};tx.receipts_outcome[0].outcome.status=tx.status;
    return tx;
  };
  try {
    const first=await f.read(await worker.run(f.request.id));assert.equal(first.transaction.state,'failed');
    worker.close();worker=f.make();f.rpc.viewTransactionStatus=async()=>{throw Error('status unavailable');};
    const recovered=await f.read(await worker.retry(f.request.id));
    assert.equal(f.sent.length,1,'A known final transaction must not be resubmitted');
    assert.equal(recovered.transaction.state,'failed');assert.equal(recovered.state,'needs_review');assert.equal(f.signers(),1);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {worker.close();f.inbox.close();}
}));

test('a final transaction learned by another worker stops recovery before broadcast',async()=>temporary(async directory=>{
  const f=await fixture(directory),a=f.make(),b=f.make(),send=f.rpc.sendTransactionUntil,status=f.rpc.viewTransactionStatus,retry=f.clients.rebroadcast;
  f.rpc.sendTransactionUntil=async(signed,wait)=>{
    const tx=await send(signed,wait);f.data.note=null;
    tx.status={Failure:{ActionError:{kind:'FunctionCallError'}}};tx.receipts_outcome[0].outcome.status=tx.status;
    throw Error('reply lost');
  };
  f.rpc.viewTransactionStatus=async()=>{throw Error('status unavailable');};
  try {
    await a.run(f.request.id);
    f.clients.rebroadcast=async(ref,call,bytes,guard)=>{
      f.rpc.viewTransactionStatus=status;await b.run(f.request.id);
      return retry(ref,call,bytes,guard);
    };
    const result=await f.read(await a.retry(f.request.id));
    assert.equal(f.sent.length,1,'Recovery must honor a concurrently learned final result');assert.equal(result.transaction.state,'failed');assert.equal(f.signers(),1);
  } finally {a.close();b.close();f.inbox.close();}
}));

test('a final broadcast reply remains known when every later status request is unavailable',async()=>temporary(async directory=>{
  const f=await fixture(directory),send=f.rpc.sendTransactionUntil;let worker=f.make();
  f.rpc.sendTransactionUntil=async(signed,wait)=>{
    const tx=await send(signed,wait);f.data.note=null;
    tx.status={Failure:{ActionError:{kind:'FunctionCallError'}}};tx.receipts_outcome[0].outcome.status=tx.status;return tx;
  };
  f.rpc.viewTransactionStatus=async()=>{throw Error('status unavailable');};
  try {
    const result=await f.read(await worker.run(f.request.id));assert.equal(result.transaction.state,'failed');
    worker.close();worker=f.make();const recovered=await f.read(await worker.retry(f.request.id));
    assert.equal(recovered.transaction.state,'failed');assert.equal(f.sent.length,1);assert.equal(f.signers(),1);
  } finally {worker.close();f.inbox.close();}
}));

test('only verified final recovery replies close an attempt when status checks are unavailable',async()=>temporary(async directory=>{
  const f=await fixture(directory),send=f.rpc.sendTransactionUntil;let worker=f.make(),invalid=true;
  f.rpc.sendTransactionUntil=async(signed,wait)=>{
    const tx=await send(signed,wait);f.data.note=null;
    tx.status={Failure:{ActionError:{kind:'FunctionCallError'}}};tx.receipts_outcome[0].outcome.status=tx.status;
    if(invalid)tx.transaction.receiver_id='other.testnet';return tx;
  };
  f.rpc.viewTransactionStatus=async()=>{throw Error('status unavailable');};
  try {
    assert.equal((await f.read(await worker.run(f.request.id))).transaction.state,'unverified');invalid=false;
    assert.equal((await f.read(await worker.retry(f.request.id))).transaction.state,'failed');
    worker.close();worker=f.make();await worker.retry(f.request.id);
    assert.equal(f.sent.length,2);assert.equal(f.signers(),1);assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {worker.close();f.inbox.close();}
}));

test('a signer cannot change the submitted bytes while durable recording is awaited',async()=>temporary(async directory=>{
  const f=await fixture(directory),expected=(await f.clients.observe(f.operation)).call,original=f.account.signer.signTransaction.bind(f.account.signer);
  let signerOwned,recorded,submitted;
  f.account.signer.signTransaction=async t=>{signerOwned=await original(t);return signerOwned;};
  f.rpc.sendTransactionUntil=async signed=>{submitted=Buffer.from(encodeTransaction(signed)).toString('base64');};
  try {
    await f.clients.send(expected,async ref=>{recorded=ref.signedTransaction;await Promise.resolve();signerOwned.signedTransaction.transaction.receiverId='evil.testnet';});
    assert.equal(submitted,recorded);assert.equal(decodeSignedTransaction(Buffer.from(submitted,'base64')).transaction.receiverId,c.reserve);
  } finally {f.inbox.close();}
}));

test('old journals containing only transaction references remain status-only on explicit recovery',async()=>temporary(async directory=>{
  const f=await fixture(directory),send=f.clients.send;let broadcasts=0,worker=f.make();
  f.clients.send=(call,record)=>send(call,({sender,txHash})=>record({sender,txHash}));
  f.rpc.sendTransactionUntil=async()=>{broadcasts++;throw Error('offline');};
  try {
    await worker.run(f.request.id);worker.close();worker=f.make();
    const result=await f.read(await worker.retry(f.request.id));
    assert.equal(result.state,'needs_review');assert.equal(broadcasts,1);assert.equal(f.signers(),1);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {worker.close();f.inbox.close();}
}));

test('recovery rechecks expiry at broadcast and rejects changed chain configuration',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make(),status=f.rpc.sendJsonRpc,rebroadcast=f.clients.rebroadcast;let broadcasts=0;
  f.rpc.sendTransactionUntil=async()=>{broadcasts++;throw Error('offline');};
  try {
    await worker.run(f.request.id);
    f.rpc.sendJsonRpc=async()=>({chain_id:'mainnet'});
    assert.equal((await f.read(await worker.retry(f.request.id))).state,'unavailable');assert.equal(broadcasts,1);
    f.rpc.sendJsonRpc=status;
    f.clients.rebroadcast=(ref,call,encoded,guard)=>rebroadcast(ref,call,encoded,async()=>{f.clock(f.request.expiresAt);await guard();});
    await worker.retry(f.request.id);assert.equal(broadcasts,1);
    assert.equal((await f.read(await worker.retry(f.request.id))).state,'expired');assert.equal(broadcasts,1);assert.equal(f.signers(),1);
    f.data.order={id:f.operation.packet.id,instruction:f.operation.packet.instruction,stage:'complete',output:'100',reason:''};
    assert.equal((await f.read(await worker.retry(f.request.id))).state,'observed');assert.equal(broadcasts,1);
  } finally {worker.close();f.inbox.close();}
}));

test('approval expiring while SQLite waits retains the signed record but never reaches transport',async()=>temporary(async directory=>{
  const f=await fixture(directory,'rhea-swap',{realTime:true,lifetime:2200}),worker=f.make(),sign=f.account.signer.signTransaction.bind(f.account.signer);
  let locker,broadcasts=0;
  f.account.signer.signTransaction=async transaction=>{
    const signed=await sign(transaction);
    locker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads'),{DatabaseSync}=require('node:sqlite');
      const db=new DatabaseSync(workerData.path);db.exec('BEGIN IMMEDIATE');parentPort.postMessage(Date.now());
      setTimeout(()=>{db.exec('COMMIT');db.close();},Math.max(0,workerData.until-Date.now()));
    `,{eval:true,workerData:{path:join(directory,'worker','execution.sqlite'),until:f.request.expiresAt+250}});
    const [lockedAt]=await once(locker,'message');assert(lockedAt<f.request.expiresAt,'Lock must precede approval expiry');return signed;
  };
  f.rpc.sendTransactionUntil=async()=>{broadcasts++;throw Error('transport must not run');};
  try {
    await worker.run(f.request.id);assert(locker,'The request must reach signed persistence');
    if(locker.threadId!==-1)await once(locker,'exit');
    assert.equal(broadcasts,0,'An approval that expires during storage cannot be broadcast');
    const db=new DatabaseSync(join(directory,'worker','execution.sqlite'),{readOnly:true});
    try {assert.equal(db.prepare('SELECT COUNT(*) AS n FROM signed_transactions').get().n,1);}finally{db.close();}
    assert.equal((await f.read(await worker.retry(f.request.id))).state,'expired');assert.equal(broadcasts,0);assert.equal(f.signers(),1);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {if(locker&&locker.threadId!==-1)await locker.terminate();worker.close();f.inbox.close();}
}));

test('saved transaction validation rejects changed hashes, terms, signatures and encoding before transport',async()=>temporary(async directory=>{
  const f=await fixture(directory),worker=f.make(),expected=(await f.clients.observe(f.operation)).call;let encoded,ref,broadcasts=0,guards=0;
  f.rpc.sendTransactionUntil=async signed=>{broadcasts++;encoded=Buffer.from(encodeTransaction(signed));ref={sender:sponsor,txHash:baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest())};throw Error('offline');};
  try {
    await worker.run(f.request.id);const original=encoded.toString('base64'),guard=()=>{guards++;};
    const damaged=decodeSignedTransaction(encoded);damaged.signature.ed25519Signature.data[0]^=1;
    for(const [identity,call,bytes] of [[{...ref,txHash:'9'.repeat(32)},expected,original],[{...ref,sender:'other.testnet'},expected,original],
      [ref,{...expected,receiver:c.adapter},original],[ref,{...expected,deposit:'0'},original],[ref,{...expected,args:{path:[]}},original],
      [ref,expected,Buffer.from(encodeTransaction(damaged)).toString('base64')],[ref,expected,original+'\n'],
      [ref,expected,Buffer.concat([encoded,Buffer.from([0])]).toString('base64')]])
      await assert.rejects(f.clients.rebroadcast(identity,call,bytes,guard));
    assert.equal(broadcasts,1);assert.equal(guards,0);assert.equal(f.signers(),1);
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

async function freeOrigin(){
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+probe.address().port;await new Promise(r=>probe.close(r));return origin;
}

test('executor service receives through a carrier, resumes after restart and returns encrypted results',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory,'rhea-swap',{intake:false}),origin=await freeOrigin(),forwardOrigin=await freeOrigin();let worker=f.make();
  const options={directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,senders:[f.owner.profile.id],now:f.now,mode:'execute'};
  let service=createDefiService({...options,worker});await service.listen();
  const carrier=createCarrier({origin:forwardOrigin,directory:join(directory,'forward'),peers:[origin],now:f.now});await carrier.listen();
  try {
    await carrierPost(forwardOrigin,'/v1/store',f.envelope);await carrier.tick();
    assert.equal(f.inbox.list().length,1);assert.equal(f.signers(),0);
    let received=await carrierPost(origin,'/v1/inbox',await inboxRequest(f.owner,origin,'',f.now()));
    assert.equal(received.envelopes.length,1);
    assert.equal((await openDefiReceipt(f.owner,f.identity.profile,received.envelopes[0].packet,f.request)).state,'stored');
    const receipt=received.envelopes[0];
    await service.close();worker.close();worker=f.make();service=createDefiService({...options,worker});await service.listen();
    for(let n=0;n<7;n++)await service.tick();
    received=await carrierPost(origin,'/v1/inbox',await inboxRequest(f.owner,origin,'',f.now()));
    assert.deepEqual(received.envelopes.find(e=>e.id===receipt.id),receipt);
    assert.equal(received.envelopes.length,2);
    const report=received.envelopes.find(e=>e.id!==receipt.id);
    const verified=await verifyDefiResult(f.owner,f.identity.profile,c,f.request,report.packet,{observe:f.clients.observe,now:f.now()});
    assert.equal(verified.state,'observed');assert.equal(verified.observation.order.stage,'complete');
    assert.deepEqual(f.sent,['settle','submit','advance','advance','advance','advance','advance']);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
    const outsider=await createIdentity('Other');
    const hidden=await carrierPost(origin,'/v1/inbox',await inboxRequest(outsider,origin,'',f.now()));
    assert.deepEqual(hidden.envelopes,[]);
  } finally {await service.close();worker.close();f.inbox.close();await carrier.close();}
}));

test('executor service defaults to checks and rejects unapproved senders and unauthenticated reads',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory,'rhea-swap',{intake:false}),worker=f.make(),origin=await freeOrigin();
  const service=createDefiService({directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,worker,senders:[f.owner.profile.id],now:f.now});await service.listen();
  try {
    await carrierPost(origin,'/v1/store',f.envelope);await service.tick();
    assert.deepEqual(f.sent,[]);assert.equal(f.signers(),0);
    const reply=await carrierPost(origin,'/v1/inbox',await inboxRequest(f.owner,origin,'',f.now()));
    const payloads=await Promise.all(reply.envelopes.map(e=>f.read(e.packet)));
    assert(payloads.some(p=>p.state==='ready'));assert(payloads.some(p=>p.state==='stored'));
    const other=await createIdentity('Unknown owner'),vault=emptyNearVault(c.reserve),root=await fundingRequest(other,c.reserve,'10');
    vault.roots.push({id:root.id,owner:root.owner,amount:root.amount});
    const prepared=await prepareRheaSwap(vault,other,c,{text:'1',minOutput:'100',receiver:sponsor,deadlineMs:f.now()+120000},f.now());
    const request=await createDefiRequest(other,f.identity.profile,c,{kind:'rhea-swap',packet:prepared.packet},{disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:f.now()+60000},f.now());
    const packet=await sealDefiRequest(other,f.identity.profile,c,request,f.now());
    await assert.rejects(carrierPost(origin,'/v1/store',await wrapForCarrier(other,packet,f.now())));
    assert.equal(f.inbox.list().length,1);
    const q=await inboxRequest(f.owner,origin,'',f.now());q.signature='0'.repeat(128);
    await assert.rejects(carrierPost(origin,'/v1/inbox',q));
    const response=await fetch(origin+'/v1/store',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:JSON.stringify(f.envelope)});
    assert.equal(response.status,400);
    const forbidden=await fetch(origin+'/run',{method:'POST'});assert.equal(forbidden.status,404);
    assert.equal(f.signers(),0);
  } finally {await service.close();worker.close();f.inbox.close();}
}));

test('executor service replays exact replies after lost acknowledgement and protects sender policy across restart',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory,'rhea-swap',{intake:false}),worker=f.make(),origin=await freeOrigin();
  const options={directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,worker,senders:[f.owner.profile.id],now:f.now};
  let service=createDefiService(options);await service.listen();
  try {
    await carrierPost(origin,'/v1/store',f.envelope);
    const query=()=>inboxRequest(f.owner,origin,'',f.now());
    const first=await carrierPost(origin,'/v1/inbox',await query());
    await Promise.all([carrierPost(origin,'/v1/store',f.envelope),carrierPost(origin,'/v1/store',f.envelope)]);
    assert.deepEqual(await carrierPost(origin,'/v1/inbox',await query()),first);
    await service.close();service=createDefiService(options);await service.listen();
    assert.deepEqual(await carrierPost(origin,'/v1/inbox',await query()),first);
    await assert.rejects(carrierPost(origin,'/v1/store',{...f.envelope,signature:'0'.repeat(128)}));
    assert.throws(()=>createDefiService({...options,senders:['a'.repeat(64)]}),/sender policy/);
    assert.deepEqual(f.sent,[]);
  } finally {await service.close();worker.close();f.inbox.close();}
}));

test('executor service recovers accepted intake without a reply and does not execute when reply storage is full',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory,'rhea-swap',{intake:false}),worker=f.make(),origin=await freeOrigin();
  const options={directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,worker,senders:[f.owner.profile.id],now:f.now,mode:'execute'};
  let service=createDefiService({...options,maxBytes:1});await service.listen();
  try {
    await assert.rejects(carrierPost(origin,'/v1/store',f.envelope));assert.equal(f.inbox.list().length,1);
    assert.equal((await service.tick())[0].state,'unavailable');assert.equal(f.signers(),0);
    await service.close();service=createDefiService(options);await service.listen();
    await service.tick();assert.deepEqual(f.sent,['settle']);
    const received=await carrierPost(origin,'/v1/inbox',await inboxRequest(f.owner,origin,'',f.now()));
    assert.equal(received.envelopes.length,2);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {await service.close();worker.close();f.inbox.close();}
}));

test('executor service reserves report capacity and stops when a reopened quota cannot hold results',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory),worker=f.make(),origin=await freeOrigin();
  const options={directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,worker,senders:[f.owner.profile.id],now:f.now,mode:'execute'};
  let service=createDefiService(options);await service.listen();
  try {
    await carrierPost(origin,'/v1/store',f.envelope);await service.close();
    service=createDefiService({...options,maxBytes:3000});await service.listen();
    await service.tick();await service.tick();assert.deepEqual(f.sent,[]);assert.equal(f.signers(),0);
    await service.close();service=createDefiService(options);await service.listen();await service.tick();assert.deepEqual(f.sent,['settle']);
  } finally {await service.close();worker.close();f.inbox.close();}
}));

test('executor service saves an undelivered journal result before any further execution',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory),worker=f.make(),origin=await freeOrigin();
  const service=createDefiService({directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,worker,senders:[f.owner.profile.id],now:f.now,mode:'execute'});await service.listen();
  const disk=new DatabaseSync(join(directory,'delivery','delivery.sqlite'));
  try {
    await carrierPost(origin,'/v1/store',f.envelope);
    disk.exec("CREATE TRIGGER failed_result_write BEFORE INSERT ON replies WHEN NEW.kind='report' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END");
    await service.tick();assert.deepEqual(f.sent,['settle']);
    await service.tick();assert.deepEqual(f.sent,['settle']);
    disk.exec('DROP TRIGGER failed_result_write');await service.tick();assert.deepEqual(f.sent,['settle','submit']);
  } finally {disk.close();await service.close();worker.close();f.inbox.close();}
}));

test('executor service renews delivery of saved evidence after expiry without spending',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory),worker=f.make(),origin=await freeOrigin();
  const service=createDefiService({directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,worker,senders:[f.owner.profile.id],now:f.now,mode:'execute'});await service.listen();
  try {
    f.data.order={id:f.operation.packet.id,instruction:f.operation.packet.instruction,stage:'complete',output:'100',reason:''};
    await service.tick();
    const query=()=>inboxRequest(f.owner,origin,'',f.now());
    const first=await carrierPost(origin,'/v1/inbox',await query());assert.equal(first.envelopes.length,2);
    f.clock(f.now()+86400001);f.offline(true);
    assert.deepEqual((await carrierPost(origin,'/v1/inbox',await query())).envelopes,[]);
    await service.tick();
    const recovered=await carrierPost(origin,'/v1/inbox',await query());assert.equal(recovered.envelopes.length,2);
    assert.deepEqual(recovered.envelopes.map(e=>e.packet),first.envelopes.map(e=>e.packet));
    assert(recovered.envelopes.every(e=>e.createdAt===f.now()));
    assert.equal(f.signers(),0);assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {await service.close();worker.close();f.inbox.close();}
}));

test('executor service coalesces work and closes without starting another action',async()=>temporary(async directory=>{
  const {createDefiService}=await import('../carrier/defi-service.mjs');
  const f=await fixture(directory),worker=f.make(),origin=await freeOrigin();
  const service=createDefiService({directory:join(directory,'delivery'),origin,inbox:f.inbox,identity:f.identity,worker,senders:[f.owner.profile.id],now:f.now,mode:'execute'});await service.listen();
  let release,entered;const gate=new Promise(r=>{release=r;}),waiting=new Promise(r=>{entered=r;}),send=f.rpc.sendTransactionUntil;
  f.rpc.sendTransactionUntil=async(signed,wait)=>{entered();await gate;return send(signed,wait);};
  try {
    const first=service.tick();assert.equal(service.tick(),first);await waiting;
    const closing=service.close();release();await Promise.all([first,closing]);
    assert.deepEqual(f.sent,['settle']);assert.equal(f.signers(),1);assert.throws(()=>service.tick(),/closed/);
  } finally {release();await service.close();worker.close();f.inbox.close();}
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
