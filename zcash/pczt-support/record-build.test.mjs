import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,basename,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('recording a rebuilt native tool preserves the reproducible bounded creation patch and pins',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lenz-build-recorder-'));
 try{
  const source=join(directory,'tooling/zcash-devtool'),support=join(directory,'zcash/pczt-support');
  await mkdir(join(source,'src/commands/pczt'),{recursive:true});await mkdir(join(source,'target/release'),{recursive:true});await mkdir(support,{recursive:true});
  await copyFile(new URL('./record-build.mjs',import.meta.url),join(support,'record-build.mjs'));
  const git=args=>{const result=spawnSync('git',['-C',source,...args],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);return result.stdout;};
  git(['init','--quiet']);git(['config','user.name','Disposable build test']);git(['config','user.email','build-test@example.invalid']);git(['config','core.autocrlf','false']);
  await writeFile(join(source,'Cargo.toml'),'[package]\nname="fixture"\n');await writeFile(join(source,'Cargo.lock'),'fixture-lock\n');
  await writeFile(join(source,'src/commands/pczt/sign.rs'),'fn sign() {}\n');await writeFile(join(source,'src/commands/pczt/create.rs'),'fn create() {}\n');
  git(['add','Cargo.toml','Cargo.lock','src']);git(['commit','--quiet','-m','Disposable recorder baseline']);
  const original=Buffer.from('fixture original tool'),candidate=Buffer.from('fixture rebuilt tool');
  await writeFile(join(source,'target/release/zcash-devtool.exe'),original);await writeFile(join(source,'target/release/lenz-zcash-pczt.exe'),candidate);
  await writeFile(join(directory,'zcash/source-lock.json'),JSON.stringify({revision:git(['rev-parse','HEAD']).trim(),librustzcashRevision:'fixture',windowsExeSha256:sha(original),cargoLockSha256:sha('fixture-lock\n'),rust:'fixture'}));
  await writeFile(join(source,'src/commands/pczt/sign.rs'),'fn sign() { sign_ironwood(); }\n');
  const create='fn bounded_expiry() { /* explicit expiry_blocks */ }\n';await writeFile(join(source,'src/commands/pczt/create.rs'),create);
  const run=spawnSync(process.execPath,[join(support,'record-build.mjs')],{encoding:'utf8',windowsHide:true});assert.equal(run.status,0,run.stderr);
  const recorded=JSON.parse(await readFile(join(support,'build.json'),'utf8')),patch=await readFile(join(support,'ironwood-test-signer.patch'),'utf8');
  assert.equal(recorded.expiryWindowVersion,1);assert.equal(recorded.createSourceSha256,sha(create));assert.equal(recorded.windowsExeSha256,sha(candidate));
  assert(patch.includes('src/commands/pczt/create.rs')&&patch.includes('bounded_expiry'),'The recorded patch must reproduce bounded unsigned creation.');
 }finally{assert.equal(dirname(await realpath(directory)),await realpath(tmpdir()));assert(basename(directory).startsWith('lenz-build-recorder-'));await rm(directory,{recursive:true,force:true});}
});
