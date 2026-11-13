import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { base58 } from '../../web/public/intents-vendor/codecs.js';
import { createTestnetSwap, executionCall, fundingCalls, nep413Hash, verifyNep413 } from './swap.mjs';

test('accepts the independent official NEP-413 signature vector', () => {
  const signed = {
    standard: 'nep413',
    payload: { message: 'Hello, world!', nonce: Buffer.alloc(32).toString('base64'), recipient: 'intents.near' },
    public_key: 'ed25519:' + base58.encode(Buffer.from('e2e9cb7ac57cb46d4da1ce1d1cc2c33bdfe17407c517916b522724a8ea2c6c50', 'hex')),
    signature: 'ed25519:' + base58.encode(Buffer.from('e2ff6254871a3fec1853c167b42f0f14248c4cf7fef5452dc24d8dbdc5c4bf183ab707322b4d782d5f5a05571bae476c5f7ee41c473f3002e600865e46b75d0f', 'hex')),
  };
  assert.equal(verifyNep413(signed), true);
  const altered = structuredClone(signed);
  altered.payload.recipient = 'another.near';
  assert.equal(verifyNep413(altered), false);
});

function signedFixture() {
  const keys = [generateKeyPairSync('ed25519'), generateKeyPairSync('ed25519')];
  const publicBytes = keys.map(key => key.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  const swap = createTestnetSwap({ ...terms(), userId: publicBytes[0].toString('hex'), solverId: publicBytes[1].toString('hex') }, { now });
  const signed = swap.payloads.map((payload, i) => ({
    standard: 'nep413', payload: structuredClone(payload), public_key: 'ed25519:' + base58.encode(publicBytes[i]),
    signature: 'ed25519:' + base58.encode(sign(null, nep413Hash(payload), keys[i].privateKey)),
  }));
  return { swap, signed, keys };
}

test('builds one verifier call only after both owners sign the exact swap', () => {
  const { swap, signed } = signedFixture();
  assert.deepEqual(executionCall(swap, signed, { now }), {
    receiverId: 'intents.lenz.testnet', methodName: 'execute_intents', args: { signed }, deposit: '0', gas: '300000000000000',
  });
  assert.throws(() => executionCall(swap, signed.slice(0, 1), { now }), /Both/);
  const forged = structuredClone(signed);
  const signature = base58.decode(forged[0].signature.slice(8)); signature[0] ^= 1;
  forged[0].signature = 'ed25519:' + base58.encode(signature);
  assert.throws(() => executionCall(swap, forged, { now }), /signature/);
});

const now = Date.parse('2026-11-13T12:00:00.000Z');
const terms = () => ({
  verifierId: 'intents.lenz.testnet', userId: '11'.repeat(32), solverId: '22'.repeat(32),
  tokenIn: 'source.lenz.testnet', tokenOut: 'target.lenz.testnet',
  amountIn: '1000000', amountOut: '2000000', deadline: '2026-11-13T12:04:00.000Z',
  salt: '12345678', userRandom: Buffer.alloc(15, 1).toString('base64'), solverRandom: Buffer.alloc(15, 2).toString('base64'),
});

test('prepares opposite exact token changes and owner-specific funding calls', () => {
  const swap = createTestnetSwap(terms(), { now });
  assert.deepEqual(JSON.parse(swap.payloads[0].message).intents, [{ intent: 'token_diff', diff: {
    'nep141:source.lenz.testnet': '-1000000', 'nep141:target.lenz.testnet': '2000000',
  } }]);
  assert.deepEqual(JSON.parse(swap.payloads[1].message).intents, [{ intent: 'token_diff', diff: {
    'nep141:source.lenz.testnet': '1000000', 'nep141:target.lenz.testnet': '-2000000',
  } }]);
  assert.deepEqual(fundingCalls(swap, { now }), [
    { signerId: '11'.repeat(32), receiverId: 'source.lenz.testnet', methodName: 'ft_transfer_call',
      args: { receiver_id: 'intents.lenz.testnet', amount: '1000000', msg: '11'.repeat(32) }, deposit: '1', gas: '300000000000000' },
    { signerId: '22'.repeat(32), receiverId: 'target.lenz.testnet', methodName: 'ft_transfer_call',
      args: { receiver_id: 'intents.lenz.testnet', amount: '2000000', msg: '22'.repeat(32) }, deposit: '1', gas: '300000000000000' },
  ]);
});

test('rejects mainnet targets, same asset and altered plan metadata', () => {
  for (const delta of [{ verifierId: 'intents.near' }, { tokenOut: 'usdc.near' }, { tokenOut: 'source.lenz.testnet' }, { solverId: '11'.repeat(32) }]) {
    assert.throws(() => createTestnetSwap({ ...terms(), ...delta }, { now }));
  }
  const swap = createTestnetSwap(terms(), { now }); swap.networkId = 'mainnet';
  assert.throws(() => fundingCalls(swap, { now }), /changed/);
});

test('rejects expiry, floating amounts and signed-128-bit overflow', () => {
  for (const delta of [{ deadline: '2026-11-13T11:59:00.000Z' }, { deadline: '2026-11-15T12:00:00.000Z' },
    { deadline: '2026-11-13T12:04:00Z' }, { amountIn: '1.5' }, { amountIn: '0' }, { amountOut: (1n << 127n).toString() }]) {
    assert.throws(() => createTestnetSwap({ ...terms(), ...delta }, { now }));
  }
});

test('rejects modified source, destination, amount, nonce, verifier and added actions', () => {
  const { swap, signed } = signedFixture();
  const changes = [
    item => { item.payload.recipient = 'other.testnet'; },
    item => { item.payload.nonce = Buffer.alloc(32, 9).toString('base64'); },
    item => { const body = JSON.parse(item.payload.message); body.intents[0].diff['nep141:source.lenz.testnet'] = '-2000000'; item.payload.message = JSON.stringify(body); },
    item => { const body = JSON.parse(item.payload.message); body.intents[0].diff['nep141:other.testnet'] = '2000000'; item.payload.message = JSON.stringify(body); },
    item => { const body = JSON.parse(item.payload.message); body.intents.push({ intent: 'transfer', receiver_id: 'attacker.testnet', tokens: { 'nep141:source.lenz.testnet': '1' } }); item.payload.message = JSON.stringify(body); },
    item => { item.payload.callbackUrl = 'https://attacker.example/'; },
  ];
  for (const change of changes) {
    const altered = structuredClone(signed); change(altered[0]);
    assert.throws(() => executionCall(swap, altered, { now }), /changed/);
  }
});

test('rejects valid signatures from an unapproved key and reversed participants', () => {
  const { swap, signed } = signedFixture(), altered = structuredClone(signed);
  const stranger = generateKeyPairSync('ed25519');
  altered[0].public_key = 'ed25519:' + base58.encode(stranger.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));
  altered[0].signature = 'ed25519:' + base58.encode(sign(null, nep413Hash(altered[0].payload), stranger.privateKey));
  assert.equal(verifyNep413(altered[0]), true);
  assert.throws(() => executionCall(swap, altered, { now }), /owner/);
  assert.throws(() => executionCall(swap, [signed[1], signed[0]], { now }), /changed/);
});

test('requires current salt, distinct fresh nonce randomness and a fresh signing deadline', () => {
  for (const delta of [{ salt: 'notasalt' }, { userRandom: Buffer.alloc(15).toString('base64') },
    { solverRandom: terms().userRandom }, { userRandom: Buffer.alloc(14, 1).toString('base64') }]) {
    assert.throws(() => createTestnetSwap({ ...terms(), ...delta }, { now }));
  }
  const { swap, signed } = signedFixture();
  assert.throws(() => executionCall(swap, signed, { now: now + 240000 }), /deadline/);
});
