// Exercise the expiry, request-binding and transaction-integrity guards in isolated copies.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const changes = [
  ['expiry boundary','payment-freshness.mjs','targetHeight > expiryHeight','false'],
  ['request binding','payment-review.mjs','record.id !== input.id || record.state','false || record.state'],
  ['pre-check integrity','payment-review.mjs',"assert.equal(hash(await readFile(file)), record.sha256, 'Saved transaction changed');",''],
  ['post-check integrity','payment-review.mjs',"assert.equal(hash(await readFile(file)), record.sha256, 'Saved transaction changed during check');",''],
];
const results=[];
for(const [name,file,from,to] of changes){
  const directory=await mkdtemp(join(tmpdir(),'lenz-expiry-mutation-'));
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));
  try{
    for(const source of ['payment-freshness.mjs','payment-effects.mjs','payment-review.mjs','companion.mjs','payment-freshness.test.mjs']){
      let text=await readFile(new URL(source,import.meta.url),'utf8');
      if(source===file){assert(text.includes(from));text=text.replaceAll(from,to);}
      await writeFile(join(directory,source),text);
    }
    const r=spawnSync(process.execPath,['--test','payment-freshness.test.mjs'],{cwd:directory,encoding:'utf8',windowsHide:true});
    assert.notEqual(r.status,0,`${name} survived`);assert(!/SyntaxError|ERR_MODULE_NOT_FOUND/.test(r.stdout+r.stderr));
    assert.match(r.stdout, /tests 7/);results.push({guard:name,rejected:true});
  }finally{await rm(directory,{recursive:true,force:true});}
}
await writeFile(new URL('payment-freshness-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
console.log(JSON.stringify(results,null,2));
