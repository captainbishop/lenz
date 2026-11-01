import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const source = await readFile(new URL('./rpc.mjs', import.meta.url), 'utf8');
const tests = await readFile(new URL('./rpc.test.mjs', import.meta.url), 'utf8');
const controls = [
  ['read-method restriction', "  if (!METHODS.has(method)) throw new Error('Unsupported Aurora read method');", ''],
  ['response request ID', 'body.id !== 1 ||', ''],
  ['streamed byte limit', "      if (size > MAX_RPC_BYTES) throw new Error('Aurora RPC response is too large');", ''],
];
const base = await realpath(tmpdir()), folder = await mkdtemp(path.join(base, 'lenz-aurora-rpc-'));
try {
  await writeFile(path.join(folder, 'rpc.test.mjs'), tests);
  const run = () => spawnSync(process.execPath, ['--test', path.join(folder, 'rpc.test.mjs')], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  await writeFile(path.join(folder, 'rpc.mjs'), source);
  const baseline = run(); assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
  for (const [name, before, after] of controls) {
    assert.equal(source.split(before).length, 2, name + ' mutation is not unique');
    await writeFile(path.join(folder, 'rpc.mjs'), source.replace(before, after));
    const result = run(); assert.equal(result.status, 1, name + ' did not fail the tests');
    assert(!result.error, name + ' failed to execute');
    console.log('DETECTED ' + name);
  }
} finally {
  const resolved = await realpath(folder);
  assert.equal(path.dirname(resolved), base); assert(path.basename(resolved).startsWith('lenz-aurora-rpc-'));
  await rm(resolved, { recursive: true, force: true });
}
