import assert from 'node:assert/strict';
import test from 'node:test';
import { DOMAIN, makeRoot, makeTransfer, OfflineView, Settlement } from './transfer-model.mjs';

function fixture() {
  const root = makeRoot('deposit-1', 'A', 100n);
  const aToB = makeTransfer(root, 'A', [{ owner: 'B', amount: 100n }], 'invoice-b');
  const b = new OfflineView([root]);
  b.receive(aToB);
  const bNote = b.notes.get(`${aToB.id}:0`);
  const bToC = makeTransfer(bNote, 'B', [{ owner: 'C', amount: 100n }], 'invoice-c');
  const aToD = makeTransfer(root, 'A', [{ owner: 'D', amount: 100n }], 'invoice-d');
  return { root, aToB, bToC, aToD, bNote };
}

test('A -> B -> C passes locally while offline and settles in dependency order', () => {
  const { root, aToB, bToC } = fixture();
  const c = new OfflineView([root]);
  assert.equal(c.receive(aToB).status, 'pending');
  assert.equal(c.receive(bToC).status, 'pending');
  const ledger = new Settlement([root]);
  assert.equal(ledger.transfers.size, 0);
  assert.equal(c.status(bToC.id, ledger), 'pending');
  assert.equal(ledger.submit(aToB).status, 'finalized');
  assert.equal(ledger.submit(bToC).status, 'finalized');
  assert.equal(c.status(bToC.id, ledger), 'finalized');
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
  assert.deepEqual(ledger.unspentNotes().map(n => n.owner), ['C']);
});

test('payment and change are conserved separately through onward transfer', () => {
  const root = makeRoot('split', 'A', 100n);
  const payment = makeTransfer(root, 'A', [
    { owner: 'B', amount: 40n }, { owner: 'A', amount: 60n },
  ], 'split');
  const ledger = new Settlement([root]);
  ledger.submit(payment);
  const onward = makeTransfer(ledger.notes.get(`${payment.id}:0`), 'B', [
    { owner: 'C', amount: 40n },
  ], 'onward');
  ledger.submit(onward);
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
  assert.deepEqual(ledger.unspentNotes().map(n => [n.owner, n.amount]), [['A', 60n], ['C', 40n]]);
});

test('a sender cannot authorize a spend of the recipient output in the ownership model', () => {
  const { root, aToB, bNote } = fixture();
  const view = new OfflineView([root]);
  view.receive(aToB);
  // A lies about the owner while constructing a syntactically valid envelope.
  const forged = makeTransfer({ ...bNote, owner: 'A' }, 'A', [{ owner: 'A', amount: 100n }], 'theft');
  assert.throws(() => view.receive(forged), /unauthorized/);
  assert.equal(view.transfers.size, 1);
  assert.equal(view.status(aToB.id), 'pending');
});

test('two partitions can both accept; the losing ancestor prevents descendant redemption', () => {
  const { root, aToB, bToC, aToD } = fixture();
  const c = new OfflineView([root]);
  const d = new OfflineView([root]);
  c.receive(aToB);
  assert.equal(c.receive(bToC).status, 'pending');
  assert.equal(d.receive(aToD).status, 'pending');
  const ledger = new Settlement([root]);
  ledger.submit(aToD);
  assert.equal(ledger.submit(aToB).status, 'rejected-conflict');
  assert.equal(c.status(aToB.id, ledger), 'rejected-conflict');
  assert.equal(c.status(bToC.id, ledger), 'rejected-ancestor');
  // The ledger alone does not know the missing input's ancestry.
  assert.equal(ledger.submit(bToC).status, 'missing-dependency');
  assert.deepEqual(ledger.unspentNotes().map(n => n.owner), ['D']);
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
});

test('all six delivery orders preserve backing and admit only one root spend', () => {
  const { root, aToB, bToC, aToD } = fixture();
  const orders = [
    [aToB, bToC, aToD], [aToB, aToD, bToC], [bToC, aToB, aToD],
    [bToC, aToD, aToB], [aToD, aToB, bToC], [aToD, bToC, aToB],
  ];
  for (const order of orders) {
    const ledger = new Settlement([root]);
    for (const tx of [...order, ...order]) {
      ledger.submit(tx);
      assert.equal(ledger.unspentTotal('UNIT'), 100n);
    }
    assert.equal(Number(ledger.transfers.has(aToB.id)) + Number(ledger.transfers.has(aToD.id)), 1);
    assert.equal(ledger.transfers.has(bToC.id), ledger.transfers.has(aToB.id));
  }
});

test('child-first delivery can be retried after the missing parent arrives', () => {
  const { root, aToB, bToC } = fixture();
  for (const receiver of [new OfflineView([root]), new Settlement([root])]) {
    const deliver = tx => receiver instanceof Settlement ? receiver.submit(tx) : receiver.receive(tx);
    assert.equal(deliver(bToC).status, 'missing-dependency');
    assert.equal(receiver.transfers.size, 0);
    deliver(aToB);
    assert.notEqual(deliver(bToC).status, 'missing-dependency');
    assert.equal(receiver.transfers.size, 2);
  }
});

test('exact retries are idempotent and do not create more value', () => {
  const { root, aToB } = fixture();
  const view = new OfflineView([root]);
  const ledger = new Settlement([root]);
  view.receive(aToB);
  ledger.submit(aToB);
  for (let i = 0; i < 5; i++) {
    assert.equal(view.receive(structuredClone(aToB)).retry, true);
    assert.equal(ledger.submit(structuredClone(aToB)).retry, true);
  }
  assert.equal(view.transfers.size, 1);
  assert.equal(ledger.transfers.size, 1);
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
});

test('changing an output changes the transcript id even with the same invoice', () => {
  const { root, aToB } = fixture();
  const changed = makeTransfer(root, 'A', [{ owner: 'D', amount: 100n }], aToB.nonce);
  assert.notEqual(changed.id, aToB.id);
  const view = new OfflineView([root]);
  view.receive(aToB);
  assert.equal(view.receive(changed).status, 'conflicted');
});

test('altered bytes under an existing id fail before the retry path', () => {
  const { root, aToB } = fixture();
  const changed = structuredClone(aToB);
  changed.outputs[0].owner = 'D';
  const view = new OfflineView([root]);
  const ledger = new Settlement([root]);
  view.receive(aToB);
  ledger.submit(aToB);
  assert.throws(() => view.receive(changed), /transcript-id-mismatch/);
  assert.throws(() => ledger.submit(changed), /transcript-id-mismatch/);
  assert.equal(view.status(aToB.id), 'pending');
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
});

test('restoring a stale copy does not restore global spending rights', () => {
  const { root, aToB, aToD } = fixture();
  const staleCopy = new OfflineView([root]);
  const ledger = new Settlement([root]);
  ledger.submit(aToB);
  assert.equal(staleCopy.receive(aToD).status, 'pending');
  assert.equal(staleCopy.status(aToD.id, ledger), 'rejected-conflict');
  assert.equal(ledger.submit(aToD).status, 'rejected-conflict');
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
});

test('supporting retries cannot erase a conflict or its descendant status', () => {
  const { root, aToB, bToC, aToD } = fixture();
  const view = new OfflineView([root]);
  view.receive(aToB);
  view.receive(bToC);
  view.receive(aToD);
  for (let i = 0; i < 4; i++) {
    view.receive(aToB);
    view.receive(bToC);
    assert.equal(view.status(aToB.id), 'conflicted');
    assert.equal(view.status(bToC.id), 'conflicted');
  }
  const ledger = new Settlement([root]);
  ledger.submit(aToB);
  ledger.submit(bToC);
  assert.equal(view.status(bToC.id, ledger), 'finalized');
  assert.equal(view.status(aToD.id, ledger), 'rejected-conflict');
});

test('foreign domains, asset substitution and unknown deposits do not enter settlement', () => {
  const { root } = fixture();
  const ledger = new Settlement([root]);
  const foreign = makeTransfer({ ...root, domain: 'foreign/v1' }, 'A', [{ owner: 'B', amount: 100n }], 'x');
  const assetSwap = makeTransfer({ ...root, asset: 'OTHER' }, 'A', [{ owner: 'B', amount: 100n }], 'y');
  const fakeRoot = makeRoot('not-deposited', 'A', 100n);
  assert.throws(() => ledger.submit(foreign), /wrong-domain/);
  assert.throws(() => ledger.submit(assetSwap), /wrong-asset/);
  assert.equal(ledger.submit(makeTransfer(fakeRoot, 'A', [{ owner: 'B', amount: 100n }], 'z')).status, 'missing-dependency');
  assert.equal(ledger.transfers.size, 0);
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
});

test('invalid amounts and value creation are rejected; integer amounts stay exact', () => {
  for (const amount of [0n, -1n, 1, 0.5, NaN]) {
    assert.throws(() => makeRoot('bad', 'A', amount), /invalid-amount/);
  }
  const { root } = fixture();
  assert.throws(() => makeTransfer(root, 'A', [{ owner: 'B', amount: 101n }], 'inflate'), /value-not-conserved/);
  assert.throws(() => makeTransfer(root, 'A', [{ owner: 'B', amount: 99n }], 'burn'), /value-not-conserved/);
  const huge = makeRoot('exact', 'A', 9007199254740993n);
  const ledger = new Settlement([huge]);
  ledger.submit(makeTransfer(huge, 'A', [{ owner: 'B', amount: huge.amount }], 'big'));
  assert.equal(ledger.unspentTotal('UNIT'), huge.amount);
});

test('receipt validation catches inflation even when the attacker constructs its own envelope', () => {
  const { root } = fixture();
  const inflated = makeTransfer({ ...root, amount: 200n }, 'A', [{ owner: 'B', amount: 200n }], 'inflate');
  for (const receiver of [new OfflineView([root]), new Settlement([root])]) {
    assert.throws(() => receiver instanceof Settlement ? receiver.submit(inflated) : receiver.receive(inflated), /value-not-conserved/);
    assert.equal(receiver.transfers.size, 0);
  }
});

test('caller mutation cannot change accepted transcripts or counterfeit retry results', () => {
  const { root, aToB } = fixture();
  const mutable = structuredClone(aToB);
  const ledger = new Settlement([root]);
  ledger.submit(mutable);
  mutable.outputs[0].amount = 200n;
  assert.equal(ledger.notes.get(`${aToB.id}:0`).amount, 100n);
  assert.equal(ledger.transfers.get(aToB.id).outputs[0].amount, 100n);
  assert.throws(() => ledger.submit(mutable), /transcript-id-mismatch/);
});

test('distinct assets conserve separately and duplicate root ids are rejected', () => {
  const one = makeRoot('one', 'A', 100n);
  const two = makeRoot('two', 'B', 200n, 'OTHER');
  const ledger = new Settlement([one, two]);
  ledger.submit(makeTransfer(two, 'B', [{ owner: 'C', amount: 200n }], 'other'));
  assert.equal(ledger.unspentTotal('UNIT'), 100n);
  assert.equal(ledger.unspentTotal('OTHER'), 200n);
  assert.throws(() => new Settlement([one, one]), /duplicate-root/);
  assert.throws(() => new OfflineView([makeRoot('foreign', 'A', 1n, 'UNIT', 'other')], DOMAIN), /wrong-domain/);
});
