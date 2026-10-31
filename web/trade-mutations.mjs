import { mkdtemp, readFile, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const source = await readFile(new URL('./public/trade-model.js', import.meta.url), 'utf8');
const mutations = [
  ['backing', "assert(keysAre(root, ['id', 'owner', 'asset', 'value']) && expected", "assert(true || keysAre(root, ['id', 'owner', 'asset', 'value']) && expected", 'inflated or unrelated demo roots'],
  ['participants', 'assert(details.from === (reverse ? recipient : sender)', 'assert(true || details.from === (reverse ? recipient : sender)', 'financial action and conversation participants'],
  ['local-offer', "assert(prior, 'No matching offer was saved on this device.');", "if (!prior) return checked.staged;", 'fully signed unsolicited reply'],
];
const results = [];
for (const [name, before, after, test] of mutations) {
  assert(source.includes(before));
  const folder = await mkdtemp(path.join(tmpdir(), 'lenz-mutation-'));
  await writeFile(path.join(folder, 'package.json'), '{"type":"module"}');
  for (const file of ['profile-display.js', 'peer-crypto.js', 'peer-exchange.js', 'exchange-reservations.js', 'trade-service.js']) await copyFile(new URL('./public/' + file, import.meta.url), path.join(folder, file));
  await writeFile(path.join(folder, 'trade-model.js'), source.replace(before, after));
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern', test, fileURLToPath(new URL('./trade.test.mjs', import.meta.url))], {
    encoding: 'utf8', env: { ...process.env, TRADE_TEST_ROOT: pathToFileURL(folder + path.sep).href }, timeout: 20000,
  });
  assert.equal(result.status, 1, `${name}: mutant survived or failed to run\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /Missing expected rejection/, `${name}: unexpected failure\n${result.stdout}\n${result.stderr}`);
  results.push({ name, detected: true }); console.log('DETECTED ' + name);
}
await writeFile(new URL('./trade-mutation-results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
