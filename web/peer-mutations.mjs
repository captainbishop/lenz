import { mkdtemp, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const mutations = [
  { name: 'second-owner signature', file: 'peer-exchange.js', pattern: 'a missing second signature', from: "if (complete) assert(owners.every(owner => seen.has(owner)), 'Every input owner must sign');", to: "if (complete) assert(true, 'Every input owner must sign');" },
  { name: 'asset conservation', file: 'peer-exchange.js', pattern: 'asset inflation', from: "assert([...totals.values()].every(n => n === 0n), 'Value must be conserved for each asset');", to: "assert(true, 'Value must be conserved for each asset');" },
  { name: 'spent input', file: 'peer-exchange.js', pattern: 'an already spent input', from: "assert(!spent.has(input), 'Input already spent');", to: "assert(true, 'Input already spent');" },
  { name: 'network and pool binding', file: 'peer-exchange.js', pattern: 'cross-network and cross-pool', from: "assert(body.network === this.#network && body.pool === this.#pool, 'Wrong network or pool');", to: "assert(true, 'Wrong network or pool');" },
  { name: 'settlement deadline', file: 'peer-exchange.js', pattern: 'expiry is checked', from: "assert(body.deadline === 0 || now <= body.deadline, 'Agreement expired');", to: "assert(true, 'Agreement expired');" },
  { name: 'chat sender authentication', file: 'peer-crypto.js', pattern: 'ciphertext with a forged signature', from: "assert(await verifyValue(incoming ? peer.signingPublic : identity.profile.signingPublic, [...header(packet), packet.ciphertext], packet.signature), 'Message signature was rejected');", to: "assert(true, 'Message signature was rejected');" },
];
const work = await mkdtemp(join(tmpdir(), 'proof-u-peer-mutations-'));
const results = [];
for (const [i, mutation] of mutations.entries()) {
  const folder = join(work, String(i)); await mkdir(folder);
  for (const name of ['profile-display.js', 'peer-crypto.js', 'peer-exchange.js', 'peer-scenario.js']) await copyFile(new URL('./public/' + name, import.meta.url), join(folder, name));
  const file = join(folder, mutation.file); const source = await readFile(file, 'utf8');
  if (source.split(mutation.from).length !== 2) throw new Error(`Mutation target is not unique: ${mutation.name}`);
  await writeFile(file, source.replace(mutation.from, mutation.to));
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern', mutation.pattern, fileURLToPath(new URL('./peer.test.mjs', import.meta.url))],
    { encoding: 'utf8', env: { ...process.env, PEER_TEST_ROOT: pathToFileURL(folder + '/').href } });
  const output = result.stdout + result.stderr;
  const killed = result.status === 1 && /AssertionError|ERR_ASSERTION/.test(output);
  results.push({ name: mutation.name, test: mutation.pattern, killed });
  console.log(`${killed ? 'DETECTED' : 'NOT DETECTED'} ${mutation.name}`);
  if (!killed) { console.error(output); throw new Error('Mutation was not rejected by its assertion'); }
}
await writeFile(new URL('./peer-mutation-results.json', import.meta.url), JSON.stringify({ results, temporarySources: work }, null, 2) + '\n');
