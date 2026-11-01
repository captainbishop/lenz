import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('./', import.meta.url);
const source = await readFile(new URL('local-evm.mjs', root), 'utf8');
const tests = await readFile(new URL('local-evm.test.mjs', root), 'utf8');
const controls = [
  ['static write rejection', 'isStatic: true', 'isStatic: false', 'Missing expected rejection'],
  ['read state rollback', 'await vm.stateManager.revert();', 'await vm.stateManager.commit();', 'deep-equal'],
  ['transaction balance validation', 'runTx(vm, { tx })', 'runTx(vm, { tx, skipBalance: true })', 'Missing expected rejection'],
];
await mkdir(new URL('cache/', root), { recursive: true });
const base = await realpath(fileURLToPath(new URL('cache/', root)));
const folder = await mkdtemp(path.join(base, 'evm-controls-'));
try {
  await writeFile(path.join(folder, 'local-evm.test.mjs'), tests.replace("'./compiler.mjs'", "'../../compiler.mjs'"));
  const run = () => spawnSync(process.execPath, ['--test', path.join(folder, 'local-evm.test.mjs')],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  await writeFile(path.join(folder, 'local-evm.mjs'), source);
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  for (const [name, before, after, diagnostic] of controls) {
    assert.equal(source.split(before).length, 2, name + ' mutation must be unique');
    await writeFile(path.join(folder, 'local-evm.mjs'), source.replace(before, after));
    const result = run();
    assert(!result.error, name + ' failed to execute');
    assert.equal(result.status, 1, name + ' did not fail the tests');
    assert((result.stdout + result.stderr).includes(diagnostic), result.stdout + result.stderr);
    console.log('DETECTED ' + name);
  }
} finally {
  const resolved = await realpath(folder);
  assert.equal(path.dirname(resolved), base);
  assert(path.basename(resolved).startsWith('evm-controls-'));
  await rm(resolved, { recursive: true, force: true });
}
