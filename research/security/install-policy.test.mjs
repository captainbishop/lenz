import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const exec=promisify(execFile);
const npm=process.env.LENZ_NPM_CLI??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
test('real npm install blocks lifecycle code; removing policy runs the harmless marker',async()=>{
  const root=await mkdtemp(join(tmpdir(),'lenz-install-policy-'));
  const source=join(root,'fixture');await mkdir(source);
  await writeFile(join(source,'package.json'),JSON.stringify({name:'lenz-harmless-install-fixture',version:'1.0.0',scripts:{postinstall:'node marker.cjs'}}));
  await writeFile(join(source,'marker.cjs'),"require('node:fs').writeFileSync('lifecycle-ran.txt','harmless local test')");
  const env={...process.env};for(const key of Object.keys(env))if(/^npm_config_/i.test(key))delete env[key];
  // No registry dependencies; npm pack runs no lifecycle hooks in this fixture.
  await exec(process.execPath,[npm,'pack','--ignore-scripts','--offline','--json'],{cwd:source,env});
  for(const protectedInstall of [true,false]){
    const dir=join(root,protectedInstall?'protected':'control');await mkdir(dir);
    await writeFile(join(dir,'package.json'),JSON.stringify({name:'lenz-policy-fixture',version:'1.0.0',private:true}));
    // Explicit false in the control also overrides any user's global true setting.
    await writeFile(join(dir,'.npmrc'),protectedInstall?await readFile(new URL('../../integrations/quote-verifier/.npmrc',import.meta.url)):'ignore-scripts=false\n');
    await exec(process.execPath,[npm,'install',join(source,'lenz-harmless-install-fixture-1.0.0.tgz'),'--offline','--no-audit','--no-fund'],{cwd:dir,env});
    const marker=join(dir,'node_modules/lenz-harmless-install-fixture/lifecycle-ran.txt');
    if(protectedInstall)await assert.rejects(access(marker),{code:'ENOENT'});else assert.equal(await readFile(marker,'utf8'),'harmless local test');
  }
});
