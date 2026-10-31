/**
 * Accounting and probability counterexamples for the shared proposal.
 * Run: node research/counterexamples.mjs
 * This is a finite illustrative model, not cryptography or a payment engine.
 * It cannot establish real-world attack probabilities or protocol soundness.
 */
import assert from 'node:assert/strict';

const cases = [];

// Every disconnected recipient sees the same valid reserve anchor and no
// conflicting spend. Local verification succeeds in each isolated view.
const reserve = 100;
const transfer = 10;
const collateralRatio = 10;
const recipients = 11;
const views = Array.from({ length: recipients }, (_, i) => ({
  recipient: i,
  rootReserve: reserve,
  nullifier: 'same-note',
  localSeen: new Set(),
}));
const accepted = views.filter(v =>
  v.rootReserve >= collateralRatio * transfer && !v.localSeen.has(v.nullifier));
assert.equal(accepted.length, recipients);
const liabilities = accepted.length * transfer;
assert.ok(liabilities > reserve);
cases.push({
  case: 'Per-payment collateral predicate under a partition',
  locallyAccepted: accepted.length,
  reserve,
  promisedValue: liabilities,
  minimumUnfundedValueEvenIfAllReserveIsCompensation: liabilities - reserve,
});

// A nullifier set prevents duplicate finalized spends. It does not make all
// previously accepted offline promises redeemable.
const settled = new Set();
let settlementWinners = 0;
for (const view of accepted) {
  if (!settled.has(view.nullifier)) {
    settled.add(view.nullifier);
    settlementWinners++;
  }
}
assert.equal(settlementWinners, 1);
cases.push({
  case: 'Settlement uniqueness versus offline acceptance',
  settlementWinners,
  acceptedButNotSettledThroughTheOriginalNote: accepted.length - settlementWinners,
});

// One fair bit controls whether ALL witnesses are isolated. Each witness has
// marginal failure 1/2, but their failures are perfectly correlated.
const witnessCount = 8;
const worlds = [{ probability: 0.5, allFail: true }, { probability: 0.5, allFail: false }];
const actualJointFailure = worlds.filter(w => w.allFail).reduce((p, w) => p + w.probability, 0);
const independencePrediction = 0.5 ** witnessCount;
const conditionalFailures = [0.5, ...Array(witnessCount - 1).fill(1)];
const chainRuleProduct = conditionalFailures.reduce((p, q) => p * q, 1);
assert.equal(actualJointFailure, 0.5);
assert.equal(chainRuleProduct, actualJointFailure);
assert.ok(actualJointFailure > independencePrediction);
cases.push({
  case: 'Correlated witnesses invalidate an independence-based exponential claim',
  witnessCount,
  independencePrediction,
  actualJointFailure,
  chainRuleProduct,
});

// Interpolation needs distinct challenge coordinates. Reusing an invoice
// challenge for different outputs gives the same (x,y), not two points.
const secret = 13;
const slope = 17;
const challenge = 5;
const first = { x: challenge, y: secret + challenge * slope, output: 'recipient A' };
const second = { x: challenge, y: secret + challenge * slope, output: 'recipient B' };
assert.notEqual(first.output, second.output);
assert.equal(first.x - second.x, 0);
assert.equal(first.y, second.y);
cases.push({
  case: 'Challenge must bind the complete authorized spend',
  distinctOutputs: first.output !== second.output,
  interpolationDenominator: first.x - second.x,
  conclusion: 'Different outputs are not extractable evidence if the challenge ignores them.',
});

// Repair candidate: reserve allocations cannot overlap. This model uses an
// ONLINE authoritative reservation state, so it is not a solution for arbitrary
// disconnected recipients. The explicit assumption is the point of the test.
let unallocated = reserve;
let allocated = 0;
let allocationCount = 0;
for (let i = 0; i < recipients; i++) {
  if (unallocated >= transfer) {
    unallocated -= transfer;
    allocated += transfer;
    allocationCount++;
  }
  assert.equal(allocated + unallocated, reserve);
}
assert.equal(allocationCount, 10);
cases.push({
  case: 'Disjoint reserve allocation preserves accounting under its stated assumption',
  allocationCount,
  allocated,
  unallocated,
  assumption: 'One authoritative allocation state is available before acceptance.',
});

console.log(JSON.stringify({ kind: 'illustrative-counterexamples', cases }, null, 2));
