import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { WitnessMap, digest, rootFromPath, verifyPath } from './witness-map.mjs';
import { witnessFixture } from './witness-fixture.mjs';
import { assembleWitness, fetchWitnessMap, openCapsule, sealCapsule, makeCapsule, noteKey, noteValue, spentKey, MAX_CAPSULE_BYTES } from './witness-delivery.mjs';

const handoff = 'ab'.repeat(16);
const mirror = (name, data) => ({ name, fetch: async () => structuredClone(data) });

test('membership and nonmembership paths verify, including an empty map', () => {
  const key = digest('key');
  const other = digest('other');
  const tree = new WitnessMap('test', [[key, digest('value')]]);
  assert.equal(verifyPath('test', tree.root, tree.path(key)), true);
  assert.equal(verifyPath('test', tree.root, tree.path(other)), true);
  assert.equal(tree.path(other).value, null);
  const empty = new WitnessMap('test');
  assert.equal(verifyPath('test', empty.root, empty.path(key)), true);
  assert.equal(verifyPath('other-domain', tree.root, tree.path(key)), false);
});

test('altered leaf, key, sibling, or path length fails root verification', () => {
  const key = digest('key');
  const tree = new WitnessMap('test', [[key, digest('value')]]);
  const proof = tree.path(key);
  assert.equal(verifyPath('test', tree.root, { ...proof, value: null }), false);
  assert.equal(verifyPath('test', tree.root, { ...proof, key: digest('another') }), false);
  const changed = structuredClone(proof);
  changed.siblings[35] = digest('tampered');
  assert.equal(verifyPath('test', tree.root, changed), false);
  assert.equal(verifyPath('test', tree.root, { ...proof, siblings: [] }), false);
});

test('an absent-leaf path computes the exact updated root without other entries', () => {
  const tree = new WitnessMap('test', [[digest('a'), digest('v')]]);
  const key = digest('new-key');
  const value = digest('new-value');
  const path = tree.path(key);
  const next = rootFromPath('test', key, value, path.siblings);
  tree.set(key, value);
  assert.equal(tree.root, next);
  const reordered = new WitnessMap('test', tree.entries().reverse());
  assert.equal(reordered.root, tree.root);
});

test('snapshot entries reject duplicates and enforce the experiment size limit', () => {
  const pair = [digest('a'), digest('b')];
  assert.throws(() => new WitnessMap('test', [pair, pair]), /duplicate-map-key/);
  assert.throws(() => new WitnessMap('test', Array(2049).fill(pair)), /snapshot-entry-limit/);
});

test('encrypted capsule can be carried onward and decrypted after senders disappear', async () => {
  const f = witnessFixture();
  const bKey = randomBytes(32);
  const bEnvelope = sealCapsule(f.bCapsule, bKey, handoff);
  const receivedByB = openCapsule(bEnvelope, bKey, f.domain, handoff);
  const onward = makeCapsule(f.domain, f.anchor, f.edges.bc.outputs[0], [...receivedByB.edges, f.edges.bc]);
  const cKey = randomBytes(32);
  const cEnvelope = sealCapsule(onward, cKey, handoff);
  // C's remaining inputs are carried bytes/key, a trusted checkpoint and a
  // local IDEAL public verifier. There are no calls to either sender.
  const c = openCapsule(cEnvelope, cKey, f.domain, handoff);
  const fetched = await fetchWitnessMap([
    { name: 'withholder', fetch: () => new Promise(() => {}) }, mirror('independent', f.snapshot),
  ], f.checkpoint, 15);
  assert.equal(fetched.source, 'independent');
  assert.equal(fetched.failures[0].reason, 'mirror-timeout');
  const result = assembleWitness(c, fetched.tree, f.checkpoint, f.verifyStep);
  assert.equal(result.steps.length, 2);
  assert.notEqual(result.priorRoot, result.nextRoot);
  assert.equal(fetched.tree.root, f.checkpoint.root);
});

test('wrong key and tampered ciphertext, tag or authenticated context fail decryption', () => {
  const f = witnessFixture();
  const key = randomBytes(32);
  const envelope = sealCapsule(f.cCapsule, key, handoff);
  assert.throws(() => openCapsule(envelope, randomBytes(32), f.domain, handoff));
  for (const field of ['ciphertext', 'authTag', 'nonce']) {
    const changed = { ...envelope, [field]: `${envelope[field][0] === '0' ? '1' : '0'}${envelope[field].slice(1)}` };
    assert.throws(() => openCapsule(changed, key, f.domain, handoff));
  }
  assert.throws(() => openCapsule(envelope, key, 'another-domain', handoff), /wrong-envelope-context/);
  // Even if the caller expects the altered header, the authentication tag fails.
  assert.throws(() => openCapsule({ ...envelope, domain: 'another-domain' }, key, 'another-domain', handoff));
  assert.throws(() => openCapsule({ ...envelope, handoff: 'cd'.repeat(16) }, key, f.domain, 'cd'.repeat(16)));
});

test('new encryption uses a fresh nonce while exact ciphertext retries still decrypt', () => {
  const f = witnessFixture();
  const key = randomBytes(32);
  const first = sealCapsule(f.cCapsule, key, handoff);
  const second = sealCapsule(f.cCapsule, key, handoff);
  assert.notEqual(first.nonce, second.nonce);
  assert.deepEqual(openCapsule(structuredClone(first), key, f.domain, handoff), f.cCapsule);
  assert.deepEqual(openCapsule(second, key, f.domain, handoff), f.cCapsule);
});

test('malformed and oversized capsule data is rejected', () => {
  const f = witnessFixture();
  assert.throws(() => sealCapsule({ ...f.cCapsule, debugOwner: 'A' }, randomBytes(32), handoff), /invalid-capsule/);
  const tooLarge = structuredClone(f.cCapsule);
  tooLarge.edges = Array.from({ length: 64 }, () => ({ ...f.edges.bc, proof: 'p'.repeat(8192) }));
  assert.throws(() => sealCapsule(tooLarge, randomBytes(32), handoff), /capsule-size-limit/);
  const packet = sealCapsule(f.cCapsule, randomBytes(32), handoff);
  assert.throws(() => openCapsule({ ...packet, ciphertext: 'aa'.repeat(MAX_CAPSULE_BYTES + 1) }, randomBytes(32), f.domain, handoff), /invalid-ciphertext/);
});

test('corrupted, incomplete and stale mirrors cannot replace an authenticated current snapshot', async () => {
  const f = witnessFixture();
  const corrupted = structuredClone(f.snapshot);
  corrupted.entries[0][1] = digest('corruption');
  const incomplete = { ...f.snapshot, entries: f.snapshot.entries.slice(1) };
  const fetched = await fetchWitnessMap([
    mirror('stale', f.staleSnapshot), mirror('corrupt', corrupted), mirror('incomplete', incomplete), mirror('honest', f.snapshot),
  ], f.checkpoint);
  assert.equal(fetched.source, 'honest');
  assert.deepEqual(fetched.failures.map(x => x.reason), ['wrong-snapshot-context', 'snapshot-root-mismatch', 'snapshot-root-mismatch']);
  assert.equal(fetched.tree.root, f.checkpoint.root);
});

test('a root alone or unanimous withholding is unavailability, not a valid witness', async () => {
  const f = witnessFixture();
  await assert.rejects(() => fetchWitnessMap([mirror('root-only', f.checkpoint)], f.checkpoint), /missing-snapshot-data/);
  await assert.rejects(() => fetchWitnessMap([], f.checkpoint), /witness-data-unavailable/);
  await assert.rejects(() => fetchWitnessMap([{ name: 'silent', fetch: () => new Promise(() => {}) }], f.checkpoint, 10), /mirror-timeout/);
});

test('mirror request is identical for different holders at the same checkpoint', async () => {
  const f = witnessFixture();
  const seen = [];
  const source = { name: 'observer', fetch: async request => { seen.push(request); return structuredClone(f.snapshot); } };
  const one = await fetchWitnessMap([source], f.checkpoint);
  const two = await fetchWitnessMap([source], f.checkpoint);
  assembleWitness(f.cCapsule, one.tree, f.checkpoint, f.verifyStep);
  const other = makeCapsule(f.domain, f.anchor, f.edges.ad.outputs[0], [f.edges.ab, f.edges.ad]);
  assembleWitness(other, two.tree, f.checkpoint, f.verifyStep);
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['domain', 'epoch', 'root']);
  assert.equal(JSON.stringify(seen).includes(f.edges.ab.nf), false);
});

test('every generated lookup and intermediate update path verifies independently', () => {
  const f = witnessFixture();
  const result = assembleWitness(f.cCapsule, f.current, f.checkpoint, f.verifyStep);
  let root = result.priorRoot;
  for (const step of result.steps) {
    assert.equal(step.beforeRoot, root);
    for (const query of step.queries) assert.equal(verifyPath(f.domain, root, query), true);
    for (const update of step.updates) {
      assert.equal(verifyPath(f.domain, root, update), true);
      root = rootFromPath(f.domain, update.key, update.nextValue, update.siblings);
    }
    assert.equal(root, step.afterRoot);
  }
  assert.equal(root, result.nextRoot);
});

test('a canonical identical parent is reused and change remains accessible', () => {
  const f = witnessFixture();
  const first = assembleWitness(f.cCapsule, f.current, f.checkpoint, f.verifyStep);
  const state = new WitnessMap(f.domain, first.nextEntries);
  assert.equal(state.get(noteKey(f.domain, f.edges.ab.outputs[1])), noteValue(f.domain, f.edges.ab.outputs[1]));
  const checkpoint = { domain: f.domain, epoch: 2, root: state.root };
  const other = makeCapsule(f.domain, f.anchor, f.edges.ad.outputs[0], [f.edges.ab, f.edges.ad]);
  const second = assembleWitness(other, state, checkpoint, f.verifyStep);
  assert.equal(second.steps[0].reused, true);
  assert.equal(second.steps[0].updates.length, 0);
  assert.equal(second.steps[1].reused, false);
});

test('a competing settled ancestor rejects the capsule without modifying the fetched map', () => {
  const f = witnessFixture();
  const fork = makeCapsule(f.domain, f.anchor, f.edges.ax.outputs[0], [f.edges.ax]);
  const result = assembleWitness(fork, f.current, f.checkpoint, f.verifyStep);
  const state = new WitnessMap(f.domain, result.nextEntries);
  const checkpoint = { domain: f.domain, epoch: 2, root: state.root };
  const before = state.root;
  assert.throws(() => assembleWitness(f.cCapsule, state, checkpoint, f.verifyStep), /conflicting-ancestor/);
  assert.equal(state.root, before);
});

test('missing parent and altered opaque step-proof inputs are rejected', () => {
  const f = witnessFixture();
  const missing = makeCapsule(f.domain, f.anchor, f.edges.bc.outputs[0], [f.edges.bc]);
  assert.throws(() => assembleWitness(missing, f.current, f.checkpoint, f.verifyStep), /missing-input-provenance/);
  const changed = structuredClone(f.cCapsule);
  changed.edges[1].outputs = [digest('attacker-output')];
  changed.tip = changed.edges[1].outputs[0];
  assert.throws(() => assembleWitness(changed, f.current, f.checkpoint, f.verifyStep), /invalid-step-proof/);
  assert.throws(() => assembleWitness(f.cCapsule, f.current, f.checkpoint), /step-verifier-required/);
});

test('freshness is relative to a trusted checkpoint; stale and cross-domain maps fail', () => {
  const f = witnessFixture();
  assert.throws(() => assembleWitness(f.cCapsule, f.original, f.checkpoint, f.verifyStep), /stale-witness-root/);
  assert.throws(() => assembleWitness(f.cCapsule, f.current, { ...f.checkpoint, domain: 'other' }, f.verifyStep), /wrong-witness-domain/);
  assert.throws(() => assembleWitness({ ...f.cCapsule, anchorEpoch: 9 }, f.current, f.checkpoint, f.verifyStep), /checkpoint-before-anchor/);
  // Old-but-authentic state still passes if the caller supplies an old trust
  // anchor. The library has no oracle for newest NEAR finality.
  assert.doesNotThrow(() => assembleWitness(f.cCapsule, f.original, f.anchor, f.verifyStep));
});

test('mutated map contents cannot hide behind a cached authenticated root', () => {
  const f = witnessFixture();
  f.current.values.set(digest('injected-key'), digest('injected-value'));
  assert.equal(f.current.root, f.checkpoint.root);
  assert.throws(() => assembleWitness(f.cCapsule, f.current, f.checkpoint, f.verifyStep), /snapshot-content-mismatch/);
});

test('fixture nullifiers are sender-derivable: this experiment does not prove payment unlinkability', () => {
  const f = witnessFixture();
  const senderDerived = digest('fixture-nf', f.domain, `${f.edges.ab.id}:0`);
  assert.equal(senderDerived, f.edges.bc.nf);
  const result = assembleWitness(f.cCapsule, f.current, f.checkpoint, f.verifyStep);
  const publicState = new WitnessMap(f.domain, result.nextEntries);
  assert.equal(publicState.get(spentKey(f.domain, senderDerived)), f.edges.bc.id);
});
