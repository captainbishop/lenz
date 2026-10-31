import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=fileURLToPath(new URL('./',import.meta.url)),dir=await mkdtemp(path.join(here,'.upgrade-mutation-'));
const source=await readFile(new URL('./adapter-upgrade.mjs',import.meta.url),'utf8'),test=await readFile(new URL('./adapter-upgrade.test.mjs',import.meta.url),'utf8');
const guards=[
  ['artifact',"  assert.equal(sha(wasm),plan.newSha256,'Candidate differs from plan');",''],
  ['deploy-only',"  assert.deepEqual(t.actions,[{DeployContract:{code:Buffer.from(plan.newSha256,'hex').toString('base64')}}],'Expected exactly the reviewed deploy action');",''],
  ['state-preservation',"    assert.deepEqual(after.values,journal.before.values,'State changed during upgrade; do not enable recovery');",''],
  ['nonfinal-retry',"journal.transaction?.final_execution_status!=='FINAL'","!journal.transaction"]
];
const results=[];
try{
  await writeFile(path.join(dir,'adapter-upgrade.test.mjs'),test.replace("'./adapter/redemption-recovery/rehearsal.json'","'../adapter/redemption-recovery/rehearsal.json'"));
  for(const [name,guard,replacement] of guards){
    if(!source.includes(guard))throw Error('Missing guard '+name);
    await writeFile(path.join(dir,'adapter-upgrade.mjs'),source.replace(guard,replacement));
    const r=spawnSync(process.execPath,['--test',path.join(dir,'adapter-upgrade.test.mjs')],{encoding:'utf8',timeout:30000});
    const expected=name==='artifact'?"assert(!f.log.includes('signer'))":name==='nonfinal-retry'?'Upgrade is not final':'Missing expected';
    if(r.error||r.status===0||!r.stdout.includes(expected))throw Error('Unexpected mutation result '+name+'\n'+r.stdout+'\n'+r.stderr);
    results.push({guard:name,detected:true});console.log('DETECTED '+name);
  }
  await writeFile(new URL('./adapter/redemption-recovery/rollout-mutations.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
}finally{if(path.dirname(path.resolve(dir))!==path.resolve(here)||!path.basename(dir).startsWith('.upgrade-mutation-'))throw Error('Unsafe cleanup');await rm(dir,{recursive:true});}
