import { createHash, createPublicKey, verify } from 'node:crypto';
import { base58 } from '../../web/public/intents-vendor/codecs.js';

const assert = (ok, message) => { if (!ok) throw Error(message); };
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
function bytes(value, size, label) {
  assert(typeof value === 'string', 'Invalid ' + label + '.');
  const result = Buffer.from(value, 'base64');
  assert(result.length === size && result.toString('base64') === value, 'Invalid ' + label + '.');
  return result;
}
function string(value) {
  assert(typeof value === 'string' && Buffer.byteLength(value) <= 8192, 'Invalid NEP-413 string.');
  const content = Buffer.from(value), length = Buffer.alloc(4);
  length.writeUInt32LE(content.length);
  return Buffer.concat([length, content]);
}
export function nep413Hash(payload) {
  assert(payload && typeof payload === 'object' && !Array.isArray(payload), 'Invalid NEP-413 payload.');
  assert(Object.keys(payload).every(key => ['message', 'nonce', 'recipient', 'callbackUrl'].includes(key)), 'Unexpected NEP-413 field.');
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2147484061);
  const callback = payload.callbackUrl === undefined || payload.callbackUrl === null
    ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), string(payload.callbackUrl)]);
  return createHash('sha256').update(Buffer.concat([
    tag, string(payload.message), bytes(payload.nonce, 32, 'nonce'), string(payload.recipient), callback,
  ])).digest();
}
function ed25519(value, size) {
  assert(typeof value === 'string' && value.startsWith('ed25519:'), 'Expected Ed25519 encoding.');
  const encoded = value.slice(8), decoded = base58.decode(encoded);
  assert(decoded.length === size && base58.encode(decoded) === encoded, 'Invalid Ed25519 encoding.');
  return Buffer.from(decoded);
}
export function verifyNep413(signed) {
  assert(signed?.standard === 'nep413', 'Expected NEP-413 signature.');
  const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI, ed25519(signed.public_key, 32)]), format: 'der', type: 'spki' });
  return verify(null, nep413Hash(signed.payload), publicKey, ed25519(signed.signature, 64));
}

export const INTENTS_SOURCE = '16d04f6ec4401263f8914638710260da50bb46b0';
const TERM_KEYS = ['verifierId', 'userId', 'solverId', 'tokenIn', 'tokenOut', 'amountIn', 'amountOut', 'deadline', 'salt', 'userRandom', 'solverRandom'];
function testnetAccount(value) {
  assert(typeof value === 'string' && value.length <= 64
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(value), 'Expected a named testnet account.');
}
function amount(value) {
  assert(typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value)
    && BigInt(value) <= (1n << 127n) - 1n, 'Expected a positive signed-128-bit base-unit amount.');
}
function nonce(salt, deadline, randomness) {
  const result = Buffer.alloc(32);
  result.set([86, 40, 246, 198, 0]);
  result.set(Buffer.from(salt, 'hex'), 5);
  result.writeBigInt64LE(BigInt(deadline) * 1000000n, 9);
  const random = bytes(randomness, 15, 'nonce randomness');
  assert(random.some(byte => byte !== 0), 'Empty nonce randomness.');
  result.set(random, 17);
  return result.toString('base64');
}
export function createTestnetSwap(input, { now = Date.now() } = {}) {
  assert(input && Object.keys(input).sort().join(',') === [...TERM_KEYS].sort().join(','), 'Unexpected swap terms.');
  const terms = structuredClone(input);
  for (const key of ['verifierId', 'tokenIn', 'tokenOut']) testnetAccount(terms[key]);
  for (const key of ['userId', 'solverId']) assert(typeof terms[key] === 'string'
    && /^[0-9a-f]{64}$/.test(terms[key]) && !/^0{64}$/.test(terms[key]), 'Expected an Ed25519 implicit signer.');
  assert(terms.userId !== terms.solverId && terms.tokenIn !== terms.tokenOut, 'Swap participants and assets must differ.');
  amount(terms.amountIn); amount(terms.amountOut);
  const deadline = Date.parse(terms.deadline);
  assert(Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(deadline)
    && new Date(deadline).toISOString() === terms.deadline && deadline > now
    && deadline <= now + 86400000 && BigInt(deadline) * 1000000n <= 0x7fffffffffffffffn, 'Invalid swap deadline.');
  assert(typeof terms.salt === 'string' && /^[0-9a-f]{8}$/.test(terms.salt), 'Invalid current contract salt.');
  assert(terms.userRandom !== terms.solverRandom, 'Signer nonces must differ.');
  const inId = 'nep141:' + terms.tokenIn, outId = 'nep141:' + terms.tokenOut;
  const payloads = [
    { signer: terms.userId, diff: { [inId]: '-' + terms.amountIn, [outId]: terms.amountOut }, random: terms.userRandom },
    { signer: terms.solverId, diff: { [inId]: terms.amountIn, [outId]: '-' + terms.amountOut }, random: terms.solverRandom },
  ].map(({ signer, diff, random }) => ({
    message: JSON.stringify({ signer_id: signer, deadline: terms.deadline, intents: [{ intent: 'token_diff', diff }] }),
    nonce: nonce(terms.salt, deadline, random), recipient: terms.verifierId,
  }));
  return { networkId: 'testnet', sourceRevision: INTENTS_SOURCE, terms, payloads };
}
function checkedSwap(swap, options) {
  assert(swap && Object.keys(swap).sort().join(',') === 'networkId,payloads,sourceRevision,terms', 'Unexpected swap plan.');
  const expected = createTestnetSwap(swap.terms, options);
  assert(swap.networkId === expected.networkId && swap.sourceRevision === expected.sourceRevision
    && JSON.stringify(swap.payloads) === JSON.stringify(expected.payloads), 'Swap plan changed.');
  return expected;
}
export function fundingCalls(swap, options) {
  const { terms } = checkedSwap(swap, options);
  return [[terms.userId, terms.tokenIn, terms.amountIn], [terms.solverId, terms.tokenOut, terms.amountOut]]
    .map(([signerId, receiverId, amount]) => ({ signerId, receiverId, methodName: 'ft_transfer_call',
      args: { receiver_id: terms.verifierId, amount, msg: signerId }, deposit: '1', gas: '300000000000000' }));
}
export function executionCall(swap, signed, options) {
  const expected = checkedSwap(swap, options);
  assert(Array.isArray(signed) && signed.length === 2, 'Both signed swap payloads are required.');
  for (let i = 0; i < 2; i++) {
    const item = signed[i];
    assert(item && Object.keys(item).sort().join(',') === 'payload,public_key,signature,standard'
      && JSON.stringify(item.payload) === JSON.stringify(expected.payloads[i]), 'Signed swap changed.');
    const owner = ed25519(item.public_key, 32).toString('hex');
    assert(owner === (i === 0 ? expected.terms.userId : expected.terms.solverId), 'Signed swap owner changed.');
    assert(verifyNep413(item), 'Invalid swap signature.');
  }
  return { receiverId: expected.terms.verifierId, methodName: 'execute_intents',
    args: { signed: structuredClone(signed) }, deposit: '0', gas: '300000000000000' };
}
