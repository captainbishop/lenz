import { readFile, writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const source = await readFile(new URL('./near-connector/meteor-popup.js', import.meta.url), 'utf8');
const suite = await readFile(new URL('./meteor-popup.test.mjs', import.meta.url), 'utf8');
const target = new URL(`./.meteor-mutation-${process.pid}.test.mjs`, import.meta.url);
const cases = [
  ['origin', "event.origin !== METEOR_ORIGIN || ", ''],
  ['source', " || event.source !== popup", ''],
  ['uid', " || data.uid !== uid", ''],
];
const results = [];
try {
  for (const [guard, before, after] of cases) {
    if (!source.includes(before)) throw Error('Mutation target missing: ' + guard);
    const module = 'data:text/javascript;base64,' + Buffer.from(source.replace(before, after)).toString('base64');
    await writeFile(target, suite.replace("'./near-connector/meteor-popup.js'", JSON.stringify(module)));
    const run = spawnSync(process.execPath, ['--test', '--test-name-pattern', `ignores a forged ${guard}`, fileURLToPath(target)], { encoding: 'utf8', timeout: 30000 });
    if (run.error || run.status === 0 || !run.stdout.includes('true !== false')) throw Error('Mutation did not fail the expected assertion: ' + guard + '\n' + run.stdout + run.stderr);
    results.push({ guard, detected: true }); console.log('DETECTED popup ' + guard);
  }
  await writeFile(new URL('./meteor-popup-mutation-results.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(), detected: results.length, results, scope: 'Removed checks in in-memory module copies; product files never mutated.' }, null, 2) + '\n');
} finally { await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
