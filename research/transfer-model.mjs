/**
 * Executable research model, NOT a wallet, proof system, wire format or contract.
 * Ownership authorization and authenticated roots/finality are idealized inputs.
 * All names, amounts and ancestry are public here. There is no privacy claim.
 */
import { createHash } from 'node:crypto';

export const DOMAIN = 'proof-of-u/research/v1';
const requireRule = (condition, code) => { if (!condition) throw new Error(code); };
const text = value => typeof value === 'string' && value.length > 0;
const amount = value => typeof value === 'bigint' && value > 0n;
const sum = outputs => outputs.reduce((total, output) => total + output.amount, 0n);
const keysAre = (object, keys) => object && typeof object === 'object'
  && Object.keys(object).sort().join(',') === [...keys].sort().join(',');

function checkShape(tx) {
  requireRule(keysAre(tx, ['id', 'domain', 'input', 'asset', 'authorizedBy', 'nonce', 'outputs']), 'invalid-envelope');
  for (const key of ['domain', 'input', 'asset', 'authorizedBy', 'nonce']) {
    requireRule(text(tx[key]), `invalid-${key}`);
  }
  requireRule(Array.isArray(tx.outputs) && tx.outputs.length > 0, 'invalid-outputs');
  for (const output of tx.outputs) {
    requireRule(keysAre(output, ['owner', 'amount']) && text(output.owner), 'invalid-output');
    requireRule(amount(output.amount), 'invalid-amount');
  }
}

// A fixed ordered encoding for this JavaScript model only. This is an identifier,
// not a signature, zero-knowledge proof or extractable e-cash challenge.
function transcriptId(tx) {
  return createHash('sha256').update(JSON.stringify([
    tx.domain, tx.input, tx.asset, tx.authorizedBy, tx.nonce,
    tx.outputs.map(output => [output.owner, output.amount.toString()]),
  ])).digest('hex');
}

function checkEnvelope(tx, domain) {
  checkShape(tx);
  requireRule(tx.domain === domain, 'wrong-domain');
  requireRule(tx.id === transcriptId(tx), 'transcript-id-mismatch');
}

function checkSpend(tx, input) {
  requireRule(input.domain === tx.domain, 'wrong-domain');
  requireRule(input.asset === tx.asset, 'wrong-asset');
  // This equality STANDS IN FOR an authorization oracle. Anyone could write
  // authorizedBy in real bytes. Production must verify a signature/proof.
  requireRule(input.owner === tx.authorizedBy, 'unauthorized');
  requireRule(sum(tx.outputs) === input.amount, 'value-not-conserved');
}

function frozenTransfer(tx) {
  return Object.freeze({ ...tx, outputs: Object.freeze(tx.outputs.map(o => Object.freeze({ ...o }))) });
}

function addOutputs(notes, tx) {
  tx.outputs.forEach((output, index) => {
    const id = `${tx.id}:${index}`;
    notes.set(id, Object.freeze({ id, ...output, asset: tx.asset, domain: tx.domain, origin: tx.id }));
  });
}

export function makeRoot(id, owner, value, asset = 'UNIT', domain = DOMAIN) {
  requireRule(text(id) && text(owner) && text(asset) && text(domain), 'invalid-root');
  requireRule(amount(value), 'invalid-amount');
  return Object.freeze({ id: `root:${id}`, owner, amount: value, asset, domain, origin: null });
}

export function makeTransfer(input, authorizedBy, outputs, nonce) {
  const tx = { id: '', domain: input.domain, input: input.id, asset: input.asset, authorizedBy, nonce, outputs };
  checkShape(tx);
  checkSpend(tx, input);
  tx.id = transcriptId(tx);
  return frozenTransfer(tx);
}

function initialNotes(roots, domain) {
  const notes = new Map();
  for (const root of roots) {
    requireRule(text(root.id) && root.id.startsWith('root:') && root.origin === null
      && text(root.owner) && text(root.asset) && amount(root.amount), 'invalid-root');
    requireRule(root.domain === domain, 'wrong-domain');
    requireRule(!notes.has(root.id), 'duplicate-root');
    notes.set(root.id, Object.freeze({ ...root }));
  }
  return notes;
}

export class OfflineView {
  constructor(roots, domain = DOMAIN) {
    this.domain = domain;
    this.notes = initialNotes(roots, domain);
    this.transfers = new Map();
    this.spends = new Map();
  }

  receive(tx) {
    checkEnvelope(tx, this.domain);
    if (this.transfers.has(tx.id)) return { status: this.status(tx.id), retry: true };
    const input = this.notes.get(tx.input);
    if (!input) return { status: 'missing-dependency', retry: false };
    checkSpend(tx, input);
    const saved = frozenTransfer(tx);
    this.transfers.set(tx.id, saved);
    const competing = this.spends.get(tx.input) ?? new Set();
    competing.add(tx.id);
    this.spends.set(tx.input, competing);
    addOutputs(this.notes, saved);
    return { status: this.status(tx.id), retry: false };
  }

  status(id, settlement = null) {
    const tx = this.transfers.get(id);
    requireRule(tx, 'unknown-transfer');
    // Finalized canonical history takes precedence over later local evidence.
    if (settlement?.transfers.has(id)) return 'finalized';
    const winner = settlement?.spent.get(tx.input);
    if (winner && winner !== id) return 'rejected-conflict';
    const parent = this.notes.get(tx.input).origin;
    const parentStatus = parent ? this.status(parent, settlement) : null;
    if (parentStatus?.startsWith('rejected-')) return 'rejected-ancestor';
    if (parentStatus === 'conflicted' || this.spends.get(tx.input).size > 1) return 'conflicted';
    return 'pending';
  }
}

export class Settlement {
  constructor(roots, domain = DOMAIN) {
    this.domain = domain;
    this.notes = initialNotes(roots, domain);
    this.transfers = new Map();
    this.spent = new Map();
  }

  submit(tx) {
    checkEnvelope(tx, this.domain);
    if (this.transfers.has(tx.id)) return { status: 'finalized', retry: true };
    const input = this.notes.get(tx.input);
    if (!input) return { status: 'missing-dependency', retry: false };
    checkSpend(tx, input);
    if (this.spent.has(tx.input)) return { status: 'rejected-conflict', retry: false };
    const saved = frozenTransfer(tx);
    // Atomic, permanently final in this idealized ledger. This does not model
    // NEAR receipt execution, finality observation, callbacks or failure recovery.
    this.spent.set(tx.input, tx.id);
    this.transfers.set(tx.id, saved);
    addOutputs(this.notes, saved);
    return { status: 'finalized', retry: false };
  }

  unspentNotes() {
    return [...this.notes.values()].filter(note => !this.spent.has(note.id));
  }

  unspentTotal(asset) {
    return sum(this.unspentNotes().filter(note => note.asset === asset));
  }
}
