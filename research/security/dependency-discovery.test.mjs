import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkDependencies} from './check-dependencies.mjs';

test('dependency discovery honors local exclusions without hiding tracked or new product lockfiles',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lenz-dependency-discovery-'));
  const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,windowsHide:true,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
  async function project(dir){
    await mkdir(join(root,dir),{recursive:true});
    await writeFile(join(root,dir,'package-lock.json'),JSON.stringify({lockfileVersion:3,packages:{'':{name:'fixture',version:'1.0.0'}}}));
    await writeFile(join(root,dir,'package.json'),JSON.stringify({name:'fixture',version:'1.0.0'}));
    await writeFile(join(root,dir,'.npmrc'),'ignore-scripts=true\nsave-exact=true\n');
  }
  try{
    git('init','-q');
    await project('app');await project('new-component');await project('.hidden-product');await project('private-cache');
    await writeFile(join(root,'.git','info','exclude'),'private-cache/\n.hidden-product/\n');
    git('add','-f','.hidden-product');
    const result=await checkDependencies(root);
    assert(result.passed);
    assert.deepEqual(result.results.map(r=>r.file),['.hidden-product/package-lock.json','app/package-lock.json','new-component/package-lock.json']);
    await writeFile(join(root,'private-cache','package-lock.json'),'invalid private cache');
    assert((await checkDependencies(root)).passed);
  }finally{
    const resolved=await realpath(root);assert.equal(dirname(resolved),await realpath(tmpdir()));
    assert(resolved.includes('lenz-dependency-discovery-'));await rm(resolved,{recursive:true});
  }
});
