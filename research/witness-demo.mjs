import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { witnessFixture } from './witness-fixture.mjs';
import { WitnessMap, verifyPath, rootFromPath } from './witness-map.mjs';
import { sealCapsule, openCapsule, fetchWitnessMap, assembleWitness, makeCapsule } from './witness-delivery.mjs';

const f = witnessFixture();
const key = randomBytes(32);
const handoff = randomBytes(16).toString('hex');
const envelope = sealCapsule(f.cCapsule, key, handoff);
const received = openCapsule(envelope, key, f.domain, handoff);
const requests = [];
const mirror = {
  name: 'available-copy', fetch: async request => {
    requests.push(request);
    return structuredClone(f.snapshot);
  },
};
const fresh = await fetchWitnessMap([
  { name: 'withholding-copy', fetch: () => new Promise(() => {}) }, mirror,
], f.checkpoint, 15);
const start = performance.now();
const assembled = assembleWitness(received, fresh.tree, f.checkpoint, f.verifyStep);
const assemblyMilliseconds = performance.now() - start;
let root = assembled.priorRoot;
for (const step of assembled.steps) {
  for (const query of step.queries) assert.equal(verifyPath(f.domain, root, query), true);
  for (const update of step.updates) {
    assert.equal(verifyPath(f.domain, root, update), true);
    root = rootFromPath(f.domain, update.key, update.nextValue, update.siblings);
  }
  assert.equal(root, step.afterRoot);
}
assert.equal(root, assembled.nextRoot);
const fork = makeCapsule(f.domain, f.anchor, f.edges.ax.outputs[0], [f.edges.ax]);
const forkState = assembleWitness(fork, f.current, f.checkpoint, f.verifyStep);
const forkTree = new WitnessMap(f.domain, forkState.nextEntries);
assert.throws(() => assembleWitness(received, forkTree, { domain: f.domain, epoch: 2, root: forkTree.root }, f.verifyStep), /conflicting-ancestor/);
await assert.rejects(() => fetchWitnessMap([], f.checkpoint), /witness-data-unavailable/);
const pathCount = assembled.steps.reduce((count, step) => count + step.queries.length + step.updates.length, 0);
console.log(JSON.stringify({
  kind: 'local-witness-delivery-experiment',
  runtime: process.version,
  implemented: ['AES-256-GCM capsule encryption', 'SHA-256 sparse Merkle paths', 'full-snapshot verification', 'bounded mirror failover'],
  assumed: ['ideal payment-proof oracle', 'trusted finalized checkpoint', 'completed decryption-key handover', 'one complete available mirror'],
  outcome: 'witness-assembled-without-sender-calls',
  failureOutcomes: ['competing ancestor rejected', 'no available mirror rejected'],
  mirrorFailures: fresh.failures,
  mirrorRequestFields: Object.keys(requests[0]),
  metrics: {
    plaintextCapsuleBytes: Buffer.byteLength(JSON.stringify(f.cCapsule)),
    serializedEncryptedEnvelopeBytes: Buffer.byteLength(JSON.stringify(envelope)),
    snapshotEntryCount: f.snapshot.entries.length,
    snapshotJsonBytes: Buffer.byteLength(JSON.stringify(f.snapshot)),
    uncompressedMerklePaths: pathCount,
    rawSiblingHashBytes: pathCount * 256 * 32,
    assembledWitnessJsonBytes: Buffer.byteLength(JSON.stringify(assembled)),
    assemblyMillisecondsOnThisWindowsHost: Number(assemblyMilliseconds.toFixed(2)),
  },
  limits: ['not a payment or ZK proof', 'no Android/iPhone/BLE measurement', 'ancestor graph visible to holder', 'public snapshot/update metadata'],
}, null, 2));
