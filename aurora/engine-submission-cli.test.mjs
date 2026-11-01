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
