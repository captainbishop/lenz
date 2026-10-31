import { makeRoot, makeTransfer, OfflineView, Settlement } from './transfer-model.mjs';

function scenario(competingSpendWins) {
  const root = makeRoot('demo-deposit', 'A', 100n);
  const cView = new OfflineView([root]);
  const dView = new OfflineView([root]);
  const aToB = makeTransfer(root, 'A', [{ owner: 'B', amount: 100n }], 'pay-b');
  cView.receive(aToB);
  const bToC = makeTransfer(cView.notes.get(`${aToB.id}:0`), 'B', [{ owner: 'C', amount: 100n }], 'pay-c');
  cView.receive(bToC);
  const aToD = makeTransfer(root, 'A', [{ owner: 'D', amount: 100n }], 'pay-d');
  if (competingSpendWins) dView.receive(aToD);
  const offline = { C: cView.status(bToC.id), D: competingSpendWins ? dView.status(aToD.id) : 'no-payment' };
  const ledger = new Settlement([root]);
  const settlementOrder = competingSpendWins ? [aToD, aToB, bToC] : [aToB, bToC];
  const results = settlementOrder.map(tx => ({
    payment: `${tx.authorizedBy} -> ${tx.outputs[0].owner}`,
    ...ledger.submit(tx),
  }));
  return {
    scenario: competingSpendWins ? 'Competing ancestor wins settlement' : 'Honest onward transfer',
    offline,
    settlement: results,
    reconciled: { C: cView.status(bToC.id, ledger), D: competingSpendWins ? dView.status(aToD.id, ledger) : 'no-payment' },
    canonicalUnspent: ledger.unspentNotes().map(({ owner, amount, asset }) => ({ owner, amount, asset })),
    totalBacking: ledger.unspentTotal('UNIT'),
  };
}

console.log(JSON.stringify({
  kind: 'public-data-idealized-research-model',
  warning: 'No cryptography, privacy, mesh transport, real funds or chain integration.',
  scenarios: [scenario(false), scenario(true)],
}, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2));
