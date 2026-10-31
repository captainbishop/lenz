// Disposable testnet wallet bridge. Never reads Lenz browser keys or a user wallet.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [action = 'check', name = 'a', ...options] = process.argv.slice(2);
assert(options.length === 0 || (options.length === 1 && options[0] === '--no-save'), 'Unsupported wallet option');
assert(['check', 'init', 'info', 'sync', 'address', 'sapling-address', 'balance', 'transactions'].includes(action), 'Unsupported wallet action');
assert(['a', 'b'].includes(name), 'Choose disposable wallet a or b');
const lock = JSON.parse(await readFile(new URL('./source-lock.json', import.meta.url)));
const executable = new URL('../tooling/zcash-devtool/target/release/zcash-devtool.exe', import.meta.url);
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(checksum(await readFile(executable)), lock.windowsExeSha256, 'Wallet executable differs from the recorded build');
assert.equal(checksum(await readFile(new URL('../tooling/zcash-devtool/Cargo.lock', import.meta.url))), lock.cargoLockSha256, 'Wallet dependencies changed');
let result = { action, wallet: name, network: 'test', checkedAt: new Date().toISOString(), sourceRevision: lock.revision };
if (action !== 'check') {
  const directory = new URL(`./.testnet/${name}/`, import.meta.url), config = new URL('keys.toml', directory);
  const exists = await access(config).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });
  if (action === 'init') {
    assert(!exists, 'This disposable wallet already exists; use sync or address');
    await mkdir(directory, { recursive: true });
  } else {
    assert(exists, 'Initialize this disposable testnet wallet first');
    assert(/^network\s*=\s*"test"\s*$/m.test(await readFile(config, 'utf8')), 'Refusing a non-testnet wallet');
  }
  const commands = {
    init: ['init', '--name', `Lenz test ${name}`, '--identity', fileURLToPath(new URL('identity.age', directory)), '--network', 'test', '--server', 'zecrocks'],
    info: ['get-info', '--server', 'zecrocks'], sync: ['sync', '--server', 'zecrocks'],
    address: ['list-addresses', '--receiver', 'orchard'], 'sapling-address': ['list-addresses', '--receiver', 'sapling'], balance: ['balance', '--json'], transactions: ['list-tx', '--json'],
  };
  const child = spawnSync(fileURLToPath(executable), ['wallet', '-w', fileURLToPath(directory), ...commands[action]],
    { input: '\n', encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 1024 * 1024 });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Zcash ${action} failed: ${child.stderr.trim().slice(-1500)}`);
  if (action === 'info') {
    result.info = JSON.parse(child.stdout);
    assert.equal(result.info.chain_name, 'test', 'Lightwallet server is not on testnet');
  } else if (action === 'transactions') {
    const transactions = JSON.parse(child.stdout);
    assert(Array.isArray(transactions), 'Invalid transaction history');
    result.transactions = transactions.map(tx => {
      assert(/^[0-9a-f]{64}$/.test(tx.txid) && (tx.mined_height === null || (Number.isSafeInteger(tx.mined_height) && tx.mined_height > 0)), 'Invalid transaction record');
      return { txid: tx.txid, minedHeight: tx.mined_height };
    });
  } else if (action === 'balance') result.balance = JSON.parse(child.stdout);
  else if (action === 'address') {
    const match = child.stdout.match(/^Receiver\(orchard\): (utest1\S+)$/m);
    assert(match, 'No Orchard-only testnet receiver returned');
    result.orchardAddress = match[1];
  } else if (action === 'sapling-address') {
    const match = child.stdout.match(/^Receiver\(sapling\): (ztestsapling1\S+)$/m);
    assert(match, 'No Sapling testnet receiver returned');
    result.saplingAddress = match[1];
  }
}
result.ok = true;
result.scope = 'Developer testnet wallet bridge. Build/address/sync checks alone do not establish a shielded payment or browser wallet integration.';
if (!options.includes('--no-save')) await writeFile(new URL(`./${action}-${name}-results.json`, import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
