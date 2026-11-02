// Exercise provenance guards in disposable copies; never modify the proof setup.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {sha256} from './artifact-provenance.mjs';

const root=fileURLToPath(new URL('./',import.meta.url));
const files=['artifact-provenance.mjs','artifact-provenance.test.mjs'];
const sources=Object.fromEntries(await Promise.all(files.map(async file=>[file,await readFile(join(root,file),'utf8')])));
function run(cwd){
  const r=spawnSync(process.execPath,['--test','--test-reporter=tap',files[1]],
    {cwd,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
  assert.equal(r.error,undefined);assert.doesNotMatch(r.stdout+r.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);
  assert.match(r.stdout,/^# cancelled 0$/m);assert.match(r.stdout,/^# skipped 0$/m);return r;
}
const baseline=run(root);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
const variants=[
  ['original-metadata',"assert.equal(refresh.originalMetadataSha256,sha256(metadataBytes),'Different original proof build');",'', 'refresh rejects changed'],
  ['original-lock',"assert.equal(refresh.originalLockSha256,metadata.hashes['package-lock.json'],'Different original dependency lock');",'', 'refresh requires complete'],
  ['current-lock',"assert.equal(refresh.currentLockSha256,currentLock,'Unreviewed dependency lock');",'', 'refresh requires complete'],
  ['package-sources',"assert.equal(packageDigest(join(root,file)),refresh.installedPackages[file],'Dependency source changed: '+file);",'', 'refresh rejects changed'],
  ['artifact',"assert.equal(sha256(read(file)),hash,'Stale proof artifact: '+file);",'', 'original setup verifies'],
  ['package-coverage',"assert.deepEqual(Object.keys(refresh.installedPackages).sort(),packages,'Incomplete dependency source record');",'', 'refresh requires complete'],
  ['digest-boundaries',"else hash.update(JSON.stringify([relative,sha256(readFileSync(file))])+'\\n');",
    "else {hash.update(relative+'\\0');hash.update(readFileSync(file));hash.update('\\0');}", 'package digests distinguish'],
];
const mutations=[];
for(const [name,from,to,expected] of variants){
  assert.equal(sources[files[0]].split(from).length,2,'Mutation must match once: '+name);
  const directory=await mkdtemp(join(tmpdir(),'lenz-provenance-mutation-'));
  try{
    for(const file of files)await writeFile(join(directory,file),file===files[0]?sources[file].replace(from,to):sources[file]);
    const r=run(directory);assert.equal(r.status,1,name+' survived');
    const failedTests=[...r.stdout.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1]);
    assert(failedTests.some(test=>test.startsWith(expected)),name+' missed its intended assertion: '+r.stdout);
    assert.match(r.stdout,/ERR_ASSERTION/);
    mutations.push({name,detected:true,failedTests});console.log('Detected provenance alteration: '+name);
  }finally{assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}
}
const sourceFiles={};
for(const file of [...files,'provenance-verification.mjs'])sourceFiles[file]=sha256(await readFile(join(root,file)));
for(const file of files)assert.equal(sourceFiles[file],sha256(sources[file]),'Source changed during verification');
await writeFile(join(root,'provenance-results.json'),JSON.stringify({checkedAt:new Date().toISOString(),
  node:process.version,platform:process.platform,scope:'Temporary file fixtures and deliberate guard changes. No dependency installation, new setup, blockchain calls or wallet operation.',
  tests:{passed:Number(baseline.stdout.match(/^# tests (\d+)$/m)[1]),failed:0,skipped:0},mutations,sourceFiles},null,2)+'\n');
console.log('Provenance regression and mutation checks passed.');
