import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256,packageDigest,verifyProofArtifacts} from './artifact-provenance.mjs';

function fixture() {
  const root=mkdtempSync(join(tmpdir(),'lenz-proof-provenance-'));
  const write=(file,value)=>writeFileSync(join(root,file),typeof value==='string'?value:JSON.stringify(value));
  mkdirSync(join(root,'build'));mkdirSync(join(root,'node_modules','utility'),{recursive:true});
  write('node_modules/utility/index.js','export const value=1;');
  const oldLock=JSON.stringify({packages:{'':{},'node_modules/utility':{version:'1.0.0'}}});
  write('package-lock.json',oldLock);write('build/proof.key','existing test key');
  const metadata={kind:'local-test-only-build',hashes:{'package-lock.json':sha256(oldLock),'build/proof.key':sha256('existing test key')}};
  write('build/build-metadata.json',metadata);
  function refresh() {
    const lock=JSON.stringify({packages:{'':{},'node_modules/utility':{version:'1.0.1'}}});write('package-lock.json',lock);
    const record={schema:'lenz/proof-dependency-refresh/v1',originalMetadataSha256:sha256(readFileSync(join(root,'build/build-metadata.json'))),
      originalLockSha256:sha256(oldLock),currentLockSha256:sha256(lock),
      installedPackages:{'node_modules/utility':packageDigest(join(root,'node_modules/utility'))}};
    write('dependency-refresh.json',record);return record;
  }
  return {root,write,metadata,refresh,close:()=>rmSync(root,{recursive:true,force:true})};
}

test('package digests distinguish embedded delimiters from separate files',()=>{
  const root=mkdtempSync(join(tmpdir(),'lenz-proof-package-'));
  try{
    writeFileSync(join(root,'a'),'a');writeFileSync(join(root,'b'),'b');
    const before=packageDigest(root);
    unlinkSync(join(root,'b'));writeFileSync(join(root,'a'),'a\0b\0b');
    assert.notEqual(packageDigest(root),before,'Different files must not share the hash transcript');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('original setup verifies without a refresh and still rejects changed artifacts',()=>{
  const f=fixture();try{assert.deepEqual(verifyProofArtifacts(f.root),f.metadata);f.write('build/proof.key','changed');
    assert.throws(()=>verifyProofArtifacts(f.root),/Stale proof artifact/);}finally{f.close();}
});

test('exact dependency refresh preserves original metadata and existing test key',()=>{
  const f=fixture();try{const before=readFileSync(join(f.root,'build/build-metadata.json'));f.refresh();
    assert.deepEqual(verifyProofArtifacts(f.root),f.metadata);assert.deepEqual(readFileSync(join(f.root,'build/build-metadata.json')),before);
    assert.equal(readFileSync(join(f.root,'build/proof.key'),'utf8'),'existing test key');}finally{f.close();}
});

test('refresh rejects changed lock, original build, dependency source and proof artifact',()=>{
  for(const change of ['lock','metadata','dependency','artifact']){
    const f=fixture();try{f.refresh();
      if(change==='lock')f.write('package-lock.json',{packages:{}});
      if(change==='metadata')f.write('build/build-metadata.json',{...f.metadata,extra:true});
      if(change==='dependency')f.write('node_modules/utility/index.js','export const value=2;');
      if(change==='artifact')f.write('build/proof.key','new test key');
      assert.throws(()=>verifyProofArtifacts(f.root),/Unreviewed dependency lock|Different original proof build|Dependency source changed|Stale proof artifact/);
    }finally{f.close();}
  }
});

test('refresh requires complete sources and both original and current lock identities',()=>{
  for(const field of ['installedPackages','extraPackage','originalLockSha256','currentLockSha256']){
    const f=fixture();try{const record=f.refresh();
      if(field==='extraPackage')record.installedPackages['node_modules/unlisted']='0'.repeat(64);
      else record[field]=field==='installedPackages'?{}:'0'.repeat(64);
      f.write('dependency-refresh.json',record);
      assert.throws(()=>verifyProofArtifacts(f.root));}finally{f.close();}
  }
});
