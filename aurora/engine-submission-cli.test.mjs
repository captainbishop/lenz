import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {fixture,operation} from './engine-submission-fixtures.mjs';
const cli=fileURLToPath(new URL('./scripts/engine-submission.js',import.meta.url));
const run=(...args)=>spawnSync(process.execPath,[cli,...args],{windowsHide:true,encoding:'utf8',timeout:10000});
test('CLI records and inspects across processes without exposing signed bytes',t=>{
  const directory=mkdtempSync(join(tmpdir(),'lenz-engine-cli-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const f=fixture(),request=join(directory,'request.json'),store=join(directory,'journal');
  writeFileSync(request,JSON.stringify({operationId:operation,reference:f.reference,signedTxBase64:f.signedTxBase64}));
  const saved=run('record',request,'--journal',store);
  assert.equal(saved.status,0,saved.stderr);assert.equal(JSON.parse(saved.stdout).outcome.state,'prepared');
  const inspected=run('inspect',operation,'--journal',store);
  assert.equal(inspected.status,0,inspected.stderr);assert.deepEqual(JSON.parse(inspected.stdout),JSON.parse(saved.stdout));
  assert(!saved.stdout.includes(f.signedTxBase64));assert(!inspected.stdout.includes(f.signedTxBase64));
  const changed=fixture();writeFileSync(request,JSON.stringify({operationId:operation,reference:changed.reference,signedTxBase64:changed.signedTxBase64}));
  assert.equal(run('record',request,'--journal',store).status,1);
  assert.equal(JSON.parse(run('inspect',operation,'--journal',store).stdout).txHash,f.reference.txHash);
});
test('CLI rejects malformed, oversized and unexpected inputs without printing them',t=>{
  const directory=mkdtempSync(join(tmpdir(),'lenz-engine-cli-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const request=join(directory,'request.json'),store=join(directory,'journal');
  for(const input of ['{','x'.repeat(128*1024+1),JSON.stringify({...fixture(),operationId:operation,extra:true})]){
    writeFileSync(request,input);
    const result=run('record',request,'--journal',store);
    assert.equal(result.status,1);assert.equal(result.stdout,'');assert(!result.stderr.includes(input));
  }
  assert.equal(run('inspect','invalid','--journal',store).status,1);
  assert.equal(run('inspect',operation,'--journal',store).status,1);
  assert.equal(run('record',request,'--extra','value').status,1);
  assert.equal(run('--help').status,0);
});

test('CLI reports denied and unavailable preflights without recording a dispatch',t=>{
  const directory=mkdtempSync(join(tmpdir(),'lenz-engine-cli-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const f=fixture(),request=join(directory,'request.json'),store=join(directory,'journal');
  writeFileSync(request,JSON.stringify({operationId:operation,reference:f.reference,signedTxBase64:f.signedTxBase64}));
  assert.equal(run('record',request,'--journal',store).status,0);
  for(const [state,exitCode] of [['blocked',1],['unavailable',2]]){
    const key=state==='blocked'?{result:{nonce:0,permission:{FunctionCall:{receiver_id:'aurora',method_names:['view'],allowance:null}},block_hash:'1'.repeat(31)+'2',block_height:1000}}:{error:{code:-32000,message:'UNKNOWN_ACCESS_KEY'}};
    const setup="globalThis.fetch=async(_url,init)=>{const request=JSON.parse(init.body);if(request.method==='send_tx')throw Error('Unexpected broadcast');return new Response(JSON.stringify({jsonrpc:'2.0',id:1,...(request.method==='status'?{result:{chain_id:'testnet'}}:"+JSON.stringify(key)+")}));};";
    const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(setup),cli,'send',operation,'--journal',store],{windowsHide:true,encoding:'utf8',timeout:10000});
    assert.equal(result.status,exitCode,result.stderr);assert.equal(JSON.parse(result.stdout).preflight.state,state);
    const saved=JSON.parse(run('inspect',operation,'--journal',store).stdout);
    assert.equal(saved.attempts,0);assert.equal(saved.outcome.state,'prepared');assert.equal(saved.txHash,f.reference.txHash);
  }
});
