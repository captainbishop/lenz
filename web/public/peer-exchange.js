// Executable direct-exchange research model with actual signatures.
// Trusted roots and an atomic settlement ledger are inputs, not a deployed chain.
// Encrypted delivery is separate; this relation reveals amounts and ancestry.
import { assert, keysAre, isPublicKey, digest, randomId, signValue, verifyValue } from './peer-crypto.js';
export const EXCHANGE_DOMAIN = 'proof-u/direct-exchange/v1';
const MAX = (1n << 64n) - 1n;
const clone = value => structuredClone(value);
const token = value => typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,128}$/.test(value);
function quantity(value) {
  assert(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= MAX, 'Invalid amount');
  return BigInt(value);
}
function checkOutput(output) {
  assert(keysAre(output, ['owner', 'asset', 'value']) && isPublicKey(output.owner) && token(output.asset), 'Invalid output');
  quantity(output.value);
}
function transcript(body) {
  return [body.domain, body.network, body.pool, body.kind, body.nonce, body.deadline, body.inputs,
    body.outputs.map(o => [o.owner, o.asset, o.value])];
}
function shape(body) {
  assert(keysAre(body, ['domain', 'network', 'pool', 'kind', 'nonce', 'deadline', 'inputs', 'outputs']), 'Invalid agreement shape');
  assert(body.domain === EXCHANGE_DOMAIN && token(body.network) && token(body.pool), 'Wrong agreement domain');
  assert(['transfer', 'swap'].includes(body.kind) && /^[0-9a-f]{32}$/.test(body.nonce), 'Invalid agreement kind or nonce');
  assert(Number.isSafeInteger(body.deadline) && body.deadline >= 0, 'Invalid deadline');
  assert(Array.isArray(body.inputs) && body.inputs.length === (body.kind === 'swap' ? 2 : 1)
    && body.inputs.every(token) && new Set(body.inputs).size === body.inputs.length, 'Invalid inputs');
  assert(Array.isArray(body.outputs) && body.outputs.length >= 1 && body.outputs.length <= 4, 'Invalid outputs');
  body.outputs.forEach(checkOutput);
}
function monetaryRules(body, notes) {
  const inputs = body.inputs.map(id => { const note = notes.get(id); assert(note, 'Missing dependency'); return note; });
  if (body.kind === 'swap') assert(inputs[0].asset !== inputs[1].asset && inputs[0].owner !== inputs[1].owner, 'A swap needs two assets and two owners');
  const totals = new Map();
  for (const input of inputs) totals.set(input.asset, (totals.get(input.asset) ?? 0n) + quantity(input.value));
  for (const output of body.outputs) {
    assert(totals.has(output.asset), 'Unfunded output asset');
    totals.set(output.asset, totals.get(output.asset) - quantity(output.value));
  }
  assert([...totals.values()].every(n => n === 0n), 'Value must be conserved for each asset');
  return [...new Set(inputs.map(input => input.owner))];
}
async function checkAgreement(agreement, notes, complete = true) {
  assert(keysAre(agreement, ['id', 'body', 'signatures']), 'Invalid agreement');
  shape(agreement.body);
  assert(agreement.id === await digest(transcript(agreement.body)), 'Agreement ID mismatch');
  const owners = monetaryRules(agreement.body, notes);
  assert(Array.isArray(agreement.signatures) && agreement.signatures.length <= owners.length, 'Invalid signers');
  const seen = new Set();
  for (const signed of agreement.signatures) {
    assert(keysAre(signed, ['owner', 'signature']) && owners.includes(signed.owner) && !seen.has(signed.owner), 'Unexpected or duplicate signer');
    assert(await verifyValue(signed.owner, ['proof-u/authorize-exchange/v1', agreement.id], signed.signature), 'Agreement signature rejected');
    seen.add(signed.owner);
  }
  if (complete) assert(owners.every(owner => seen.has(owner)), 'Every input owner must sign');
  return owners;
}
export async function makeAgreement({ network, pool, kind, inputs, outputs, deadline = 0 }) {
  const body = clone({ domain: EXCHANGE_DOMAIN, network, pool, kind, nonce: randomId(), deadline, inputs, outputs });
  shape(body);
  return { id: await digest(transcript(body)), body, signatures: [] };
}
export async function signAgreement(identity, candidate, trustedNotes) {
  const agreement = clone(candidate);
  const notes = new Map(clone([...trustedNotes]));
  const owners = await checkAgreement(agreement, notes, false);
  const owner = identity.profile.signingPublic;
  assert(owners.includes(owner), 'This person does not own an input');
  assert(!agreement.signatures.some(item => item.owner === owner), 'Already signed');
  agreement.signatures.push({ owner, signature: await signValue(identity, ['proof-u/authorize-exchange/v1', agreement.id]) });
  return agreement;
}
export async function verifyAgreement(candidate, trustedNotes, complete = true) {
  const agreement = clone(candidate);
  await checkAgreement(agreement, new Map(clone([...trustedNotes])), complete);
  return agreement;
}
export function outputNotes(agreement) {
  return agreement.body.outputs.map((output, i) => ({ id: `${agreement.id}:${i}`, ...clone(output) }));
}
export function swapOutputs(a, b, amountA, amountB) {
  const av = quantity(String(amountA)), bv = quantity(String(amountB));
  assert(av <= quantity(a.value) && bv <= quantity(b.value), 'Insufficient value');
  return [
    { owner: a.owner, asset: b.asset, value: String(bv) },
    { owner: b.owner, asset: a.asset, value: String(av) },
    ...(BigInt(a.value) > av ? [{ owner: a.owner, asset: a.asset, value: String(BigInt(a.value) - av) }] : []),
    ...(BigInt(b.value) > bv ? [{ owner: b.owner, asset: b.asset, value: String(BigInt(b.value) - bv) }] : []),
  ];
}

export class ExchangeLedger {
  #notes; #spent = new Map(); #accepted = new Set(); #queue = Promise.resolve(); #network; #pool;
  constructor(roots, { network, pool }) {
    assert(token(network) && token(pool) && Array.isArray(roots) && roots.length > 0, 'Invalid trusted checkpoint');
    this.#network = network; this.#pool = pool; this.#notes = new Map();
    for (const root of clone(roots)) {
      assert(keysAre(root, ['id', 'owner', 'asset', 'value']) && /^root:[A-Za-z0-9._-]{1,96}$/.test(root.id), 'Invalid root');
      checkOutput({ owner: root.owner, asset: root.asset, value: root.value });
      assert(!this.#notes.has(root.id), 'Duplicate root'); this.#notes.set(root.id, root);
    }
  }
  snapshot() { return { notes: clone([...this.#notes.values()]), spent: clone([...this.#spent]), accepted: [...this.#accepted] }; }
  unspent() { return clone([...this.#notes.values()].filter(note => !this.#spent.has(note.id))); }
  apply(packageInput, now) {
    assert(Array.isArray(packageInput) && packageInput.length > 0 && packageInput.length <= 32, 'Invalid dependency package');
    assert(Number.isSafeInteger(now) && now >= 0, 'Invalid verification time');
    // Snapshot before any async work; serialize simultaneous applications.
    const batch = clone(packageInput);
    const result = this.#queue.then(() => this.#apply(batch, now));
    this.#queue = result.catch(() => {}); // Only release the queue; result still rejects to the caller.
    return result;
  }
  async #apply(batch, now) {
    const notes = new Map(this.#notes), spent = new Map(this.#spent), accepted = new Set(this.#accepted);
    for (const agreement of batch) {
      await checkAgreement(agreement, notes);
      const body = agreement.body;
      assert(body.network === this.#network && body.pool === this.#pool, 'Wrong network or pool');
      if (accepted.has(agreement.id)) continue;
      assert(body.deadline === 0 || now <= body.deadline, 'Agreement expired');
      for (const input of body.inputs) assert(!spent.has(input), 'Input already spent');
      for (const note of outputNotes(agreement)) { assert(!notes.has(note.id), 'Duplicate output'); notes.set(note.id, note); }
      for (const input of body.inputs) spent.set(input, agreement.id);
      accepted.add(agreement.id);
    }
    // Commit the complete dependency package, or no part of it.
    this.#notes = notes; this.#spent = spent; this.#accepted = accepted;
    return { accepted: batch.map(item => item.id), unspent: this.unspent() };
  }
}
