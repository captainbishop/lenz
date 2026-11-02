import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Include file names and contents; reject links that could escape the package.
export function packageDigest(directory) {
  const hash=createHash('sha256');
  function visit(path,prefix='') {
    assert(!lstatSync(path).isSymbolicLink(),'Linked dependency source');
    for(const name of readdirSync(path).sort()) {
      const file=join(path,name),relative=prefix+name,stat=lstatSync(file);
      assert(!stat.isSymbolicLink(),'Linked dependency source');
      if(stat.isDirectory())visit(file,relative+'/');
      else hash.update(JSON.stringify([relative,sha256(readFileSync(file))])+'\n');
    }
  }
  visit(directory);return hash.digest('hex');
}

export function verifyProofArtifacts(root) {
  const read=file=>readFileSync(join(root,file));
  const metadataBytes=read('build/build-metadata.json'),metadata=JSON.parse(metadataBytes);
  const lockBytes=read('package-lock.json'),currentLock=sha256(lockBytes);
  assert.equal(metadata.kind,'local-test-only-build','Unsupported proof artifact provenance');
  if(currentLock!==metadata.hashes['package-lock.json']) {
    // A reviewed compatibility record retains the original setup provenance.
    // It authorizes only these exact artifacts, lock bytes and installed sources.
    const refresh=JSON.parse(read('dependency-refresh.json'));
    assert.equal(refresh.schema,'lenz/proof-dependency-refresh/v1');
    assert.equal(refresh.originalMetadataSha256,sha256(metadataBytes),'Different original proof build');
    assert.equal(refresh.originalLockSha256,metadata.hashes['package-lock.json'],'Different original dependency lock');
    assert.equal(refresh.currentLockSha256,currentLock,'Unreviewed dependency lock');
    const packages=Object.keys(JSON.parse(lockBytes).packages).filter(Boolean).sort();
    assert.deepEqual(Object.keys(refresh.installedPackages).sort(),packages,'Incomplete dependency source record');
    for(const file of packages) {
      assert(file.startsWith('node_modules/')&&!file.includes('\\')
        && file.split('/').every(part=>part!=='.'&&part!=='..'&&part!==''),'Invalid dependency path');
      assert.equal(packageDigest(join(root,file)),refresh.installedPackages[file],'Dependency source changed: '+file);
    }
  }
  for(const [file,hash] of Object.entries(metadata.hashes)) {
    if(file==='package-lock.json')continue;
    assert.equal(sha256(read(file)),hash,'Stale proof artifact: '+file);
  }
  return metadata;
}
