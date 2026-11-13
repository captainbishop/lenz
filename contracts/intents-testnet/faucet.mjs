import assert from 'node:assert/strict';
import { open, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeyPair, JsonRpcProvider } from 'near-api-js';
import { TESTNET_RPC } from '../../integrations/near-network.mjs';
import { outsideRepository } from '../../integrations/intent-testnet/private-path.mjs';

const args = process.argv.slice(2);
assert(args.length === 3 && ['--run', '--status'].includes(args[0]) && args[1] === '--state-dir',
  'Use --run or --status --state-dir <private directory>.');
const dir = resolve(args[2]), repo = fileURLToPath(new URL('../..', import.meta.url));
assert(outsideRepository(repo,dir), 'Keep the faucet key outside the product repository.');
await mkdir(dir, { recursive: true });
const runLockPath = resolve(dir, 'faucet-run.lock');
if (args[0] === '--run') { const runLock = await open(runLockPath, 'wx'); await runLock.close(); }
const statePath = resolve(dir, 'faucet.json'), keyPath = resolve(dir, 'deployer.json');
const provider = new JsonRpcProvider({ url: TESTNET_RPC });
const json = value => JSON.stringify(value, (key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
async function durable(path, value, flag = 'w') {
  const file = await open(path, flag, 0o600);
  await file.writeFile(json(value) + '\n'); await file.sync(); await file.close();
}
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT' || args[0] !== '--run') throw error;
  const pair = KeyPair.fromRandom('ed25519'), accountId = `lenz-dev-${Date.now()}.testnet`;
  const key = { accountId, privateKey: pair.toString(), publicKey: pair.getPublicKey().toString() };
  state = { network: 'testnet', endpoint: 'https://helper.testnet.near.org/account',
    request: { newAccountId: accountId, newAccountPublicKey: key.publicKey }, status: 'prepared' };
  await durable(keyPath, key, 'wx'); await durable(statePath, state, 'wx');
}
assert(state.network === 'testnet' && state.endpoint === 'https://helper.testnet.near.org/account'
  && /^lenz-dev-[0-9]+\.testnet$/.test(state.request.newAccountId), 'The retained faucet request changed.');
const key = JSON.parse(await readFile(keyPath, 'utf8'));
assert(key.accountId === state.request.newAccountId && key.publicKey === state.request.newAccountPublicKey
  && KeyPair.fromString(key.privateKey).getPublicKey().toString() === key.publicKey, 'The retained faucet key changed.');
async function observe() {
  try {
    const account = await provider.viewAccount({ accountId: key.accountId, blockQuery: { finality: 'final' } });
    await provider.viewAccessKey({ accountId: key.accountId, publicKey: key.publicKey, finalityQuery: { finality: 'final' } });
    return { accountId: key.accountId, amount: account.amount, locked: account.locked, storageUsage: account.storage_usage,
      blockHash: account.block_hash, blockHeight: account.block_height, ownedByPreparedKey: true };
  } catch (error) { if (/does not exist|UNKNOWN_ACCOUNT/i.test(error.message)) return null; throw error; }
}
let account = await observe();
if (!account && args[0] === '--run') {
  assert(state.status === 'prepared', 'The faucet request is unresolved; use --status to reconcile instead of repeating it.');
  state.status = 'pending'; state.requestedAt = new Date().toISOString();
  await durable(statePath + '.next', state, 'wx'); await rename(statePath + '.next', statePath);
  const response = await fetch(state.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.request), signal: AbortSignal.timeout(45000) });
  state.httpStatus = response.status; await response.body?.cancel();
  await durable(statePath + '.next', state, 'wx'); await rename(statePath + '.next', statePath);
  account = await observe();
}
if (account && args[0] === '--run') {
  state.status = 'created'; state.account = account;
  await durable(statePath + '.next', state, 'wx'); await rename(statePath + '.next', statePath);
}
console.log(json({ request: state.request, status: state.status, httpStatus: state.httpStatus ?? null, account }));
if (args[0] === '--run') await unlink(runLockPath);
