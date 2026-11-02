import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {transferFixture,transferReceipt,abi} from './engine-transfer-fixtures.mjs';
const cli=fileURLToPath(new URL('./scripts/check-transfer.js',import.meta.url));
const run=(args,preload='globalThis.fetch=()=>{throw Error("Unexpected network");};')=>spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(preload),cli,...args],{windowsHide:true,encoding:'utf8',timeout:10000});
test('CLI distinguishes reported transfers, false returns and pending receipts without broadcast',t=>{
  const directory=mkdtempSync(join(tmpdir(),'lenz-transfer-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const f=transferFixture(),path=join(directory,'expected.json');writeFileSync(path,JSON.stringify({reference:f.reference,payment:f.payment}));
  for(const [receipt,state,exit] of [[transferReceipt(f.reference,{logs:[f.log]}),'reported',0],[transferReceipt(f.reference,{logs:[f.log],output:abi.encodeFunctionResult('transfer',[false])}),'not_reported',1],[{final_execution_status:'NONE'},'unconfirmed',2]]){
    const preload="globalThis.fetch=async(_url,init)=>{if(JSON.parse(init.body).method!=='tx')throw Error('Unexpected write');return new Response("+JSON.stringify(JSON.stringify({jsonrpc:'2.0',id:1,result:receipt}))+");};";
    const result=run([path],preload);assert.equal(result.status,exit,result.stderr);assert.equal(JSON.parse(result.stdout).transfer.state,state);
  }
});
test('CLI rejects unexpected, oversized and invalid expectations and documents usage',t=>{
  const directory=mkdtempSync(join(tmpdir(),'lenz-transfer-cli-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'expected.json');
  for(const data of ['{','x'.repeat(72*1024+1),JSON.stringify({reference:{},payment:{},extra:true})]){
    writeFileSync(path,data);const result=run([path]);assert.equal(result.status,1);assert.equal(result.stdout,'');
  }
  assert.equal(run(['--help']).status,0);
});
