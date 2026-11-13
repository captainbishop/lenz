import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, readFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, KeyPair, JsonRpcProvider, actions, nearToYocto, encodeTransaction, baseEncode } from 'near-api-js';
import { TESTNET_RPC } from '../../integrations/near-network.mjs';
import { outsideRepository } from '../../integrations/intent-testnet/private-path.mjs';

const flags = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]; assert(flag.startsWith('--') && !flags.has(flag), 'Invalid argument.');
  flags.set(flag, process.argv[i + 1]?.startsWith('--') || !process.argv[i + 1] ? true : process.argv[++i]);
}
assert(['--run', '--plan', '--status'].filter(flag => flags.has(flag)).length === 1, 'Choose --run, --plan or --status.');
assert([...flags.keys()].every(key => ['--run', '--plan', '--status', '--source-dir', '--target-dir', '--state-dir'].includes(key)), 'Unsupported argument.');
const repo = fileURLToPath(new URL('../..', import.meta.url));
for (const flag of ['--source-dir', '--target-dir', '--state-dir']) {
  assert(typeof flags.get(flag) === 'string', 'Missing ' + flag + '.');
  assert(outsideRepository(repo,flags.get(flag)), 'Keep funding state outside the repository.');
}
const json = value => JSON.stringify(value, (key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
async function loadFunder(directory) {
  const dir = resolve(directory), key = JSON.parse(await readFile(resolve(dir, 'deployer.json'), 'utf8'));
  const faucet = JSON.parse(await readFile(resolve(dir, 'faucet.json'), 'utf8'));
  assert(faucet.network === 'testnet' && faucet.endpoint === 'https://helper.testnet.near.org/account'
    && faucet.httpStatus === 200 && faucet.request.newAccountId === key.accountId
    && faucet.request.newAccountPublicKey === key.publicKey && /^lenz-dev-[0-9]+\.testnet$/.test(key.accountId)
    && KeyPair.fromString(key.privateKey).getPublicKey().toString() === key.publicKey, 'Use an original freshly faucet-created account.');
  return key;
}
const source = await loadFunder(flags.get('--source-dir')), target = await loadFunder(flags.get('--target-dir'));
assert(source.accountId !== target.accountId, 'The funder and receiver must differ.');
const provider = new JsonRpcProvider({ url: TESTNET_RPC });
async function observe(key) {
  const account = await provider.viewAccount({ accountId: key.accountId, blockQuery: { finality: 'final' } });
  await provider.viewAccessKey({ accountId: key.accountId, publicKey: key.publicKey, finalityQuery: { finality: 'final' } });
  return { accountId: key.accountId, amount: account.amount.toString(), storageUsage: account.storage_usage,
    available: (BigInt(account.amount) - BigInt(account.storage_usage) * 10000000000000000000n).toString(), blockHash: account.block_hash, blockHeight: account.block_height };
}
const observations = await Promise.all([observe(source), observe(target)]), amount = nearToYocto('8');
const plan = { network: 'testnet', rpc: TESTNET_RPC, senderId: source.accountId, receiverId: target.accountId, amount: amount.toString(), sourcePublicKey: source.publicKey };
if (flags.has('--plan')) { console.log(json({ plan, source: observations[0], target: observations[1] })); process.exit(0); }
const dir = resolve(flags.get('--state-dir')), statePath = resolve(dir, 'transfer.json');
await mkdir(dir, { recursive: true });
async function save(state) {
  const temporary = statePath + '.next-' + Date.now();
  const file = await open(temporary, 'wx', 0o600); await file.writeFile(json(state) + '\n'); await file.sync(); await file.close();
  await rename(temporary, statePath);
}
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; assert(flags.has('--run'), 'No original funding transaction to reconcile.'); }
if (state) assert.deepEqual(state.plan, plan, 'The original funding plan changed.');
let outcome;
if (flags.has('--run')) {
  assert(state === undefined, 'Funding has already been prepared; reconcile its original transaction instead of signing again.');
  assert(BigInt(observations[0].available) >= nearToYocto('9'), 'Keep one testNEAR of source gas headroom. No transaction sent.');
  const lock = await open(resolve(dir, 'run.lock'), 'wx'); await lock.close();
  const account = new Account(source.accountId, provider, source.privateKey);
  const signed = await account.createSignedTransaction({ receiverId: target.accountId, actions: [actions.transfer(amount)] });
  const txHash = baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
  const signedPath = resolve(dir, 'transfer.signed'), artifact = await open(signedPath, 'wx', 0o600);
  await artifact.writeFile(signed.encode()); await artifact.sync(); await artifact.close();
  state = { plan, status: 'pending', txHash, signedPath, before: observations }; await save(state);
  outcome = await provider.sendTransactionUntil(signed, 'FINAL');
} else {
  assert(state && ['pending', 'settled'].includes(state.status), 'No original funding transaction to reconcile.');
  outcome = await provider.sendJsonRpc('tx', { tx_hash: state.txHash, sender_account_id: source.accountId, wait_until: 'FINAL' });
}
assert(outcome.transaction.hash === state.txHash && outcome.transaction.signer_id === source.accountId
  && outcome.transaction.receiver_id === target.accountId && outcome.transaction.public_key === source.publicKey
  && outcome.transaction.actions.length === 1 && BigInt(outcome.transaction.actions[0].Transfer.deposit) === amount
  && outcome.final_execution_status === 'FINAL' && Object.hasOwn(outcome.status, 'SuccessValue')
  && outcome.receipts_outcome.every(receipt => !Object.hasOwn(receipt.outcome.status, 'Failure')), 'The exact funding transfer is not a successful final transaction.');
const after = await Promise.all([observe(source), observe(target)]);
assert(BigInt(after[1].available) - BigInt(state.before[1].available) >= amount, 'The receiver does not hold the transferred testNEAR.');
assert(BigInt(state.before[0].available) - BigInt(after[0].available) >= amount, 'The source was not debited.');
state.status = 'settled'; state.receiptIds = outcome.receipts_outcome.map(receipt => receipt.id); state.after = after;
await save(state);
if (flags.has('--run')) await unlink(resolve(dir, 'run.lock'));
console.log(json({ plan, txHash: state.txHash, status: state.status, receiptIds: state.receiptIds, before: state.before, after }));
