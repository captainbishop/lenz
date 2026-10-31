import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const source = await readFile(new URL('./public/proof-worker.js', import.meta.url), 'utf8');
const suite = await readFile(new URL('./proof-worker.test.mjs', import.meta.url), 'utf8');
const results = [];
const mutants = [
  ['send input before readiness', 'let started = false;', 'worker.postMessage(input); let started = true;'],
  ['treat progress as a final result', 'onProgress(data.stage); return;', 'onProgress(data.stage); finish(null, data); return;'],
];
for (const [name, before, after] of mutants) {
  assert(source.includes(before), `Mutation target missing: ${name}`);
  const directory = await mkdtemp(join(tmpdir(), 'proof-u-worker-mutation-'));
  try {
    await mkdir(join(directory, 'public'));
    await writeFile(join(directory, 'public/proof-worker.js'), source.replace(before, after));
    await writeFile(join(directory, 'proof-worker.test.mjs'), suite);
    const run = spawnSync(process.execPath, ['--test', 'proof-worker.test.mjs'], { cwd: directory, encoding: 'utf8', timeout: 10000 });
    if (run.error) throw run.error;
    assert.equal(run.status, 1, `Expected assertion failure for ${name}: ${run.stdout}${run.stderr}`);
    assert.match(run.stdout + run.stderr, /AssertionError/, `No assertion evidence: ${name}`);
    results.push({ name, killed: true }); console.log(`Killed: ${name}`);
  } finally {
    const absolute = resolve(directory), parent = resolve(tmpdir());
    assert(absolute.startsWith(parent + sep) && absolute.slice(parent.length + 1).startsWith('proof-u-worker-mutation-'));
    await rm(absolute, { recursive: true, force: true });
  }
}
await writeFile(new URL('./worker-mutation-results.json', import.meta.url), JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + '\n');
