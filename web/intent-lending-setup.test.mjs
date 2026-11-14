import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Transaction } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { createLendingSetupService, emptyLendingSetupJournal } from './intent-lending-setup.mjs';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
const owner = '0x' + '11'.repeat(20), account = '0x' + '22'.repeat(20), factory = '0x' + '33'.repeat(20), blockHash = '0x' + '44'.repeat(32);
function fixture() {
  const wallet = Wallet.createRandom(), config = { ...LENDING_TESTNET, lendingFactory: factory, codeHashes: { lendingFactory: '0x' + '55'.repeat(32) } };
  let state = emptyLendingSetupJournal(), receipt = null, deployed = false, finalizedBlock = '90', sent = [], signing = 0;
  const rpc = { snapshot: async input => ({ chainId: config.chain, routeVerified: true, trust: { executionPinsVerified: true }, observedAt: Date.now(), block: { number: finalizedBlock, hash: blockHash, finality: 'finalized', requireCanonical: true }, account: { address: input.account, owner: input.owner, route: { factory }, status: deployed ? 'verified' : 'undeployed', codeHash: deployed ? '0x' + '66'.repeat(32) : null } }), simulateSetup: async () => account,
    sponsorState: async () => ({ chainId: '11155111', address: wallet.address.toLowerCase(), nonce: '0', balance: '1000000000000000000', maxFeePerGas: '1000000', maxPriorityFeePerGas: '1000000' }),
    send: async raw => { sent.push(raw); return Transaction.from(raw).hash; }, receipt: async () => receipt, block: async () => ({ number: '0x64', hash: blockHash }) };
  const signer = { signTransaction: async value => { signing++; return wallet.signTransaction({ ...value, nonce: Number(value.nonce) }); } };
  const journal = { read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } };
  const make = () => createLendingSetupService({ config, rpc, signer, journal, sponsorAddress: wallet.address.toLowerCase(), maxGas: '50000000', maxFeePerGas: '5000000' });
  return { rpc, journal, make, sent, signing: () => signing, setFinal: () => { deployed = true; finalizedBlock = '100'; receipt = { transactionHash: Transaction.from(sent[0]).hash, from: wallet.address.toLowerCase(), to: factory, status: '0x1', blockHash, blockNumber: '0x64' }; } };
}
test('setup sponsors the exact predicted account once and restores the original pending deployment', async () => {
  const f = fixture(), service = f.make();
  const pending = await service.setup({ owner, account }); assert.equal(pending.status, 'pending'); assert.equal(pending.verified, false);
  await service.setup({ owner, account }); assert.equal(f.sent.length, 1); assert.equal(f.signing(), 1);
  const restored = f.make(); f.setFinal();
  const result = await restored.reconcile({ owner, account }); assert.equal(result.status, 'verified'); assert.equal(result.account, account); assert.equal(f.sent.length, 1);
  assert.equal((await restored.setup({ owner, account })).transaction, result.transaction); assert.equal(f.signing(), 1);
});
test('a changed simulated recipient or unavailable durable journal cannot send setup', async () => {
  const f = fixture(); f.rpc.simulateSetup = async () => owner;
  await assert.rejects(f.make().setup({ owner, account }), /simulation/); assert.equal(f.sent.length, 0); assert.equal(f.signing(), 0);
  f.rpc.simulateSetup = async () => account; f.journal.write = async () => { throw Error('storage failed'); };
  await assert.rejects(f.make().setup({ owner, account }), /storage/); assert.equal(f.sent.length, 0); assert.equal(f.signing(), 0);
});
test('setup cannot redirect to another owner or accept unrelated fields', async () => {
  const f = fixture(), service = f.make(); await service.setup({ owner, account });
  await assert.rejects(service.setup({ owner: '0x' + '77'.repeat(20), account }), /owner/);
  await assert.rejects(service.setup({ owner, account, privateKey: 'anything' }), /original/); assert.equal(f.sent.length, 1);
});
