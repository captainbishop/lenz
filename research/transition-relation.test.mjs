import assert from 'node:assert/strict';
import test from 'node:test';
import { makeRoot, makeTransfer, OfflineView, Settlement } from './transfer-model.mjs';
import { stateDigest, prepareStatement, applyStatement } from './transition-relation.mjs';

// Fixed blinding is for deterministic tests, not a production randomness policy.
const pack = transfers => ({ transfers, blinding: '12'.repeat(32) });
const settle = (ledger, witness) => applyStatement(ledger, prepareStatement(ledger, witness), witness);

function splitFixture() {
  const root = makeRoot('shared', 'A', 100n);
  const parent = makeTransfer(root, 'A', [{ owner: 'B', amount: 60n }, { owner: 'D', amount: 40n }], 'split');
  const view = new OfflineView([root]);
  view.receive(parent);
  const left = makeTransfer(view.notes.get(`${parent.id}:0`), 'B', [{ owner: 'C', amount: 60n }], 'left');
  const right = makeTransfer(view.notes.get(`${parent.id}:1`), 'D', [{ owner: 'E', amount: 40n }], 'right');
  const fork = makeTransfer(root, 'A', [{ owner: 'X', amount: 100n }], 'fork');
  return { root, parent, left, right, fork };
}

test('a shared canonical ancestor supports both honest children in either order', () => {
  const { root, parent, left, right } = splitFixture();
  for (const [first, second] of [[left, right], [right, left]]) {
    const ledger = new Settlement([root]);
    assert.deepEqual(settle(ledger, pack([parent, first])), { status: 'finalized', fresh: 2, reused: 0 });
    const afterFirst = ledger.notes.size;
    assert.deepEqual(settle(ledger, pack([parent, second])), { status: 'finalized', fresh: 1, reused: 1 });
    assert.equal(ledger.notes.size, afterFirst + 1);
    assert.equal(ledger.unspentTotal('UNIT'), 100n);
    assert.deepEqual(ledger.unspentNotes().map(n => n.owner).sort(), ['C', 'E']);
  }
});

test('omitting the change branch does not omit or destroy its unspent output', () => {
  const { root, parent, left } = splitFixture();
  const ledger = new Settlement([root]);
  settle(ledger, pack([parent, left]));
  assert.deepEqual(ledger.unspentNotes().map(n => [n.owner, n.amount]), [['D', 40n], ['C', 60n]]);
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
});

test('a competing ancestor cannot be disguised as already settled ancestry', () => {
  const { root, parent, left, fork } = splitFixture();
  const ledger = new Settlement([root]);
  settle(ledger, pack([fork]));
  const before = stateDigest(ledger);
  assert.throws(() => prepareStatement(ledger, pack([parent, left])), /invalid-dependency:rejected-conflict/);
  assert.equal(stateDigest(ledger), before);
});

test('an omitted unsettled ancestor is rejected while an existing canonical input is sufficient', () => {
  const { root, parent, left } = splitFixture();
  const ledger = new Settlement([root]);
  assert.throws(() => prepareStatement(ledger, pack([left])), /invalid-dependency:missing-dependency/);
  settle(ledger, pack([parent]));
  assert.equal(settle(ledger, pack([left])).fresh, 1);
});

test('invalid later evidence cannot leave an earlier transfer partially committed', () => {
  const { root, parent, fork } = splitFixture();
  const ledger = new Settlement([root]);
  const before = stateDigest(ledger);
  const statement = prepareStatement(ledger, pack([parent]));
  assert.throws(() => applyStatement(ledger, statement, pack([parent, fork])), /invalid-dependency:rejected-conflict/);
  assert.equal(stateDigest(ledger), before);
  assert.equal(ledger.spent.size, 0);
});

test('a well-formed proof candidate at a stale root cannot overwrite newer settlement', () => {
  const { root, parent, left, fork } = splitFixture();
  const ledger = new Settlement([root]);
  const witness = pack([parent, left]);
  const old = prepareStatement(ledger, witness);
  settle(ledger, pack([fork]));
  const before = stateDigest(ledger);
  assert.throws(() => applyStatement(ledger, old, witness), /stale-state/);
  assert.equal(stateDigest(ledger), before);
  assert.deepEqual(ledger.unspentNotes().map(n => n.owner), ['X']);
});

test('even unrelated state updates require refreshing a single-root statement', () => {
  const { root, parent } = splitFixture();
  const other = makeRoot('independent', 'F', 25n);
  const transfer = makeTransfer(other, 'F', [{ owner: 'G', amount: 25n }], 'unrelated');
  const ledger = new Settlement([root, other]);
  const witness = pack([parent]);
  const old = prepareStatement(ledger, witness);
  settle(ledger, pack([transfer]));
  assert.throws(() => applyStatement(ledger, old, witness), /stale-state/);
  assert.equal(settle(ledger, witness).fresh, 1);
  assert.equal(ledger.unspentTotal('UNIT'), 125n);
});

test('replaying canonical ancestry against the current state adds no outputs', () => {
  const { root, parent, left } = splitFixture();
  const ledger = new Settlement([root]);
  const witness = pack([parent, left, parent]);
  settle(ledger, witness);
  const before = stateDigest(ledger);
  assert.deepEqual(settle(ledger, witness), { status: 'finalized', fresh: 0, reused: 3 });
  assert.equal(stateDigest(ledger), before);
});

test('public statement binds the output state and the entire supplied package', () => {
  const { root, parent, left, right } = splitFixture();
  const ledger = new Settlement([root]);
  const witness = pack([parent, left]);
  const statement = prepareStatement(ledger, witness);
  const before = stateDigest(ledger);
  assert.throws(() => applyStatement(ledger, { ...statement, nextRoot: '00'.repeat(32) }, witness), /wrong-next-state/);
  assert.throws(() => applyStatement(ledger, statement, pack([parent, right])), /wrong-package/);
  assert.throws(() => applyStatement(ledger, { ...statement, packageCommitment: '00'.repeat(32) }, witness), /wrong-package/);
  assert.equal(stateDigest(ledger), before);
});

test('domain and witness substitution fail before state mutation', () => {
  const { root, parent } = splitFixture();
  const ledger = new Settlement([root]);
  const witness = pack([parent]);
  const statement = prepareStatement(ledger, witness);
  const before = stateDigest(ledger);
  assert.throws(() => applyStatement(ledger, { ...statement, domain: 'other-pool' }, witness), /wrong-domain/);
  assert.throws(() => applyStatement(ledger, statement, { ...witness, blinding: '34'.repeat(32) }), /wrong-package/);
  assert.throws(() => applyStatement(ledger, { ...statement, debugAncestry: 'leak' }, witness), /invalid-statement-shape/);
  assert.equal(stateDigest(ledger), before);
});

test('reference public schema contains only roots and a commitment; the checker still sees plaintext', () => {
  const { root, parent, left } = splitFixture();
  const witness = pack([parent, left]);
  const ledger = new Settlement([root]);
  const statement = prepareStatement(ledger, witness);
  assert.deepEqual(Object.keys(statement).sort(), ['domain', 'nextRoot', 'packageCommitment', 'priorRoot']);
  for (const value of [root.id, parent.id, left.id, 'authorizedBy', 'outputs']) {
    assert.ok(!JSON.stringify(statement).includes(value));
  }
  // An intentional disclosure check, not an assertion of zero knowledge.
  assert.equal(witness.transfers[0].authorizedBy, 'A');
  assert.equal(witness.transfers[0].outputs[0].amount, 60n);
});

test('state roots ignore Map insertion order and bind changes to spend winners', () => {
  const { root, parent } = splitFixture();
  const other = makeRoot('two', 'F', 3n);
  const one = new Settlement([root, other]);
  const two = new Settlement([other, root]);
  assert.equal(stateDigest(one), stateDigest(two));
  settle(one, pack([parent]));
  settle(two, pack([parent]));
  assert.equal(stateDigest(one), stateDigest(two));
  two.spent.set(root.id, 'different-winner');
  assert.notEqual(stateDigest(one), stateDigest(two));
});
