import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Aurora tooling has no Zod dependency, including nested installations', async () => {
  const lock = JSON.parse(await readFile(new URL('./package-lock.json', import.meta.url)));
  const affected = Object.keys(lock.packages).filter(path => path.split('node_modules/').at(-1) === 'zod');
  assert.deepEqual(affected, [], 'The Zod advisory must not return through a transitive dependency');
});

test('Aurora dependencies are pinned, registry-integrity checked and installed without hooks', async () => {
  const root = new URL('./', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root)));
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root)));
  const policy = await readFile(new URL('.npmrc', root), 'utf8');
  assert.match(policy, /^ignore-scripts=true\s*$/m);
  assert.match(policy, /^save-exact=true\s*$/m);
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/);
    assert.equal(lock.packages[`node_modules/${name}`].version, version);
  }
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path) continue;
    assert.match(pkg.resolved, /^https:\/\/registry\.npmjs\.org\//);
    assert.match(pkg.integrity, /^sha512-/);
    assert(!pkg.hasInstallScript, `${path} introduces an installation hook`);
    const installed = await readFile(new URL(`${path}/package.json`, root)).then(JSON.parse).catch(error => {
      if (pkg.optional && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!installed) continue;
    assert.equal(installed.version, pkg.version, path);
  }
});
