import test from 'node:test';
import assert from 'node:assert/strict';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { lendingSupplySelection, buildLendingSupplyReview, lendingSupplySignals, buildLendingSupplyAuthorization } from './public/intent-lending-supply.js';
import { createLendingSupplyIntentService } from './public/intent-lending-supply-route.js';

const address = digit => '0x' + digit.repeat(40), hash = digit => '0x' + digit.repeat(64), now = 1800000000000;
const config = { ...LENDING_TESTNET, lendingFactory: address('1'), privacyPool: address('2'), supplyFactory: address('3'), verifier: address('4'), hasher: address('5'), supplyVaultCreationCode: '0x60006000', codeHashes: Object.fromEntries(['pool','link','usdc','aLink','variableDebt','lendingFactory','privacyPool','supplyFactory','verifier','hasher'].map(key => [key, hash('9')])) };
function attempt() {
  const route = { chainId: config.chain, factory: config.lendingFactory, ...Object.fromEntries(['pool','link','usdc','aLink','variableDebt'].flatMap(key => [[key, config[key]], [key + 'CodeHash', config.codeHashes[key]]])) };
  const identity = { lenzIdentity: 'a'.repeat(64), ownerAddress: address('8'), account: address('6'), accountId: address('6'), deployed: true, route, chainId: config.chain };
  const snapshot = { chainId: config.chain, observedAt: now, block: { number: '100', hash: hash('8'), timestamp: String(now / 1000), finality: 'finalized', requireCanonical: true }, routeVerified: true, trust: { codePinsVerified: true, implementationPinsVerified: true, executionPinsVerified: true }, account: { status: 'verified', address: identity.account, owner: identity.ownerAddress, codeHash: hash('8'), route }, reserves: { LINK: { active: true, frozen: false, paused: false, oneNoteSupplyPossible: true } }, privatePool: { address: config.privacyPool, root: hash('1'), nextIndex: 1, commitments: [hash('2')], withdrawals: [] } };
  const chosen = lendingSupplySelection({ chainId: config.chain, asset: config.link, accountId: 'a'.repeat(64), amount: config.denomination, commitment: hash('2') }, { recipient: identity.account, minimum: '900000000000000000', deadline: now + 300000, now, config });
  const spend = { commitment: hash('2'), nullifierHash: '0x' + '0'.repeat(63) + '3', root: hash('1'), pathElements: Array(20).fill(hash('0')), pathIndices: Array(20).fill(0) };
  const review = buildLendingSupplyReview(chosen, spend, { snapshot, identity, salt: hash('7'), now, config }), publicSignals = lendingSupplySignals(review), proof = '0x' + 'ab'.repeat(256);
  return { review, authorization: buildLendingSupplyAuthorization(review, { solidity: { proof, publicSignals }, publicSignals }, { config }) };
}

test('verified Supply results retain extra LINK returned from the original deterministic vault', () => {
  const original = attempt(), { review, authorization } = original;
  const service = createLendingSupplyIntentService({ source: {}, account: {}, store: {}, config });
  const evidence = { network: config.network, chainId: config.chain, transaction: hash('a'), blockHash: hash('b'), blockNumber: '101', beneficiary: review.plan.beneficiary, ownerAddress: review.ownerAddress, vault: review.vault, nullifierHash: review.spend.nullifierHash, inputAsset: config.link, inputAmount: config.denomination, outputAsset: config.aLink, refundRecipient: review.plan.refundRecipient, refundAsset: config.link, allowance: '0', scaledCredit: review.plan.minScaledCredit, refundAmount: '100', position: { aLinkScaled: review.plan.minScaledCredit, freeLinkBaseUnits: '100' } };
  const supplied = { intentId: review.id, artifactId: authorization.artifactId, status: 'executed', verified: true, evidence };
  assert.deepEqual(service.validateOutcome(supplied, original), supplied);
  const refunded = structuredClone(supplied); refunded.status = 'refunded'; refunded.evidence.scaledCredit = '0'; refunded.evidence.refundAmount = '1000000000000000100'; refunded.evidence.position.freeLinkBaseUnits = '1000000000000000100';
  assert.deepEqual(service.validateOutcome(refunded, original), refunded);
  const missingCredit = structuredClone(supplied); missingCredit.evidence.position.freeLinkBaseUnits = '99';
  assert.throws(() => service.validateOutcome(missingCredit, original), /credit|refund/);
  const tooLittle = structuredClone(refunded); tooLittle.evidence.refundAmount = '999999999999999999';
  assert.throws(() => service.validateOutcome(tooLittle, original), /credit|refund/);
});
