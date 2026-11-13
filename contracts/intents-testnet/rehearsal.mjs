import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, KeyPair, JsonRpcProvider, actions, nearToYocto, teraToGas, encodeTransaction, baseEncode, getTransactionLastResult } from 'near-api-js';
import { base58 } from '../../web/public/intents-vendor/codecs.js';
import { createTestnetSwap, executionCall, fundingCalls, nep413Hash, INTENTS_SOURCE } from '../../integrations/intent-testnet/swap.mjs';
import { TESTNET_RPC } from '../../integrations/near-network.mjs';
import { outsideRepository } from '../../integrations/intent-testnet/private-path.mjs';

const flags = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  assert(flag.startsWith('--') && !flags.has(flag), 'Invalid command argument.');
  flags.set(flag, process.argv[i + 1]?.startsWith('--') || !process.argv[i + 1] ? true : process.argv[++i]);
}
assert([...flags.keys()].every(key => ['--run', '--plan', '--wasm', '--token-wasm', '--state-dir', '--deployer-key', '--prefix'].includes(key)), 'Unsupported command argument.');
assert(flags.has('--run') !== flags.has('--plan'), 'Choose --plan or --run.');
for (const required of ['--wasm', '--token-wasm', '--state-dir', '--deployer-key', '--prefix']) assert(typeof flags.get(required) === 'string', 'Missing ' + required + '.');
const repo = fileURLToPath(new URL('../..', import.meta.url));
const stateDir = resolve(flags.get('--state-dir'));
assert(outsideRepository(repo,stateDir)&&outsideRepository(repo,flags.get('--deployer-key')), 'Keep testnet keys and journals outside the product repository.');
const prefix = flags.get('--prefix');
assert(/^[a-z][a-z0-9]{1,11}$/.test(prefix), 'Invalid fresh account prefix.');
const deployer = JSON.parse(await readFile(resolve(flags.get('--deployer-key')), 'utf8'));
assert(/^lenz-dev-[0-9]+\.testnet$/.test(deployer.accountId), 'Use the existing disposable testnet deployer.');
const provider = new JsonRpcProvider({ url: TESTNET_RPC });
const parent = new Account(deployer.accountId, provider, deployer.privateKey);
const verifierWasm = await readFile(resolve(flags.get('--wasm'))), tokenWasm = await readFile(resolve(flags.get('--token-wasm')));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, (key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
assert(sha256(verifierWasm) === '9c385736268b5240e8000169401b1d700393367cc5de74e3a9b627624b4005db', 'Unreviewed verifier Wasm.');
assert(sha256(tokenWasm) === 'bcac83483ad6d8bbec302060a8ceac6bd83151cb3c8ed1ce17685bb59a87636d', 'Unreviewed token Wasm.');
const names = Object.fromEntries(['verifier', 'source', 'target', 'user', 'solver'].map(name => [name, `${name}${prefix}.${deployer.accountId}`]));
assert(Object.values(names).every(name => name.length <= 64), 'Child account name too long.');
const parentState = await provider.viewAccount({ accountId: parent.accountId, blockQuery: { finality: 'final' } });
const available = BigInt(parentState.amount) - BigInt(parentState.storage_usage) * 10000000000000000000n;
const existingChildren = await Promise.all(Object.entries(names).map(async ([name, accountId]) => {
  try { await provider.viewAccount({ accountId, blockQuery: { finality: 'final' } }); return name; }
  catch (error) { if (/does not exist|UNKNOWN_ACCOUNT/i.test(error.message)) return null; throw error; }
}));
const plan = { network: 'testnet', rpc: TESTNET_RPC, sourceRevision: INTENTS_SOURCE,
  verifierSha256: sha256(verifierWasm), tokenSha256: sha256(tokenWasm), parent: parent.accountId,
  requiredTestNear: '24', availableYoctoNear: available.toString(), names,
  privacy: 'Public NEAR token balances and signed intents; no shielded settlement claim.' };
if (flags.has('--plan')) { console.log(JSON.stringify({ ...plan, existingChildren: existingChildren.filter(Boolean) }, null, 2)); process.exit(0); }
await mkdir(stateDir, { recursive: true });
const lock = await open(resolve(stateDir, 'run.lock'), 'wx');
await lock.close();
const statePath = resolve(stateDir, 'state.json');
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  assert(existingChildren.every(name => name === null), 'Choose a fresh child prefix. No existing account may be replaced.');
  assert(available >= nearToYocto('24'), 'The disposable parent needs at least 24 available testNEAR. No transaction sent.');
  state = { plan, keys: Object.fromEntries(Object.entries(names).map(([name, accountId]) => {
    const pair = KeyPair.fromRandom('ed25519');
    return [name, { accountId, privateKey: pair.toString(), publicKey: pair.getPublicKey().toString() }];
  })), stages: {}, pending: null };
}
const immutablePlan = ({ availableYoctoNear, ...immutable }) => immutable;
assert.deepEqual(immutablePlan(state.plan), immutablePlan(plan), 'The retained testnet plan changed.');
assert(state.pending === null, 'An original signed transaction is unresolved. Reconcile its retained hash; do not rerun.');
assert(available >= nearToYocto('0.2'), 'The disposable parent needs testNEAR gas headroom to continue.');
async function save() {
  const temporary = statePath + '.next';
  const file = await open(temporary, 'w', 0o600);
  await file.writeFile(json(state) + '\n'); await file.sync(); await file.close();
  await rename(temporary, statePath);
}
await save();
const accounts = Object.fromEntries(Object.entries(state.keys).map(([name, key]) => [name, new Account(key.accountId, provider, key.privateKey)]));
async function view(contractId, method, args = {}) {
  return provider.callFunction({ contractId, method, args, blockQuery: { finality: 'final' } });
}
async function tx(stage, account, receiverId, operations, { expectFailure = false } = {}) {
  if (state.stages[stage]) return state.stages[stage];
  const signed = await account.createSignedTransaction({ receiverId, actions: operations });
  const txHash = baseEncode(createHash('sha256').update(encodeTransaction(signed.transaction)).digest());
  const signedPath = resolve(stateDir, stage + '.signed');
  const file = await open(signedPath, 'wx', 0o600);
  await file.writeFile(signed.encode()); await file.sync(); await file.close();
  state.pending = { stage, senderId: account.accountId, receiverId, txHash, signedPath, expectFailure };
  await save();
  const outcome = await provider.sendTransactionUntil(signed, 'FINAL');
  assert(outcome.transaction.hash === txHash && outcome.final_execution_status === 'FINAL', 'Original transaction is not final.');
  const failed = outcome.status && Object.hasOwn(outcome.status, 'Failure');
  if (expectFailure) assert(failed, 'The intentionally invalid operation unexpectedly succeeded.');
  else {
    assert(outcome.status && Object.hasOwn(outcome.status, 'SuccessValue'), 'The final transaction failed.');
    assert(outcome.receipts_outcome.every(receipt => !Object.hasOwn(receipt.outcome.status, 'Failure')), 'A final asynchronous receipt failed.');
  }
  state.stages[stage] = { txHash, status: failed ? 'rejected' : 'final-success',
    receiptIds: outcome.receipts_outcome.map(receipt => receipt.id), value: failed ? null : getTransactionLastResult(outcome) };
  state.pending = null; await save(); console.log(stage + ': ' + state.stages[stage].status + ' ' + txHash);
  return state.stages[stage];
}
const call = (stage, account, receiverId, methodName, args, deposit = 0n, options) =>
  tx(stage, account, receiverId, [actions.functionCall(methodName, args, teraToGas('250'), deposit)], options);
function signPayload(payload, pair) {
  return { standard: 'nep413', payload, public_key: pair.getPublicKey().toString(),
    signature: 'ed25519:' + base58.encode(pair.sign(nep413Hash(payload)).signature) };
}
try {
  for (const [name, allocation] of [['verifier', '16'], ['source', '3'], ['target', '3'], ['user', '0.5'], ['solver', '0.5']]) {
    await tx('create-' + name, parent, names[name], [actions.createAccount(), actions.transfer(nearToYocto(allocation)),
      actions.addFullAccessKey(KeyPair.fromString(state.keys[name].privateKey).getPublicKey())]);
  }
  await tx('deploy-verifier', accounts.verifier, names.verifier, [actions.deployContract(verifierWasm),
    actions.functionCall('new', { config: { wnear_id: 'wrap.testnet', fees: { fee: 0, fee_collector: names.verifier }, roles: { super_admins: [], admins: {}, grantees: {} } } }, teraToGas('200'), 0n)]);
  const verifierAccount = await provider.viewAccount({ accountId: names.verifier, blockQuery: { finality: 'final' } });
  assert(verifierAccount.code_hash === baseEncode(createHash('sha256').update(verifierWasm).digest()), 'Deployed verifier code changed.');
  assert.equal(await view(names.verifier, 'fee'), 0);
  const roles = await view(names.verifier, 'acl_get_super_admins', { skip: 0, limit: 100 });
  assert.deepEqual(roles, []);
  await tx('remove-verifier-key', accounts.verifier, names.verifier, [actions.deleteKey(KeyPair.fromString(state.keys.verifier.privateKey).getPublicKey())]);
  for (const name of ['source', 'target']) {
    await tx('deploy-' + name, accounts[name], names[name], [actions.deployContract(tokenWasm),
      actions.functionCall('new', { owner_id: parent.accountId, metadata: { spec: 'ft-1.0.0', name: 'Lenz testnet ' + name + ' asset', symbol: name === 'source' ? 'LTS' : 'LTT', decimals: 6 } }, teraToGas('200'), 0n)]);
    const tokenAccount = await provider.viewAccount({ accountId: names[name], blockQuery: { finality: 'final' } });
    assert(tokenAccount.code_hash === baseEncode(createHash('sha256').update(tokenWasm).digest()), 'Deployed token code changed.');
    await tx('remove-' + name + '-key', accounts[name], names[name], [actions.deleteKey(KeyPair.fromString(state.keys[name].privateKey).getPublicKey())]);
    await call('register-' + name + '-verifier', parent, names[name], 'storage_deposit', { account_id: names.verifier, registration_only: true }, nearToYocto('0.02'));
  }
  await call('mint-user-source', parent, names.source, 'ft_deposit', { owner_id: names.user, amount: '1000000' }, nearToYocto('0.02'));
  await call('mint-solver-target', parent, names.target, 'ft_deposit', { owner_id: names.solver, amount: '2000000' }, nearToYocto('0.02'));
  const userPair = KeyPair.fromString(state.keys.user.privateKey), solverPair = KeyPair.fromString(state.keys.solver.privateKey);
  if (!state.swap) {
    state.swap = createTestnetSwap({ verifierId: names.verifier, userId: Buffer.from(userPair.getPublicKey().data).toString('hex'),
      solverId: Buffer.from(solverPair.getPublicKey().data).toString('hex'), tokenIn: names.source, tokenOut: names.target,
      amountIn: '1000000', amountOut: '2000000', deadline: new Date(Date.now() + 240000).toISOString(),
      salt: await view(names.verifier, 'current_salt'), userRandom: randomBytes(15).toString('base64'), solverRandom: randomBytes(15).toString('base64') });
    state.signed = state.swap.payloads.map((payload, i) => signPayload(payload, i === 0 ? userPair : solverPair)); await save();
  }
  if (!state.stages['deposit-user'] || !state.stages['deposit-solver']) {
    for (const [index, request] of fundingCalls(state.swap).entries()) {
      await call(index === 0 ? 'deposit-user' : 'deposit-solver', index === 0 ? accounts.user : accounts.solver,
        request.receiverId, request.methodName, request.args, 1n);
    }
  }
  const tokenIds = ['nep141:' + names.source, 'nep141:' + names.target];
  const balances = async () => Promise.all([state.swap.terms.userId, state.swap.terms.solverId]
    .map(account_id => view(names.verifier, 'mt_batch_balance_of', { account_id, token_ids: tokenIds })));
  if (!state.stages['execute-swap']) {
    assert.deepEqual(await balances(), [['1000000', '0'], ['0', '2000000']]);
    const bad = structuredClone(state.signed), signature = base58.decode(bad[0].signature.slice(8));
    signature[0] ^= 1; bad[0].signature = 'ed25519:' + base58.encode(signature);
    await call('reject-invalid-signature', parent, names.verifier, 'execute_intents', { signed: bad }, 0n, { expectFailure: true });
    assert.deepEqual(await balances(), [['1000000', '0'], ['0', '2000000']]);
    const request = executionCall(state.swap, state.signed);
    await call('execute-swap', parent, request.receiverId, request.methodName, request.args);
  }
  if (!state.stages['withdraw-user-result']) assert.deepEqual(await balances(), [['0', '2000000'], ['1000000', '0']]);
  for (let i = 0; i < 2; i++) assert.equal(await view(names.verifier, 'is_nonce_used', {
    account_id: i === 0 ? state.swap.terms.userId : state.swap.terms.solverId, nonce: state.swap.payloads[i].nonce }), true);
  await call('reject-replay', parent, names.verifier, 'execute_intents', { signed: state.signed }, 0n, { expectFailure: true });
  if (!state.stages['withdraw-user-result']) assert.deepEqual(await balances(), [['0', '2000000'], ['1000000', '0']]);
  await call('register-user-target', parent, names.target, 'storage_deposit', { account_id: names.user, registration_only: true }, nearToYocto('0.02'));
  if (!state.withdrawal) {
    const fresh = createTestnetSwap({ ...state.swap.terms, deadline: new Date(Date.now() + 240000).toISOString(),
      salt: await view(names.verifier, 'current_salt'), userRandom: randomBytes(15).toString('base64'), solverRandom: randomBytes(15).toString('base64') });
    const payload = fresh.payloads[0];
    payload.message = JSON.stringify({ signer_id: state.swap.terms.userId, deadline: fresh.terms.deadline,
      intents: [{ intent: 'ft_withdraw', token: names.target, receiver_id: names.user, amount: '2000000' }] });
    state.withdrawal = signPayload(payload, userPair); await save();
  }
  await call('withdraw-user-result', parent, names.verifier, 'execute_intents', { signed: [state.withdrawal] });
  assert.equal(await view(names.target, 'ft_balance_of', { account_id: names.user }), '2000000');
  assert.deepEqual(await balances(), [['0', '0'], ['1000000', '0']]);
  assert.equal(await view(names.source, 'ft_total_supply'), '1000000');
  assert.equal(await view(names.target, 'ft_total_supply'), '2000000');
  assert.equal(await view(names.source, 'ft_balance_of', { account_id: names.verifier }), '1000000');
  assert.equal(await view(names.target, 'ft_balance_of', { account_id: names.verifier }), '0');
  const report = { ...plan, checkedAt: new Date().toISOString(), stages: state.stages, user: names.user, solver: names.solver,
    sourceUnits: '1000000', resultUnits: '2000000', finalExternalResult: '2000000', privacy: plan.privacy };
  const reportFile = await open(resolve(stateDir, 'verified-public-report.json'), 'w', 0o600);
  await reportFile.writeFile(json(report) + '\n'); await reportFile.sync(); await reportFile.close();
  state.complete = true; await save();
  await unlink(resolve(stateDir, 'run.lock'));
  console.log('Verified actual testnet swap, nonce consumption, invalid signature/replay rejection and final external withdrawal.');
} catch (error) {
  console.error('Stopped safely; preserve the original state and signed transaction journal. ' + error.message);
  process.exitCode = 1;
}
