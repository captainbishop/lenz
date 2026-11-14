import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLendingCoordinator, openLendingRuntime } from './intent-lending-runtime.mjs';
import { Wallet, Transaction } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { buildLendingPermissionReview, lendingPermissionDigest } from './public/intent-lending-account.js';
import { buildLendingSupplyPreparation, lendingSupplySignals } from './public/intent-lending-supply.js';
import { keccak256 } from './public/evm-vendor/offline-budget.js';

async function directory() {
  const stateDir = await mkdtemp(join(tmpdir(), 'lenz-lending-runtime-'));
  return stateDir;
}

test('adding Repay test funds preserves an original loan, private LINK grant and sponsor fence on disk', async () => {
  const old = { version: 1, orders: { version: 1, requests: { loan: { signed: 'original' } }, pending: 'loan' }, supply: { version: 1, requests: {}, pending: null }, setup: { version: 1, requests: {}, pending: null }, funding: { version: 1, requests: { link: { commitment: 'original' } }, pending: null }, sponsorFence: { namespace: 'orders', id: 'loan' } };
  let retained = structuredClone(old);
  const journal = { read: async () => structuredClone(retained), write: async value => { retained = structuredClone(value); }, close: async () => {} };
  const runtime = await openLendingCoordinator({ journal });
  try {
    assert.deepEqual(await runtime.scope('orders').journal.read(), old.orders);
    assert.deepEqual(await runtime.scope('funding').journal.read(), old.funding);
    assert.deepEqual(await runtime.scope('repayment').journal.read(), { version: 1, requests: {}, pending: null });
    await assert.rejects(runtime.scope('repayment').sponsorFence.reserve('grant'), /pending/);
    assert.deepEqual(retained.sponsorFence, old.sponsorFence);
    assert.deepEqual(retained.orders, old.orders); assert.deepEqual(retained.funding, old.funding);
  } finally { await runtime.close(); }
});

test('an unresolved Supply blocks orders and setup across a restart, even with matching raw IDs', async t => {
  const stateDir = await directory(), runtime = await openLendingCoordinator({ stateDir });
  let restored;
  t.after(async () => { await runtime.close(); await restored?.close(); await rm(stateDir, { recursive: true, force: true }); });
  const supply = runtime.scope('supply'), orders = runtime.scope('orders');
  await supply.sponsorFence.reserve('original');
  await supply.sponsorFence.reserve('original');
  await supply.sponsorFence.assertAvailable('original');
  await assert.rejects(orders.sponsorFence.reserve('original'), /pending/);
  await runtime.close();
  restored = await openLendingCoordinator({ stateDir });
  await assert.rejects(restored.scope('orders').sponsorFence.assertAvailable(), /pending/);
  await assert.rejects(restored.scope('setup').sponsorFence.reserve('original'), /pending/);
  await assert.rejects(restored.scope('funding').sponsorFence.reserve('original'), /pending/);
  await restored.scope('orders').sponsorFence.release('original');
  await assert.rejects(restored.scope('orders').sponsorFence.assertAvailable(), /pending/);
  await restored.scope('supply').sponsorFence.release('original');
  await restored.scope('supply').sponsorFence.release('original');
  await restored.scope('orders').sponsorFence.reserve('next');
  await restored.scope('supply').sponsorFence.release('original');
  await assert.rejects(restored.scope('supply').sponsorFence.assertAvailable(), /pending/);
});

test('namespace writes retain other requests and pending state cannot lose its durable fence', async t => {
  const stateDir = await directory(), runtime = await openLendingCoordinator({ stateDir });
  t.after(async () => { await runtime.close(); await rm(stateDir, { recursive: true, force: true }); });
  const orders = runtime.scope('orders'), supply = runtime.scope('supply'), setup = runtime.scope('setup');
  await orders.journal.write({ version: 1, requests: { retained: { outcome: 'known' } }, pending: null });
  await setup.journal.write({ version: 1, requests: { account: { address: 'deterministic' } }, pending: null });
  await assert.rejects(supply.journal.write({ version: 1, requests: {}, pending: { id: 'original', index: 0 } }), /fence/);
  await supply.sponsorFence.reserve('original');
  await supply.journal.write({ version: 1, requests: { original: { status: 'unknown' } }, pending: { id: 'original', index: 0 } });
  await assert.rejects(supply.sponsorFence.release('original'), /pending/);
  assert.deepEqual((await orders.journal.read()).requests, { retained: { outcome: 'known' } });
  assert.deepEqual((await setup.journal.read()).requests, { account: { address: 'deterministic' } });
  const final = await supply.journal.read(); final.pending = null;
  await supply.journal.write(final);
  await supply.sponsorFence.release('original');
  await orders.sponsorFence.assertAvailable();
});

test('close waits accepted work, preserves its exclusive lock, and rejects new calls', async t => {
  const stateDir = await directory(), runtime = await openLendingCoordinator({ stateDir });
  let reopened;
  const started = Promise.withResolvers(), finish = Promise.withResolvers(), events = [];
  t.after(async () => { finish.resolve(); await runtime.close(); await reopened?.close(); await rm(stateDir, { recursive: true, force: true }); });
  const supply = runtime.scope('supply'), orders = runtime.scope('orders');
  const first = supply.serialize(async () => { events.push('supply'); started.resolve(); await finish.promise; await supply.sponsorFence.reserve('original'); });
  await started.promise;
  const next = orders.serialize(async () => { events.push('orders'); await assert.rejects(orders.sponsorFence.reserve('second'), /pending/); });
  let closed = false;
  const closing = runtime.close().then(() => { closed = true; });
  assert.equal(runtime.close() instanceof Promise, true);
  let deadline;
  try { await assert.rejects(Promise.race([orders.serialize(() => events.push('new')), new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('admission remained open')), 250); })]), /closed/); }
  finally { clearTimeout(deadline); }
  await assert.rejects(openLendingCoordinator({ stateDir }), /EEXIST/);
  assert.equal(closed, false); assert.deepEqual(events, ['supply']);
  finish.resolve(); await Promise.all([first, next, closing]);
  assert.deepEqual(events, ['supply', 'orders']);
  reopened = await openLendingCoordinator({ stateDir });
  await assert.rejects(reopened.scope('setup').sponsorFence.assertAvailable(), /pending/);
});

test('failed reservation persistence prevents use and a retained final namespace can safely retry release', async () => {
  let state, fail = true;
  const initial = (await import('./intent-lending-runtime.mjs')).emptyLendingRuntimeJournal;
  const journal = { read: async () => structuredClone(state ?? initial()), write: async value => { if (fail) throw Error('disk full'); state = structuredClone(value); }, close: async () => {} };
  const runtime = await openLendingCoordinator({ journal }), supply = runtime.scope('supply');
  await assert.rejects(supply.sponsorFence.reserve('original'), /disk full/);
  await supply.sponsorFence.assertAvailable();
  fail = false; await supply.sponsorFence.reserve('original');
  await supply.journal.write({ version: 1, requests: { original: { status: 'executed' } }, pending: null });
  fail = true; await assert.rejects(supply.sponsorFence.release('original'), /disk full/);
  await runtime.close();
  const restored = await openLendingCoordinator({ journal });
  await assert.rejects(restored.scope('orders').sponsorFence.assertAvailable(), /pending/);
  fail = false; await restored.scope('supply').sponsorFence.release('original');
  await restored.scope('orders').sponsorFence.reserve('next');
  await restored.scope('supply').sponsorFence.release('original');
  await assert.rejects(restored.scope('supply').sponsorFence.assertAvailable(), /pending/);
  await restored.close();
});

test('a journal that acknowledges but loses a reservation cannot open sponsor authority', async () => {
  const initial = (await import('./intent-lending-runtime.mjs')).emptyLendingRuntimeJournal;
  const runtime = await openLendingCoordinator({ journal: { read: async () => initial(), write: async () => {}, close: async () => {} } });
  await assert.rejects(runtime.scope('setup').sponsorFence.reserve('original'), /durably saved/);
  await runtime.close();
});

test('funding retains its sponsor through included approval until its original deposit and allowance cleanup finish', async t => {
  const stateDir = await directory(); let runtime = await openLendingCoordinator({ stateDir });
  t.after(async () => { await runtime.close(); await rm(stateDir, { recursive: true, force: true }); });
  let funding = runtime.scope('funding');
  await funding.sponsorFence.reserve('original-grant');
  await funding.journal.write({ version: 1, requests: { 'original-grant': { phase: 'approval-included' } }, pending: 'original-grant' });
  await assert.rejects(funding.sponsorFence.release('original-grant'), /pending/);
  await runtime.close(); runtime = await openLendingCoordinator({ stateDir }); funding = runtime.scope('funding');
  await assert.rejects(runtime.scope('supply').sponsorFence.reserve('original-grant'), /pending/);
  const state = await funding.journal.read(); state.requests['original-grant'].phase = 'allowance-zero'; state.pending = null;
  await funding.journal.write(state); await funding.sponsorFence.release('original-grant');
  await runtime.scope('supply').sponsorFence.reserve('original-supply');
  await funding.sponsorFence.release('original-grant');
  await assert.rejects(runtime.scope('orders').sponsorFence.assertAvailable(), /pending/);
});

function serviceFixture() {
  const addr = digit => '0x' + digit.repeat(40), hash = digit => '0x' + digit.repeat(64);
  const owner = new Wallet('0x' + '12'.repeat(32)), sponsor = new Wallet('0x' + '34'.repeat(32));
  const now = 1800000000000, account = addr('6'), sender = sponsor.address.toLowerCase();
  const config = { ...LENDING_TESTNET, lendingFactory: addr('1'), privacyPool: addr('2'), supplyFactory: addr('3'), verifier: addr('4'), hasher: addr('5'), supplyVaultCreationCode: '0x60006000', codeHashes: Object.fromEntries(['pool', 'link', 'usdc', 'aLink', 'variableDebt', 'lendingFactory', 'privacyPool', 'supplyFactory', 'verifier', 'hasher'].map(key => [key, hash('9')])) };
  const route = { chainId: config.chain, factory: config.lendingFactory, ...Object.fromEntries(['pool', 'link', 'usdc', 'aLink', 'variableDebt'].flatMap(key => [[key, config[key]], [key + 'CodeHash', config.codeHashes[key]]])) };
  const plan = { beneficiary: account, refundRecipient: account, minScaledCredit: '900000000000000000', deadline: '1800000300', salt: hash('7') };
  const preparation = buildLendingSupplyPreparation({ ownerAddress: owner.address.toLowerCase(), plan, root: '0x' + '0'.repeat(63) + '1', nullifierHash: '0x' + '0'.repeat(63) + '2' }, { config });
  const proof = '0x' + 'ab'.repeat(256), publicSignals = lendingSupplySignals(preparation);
  const supply = { ...preparation, proof, publicSignals, artifactId: 'lending-supply-proof:' + keccak256(new TextEncoder().encode(JSON.stringify({ intentId: preparation.id, proof, publicSignals }))).slice(2) };
  const review = buildLendingPermissionReview({ lenzIdentity: 'a'.repeat(64), chainId: config.chain, ownerAddress: owner.address.toLowerCase(), account, accountId: account, route, nonce: '0', deployed: true }, { kind: 'Cancel', terms: { nonce: '0', deadline: '1800000300' } }, { config, now });
  const digest = lendingPermissionDigest(review), order = { review, signed: { type: 'lenz/lending-signed-permission/v1', reviewId: review.id, digest, signature: owner.signingKey.sign(digest).serialized.toLowerCase(), createdAt: now + 1 } };
  const position = { freeLinkBaseUnits: '0', freeUsdcBaseUnits: '0', aLinkBalanceBaseUnits: '100', aLinkScaled: '100', variableDebtBaseUnits: '0', variableDebtScaled: '0', accountData: { healthFactorWad: '4500000000000000000' } };
  const snapshot = { chainId: config.chain, observedAt: now, block: { number: '100', hash: hash('a'), timestamp: String(now / 1000), finality: 'finalized', requireCanonical: true }, routeVerified: true, trust: { codePinsVerified: true, implementationPinsVerified: true, executionPinsVerified: true }, account: { status: 'verified', address: account, owner: owner.address.toLowerCase(), codeHash: hash('8'), nonce: '0', route, position }, reserves: { LINK: { active: true, frozen: false, paused: false, oneNoteSupplyPossible: true } } };
  const observed = { snapshot, knownRoot: true, spent: false, proofValid: true, vault: { address: supply.vault, deployed: false, status: null, inputBalance: '0', allowance: '0', termsVerified: false }, withdrawal: null };
  let receipt = null; const sent = [], signed = [];
  const rpc = { snapshot: async () => structuredClone(snapshot), supplySnapshot: async () => structuredClone(observed), sponsorState: async () => ({ chainId: '11155111', address: sender, nonce: String(sent.length + 3), balance: '100000000000000000', maxFeePerGas: '1000000', maxPriorityFeePerGas: '100000' }), simulate: async () => true, simulateSupply: async () => true, simulateSetup: async () => account, send: async raw => { sent.push(raw); return Transaction.from(raw).hash; }, receipt: async id => receipt?.transactionHash === id ? structuredClone(receipt) : null, block: async number => ({ number, hash: hash('b') }), transaction: async () => null };
  const signer = { signTransaction: async call => { const raw = await sponsor.signTransaction({ ...call, nonce: Number(call.nonce) }); signed.push(raw); return raw; } };
  return { config, rpc, signer, sponsorAddress: sender, now: () => now, supply, order, signed, sent, owner: owner.address.toLowerCase(), account,
    revertSupply() { receipt = { transactionHash: Transaction.from(sent[0]).hash, from: sender, to: config.supplyFactory, blockNumber: '0x65', blockHash: hash('b'), status: '0x0', logs: [] }; snapshot.block.number = '102'; },
  };
}

test('real composed services share one sponsor through unknown Supply, restart, finality and the next order', async t => {
  const stateDir = await directory(), f = serviceFixture();
  let runtime = await openLendingRuntime({ ...f, stateDir });
  t.after(async () => { await runtime.close(); await rm(stateDir, { recursive: true, force: true }); });
  assert.equal((await runtime.supplySubmit(f.supply)).status, 'pending');
  await assert.rejects(runtime.submit(f.order), /pending/);
  await assert.rejects(runtime.setup({ owner: f.owner, account: f.account }), /pending/);
  assert.equal((await runtime.configuration()).execute, false);
  await runtime.close(); runtime = await openLendingRuntime({ ...f, stateDir });
  assert.equal((await runtime.supplyReconcile(f.supply)).verified, false);
  await assert.rejects(runtime.submit(f.order), /pending/);
  assert.equal(f.signed.length, 1); assert.equal(f.sent.length, 1);
  f.revertSupply(); await runtime.supplyReconcile(f.supply);
  assert.equal((await runtime.submit(f.order)).status, 'pending');
  assert.equal(f.signed.length, 2); assert.equal(f.sent.length, 2);
  await runtime.supplyReconcile(f.supply);
  assert.equal((await runtime.configuration()).execute, false);
  await runtime.close();
  await assert.rejects(runtime.supplyReconcile(f.supply), /closed/);
});

test('a cancelled request waiting in the shared queue cannot start signing later', async t => {
  const stateDir = await directory(), f = serviceFixture(), started = Promise.withResolvers(), finish = Promise.withResolvers();
  const sponsorState = f.rpc.sponsorState;
  f.rpc.sponsorState = async () => { started.resolve(); await finish.promise; return sponsorState(); };
  const runtime = await openLendingRuntime({ ...f, stateDir });
  t.after(async () => { finish.resolve(); await runtime.close(); await rm(stateDir, { recursive: true, force: true }); });
  const active = runtime.configuration(); await started.promise;
  const controller = new AbortController(), queued = runtime.submit(f.order, { signal: controller.signal });
  const cancelled = assert.rejects(queued, /request cancelled/);
  controller.abort(Error('request cancelled')); finish.resolve();
  await Promise.all([active, cancelled]);
  assert.equal(f.signed.length, 0); assert.equal(f.sent.length, 0);
});
