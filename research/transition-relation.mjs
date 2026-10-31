/**
 * Transparent reference checker for a CANDIDATE proof relation.
 * It receives the entire state and witness in plaintext. No ZK, signatures,
 * Merkle proofs, private witness distribution or on-chain execution are here.
 */
import { createHash } from 'node:crypto';
import { Settlement } from './transfer-model.mjs';

const rule = (condition, code) => { if (!condition) throw new Error(code); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = map => [...map.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

// Full-state hashing is a surrogate for authenticated data structures only.
// The digest does not establish hiding, membership proofs or data availability.
export function stateDigest(ledger) {
  return hash([
    'proof-u/research/state/v1', ledger.domain,
    sorted(ledger.notes).map(([id, n]) => [id, n.domain, n.asset, n.owner, n.amount.toString(), n.origin]),
    sorted(ledger.spent), sorted(ledger.transfers).map(([id]) => id),
  ]);
}

function cloneLedger(ledger) {
  const copy = new Settlement([], ledger.domain);
  copy.notes = new Map(ledger.notes);
  copy.spent = new Map(ledger.spent);
  copy.transfers = new Map(ledger.transfers);
  return copy;
}

function evaluate(ledger, witness) {
  rule(witness && Array.isArray(witness.transfers) && witness.transfers.length > 0, 'empty-package');
  rule(typeof witness.blinding === 'string' && /^[0-9a-f]{64}$/.test(witness.blinding), 'invalid-blinding');
  const staged = cloneLedger(ledger);
  let fresh = 0;
  let reused = 0;
  for (const tx of witness.transfers) {
    const outcome = staged.submit(tx);
    rule(outcome.status === 'finalized', `invalid-dependency:${outcome.status}`);
    if (outcome.retry) reused++;
    else fresh++;
  }
  const statement = {
    domain: ledger.domain,
    priorRoot: stateDigest(ledger),
    nextRoot: stateDigest(staged),
    packageCommitment: hash([
      'proof-u/research/package/v1', ledger.domain, witness.blinding,
      witness.transfers.map(tx => tx.id),
    ]),
  };
  return { staged, statement, fresh, reused };
}

export function prepareStatement(ledger, witness) {
  return Object.freeze(evaluate(ledger, witness).statement);
}

export function applyStatement(ledger, statement, witness) {
  rule(statement && Object.keys(statement).sort().join(',')
    === 'domain,nextRoot,packageCommitment,priorRoot', 'invalid-statement-shape');
  rule(statement.domain === ledger.domain, 'wrong-domain');
  rule(statement.priorRoot === stateDigest(ledger), 'stale-state');
  const checked = evaluate(ledger, witness);
  rule(statement.packageCommitment === checked.statement.packageCommitment, 'wrong-package');
  rule(statement.nextRoot === checked.statement.nextRoot, 'wrong-next-state');
  // Commit only after the entire relation succeeds. NEAR cross-contract calls
  // are not covered by this synchronous in-memory atomicity assumption.
  ledger.notes = checked.staged.notes;
  ledger.spent = checked.staged.spent;
  ledger.transfers = checked.staged.transfers;
  return { status: 'finalized', fresh: checked.fresh, reused: checked.reused };
}
