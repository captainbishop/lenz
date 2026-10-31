/**
 * Witness-delivery experiment. AES-GCM and Merkle paths are implemented.
 * Payment proof verification is a REQUIRED external assumption/oracle here.
 * This does not verify ZK proofs, key exchange, NEAR finality or actual funds.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { WitnessMap, digest, isDigest } from './witness-map.mjs';

const rule = (ok, message) => { if (!ok) throw new Error(message); };
const VERSION = 'proof-u/witness-capsule/v1';
export const MAX_CAPSULE_BYTES = 65536;
export const noteKey = (domain, note) => digest('note-key', domain, note);
export const noteValue = (domain, note) => digest('note-created', domain, note);
export const spentKey = (domain, nf) => digest('spent-key', domain, nf);
export const edgeKey = (domain, edge) => digest('edge-key', domain, edge);
export const edgeValue = (domain, edge) => digest('edge-record', domain, edge.input, edge.nf, edge.id, edge.outputs);

const hasKeys = (object, names) => object && typeof object === 'object'
  && JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...names].sort());

export function validateCapsule(capsule) {
  rule(hasKeys(capsule, ['version', 'domain', 'anchorEpoch', 'anchorRoot', 'tip', 'edges']), 'invalid-capsule');
  rule(capsule.version === VERSION && typeof capsule.domain === 'string' && capsule.domain.length > 0, 'invalid-capsule-domain');
  rule(Number.isSafeInteger(capsule.anchorEpoch) && capsule.anchorEpoch >= 0 && isDigest(capsule.anchorRoot), 'invalid-anchor');
  rule(isDigest(capsule.tip) && Array.isArray(capsule.edges) && capsule.edges.length > 0 && capsule.edges.length <= 64, 'invalid-capsule-edges');
  for (const edge of capsule.edges) {
    rule(hasKeys(edge, ['input', 'nf', 'id', 'outputs', 'proof']), 'invalid-edge');
    rule([edge.input, edge.nf, edge.id].every(isDigest), 'invalid-edge-id');
    rule(Array.isArray(edge.outputs) && edge.outputs.length > 0 && edge.outputs.length <= 8 && edge.outputs.every(isDigest), 'invalid-edge-outputs');
    rule(new Set(edge.outputs).size === edge.outputs.length, 'duplicate-output');
    rule(typeof edge.proof === 'string' && edge.proof.length > 0 && edge.proof.length <= 8192, 'invalid-step-proof-bytes');
  }
  rule(capsule.edges.some(edge => edge.outputs.includes(capsule.tip)), 'tip-not-in-package');
  rule(Buffer.byteLength(JSON.stringify(capsule)) <= MAX_CAPSULE_BYTES, 'capsule-size-limit');
}

export function makeCapsule(domain, checkpoint, tip, edges) {
  const capsule = { version: VERSION, domain, anchorEpoch: checkpoint.epoch, anchorRoot: checkpoint.root, tip, edges };
  validateCapsule(capsule);
  return structuredClone(capsule);
}

const aad = (domain, handoff) => Buffer.from(JSON.stringify([VERSION, domain, handoff]));
function validateKey(key, handoff) {
  rule(Buffer.isBuffer(key) && key.length === 32, 'invalid-capsule-key');
  rule(typeof handoff === 'string' && /^[0-9a-f]{32}$/.test(handoff), 'invalid-handoff');
}

export function sealCapsule(capsule, key, handoff) {
  validateCapsule(capsule);
  validateKey(key, handoff);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad(capsule.domain, handoff));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(capsule), 'utf8'), cipher.final()]);
  return { version: VERSION, domain: capsule.domain, handoff, nonce: nonce.toString('hex'), ciphertext: bytes.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

export function openCapsule(envelope, key, expectedDomain, expectedHandoff) {
  validateKey(key, expectedHandoff);
  rule(hasKeys(envelope, ['version', 'domain', 'handoff', 'nonce', 'ciphertext', 'authTag']), 'invalid-envelope');
  rule(envelope.version === VERSION && envelope.domain === expectedDomain && envelope.handoff === expectedHandoff, 'wrong-envelope-context');
  rule(typeof envelope.nonce === 'string' && /^[0-9a-f]{24}$/.test(envelope.nonce), 'invalid-nonce');
  rule(typeof envelope.authTag === 'string' && /^[0-9a-f]{32}$/.test(envelope.authTag), 'invalid-auth-tag');
  rule(typeof envelope.ciphertext === 'string' && envelope.ciphertext.length <= MAX_CAPSULE_BYTES * 2
    && /^(?:[0-9a-f]{2})+$/.test(envelope.ciphertext), 'invalid-ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'hex'), { authTagLength: 16 });
  decipher.setAAD(aad(expectedDomain, expectedHandoff));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'hex'));
  // Do not parse or return any plaintext before authentication succeeds.
  const bytes = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'hex')), decipher.final()]);
  const capsule = JSON.parse(bytes.toString('utf8'));
  validateCapsule(capsule);
  rule(capsule.domain === expectedDomain, 'wrong-capsule-domain');
  return capsule;
}

function checkCheckpoint(checkpoint) {
  rule(checkpoint && typeof checkpoint.domain === 'string' && checkpoint.domain.length > 0
    && Number.isSafeInteger(checkpoint.epoch) && checkpoint.epoch >= 0 && isDigest(checkpoint.root), 'invalid-checkpoint');
}

export async function fetchWitnessMap(mirrors, trustedCheckpoint, timeoutMs = 1000) {
  checkCheckpoint(trustedCheckpoint);
  rule(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 10000, 'invalid-timeout');
  const failures = [];
  // Every client asks for the SAME full snapshot. No capsule-dependent key query.
  const request = { domain: trustedCheckpoint.domain, epoch: trustedCheckpoint.epoch, root: trustedCheckpoint.root };
  for (const mirror of mirrors) {
    let timer;
    const controller = new AbortController();
    try {
      const snapshot = await Promise.race([
        Promise.resolve().then(() => mirror.fetch(structuredClone(request), controller.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('mirror-timeout')), timeoutMs); }),
      ]);
      rule(snapshot && snapshot.domain === request.domain && snapshot.epoch === request.epoch, 'wrong-snapshot-context');
      rule(Array.isArray(snapshot.entries), 'missing-snapshot-data');
      const tree = new WitnessMap(request.domain, snapshot.entries);
      rule(tree.root === request.root, 'snapshot-root-mismatch');
      return { tree, source: mirror.name, failures };
    } catch (error) {
      failures.push({ source: mirror.name, reason: error.message });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  throw new Error(`witness-data-unavailable:${JSON.stringify(failures)}`);
}

export function assembleWitness(capsule, tree, trustedCheckpoint, verifyStep) {
  validateCapsule(capsule);
  checkCheckpoint(trustedCheckpoint);
  rule(typeof verifyStep === 'function', 'step-verifier-required');
  rule(capsule.domain === tree.domain && tree.domain === trustedCheckpoint.domain, 'wrong-witness-domain');
  rule(trustedCheckpoint.epoch >= capsule.anchorEpoch, 'checkpoint-before-anchor');
  rule(tree.root === trustedCheckpoint.root, 'stale-witness-root');
  const staged = new WitnessMap(tree.domain, tree.entries());
  rule(staged.root === trustedCheckpoint.root, 'snapshot-content-mismatch');
  const steps = [];
  for (const edge of capsule.edges) {
    rule(verifyStep(edge, capsule.domain) === true, 'invalid-step-proof');
    const beforeRoot = staged.root;
    const queries = [];
    const updates = [];
    const query = key => { const path = staged.path(key); queries.push(path); return path.value; };
    const update = (key, value) => {
      const path = staged.path(key);
      updates.push({ ...path, nextValue: value });
      staged.set(key, value);
    };
    const winner = query(spentKey(tree.domain, edge.nf));
    if (winner !== null) {
      rule(winner === edge.id, 'conflicting-ancestor');
      rule(query(edgeKey(tree.domain, edge.id)) === edgeValue(tree.domain, edge), 'missing-canonical-edge');
      for (const output of edge.outputs) {
        rule(query(noteKey(tree.domain, output)) === noteValue(tree.domain, output), 'missing-canonical-output');
      }
    } else {
      rule(query(noteKey(tree.domain, edge.input)) === noteValue(tree.domain, edge.input), 'missing-input-provenance');
      rule(query(edgeKey(tree.domain, edge.id)) === null, 'inconsistent-canonical-edge');
      for (const output of edge.outputs) rule(query(noteKey(tree.domain, output)) === null, 'output-already-exists');
      update(spentKey(tree.domain, edge.nf), edge.id);
      update(edgeKey(tree.domain, edge.id), edgeValue(tree.domain, edge));
      for (const output of edge.outputs) update(noteKey(tree.domain, output), noteValue(tree.domain, output));
    }
    steps.push({ edge: edge.id, beforeRoot, afterRoot: staged.root, reused: winner !== null, queries, updates });
  }
  return { kind: 'research-witness-under-step-proof-assumption', priorRoot: tree.root, nextRoot: staged.root, steps, nextEntries: staged.entries() };
}
