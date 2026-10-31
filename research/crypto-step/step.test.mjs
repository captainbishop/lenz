import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { DOMAIN, FR, createOwner, note, commitment, nullifier, makeStep, field, asHex, hash, context, ownerKey, checkWitness, proveStep, verifyEdge, loadVerificationKey, verifiedCapsuleVerifier, closeCurve } from './step.mjs';
import { WitnessMap } from '../witness-map.mjs';
import { makeCapsule, assembleWitness, noteKey, noteValue } from '../witness-delivery.mjs';

const vk = loadVerificationKey();
after(closeCurve);
function fixture() {
  const a = createOwner();
  const b = createOwner();
  const c = createOwner();
  const root = note(a.publicKey, 100n);
  const bNote = note(b.publicKey, 40n);
  const change = note(a.publicKey, 60n);
  const cNote = note(c.publicKey, 30n);
  const bChange = note(b.publicKey, 10n);
  return {
    a, b, c, root, bNote, change, cNote, bChange,
    ab: makeStep(root, a.secret, [bNote, change]),
    bc: makeStep(bNote, b.secret, [cNote, bChange]),
  };
}

test('honest transfer satisfies the compiled R1CS with only seven public fields', async () => {
  const f = fixture();
  assert.equal(await checkWitness(f.ab), true);
  const info = JSON.parse(readFileSync('build/build-metadata.json', 'utf8'));
  assert.equal(info.publicInputs, 7);
});

test('input ownership, secret-keyed nullifier and transcript are circuit constraints', async () => {
  const f = fixture();
  await assert.rejects(() => checkWitness({ ...f.ab, secret: f.b.secret }));
  await assert.rejects(() => checkWitness({ ...f.ab, nullifier: (f.ab.nullifier + 1n) % FR }));
  await assert.rejects(() => checkWitness({ ...f.ab, nonce: (f.ab.nonce + 1n) % FR }));
  await assert.rejects(() => checkWitness({ ...f.ab, transferDigest: 0n }));
  await assert.rejects(() => checkWitness(makeStep(f.bNote, f.a.secret, [f.cNote, f.bChange])));
});

test('overspending, burning, overflow and modular negative values fail the circuit', async () => {
  const f = fixture();
  for (const [one, two] of [[41n, 60n], [39n, 60n], [1n << 64n, 0n], [FR - 1n, 101n]]) {
    await assert.rejects(() => checkWitness(makeStep(f.root, f.a.secret, [note(f.b.publicKey, one), note(f.a.publicKey, two)])));
  }
  // Both outputs fit in 64 bits and conserve value: only the input range fails.
  await assert.rejects(() => checkWitness(makeStep(note(f.a.publicKey, 1n << 64n), f.a.secret,
    [note(f.b.publicKey, (1n << 64n) - 1n), note(f.a.publicKey, 1n)])));
});

test('zero spending secret is rejected even with matching note openings', async () => {
  const zeroOwner = ownerKey(0n);
  const b = createOwner();
  await assert.rejects(() => checkWitness(makeStep(note(zeroOwner, 100n), 0n,
    [note(b.publicKey, 40n), note(zeroOwner, 60n)])));
});

test('wrong input opening and output asset substitution fail the circuit', async () => {
  const f = fixture();
  await assert.rejects(() => checkWitness({ ...f.ab, inputRandomness: (f.ab.inputRandomness + 1n) % FR }));
  await assert.rejects(() => checkWitness(makeStep(f.root, f.a.secret, [note(f.b.publicKey, 40n, 2n), f.change])));
  const alteredOwner = { ...f.ab, outputOwners: [f.c.publicKey, f.ab.outputOwners[1]] };
  await assert.rejects(() => checkWitness(alteredOwner));
});

test('zero outputs support full-value payments; zero inputs and duplicate outputs are invalid', async () => {
  const f = fixture();
  assert.equal(await checkWitness(makeStep(f.root, f.a.secret, [note(f.b.publicKey, 100n), note(f.a.publicKey, 0n)])), true);
  await assert.rejects(() => checkWitness(makeStep(note(f.a.publicKey, 0n), f.a.secret, [note(f.b.publicKey, 0n), note(f.a.publicKey, 0n)])));
  const equal = note(f.b.publicKey, 50n);
  await assert.rejects(() => checkWitness(makeStep(f.root, f.a.secret, [equal, equal])));
});

test('same note fixes the nullifier across conflicting outputs, without deriving it from the address', () => {
  const f = fixture();
  const other = makeStep(f.root, f.a.secret, [note(f.c.publicKey, 100n), note(f.a.publicKey, 0n)], f.ab.nonce);
  assert.equal(other.nullifier, f.ab.nullifier);
  assert.notEqual(other.transferDigest, f.ab.transferDigest);
  assert.notEqual(nullifier(f.bNote, f.a.secret), nullifier(f.bNote, f.b.secret));
  assert.notEqual(hash([103n, context(), f.b.publicKey, commitment(f.bNote)]), nullifier(f.bNote, f.b.secret));
  // These sample inequalities do not prove a PRF/unlinkability theorem.
});

test('actual PLONK proofs connect A -> B -> C to the witness assembler', async () => {
  const f = fixture();
  const ab = await proveStep(f.ab);
  const bc = await proveStep(f.bc);
  assert.equal(await verifyEdge(ab.edge, DOMAIN, vk), true);
  assert.equal(await verifyEdge(bc.edge, DOMAIN, vk), true);
  const rootId = asHex(commitment(f.root));
  const tree = new WitnessMap(DOMAIN, [[noteKey(DOMAIN, rootId), noteValue(DOMAIN, rootId)]]);
  const checkpoint = { domain: DOMAIN, epoch: 0, root: tree.root };
  const capsule = makeCapsule(DOMAIN, checkpoint, bc.edge.outputs[0], [ab.edge, bc.edge]);
  const verified = await verifiedCapsuleVerifier(capsule, vk);
  const result = assembleWitness(capsule, tree, checkpoint, verified);
  assert.equal(result.steps.length, 2);
  assert.equal(result.steps[1].reused, false);
  assert.equal(new WitnessMap(DOMAIN, result.nextEntries).get(noteKey(DOMAIN, bc.edge.outputs[0])), noteValue(DOMAIN, bc.edge.outputs[0]));
  assert.equal(verified({ ...ab.edge, nf: bc.edge.nf }, DOMAIN), false);
});

test('real verification rejects public-field, proof and cross-domain tampering', async () => {
  const f = fixture();
  const { edge } = await proveStep(f.ab);
  assert.equal(await verifyEdge(edge, `${DOMAIN}/other-pool`, vk), false);
  for (const name of ['input', 'nf', 'id']) {
    assert.equal(await verifyEdge({ ...edge, [name]: asHex((BigInt(`0x${edge[name]}`) + 1n) % FR) }, DOMAIN, vk), false);
  }
  assert.equal(await verifyEdge({ ...edge, outputs: [edge.outputs[1], edge.outputs[0]] }, DOMAIN, vk), false);
  assert.equal(await verifyEdge({ ...edge, input: (BigInt(`0x${edge.input}`) + FR).toString(16).padStart(64, '0') }, DOMAIN, vk), false);
  const alias = JSON.parse(edge.proof);
  alias.nonce = (BigInt(alias.nonce) + FR).toString();
  assert.equal(await verifyEdge({ ...edge, proof: JSON.stringify(alias) }, DOMAIN, vk), false);
  const data = JSON.parse(edge.proof);
  data.nonce = ((BigInt(data.nonce) + 1n) % FR).toString();
  assert.equal(await verifyEdge({ ...edge, proof: JSON.stringify(data) }, DOMAIN, vk), false);
  const broken = JSON.parse(edge.proof);
  broken.proof.A[0] = '0';
  assert.equal(await verifyEdge({ ...edge, proof: JSON.stringify(broken) }, DOMAIN, vk), false);
});

test('canonical field encodings reject aliases and malformed proof envelopes', async () => {
  assert.throws(() => field(FR), /field-out-of-range/);
  assert.throws(() => field('01'), /noncanonical-field/);
  assert.throws(() => field(1), /noncanonical-field/);
  const f = fixture();
  const malformed = { input: asHex(f.ab.inputCommitment), nf: asHex(f.ab.nullifier), id: asHex(f.ab.transferDigest), outputs: f.ab.outputCommitments.map(asHex), proof: '{}' };
  assert.equal(await verifyEdge(malformed, DOMAIN, vk), false);
  assert.equal(await verifyEdge({ ...malformed, input: FR.toString(16).padStart(64, '0') }, DOMAIN, vk), false);
  assert.equal(await verifyEdge({ ...malformed, proof: 'x'.repeat(8193) }, DOMAIN, vk), false);
  assert.notEqual(ownerKey(f.a.secret), ownerKey(f.a.secret, `${DOMAIN}/other`));
});
