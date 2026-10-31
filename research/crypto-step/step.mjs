import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildPoseidon } from 'circomlibjs';
import * as snarkjs from 'snarkjs';

export const FR = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DOMAIN = 'proof-u/local-plonk-step/v1';
export const SCHEME = 'proof-u/plonk-bn254-step/v1';
const poseidon = await buildPoseidon();
const rule = (ok, reason) => { if (!ok) throw new Error(reason); };
export function field(value) {
  rule(typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)), 'noncanonical-field');
  const result = BigInt(value);
  rule(result >= 0n && result < FR, 'field-out-of-range');
  return result;
}
export const hash = values => poseidon.F.toObject(poseidon(values.map(field)));
export const asHex = value => field(value).toString(16).padStart(64, '0');
export function fromHex(value) {
  rule(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value), 'noncanonical-hex-field');
  return field(BigInt(`0x${value}`));
}
export function randomField() {
  for (;;) {
    const n = BigInt(`0x${randomBytes(32).toString('hex')}`);
    if (n > 0n && n < FR) return n;
  }
}
export function context(domain = DOMAIN) {
  rule(typeof domain === 'string' && domain.length > 0, 'invalid-domain');
  return BigInt(`0x${createHash('sha256').update(JSON.stringify(['proof-u/step-context/v1', domain])).digest('hex')}`) % FR;
}
export const ownerKey = (secret, domain = DOMAIN) => hash([101n, context(domain), secret]);
export const createOwner = (domain = DOMAIN) => {
  const secret = randomField();
  return { secret, publicKey: ownerKey(secret, domain) };
};
export function note(owner, value, asset = 1n, randomness = randomField(), domain = DOMAIN) {
  return { owner: field(owner), value: field(value), asset: field(asset), randomness: field(randomness), domain };
}
export const commitment = n => hash([102n, context(n.domain), n.asset, n.owner, n.value, n.randomness]);
export const nullifier = (n, secret) => hash([103n, context(n.domain), secret, commitment(n)]);

export function makeStep(input, secret, outputs, nonce = randomField()) {
  rule(Array.isArray(outputs) && outputs.length === 2, 'two-outputs-required');
  const ctx = context(input.domain);
  const cm = commitment(input);
  const nf = nullifier(input, secret);
  const out = outputs.map(commitment);
  // The circuit, not this helper, enforces ownership, ranges, asset equality,
  // conservation and duplicate-output rejection. Tests exercise it directly.
  return {
    context: ctx, inputCommitment: cm, nullifier: nf, outputCommitments: out, nonce: field(nonce),
    transferDigest: hash([104n, ctx, cm, nf, ...out, nonce]),
    secret: field(secret), asset: input.asset, inputValue: input.value, inputRandomness: input.randomness,
    outputOwners: outputs.map(n => n.owner), outputValues: outputs.map(n => n.value), outputRandomness: outputs.map(n => n.randomness),
  };
}

export function publicSignals(witness) {
  return [witness.context, witness.inputCommitment, witness.nullifier, ...witness.outputCommitments, witness.nonce, witness.transferDigest].map(n => field(n).toString());
}
export async function calculateWitness(witness, wasmPath = 'build/step_js/step.wasm') {
  const memory = { type: 'mem' };
  await snarkjs.wtns.calculate(witness, wasmPath, memory, { sanityCheck: true });
  return memory;
}
export async function checkWitness(witness) {
  const memory = await calculateWitness(witness);
  return snarkjs.wtns.check('build/step.r1cs', memory);
}

export async function proveStep(witness) {
  const start = performance.now();
  const memory = await calculateWitness(witness);
  const afterWitness = performance.now();
  const result = await snarkjs.plonk.prove('build/step.zkey', memory, undefined, { singleThread: true });
  rule(JSON.stringify(result.publicSignals) === JSON.stringify(publicSignals(witness)), 'unexpected-public-signal-order');
  const edge = {
    input: asHex(witness.inputCommitment), nf: asHex(witness.nullifier), id: asHex(witness.transferDigest),
    outputs: witness.outputCommitments.map(asHex),
    proof: JSON.stringify({ scheme: SCHEME, nonce: field(witness.nonce).toString(), proof: result.proof }),
  };
  return { edge, timings: { witnessMs: afterWitness - start, provingMs: performance.now() - afterWitness } };
}

export const loadVerificationKey = () => JSON.parse(readFileSync('build/verification-key.json', 'utf8'));
const verifierLogger = { info() {}, debug() {}, warn() {}, error() {} };
export async function verifyEdge(edge, domain, verificationKey) {
  try {
    rule(edge && Object.keys(edge).sort().join(',') === 'id,input,nf,outputs,proof', 'invalid-edge-shape');
    rule(Array.isArray(edge.outputs) && edge.outputs.length === 2 && edge.outputs[0] !== edge.outputs[1], 'invalid-output-list');
    rule(typeof edge.proof === 'string' && Buffer.byteLength(edge.proof) <= 8192, 'invalid-proof-size');
    const encoded = JSON.parse(edge.proof);
    rule(encoded && Object.keys(encoded).sort().join(',') === 'nonce,proof,scheme' && encoded.scheme === SCHEME, 'wrong-proof-scheme');
    const signals = [context(domain), fromHex(edge.input), fromHex(edge.nf), ...edge.outputs.map(fromHex), field(encoded.nonce), fromHex(edge.id)].map(n => n.toString());
    rule(verificationKey.protocol === 'plonk' && verificationKey.curve === 'bn128' && verificationKey.nPublic === 7, 'wrong-verification-key');
    return await snarkjs.plonk.verify(verificationKey, signals, encoded.proof, verifierLogger);
  } catch {
    return false; // Untrusted malformed proofs fail closed; setup/load errors throw separately.
  }
}

const edgeFingerprint = (edge, domain) => createHash('sha256').update(JSON.stringify([domain, edge.input, edge.nf, edge.id, edge.outputs, edge.proof])).digest('hex');
export async function verifiedCapsuleVerifier(capsule, verificationKey) {
  const verified = new Set();
  for (const edge of capsule.edges) {
    rule(await verifyEdge(edge, capsule.domain, verificationKey), 'invalid-cryptographic-step-proof');
    verified.add(edgeFingerprint(edge, capsule.domain));
  }
  // Compatibility with the synchronous witness assembler. Entries enter this
  // set only AFTER actual PLONK verification; it is not the fixture oracle.
  return (edge, domain) => domain === capsule.domain && verified.has(edgeFingerprint(edge, domain));
}

export async function closeCurve() {
  // snarkjs verification/checks cache a worker-backed curve; release its workers.
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
}
