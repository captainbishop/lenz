import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {EngineJournal} from './engine-journal.mjs';
import {validateSignedEngineCall,MAX_SIGNED_BYTES} from './engine-signed.mjs';
import {fixture,operation,finalTransaction,rpcFixture,response,accessKey} from './engine-submission-fixtures.mjs';

function setup(t){
  const directory=mkdtempSync(join(tmpdir(),'lenz-engine-test-')),journal=new EngineJournal(directory);
  t.after(()=>{try{journal.close();}catch{}rmSync(directory,{recursive:true,force:true});});
  return {directory,journal};
}
const prepare=(j,f=fixture())=>{j.record(operation,f.reference,f.signedTxBase64);return f;};
const writes=r=>r.requests.filter(x=>x.method==='send_tx');
test('bounded signed transaction verifies signature, hash and exact reviewed call',()=>{
  const f=fixture(),result=validateSignedEngineCall(f.reference,f.signedTxBase64);
  assert.equal(result.reference.txHash,f.reference.txHash);assert.equal(result.nonce,'1');assert.match(result.publicKey,/^ed25519:/);
  assert.deepEqual(result.reference,Object.fromEntries(Object.keys(f.reference).sort().map(k=>[k,f.reference[k]])));
  assert(!JSON.stringify(result).includes('private'));
});
test('signed action substitutions, extra actions and unreviewed deposits are rejected',()=>{
  const deposit=Buffer.alloc(16);deposit[0]=1;
  for(const wire of [{sender:'other.testnet'},{receiver:'other.testnet'},{nonce:0n},{keyTag:1},{count:0},{count:2},{tag:3},{method:'view'},{args:Buffer.alloc(1)},{gas:1n},{deposit},{signatureTag:1}]){
    const f=fixture({wire});assert.throws(()=>validateSignedEngineCall(f.reference,f.signedTxBase64));
  }
});
test('altered signatures, hashes, domains, trailing bytes and malformed vectors fail closed',()=>{
  const f=fixture(),bytes=Buffer.from(f.signedTxBase64,'base64');bytes[bytes.length-1]^=1;
  for(const signed of [bytes.toString('base64'),f.signedTxBase64+'\n',Buffer.concat([Buffer.from(f.signedTxBase64,'base64'),Buffer.from([0])]).toString('base64'),Buffer.alloc(MAX_SIGNED_BYTES+1).toString('base64'),'AQ==','AA==']){
    assert.throws(()=>validateSignedEngineCall(f.reference,signed));
  }
  for(const changes of [{network:'mainnet'},{gas:'1'},{txHash:'1'.repeat(32)},{extra:true},{input:'0x00'},{contract:'0x'+'34'.repeat(20)}]){
    assert.throws(()=>validateSignedEngineCall({...f.reference,...changes},f.signedTxBase64));
  }
});
test('operation is immutable across restart and another operation cannot reuse its transaction',t=>{
  const {journal,directory}=setup(t),f=prepare(journal),other=fixture();
  assert.equal(journal.record(operation,f.reference,f.signedTxBase64).attempts,0);
  assert.throws(()=>journal.record(operation,other.reference,other.signedTxBase64),/different/);
  assert.throws(()=>journal.record('b'.repeat(64),f.reference,f.signedTxBase64),/UNIQUE/);
  journal.close();const reopened=new EngineJournal(directory);
  try{assert.equal(reopened.inspect(operation).outcome.state,'prepared');assert(!JSON.stringify(reopened.inspect(operation)).includes(f.signedTxBase64));}finally{reopened.close();}
});
test('failed initial persistence and failed attempt persistence reach no broadcast',async t=>{
  const {journal,directory}=setup(t),db=new DatabaseSync(join(directory,'submissions.sqlite'));
  try{
  db.exec("CREATE TRIGGER fail_record BEFORE INSERT ON submissions BEGIN SELECT RAISE(ABORT,'injected write failure'); END;");
  const f=fixture();assert.throws(()=>prepare(journal,f),/injected/);
  db.exec('DROP TRIGGER fail_record;');prepare(journal,f);
  db.exec("CREATE TRIGGER fail_attempt BEFORE UPDATE OF attempts ON submissions BEGIN SELECT RAISE(ABORT,'injected attempt failure'); END;");
  const rpc=rpcFixture();await assert.rejects(journal.send(operation,rpc),/injected/);
  assert.equal(writes(rpc).length,0);assert.equal(journal.inspect(operation).attempts,0);
  }finally{db.close();}
});
test('a lost submission response survives reopening; normal send only checks status',async t=>{
  const {journal,directory}=setup(t),f=prepare(journal),rpc=rpcFixture({send:Error('Response lost')});
  const result=await journal.send(operation,rpc);assert.equal(result.outcome.state,'unavailable');assert.equal(result.attempts,1);
  assert.deepEqual(writes(rpc).map(r=>r.params),[{signed_tx_base64:f.signedTxBase64,wait_until:'NONE'}]);
  journal.close();const reopened=new EngineJournal(directory),recovery=rpcFixture({read:finalTransaction(f.reference)});
  try{
    const recovered=await reopened.send(operation,recovery);assert.equal(recovered.outcome.state,'evm_succeeded');
    assert.equal(recovered.attempts,1);assert.equal(writes(recovery).length,0);assert.deepEqual(recovery.requests.map(r=>r.method),['tx']);
    assert.equal(recovered.outcome.settled,undefined);
  }finally{reopened.close();}
});
test('explicit retry checks first and transmits exactly the original signed bytes',async t=>{
  const {journal}=setup(t),f=prepare(journal),rpc=rpcFixture();
  await journal.send(operation,rpc);const result=await journal.send(operation,{...rpc,retry:true});
  assert.equal(result.attempts,2);assert.deepEqual(rpc.requests.map(x=>x.method),['status','query','send_tx','tx','status','query','send_tx']);
  assert.deepEqual(writes(rpc).map(x=>x.params.signed_tx_base64),[f.signedTxBase64,f.signedTxBase64]);
});
test('included, unverified and final outcomes prevent an explicit retry',async t=>{
  for(const kind of ['INCLUDED','unverified','final']){
    const directory=mkdtempSync(join(tmpdir(),'lenz-engine-retry-')),j=new EngineJournal(directory),f=prepare(j);
    try{
      await j.send(operation,rpcFixture());
      const read=kind==='unverified'?{final_execution_status:'FINAL'}:kind==='final'?finalTransaction(f.reference):{final_execution_status:kind};
      const rpc=rpcFixture({read});const result=await j.send(operation,{...rpc,retry:true});
      assert.equal(writes(rpc).length,0);assert.equal(result.attempts,1);
    }finally{j.close();rmSync(directory,{recursive:true,force:true});}
  }
});
test('failed EVM and side receipts remain failures; EVM return false is not payment settlement',async t=>{
  for(const options of [{tag:1},{sideFailure:true},{output:Buffer.alloc(32)}]){
    const {journal}=setup(t),f=prepare(journal),rpc=rpcFixture({send:finalTransaction(f.reference,options)});
    const result=await journal.send(operation,rpc);
    assert.equal(result.outcome.state,options.tag?'evm_failed':options.sideFailure?'needs_review':'evm_succeeded');
    assert.equal(result.outcome.settled,undefined);
    await journal.send(operation,{...rpc,retry:true});assert.equal(writes(rpc).length,1);
  }
});
test('concurrent initial sends from separate journal connections claim one durable attempt',async t=>{
  const {journal,directory}=setup(t),f=prepare(journal),second=new EngineJournal(directory),rpc=rpcFixture();
  try{await Promise.all([journal.send(operation,rpc),second.send(operation,rpc)]);assert.equal(writes(rpc).length,1);assert.equal(journal.inspect(operation).attempts,1);}
  finally{second.close();}
});
test('process termination after dispatch retains the hash and forbids automatic retransmission',async t=>{
  const {journal,directory}=setup(t),f=prepare(journal);journal.close();
  const module=new URL('./engine-journal.mjs',import.meta.url).href;
  const code=`import {EngineJournal} from ${JSON.stringify(module)}; const j=new EngineJournal(process.argv[1]);await j.send(process.argv[2],{fetchImpl:async(url,init)=>{const r=JSON.parse(init.body);if(r.method==='send_tx')process.exit(78);return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:r.method==='query'?{nonce:0,permission:'FullAccess',block_hash:'1'.repeat(31)+'2',block_height:1000}:{chain_id:'testnet'}}));}});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',code,directory,operation],{windowsHide:true,encoding:'utf8'});
  assert.equal(child.status,78,child.stderr);
  const reopened=new EngineJournal(directory),rpc=rpcFixture({read:finalTransaction(f.reference)});
  try{assert.equal(reopened.inspect(operation).attempts,1);const recovered=await reopened.send(operation,rpc);assert.equal(recovered.outcome.state,'evm_succeeded');assert.equal(writes(rpc).length,0);}finally{reopened.close();}
});
test('a final result survives later unavailable evidence and rejects a conflicting final result',async t=>{
  const {journal}=setup(t),f=prepare(journal);
  await journal.send(operation,rpcFixture({send:finalTransaction(f.reference)}));
  const unavailable=await journal.check(operation,{fetchImpl:async()=>{throw Error('Offline');}});
  assert.equal(unavailable.outcome.state,'evm_succeeded');
  await assert.rejects(journal.check(operation,rpcFixture({read:finalTransaction(f.reference,{tag:1})})),/Conflicting/);
  assert.equal(journal.inspect(operation).outcome.state,'evm_succeeded');
});
test('wrong network and invalid stored bytes cannot reach send_tx',async t=>{
  const {journal,directory}=setup(t);prepare(journal);const rpc=rpcFixture({chain:'mainnet'});
  await assert.rejects(journal.send(operation,rpc),/not NEAR testnet/);assert.equal(writes(rpc).length,0);
  const db=new DatabaseSync(join(directory,'submissions.sqlite'));
  db.prepare('UPDATE submissions SET signed=?').run('AA==');db.close();
  await assert.rejects(journal.send(operation,rpc));assert.equal(writes(rpc).length,0);
});
test('a stalled response remains uncertain without a replacement transaction',async t=>{
  const {journal}=setup(t),f=prepare(journal);
  let sends=0;
  const fetchImpl=async(_url,init)=>{
    if(JSON.parse(init.body).method==='status')return response({chain_id:'testnet'});
    if(JSON.parse(init.body).method==='query')return response(accessKey());
    sends++;return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '));}}));
  };
  const result=await journal.send(operation,{fetchImpl,timeoutMs:20});assert.equal(result.outcome.state,'unavailable');assert.equal(result.attempts,1);assert.equal(sends,1);
  assert.equal(journal.inspect(operation).txHash,f.reference.txHash);
});

test('repeating send with no final receipt never rebroadcasts implicitly',async t=>{
  const {journal}=setup(t);prepare(journal);const rpc=rpcFixture();
  await journal.send(operation,rpc);
  const result=await journal.send(operation,rpc);
  assert.equal(result.outcome.state,'pending');assert.equal(result.attempts,1);
  assert.deepEqual(rpc.requests.map(r=>r.method),['status','query','send_tx','tx']);
});
test('failed receipt persistence leaves the original attempt available for read-only recovery',async t=>{
  const {journal,directory}=setup(t),f=prepare(journal),db=new DatabaseSync(join(directory,'submissions.sqlite'));
  try{
    db.exec("CREATE TRIGGER fail_result BEFORE UPDATE OF observation ON submissions WHEN NEW.observation IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected result failure'); END;");
    const rpc=rpcFixture({send:finalTransaction(f.reference)});
    await assert.rejects(journal.send(operation,rpc),/injected result/);
    assert.equal(journal.inspect(operation).attempts,1);assert.equal(writes(rpc).length,1);
    db.exec('DROP TRIGGER fail_result;');
    const recovery=rpcFixture({read:finalTransaction(f.reference)}),result=await journal.send(operation,recovery);
    assert.equal(result.outcome.state,'evm_succeeded');assert.equal(writes(recovery).length,0);
  }finally{db.close();}
});

test('an observed included transaction is not sent as a first journal attempt',async t=>{
  const {journal}=setup(t);prepare(journal);
  const rpc=rpcFixture({read:{final_execution_status:'INCLUDED'}});
  await journal.check(operation,rpc);
  const result=await journal.send(operation,rpc);
  assert.equal(writes(rpc).length,0);assert.equal(result.attempts,0);assert.equal(result.outcome.finality,'INCLUDED');
});

test('a newer final observation cannot be cleared by a retry with an older check result',async t=>{
  const {journal,directory}=setup(t),f=prepare(journal),second=new EngineJournal(directory);
  try{
    await journal.send(operation,rpcFixture());
    const original=journal.check.bind(journal);
    journal.check=async(...args)=>{
      const stale=await original(...args);
      await second.check(operation,rpcFixture({read:finalTransaction(f.reference)}));
      return stale;
    };
    const rpc=rpcFixture(),result=await journal.send(operation,{...rpc,retry:true});
    assert.equal(writes(rpc).length,0);assert.equal(result.attempts,1);assert.equal(result.outcome.state,'evm_succeeded');
  }finally{second.close();}
});

test('saved bytes and the attempt are visible to a separate connection before dispatch',async t=>{
  const {journal,directory}=setup(t),f=prepare(journal),db=new DatabaseSync(join(directory,'submissions.sqlite'));
  let observed=false;
  try{
    const rpc=rpcFixture({send:()=>{
      const row=db.prepare('SELECT * FROM submissions WHERE id=?').get(operation);
      assert.equal(row.signed,f.signedTxBase64);assert.equal(row.tx_hash,f.reference.txHash);
      assert.equal(row.attempts,1);assert.equal(row.revision,1);observed=true;
      return {final_execution_status:'NONE'};
    }});
    await journal.send(operation,rpc);assert(observed);
  }finally{db.close();}
});

test('journal and attempt bounds preserve existing records without dispatching',async t=>{
  const {journal,directory}=setup(t);
  for(let i=1;i<=128;i++){const f=fixture();journal.record(i.toString(16).padStart(64,'0'),f.reference,f.signedTxBase64);}
  const f=fixture();assert.throws(()=>journal.record(operation,f.reference,f.signedTxBase64),/capacity/);
  const id='1'.padStart(64,'0'),before=journal.inspect(id);
  const db=new DatabaseSync(join(directory,'submissions.sqlite'));
  db.prepare('UPDATE submissions SET attempts=100 WHERE id=?').run(id);db.close();
  const rpc=rpcFixture();await assert.rejects(journal.send(id,{...rpc,retry:true}),/attempt limit/);
  assert.equal(writes(rpc).length,0);assert.equal(journal.inspect(id).txHash,before.txHash);
});
