import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Transaction, Interface } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { LENDING_DEPLOYMENT } from './public/intent-lending-deployment.js';
import { createLendingRepaymentFundingService } from './intent-lending-repayment-funding.mjs';

const hash = d => '0x' + d.repeat(64), addr = d => '0x' + d.repeat(40), now = 1800000000000;
const config = { ...LENDING_TESTNET, ...LENDING_DEPLOYMENT }, sponsor = new Wallet('0x' + '19'.repeat(32));
const input = { owner: 'a'.repeat(64), ownerAddress: addr('8'), account: addr('6') };
const abi = new Interface(['function mint(address asset,address recipient,uint256 amount) returns(uint256)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
function fixture() {
  let stored = { version: 1, requests: {}, pending: null }, receipt = null;
  const signed = [], sent = [], released = [];
  const snapshot = { chainId: config.chain, observedAt: now, block: { number: '100', hash: hash('a'), timestamp: String(now / 1000), finality: 'finalized', requireCanonical: true }, routeVerified: true, trust: { codePinsVerified: true, implementationPinsVerified: true, executionPinsVerified: true }, codes: { faucet: { address: config.faucet, codeHash: config.codeHashes.faucet, pinned: true }, usdc: { address: config.usdc, codeHash: config.codeHashes.usdc, pinned: true } }, account: { status: 'verified', address: input.account, owner: input.ownerAddress, codeHash: hash('8'), route: { chainId: config.chain, factory: config.lendingFactory, ...Object.fromEntries(['pool', 'link', 'usdc', 'aLink', 'variableDebt'].flatMap(key => [[key, config[key]], [key + 'CodeHash', config.codeHashes[key]]])) }, position: { freeUsdcBaseUnits: '5000000', variableDebtBaseUnits: '5000100', aLinkScaled: '17', variableDebtScaled: '13' } } };
  const journal = { read: async () => structuredClone(stored), write: async value => { stored = structuredClone(value); } };
  const rpc = { repaymentSnapshot: async (_input, options = {}) => ({ snapshot: { ...structuredClone(snapshot), block: { ...snapshot.block, finality: options.blockTag ?? 'finalized' } }, permissioned: false }), sponsorState: async () => ({ chainId: '11155111', address: sponsor.address.toLowerCase(), nonce: '3', balance: '100000000000000000', maxFeePerGas: '1000000000', maxPriorityFeePerGas: '100000000' }), simulateRepaymentFunding: async () => true, send: async raw => { sent.push(raw); return Transaction.from(raw).hash; }, receipt: async () => structuredClone(receipt), transaction: async () => null, block: async number => ({ number, hash: hash('b') }) };
  const signer = { signTransaction: async tx => { const raw = await sponsor.signTransaction({ ...tx, nonce: Number(tx.nonce) }); signed.push(raw); return raw; } };
  const sponsorFence = { assertAvailable: async () => {}, reserve: async () => {}, release: async id => released.push(id) };
  const make = () => createLendingRepaymentFundingService({ config, rpc, signer, journal, sponsorFence, sponsorAddress: sponsor.address.toLowerCase(), now: () => now });
  function finalize(amount = 1000000n) { const tx = Transaction.from(sent.at(-1)); receipt = { transactionHash: tx.hash, from: sponsor.address.toLowerCase(), to: config.faucet, blockNumber: '0x65', blockHash: hash('b'), status: '0x1', logs: [{ address: config.usdc, ...abi.encodeEventLog(abi.getEvent('Transfer'), ['0x' + '0'.repeat(40), input.account, amount]) }] }; snapshot.block.number = '102'; snapshot.account.position.freeUsdcBaseUnits = (5000000n + amount).toString(); }
  return { make, rpc, signer, journal, snapshot, signed, sent, released, finalize, stored: () => stored, receipt: () => receipt, setReceipt: value => { receipt = value; } };
}

test('one fixed Aave test-USDC grant reaches the original deployed lending account only after final mint and independent funds', async () => {
  const f = fixture(); const pending = await f.make().submit(input);
  assert.equal(pending.verified, false); assert.equal(f.signed.length, 1);
  const tx = Transaction.from(f.sent[0]), call = abi.parseTransaction({ data: tx.data });
  assert.equal(tx.to.toLowerCase(), '0xc959483dba39aa9e78757139af0e9a2edeb3f42d');
  assert.equal(call.args.asset.toLowerCase(), '0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8');
  assert.equal(call.args.recipient.toLowerCase(), input.account); assert.equal(call.args.amount, 1000000n); assert.equal(tx.value, 0n);
  f.finalize(); const result = await f.make().reconcile(input);
  assert.equal(result.status, 'funded'); assert.equal(result.evidence.amount, '1000000'); assert.equal(result.evidence.balance, '6000000'); assert.equal(result.verified, true);
  await f.make().submit(input); assert.equal(f.signed.length, 1); assert.equal(f.sent.length, 1); assert.equal(f.stored().pending, null);
});

test('a repeated or replaced grant body cannot give an owner or account a second gift', async () => {
  const f = fixture(); await f.make().submit(input); f.finalize(); await f.make().reconcile(input);
  for (const value of [{ ...input, owner: 'b'.repeat(64) }, { ...input, account: addr('7') }, { ...input, ownerAddress: addr('7') }, { ...input, owner: 'b'.repeat(64), ownerAddress: addr('7') }, { ...input, amount: '2000000' }, { ...input, asset: config.link }, { ...input, privateKey: 'secret' }]) await assert.rejects(f.make().submit(value));
  assert.equal(f.signed.length, 1); assert.equal(f.sent.length, 1);
  assert.equal((await f.make().reconcile({ ...input, owner: 'b'.repeat(64) })).available, false);
});

test('status and restart reuse the one original signed mint after a lost broadcast response', async () => {
  const f = fixture(); f.rpc.send = async raw => { f.sent.push(raw); throw Error('response lost'); };
  assert.equal((await f.make().submit(input)).status, 'unknown');
  assert.equal((await f.make().reconcile(input)).resubmissionSafe, true); assert.equal(f.sent.length, 1);
  await f.make().resume(input); assert.equal(f.signed.length, 1); assert.equal(f.sent.length, 2); assert.equal(f.sent[1], f.sent[0]);
  const tx = Transaction.from(f.sent[0]); f.rpc.transaction = async () => ({ hash: tx.hash, from: tx.from.toLowerCase(), to: tx.to.toLowerCase(), input: tx.data, value: '0x0' });
  assert.equal((await f.make().reconcile(input)).resubmissionSafe, false); await f.make().resume(input); assert.equal(f.sent.length, 2); assert.equal(f.signed.length, 1);
});

test('short or missing mints and independently missing funds stay unresolved and retain the original sponsor', async () => {
  for (const change of [f => f.finalize(999999n), f => f.finalize(1000001n), f => { f.finalize(); f.setReceipt({ ...f.receipt(), logs: [] }); }, f => { f.finalize(); f.snapshot.account.position.freeUsdcBaseUnits = '5999999'; }, f => { f.finalize(); f.rpc.block = async number => ({ number, hash: hash('c') }); }, f => { f.finalize(); f.snapshot.block.number = '100'; }]) {
    const f = fixture(); await f.make().submit(input); change(f);
    try { assert.notEqual((await f.make().reconcile(input)).verified, true); } catch (error) { assert.match(error.message, /mint|position|canonical/); }
    assert.notEqual(f.stored().pending, null); assert.equal(f.released.length, 0); assert.equal(f.signed.length, 1);
  }
});

test('later repayment can reconcile the exact original mint block without using today’s lower balance', async () => {
  const f = fixture(); await f.make().submit(input); f.finalize(); const receiptTime = structuredClone(f.snapshot);
  receiptTime.block = { ...receiptTime.block, number: '101', hash: hash('b') };
  f.snapshot.account.position.freeUsdcBaseUnits = '999900'; f.snapshot.account.position.variableDebtScaled = '0';
  f.rpc.repaymentSnapshot = async (_input, options = {}) => ({ snapshot: options.blockRef ? structuredClone(receiptTime) : structuredClone(f.snapshot), permissioned: false });
  const value = await f.make().reconcile(input); assert.equal(value.verified, true); assert.equal(value.evidence.balance, '6000000'); assert.equal(value.evidence.checkedBlockNumber, '101'); assert.equal(value.evidence.checkedBlockHash, hash('b'));
});

test('wrong owner, changed code, permissioned faucet and failed persistence cannot open grant authority', async () => {
  for (const change of [f => { f.snapshot.account.owner = addr('9'); }, f => { f.snapshot.codes.faucet.codeHash = hash('9'); }, f => { const read = f.rpc.repaymentSnapshot; f.rpc.repaymentSnapshot = async (...args) => ({ ...await read(...args), permissioned: true }); }, f => { f.journal.write = async () => {}; }, f => { f.signer.signTransaction = async tx => sponsor.signTransaction({ ...tx, nonce: Number(tx.nonce), data: abi.encodeFunctionData('mint', [config.usdc, input.account, 1000001]) }); }]) {
    const f = fixture(); change(f); await assert.rejects(f.make().submit(input)); assert.equal(f.sent.length, 0);
  }
});

test('unresolved signing and acknowledged-but-lost signed bytes cannot create a replacement mint', async () => {
  for (const change of [f => { f.signer.signTransaction = async () => { throw Error('signing interrupted'); }; }, f => { const write = f.journal.write; f.journal.write = async state => { if (Object.values(state.requests)[0]?.transaction) return; await write(state); }; }]) {
    const f = fixture(); change(f); await assert.rejects(f.make().submit(input)); assert.equal(f.sent.length, 0); assert.notEqual(f.stored().pending, null);
    assert.equal((await f.make().reconcile(input)).resubmissionSafe, false); await assert.rejects(f.make().resume(input), /signature is unresolved/); await f.make().submit(input); assert.equal(f.sent.length, 0);
  }
});

test('a finalized reverted original grant releases the sponsor and keeps the one-grant cap', async () => {
  const f = fixture(); await f.make().submit(input); f.finalize(); f.setReceipt({ ...f.receipt(), status: '0x0', logs: [] });
  assert.equal((await f.make().reconcile(input)).status, 'failed'); assert.equal(f.stored().pending, null); assert.equal(f.released.length, 1);
  await f.make().submit(input); assert.equal(f.sent.length, 1); await assert.rejects(f.make().submit({ ...input, account: addr('7') }), /already/);
});

test('a new Repay grant needs real debt in both finalized and latest positions', async () => {
  for (const zeroAt of ['finalized', 'latest']) {
    const f = fixture(), read = f.rpc.repaymentSnapshot;
    f.rpc.repaymentSnapshot = async (input, options = {}) => { const value = await read(input, options); if ((options.blockTag ?? 'finalized') === zeroAt) value.snapshot.account.position.variableDebtBaseUnits = '0'; return value; };
    await assert.rejects(f.make().submit(input), /outstanding debt/); assert.equal(f.signed.length, 0); assert.equal(f.sent.length, 0); assert.equal(f.stored().pending, null);
  }
});
