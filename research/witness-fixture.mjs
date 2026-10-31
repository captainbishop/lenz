// Deterministic research fixtures and an IDEAL proof-verification oracle.
// No actual ZK proof bytes, signing keys or randomized private note scheme.
import { makeRoot, makeTransfer, OfflineView, DOMAIN } from './transfer-model.mjs';
import { WitnessMap, digest } from './witness-map.mjs';
import { noteKey, noteValue, makeCapsule, assembleWitness } from './witness-delivery.mjs';

export function witnessFixture() {
  const commitment = id => digest('fixture-note', DOMAIN, id);
  const a = makeRoot(digest('fixture-deposit-a'), 'A', 100n);
  const u = makeRoot(digest('fixture-deposit-u'), 'U', 7n);
  const ab = makeTransfer(a, 'A', [{ owner: 'B', amount: 60n }, { owner: 'A', amount: 40n }], 'ab');
  const view = new OfflineView([a, u]);
  view.receive(ab);
  const bc = makeTransfer(view.notes.get(`${ab.id}:0`), 'B', [{ owner: 'C', amount: 60n }], 'bc');
  const ad = makeTransfer(view.notes.get(`${ab.id}:1`), 'A', [{ owner: 'D', amount: 40n }], 'ad');
  const ax = makeTransfer(a, 'A', [{ owner: 'X', amount: 100n }], 'ax');
  const uv = makeTransfer(u, 'U', [{ owner: 'V', amount: 7n }], 'uv');
  // Local validity has been checked by makeTransfer's IDEAL ownership model.
  const describe = tx => ({
    input: commitment(tx.input), nf: digest('fixture-nf', DOMAIN, tx.input), id: tx.id,
    outputs: tx.outputs.map((_, index) => commitment(`${tx.id}:${index}`)),
    proof: `IDEAL-STEP-PROOF:${digest('fixture-proof', tx.id)}`,
  });
  const edges = { ab: describe(ab), bc: describe(bc), ad: describe(ad), ax: describe(ax), uv: describe(uv) };
  const fingerprint = (edge, domain) => digest('fixture-oracle', domain, edge.input, edge.nf, edge.id, edge.outputs, edge.proof);
  const authorized = new Set(Object.values(edges).map(edge => fingerprint(edge, DOMAIN)));
  const verifyStep = (edge, domain) => authorized.has(fingerprint(edge, domain));
  const original = new WitnessMap(DOMAIN, [a, u].map(n => [noteKey(DOMAIN, commitment(n.id)), noteValue(DOMAIN, commitment(n.id))]));
  const anchor = { domain: DOMAIN, epoch: 0, root: original.root };
  const bCapsule = makeCapsule(DOMAIN, anchor, edges.ab.outputs[0], [edges.ab]);
  const cCapsule = makeCapsule(DOMAIN, anchor, edges.bc.outputs[0], [...bCapsule.edges, edges.bc]);
  const unrelated = makeCapsule(DOMAIN, anchor, edges.uv.outputs[0], [edges.uv]);
  const unrelatedWitness = assembleWitness(unrelated, original, anchor, verifyStep);
  const current = new WitnessMap(DOMAIN, unrelatedWitness.nextEntries);
  const checkpoint = { domain: DOMAIN, epoch: 1, root: current.root };
  return {
    domain: DOMAIN, edges, verifyStep, original, current, anchor, checkpoint, bCapsule, cCapsule,
    snapshot: { domain: DOMAIN, epoch: 1, entries: current.entries() },
    staleSnapshot: { domain: DOMAIN, epoch: 0, entries: original.entries() },
  };
}
