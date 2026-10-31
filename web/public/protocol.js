import config from './config.js';
import { buildPoseidon } from './vendor/poseidon.js';
import * as snarkjs from './vendor/snarkjs.js';
const poseidon = await buildPoseidon();
export const DOMAIN = config.domain;
export const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ctx = BigInt(config.context);
const check = (ok, why) => { if (!ok) throw new Error(why); };
export const field = value => {
  check(typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)), 'Invalid field encoding');
  const n = BigInt(value); check(n >= 0n && n < FR, 'Field out of range'); return n;
};
export const hash = values => poseidon.F.toObject(poseidon(values.map(field)));
export const asHex = n => field(n).toString(16).padStart(64, '0');
const fromHex = value => { check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'Invalid commitment'); return field(BigInt('0x' + value)); };
export function randomField() {
  for (;;) {
    const n = BigInt('0x' + Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join(''));
    if (n > 0n && n < FR) return n.toString();
  }
}
export const ownerKey = secret => hash([101n, ctx, secret]).toString();
export const note = (owner, value) => ({ owner, value: String(value), asset: '1', randomness: randomField() });
export const commitment = n => asHex(hash([102n, ctx, n.asset, n.owner, n.value, n.randomness]));
export function makeStep(input, secret, outputs) {
  const cm = fromHex(commitment(input));
  const nf = hash([103n, ctx, secret, cm]);
  const out = outputs.map(n => fromHex(commitment(n)));
  const nonce = randomField();
  return { context: ctx.toString(), inputCommitment: cm.toString(), nullifier: nf.toString(), outputCommitments: out.map(String), nonce,
    transferDigest: hash([104n, ctx, cm, nf, ...out, nonce]).toString(), secret, asset: input.asset, inputValue: input.value,
    inputRandomness: input.randomness, outputOwners: outputs.map(n => n.owner), outputValues: outputs.map(n => n.value), outputRandomness: outputs.map(n => n.randomness) };
}
export async function prove(input, progress = () => {}) {
  progress('Calculating witness…');
  const memory = { type: 'mem' };
  await snarkjs.wtns.calculate(input, './assets/step.wasm', memory, { sanityCheck: true });
  progress('Creating proof…');
  const result = await snarkjs.plonk.prove('./assets/step.zkey', memory, undefined, { singleThread: true });
  const expected = [input.context, input.inputCommitment, input.nullifier, ...input.outputCommitments, input.nonce, input.transferDigest];
  check(JSON.stringify(expected) === JSON.stringify(result.publicSignals), 'Unexpected proof statement');
  return { input: asHex(input.inputCommitment), nf: asHex(input.nullifier), id: asHex(input.transferDigest), outputs: input.outputCommitments.map(asHex),
    proof: JSON.stringify({ scheme: 'proof-u/plonk-bn254-step/v1', nonce: input.nonce, proof: result.proof }) };
}
const logger = { info() {}, debug() {}, warn() {}, error() {} };
export async function verify(edge) {
  try {
    check(edge && Object.keys(edge).sort().join(',') === 'id,input,nf,outputs,proof', 'Invalid edge');
    check(Array.isArray(edge.outputs) && edge.outputs.length === 2 && edge.outputs[0] !== edge.outputs[1], 'Invalid outputs');
    check(typeof edge.proof === 'string' && new TextEncoder().encode(edge.proof).length <= 8192, 'Invalid proof size');
    const data = JSON.parse(edge.proof);
    check(data.scheme === 'proof-u/plonk-bn254-step/v1' && Object.keys(data).sort().join(',') === 'nonce,proof,scheme', 'Wrong proof scheme');
    const signals = [ctx, fromHex(edge.input), fromHex(edge.nf), ...edge.outputs.map(fromHex), field(data.nonce), fromHex(edge.id)].map(String);
    return await snarkjs.plonk.verify(config.verificationKey, signals, data.proof, logger);
  } catch { return false; }
}
export async function validatePayment(payment, wallet, knownSpends = {}) {
  check(payment?.type === 'proof-u/web-demo/1' && payment.domain === DOMAIN, 'This is not a Proof of U demo payment.');
  check(payment.note?.owner === wallet.owner && payment.note.asset === '1', 'This payment belongs to another demo person.');
  const value = field(payment.note.value); check(value > 0n && value < (1n << 64n), 'Invalid payment amount.');
  check(Array.isArray(payment.edges) && payment.edges.length > 0 && payment.edges.length <= 16, 'Invalid payment history.');
  fromHex(payment.root);
  const notes = new Set([payment.root]); const spent = new Set(); const ids = new Set();
  for (const edge of payment.edges) {
    check(!ids.has(edge.id) && !spent.has(edge.nf) && notes.has(edge.input), 'Broken or conflicting payment history.');
    check(!knownSpends[edge.nf] || knownSpends[edge.nf] === edge.id, 'A conflicting payment was already seen in this demo.');
    check(await verify(edge), 'The payment proof could not be verified.');
    for (const output of edge.outputs) { check(!notes.has(output), 'Repeated payment output.'); notes.add(output); }
    ids.add(edge.id); spent.add(edge.nf);
  }
  check(payment.edges.at(-1).outputs.includes(commitment(payment.note)), 'The payment opening does not match the proof.');
  return payment;
}
