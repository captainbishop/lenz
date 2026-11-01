// Remove review guards in isolated copies and require the behavioral tests to fail.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const mutations = [
  ['change ownership','payment-effects.mjs','value.changeOwned === true','true'],
  ['exact change value','payment-effects.mjs','assert.equal(value.change, review.summary.change);',''],
  ['request binding','payment-review.mjs','record.id !== input.id || record.state','false || record.state'],
  ['pre-check integrity','payment-review.mjs',"assert.equal(hash(await readFile(file)), record.sha256, 'Saved transaction changed');",''],
  ['post-check integrity','payment-review.mjs',"assert.equal(hash(await readFile(file)), record.sha256, 'Saved transaction changed during check');",''],
  ['persist before native I/O','payment-review.mjs',"record.effects = { status: 'checking', checkedAt: new Date().toISOString() }; await save(record);",''],
];
const results=[];
for(const [guard,file,from,to] of mutations){
  const directory=await mkdtemp(join(tmpdir(),'lenz-effects-mutation-'));
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  try{
    for(const source of ['payment-effects.mjs','payment-effects.test.mjs','payment-review.mjs','payment-freshness.mjs','companion.mjs']){
      let text=await readFile(new URL(source,import.meta.url),'utf8');
      if(source===file){assert(text.includes(from));text=text.replace(from,to);}
      await writeFile(join(directory,source),text);
    }
    const result=spawnSync(process.execPath,['--test','payment-effects.test.mjs'],{cwd:directory,encoding:'utf8',windowsHide:true,timeout:30000});
    assert.equal(result.error,undefined);assert.notEqual(result.status,0,guard+' survived');
    assert(!/SyntaxError|ERR_MODULE_NOT_FOUND/.test(result.stdout+result.stderr));
    assert.match(result.stdout, /tests 6/);results.push({guard,rejected:true});
  }finally{await rm(directory,{recursive:true,force:true});}
}
await writeFile(new URL('payment-effects-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
console.log(`PASS ${results.length} removed review guards caused test failures.`);
