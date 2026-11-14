import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const webRoot=dirname(fileURLToPath(import.meta.url)),script=join(webRoot,'build-tornado-prover.mjs');
const artifactRoot=process.env.LENZ_TORNADO_ARTIFACTS,toolsRoot=process.env.LENZ_TORNADO_TOOLS;
assert(artifactRoot&&toolsRoot,'Set the pinned artifact and tool paths');
const testRoot=resolve(dirname(artifactRoot));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=env=>spawnSync(process.execPath,[script],{cwd:resolve(webRoot,'..'),env:{...process.env,...env},encoding:'utf8'});
async function cleanup(folder){assert.equal(dirname(resolve(folder)),testRoot);await rm(folder,{recursive:true,force:true});}

test('the pinned browser build is reproducible and keeps the proving artifacts outside the bundle',async()=>{
 const before=JSON.parse(await readFile(join(webRoot,'tornado-prover-build.json'),'utf8')),result=run({});
 assert.equal(result.status,0,result.stderr);
 const after=JSON.parse(await readFile(join(webRoot,'tornado-prover-build.json'),'utf8'));
 assert.deepEqual(after.outputs,before.outputs);
 for(const [name,digest]of Object.entries(after.outputs))assert.equal(hash(await readFile(join(webRoot,'public/tornado-vendor',name))),digest);
 const source=await readFile(join(webRoot,'public/tornado-vendor/prover-worker.js'),'utf8');
 assert(!/\beval\s*\(|\bnew\s+Function\s*\(|worker_threads/.test(source),'Runtime must contain no JavaScript evaluation or Node worker path');
 await assert.rejects(readFile(join(webRoot,'public/tornado-vendor/withdraw_proving_key.bin')));
 await assert.rejects(readFile(join(webRoot,'public/tornado-vendor/withdraw.json')));
 await readFile(join(webRoot,'public/tornado-vendor/COPYING.txt'));
});

test('a changed dependency aborts before writing a browser runtime',async()=>{
 const folder=await mkdtemp(join(testRoot,'tornado-build-source-'));
 try{
  const before=await readFile(join(webRoot,'public/tornado-vendor/prover-worker.js'));
  const pins=JSON.parse(await readFile(join(webRoot,'tornado-prover-inputs.json'),'utf8')),name=Object.keys(pins.inputs)[0];
  const target=join(folder,'node_modules',name);await mkdir(dirname(target),{recursive:true});await writeFile(target,'changed negative control');
  const result=run({LENZ_TORNADO_TOOLS:folder});assert.equal(result.status,1);assert.match(result.stderr,/Pinned Tornado dependency changed/);
  assert.deepEqual(await readFile(join(webRoot,'public/tornado-vendor/prover-worker.js')),before);
 }finally{await cleanup(folder);}
});

test('a changed released circuit aborts before writing a browser runtime',async()=>{
 const folder=await mkdtemp(join(testRoot,'tornado-build-artifact-'));
 try{
  const before=await readFile(join(webRoot,'public/tornado-vendor/prover-worker.js'));await writeFile(join(folder,'withdraw.json'),'{}');
  const result=run({LENZ_TORNADO_ARTIFACTS:folder});assert.equal(result.status,1);assert.match(result.stderr,/Released Tornado artifact hash mismatch/);
  assert.deepEqual(await readFile(join(webRoot,'public/tornado-vendor/prover-worker.js')),before);
 }finally{await cleanup(folder);}
});
