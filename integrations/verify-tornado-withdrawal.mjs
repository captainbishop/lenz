import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),file=new URL('./tornado-withdrawal.mjs',import.meta.url),source=await readFile(file,'utf8');
const mutations=[
 ['unknown fields',"Object.keys(value).sort().join(',')===[...keys].sort().join(',')",'true'],
 ['proof and terms','decoded[name]===approval[name]','true'],
 ['transaction destination','transaction.chainId===pin.chainId&&transaction.to===pin.pool','true'],
 ['new funds',"transaction.value==='0'",'true'],
 ['pool observation','observation[name]===pin[name]','true'],
 ['fresh state','observation.observedAt>=now-30000','true'],
 ['spent note','observation.spent===false','true'],
 ['known root','observation.knownRoot===true','true'],
 ['disclosure',"approval.disclosure==='tornado-classic-public-withdrawal-v1'",'true'],
 ['received minimum','denomination-fee>=minimum','true'],
];
const run=env=>spawnSync(process.execPath,['--test',fileURLToPath(new URL('./tornado-withdrawal.test.mjs',import.meta.url))],{env:{...process.env,...env},encoding:'utf8',windowsHide:true,timeout:30000});
const baseline=run({});assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
const directory=await mkdtemp(join(tmpdir(),'lenz-withdrawal-')),mutant=join(directory,'mutant.mjs'),results=[];
try{
 for(const [guard,from,to] of mutations){
  assert.equal(source.split(from).length,2,guard);
  await writeFile(mutant,source.replace(from,to).replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,file).href}${q}`));
  const r=run({LENZ_TORNADO_REVIEW_MODULE:mutant});assert.notEqual(r.status,0,guard);assert.match(r.stdout+r.stderr,/AssertionError/,guard);results.push({guard,detected:true});
 }
 const sourceHashes={};for(const path of ['integrations/tornado-withdrawal.mjs','integrations/tornado-withdrawal.test.mjs','aurora/tornado-codec.mjs'])sourceHashes[path]=createHash('sha256').update(await readFile(new URL(path,root))).digest('hex');
 const report={checkedAt:new Date().toISOString(),tests:6,guardAlterations:results.length,results,sourceHashes,scope:'Synthetic calldata only. No deployed pool, Groth16 proof, RPC state, signing, funding, or withdrawal verified.'};
 await writeFile(new URL('./tornado-withdrawal-verification.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await unlink(mutant).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
