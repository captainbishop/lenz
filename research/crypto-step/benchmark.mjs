import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { randomBytes } from 'node:crypto';
import { DOMAIN, createOwner, note, makeStep, commitment, asHex, proveStep, verifyEdge, loadVerificationKey, verifiedCapsuleVerifier, closeCurve } from './step.mjs';
import { WitnessMap } from '../witness-map.mjs';
import { noteKey, noteValue, makeCapsule, assembleWitness, sealCapsule, openCapsule, fetchWitnessMap } from '../witness-delivery.mjs';

try {
  const vk = loadVerificationKey();
  const a = createOwner();
  const b = createOwner();
  const c = createOwner();
  const root = note(a.publicKey, 100n);
  const bNote = note(b.publicKey, 40n);
  const abInput = makeStep(root, a.secret, [bNote, note(a.publicKey, 60n)]);
  const bcInput = makeStep(bNote, b.secret, [note(c.publicKey, 30n), note(b.publicKey, 10n)]);
  const samples = [];
  const proven = [];
  for (const [label, input] of [['A-to-B', abInput], ['B-to-C', bcInput], ['A-to-B-new-proof', abInput]]) {
    const item = await proveStep(input);
    const started = performance.now();
    assert.equal(await verifyEdge(item.edge, DOMAIN, vk), true);
    samples.push({ label, ...item.timings, verifyMs: performance.now() - started, proofEnvelopeBytes: Buffer.byteLength(item.edge.proof) });
    proven.push(item.edge);
    console.log(`Generated and verified ${label}`);
  }
  assert.equal(proven[0].id, proven[2].id);
  assert.equal(proven[0].nf, proven[2].nf);
  assert.notEqual(proven[0].proof, proven[2].proof);
  const rootId = asHex(commitment(root));
  const tree = new WitnessMap(DOMAIN, [[noteKey(DOMAIN, rootId), noteValue(DOMAIN, rootId)]]);
  const anchor = { domain: DOMAIN, epoch: 0, root: tree.root };
  const capsule = makeCapsule(DOMAIN, anchor, proven[1].outputs[0], proven.slice(0, 2));
  const key = randomBytes(32);
  const handoff = randomBytes(16).toString('hex');
  const envelope = sealCapsule(capsule, key, handoff);
  const received = openCapsule(envelope, key, DOMAIN, handoff);
  const unrelated = asHex(commitment(note(createOwner().publicKey, 7n)));
  tree.set(noteKey(DOMAIN, unrelated), noteValue(DOMAIN, unrelated));
  const checkpoint = { domain: DOMAIN, epoch: 1, root: tree.root };
  const snapshot = { domain: DOMAIN, epoch: 1, entries: tree.entries() };
  const requests = [];
  const fresh = await fetchWitnessMap([
    { name: 'withholding-copy', fetch: () => new Promise(() => {}) },
    { name: 'available-copy', fetch: async request => { requests.push(request); return structuredClone(snapshot); } },
  ], checkpoint, 20);
  const checked = await verifiedCapsuleVerifier(received, vk);
  const assembled = assembleWitness(received, fresh.tree, checkpoint, checked);
  assert.equal(assembled.steps.length, 2);
  assert.equal(fresh.failures[0].reason, 'mirror-timeout');
  assert.deepEqual(Object.keys(requests[0]).sort(), ['domain', 'epoch', 'root']);
  const metadata = JSON.parse(readFileSync('build/build-metadata.json', 'utf8'));
  // Public sample key is for replaying this saved test only. Runtime verification
  // uses its independently loaded key, never an envelope-supplied key.
  writeFileSync('proof-example.json', JSON.stringify({ kind: 'public-test-only-PLONK-step', domain: DOMAIN, circuitHash: metadata.hashes['step.circom'], verificationKey: vk, edge: proven[0] }, null, 2));
  const report = {
    ...metadata,
    kind: 'real-PLONK-local-research-benchmark', runtime: process.version, platform: process.platform, arch: process.arch,
    benchmarkKind: 'three observations, not a performance distribution',
    samples: samples.map(sample => Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, typeof value === 'number' ? Number(value.toFixed(2)) : value]))),
    bytes: { wasm: statSync('build/step_js/step.wasm').size, provingKey: statSync('build/step.zkey').size, verificationKeyJson: statSync('build/verification-key.json').size, twoStepCapsuleJson: Buffer.byteLength(JSON.stringify(capsule)), encryptedEnvelopeJson: Buffer.byteLength(JSON.stringify(envelope)), snapshotJson: Buffer.byteLength(JSON.stringify(snapshot)), assembledWitnessJson: Buffer.byteLength(JSON.stringify(assembled)) },
    peakResidentMiBForWholeProcess: Number((process.resourceUsage().maxRSS / 1024).toFixed(2)),
    outcomes: ['three real proofs verified', 'proof randomization preserves transfer digest/nullifier', 'A-to-B-to-C capsule verified without supplying prior spending secrets', 'encrypted capsule round trip', 'fresh witness assembled after unrelated state update and one mirror timeout'],
    mirrorFailures: fresh.failures,
    assumed: ['trusted fresh checkpoint', 'completed capsule-key and recipient-opening handover', 'one reachable complete snapshot', 'local test setup is trusted for this experiment only'],
    remaining: ['local setup is not production-trusted', 'no recursive settlement proof', 'no NEAR on-chain verification', 'no Zcash value route', 'no mobile proving measurement', 'ancestor graph visible to capsule holder', 'no guaranteed offline redemption'],
  };
  writeFileSync('benchmark-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await closeCurve();
}
