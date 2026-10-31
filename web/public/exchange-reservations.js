// Browser-local authorization journal for the synthetic exchange experiment.
// This prevents accidental local reuse, not malicious rollback/copying or forks.
import { assert } from './peer-crypto.js';
import { signAgreement } from './peer-exchange.js';
const DB = 'proof-u-exchange-authorizations-v1';
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('owners');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function journal(owner, value) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('owners', value ? 'readwrite' : 'readonly');
      const store = tx.objectStore('owners');
      const request = value ? store.put(value, owner) : store.get(owner);
      tx.oncomplete = () => resolve(value ?? request.result ?? []);
      tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error('Authorization storage aborted'));
    });
  } finally { db.close(); }
}
export async function readAuthorizations(owner) { return journal(owner); }

// Candidate must not yet contain this owner's signature. Retrying that candidate
// returns the previously saved signature, including after a reload or deadline.
// A fresh candidate past its deadline is rejected. Time never releases a lock.
export async function authorizeReserved(identity, candidate, trustedNotes, { network, pool, now }) {
  assert(navigator.locks, 'Web Locks are required for safe authorization across tabs');
  assert(Number.isSafeInteger(now) && now >= 0, 'Invalid authorization time');
  const input = structuredClone(candidate), notes = new Map(structuredClone([...trustedNotes]));
  const signer = structuredClone(identity), owner = signer.profile.signingPublic;
  assert(input.body?.network === network && input.body?.pool === pool, 'Wrong network or pool');
  return navigator.locks.request(DB, async () => {
    const saved = await journal(owner);
    const signed = await stageReservation(signer, input, notes, { network, pool, now }, saved);
    await journal(owner, saved);
    return signed;
  });
}

// Stage inside a caller's serialized transaction. Do not expose its result until
// that transaction commits. Chat uses this to commit lock, packet and ledger together.
export async function stageReservation(identity, candidate, trustedNotes, { network, pool, now }, saved) {
    const signer = structuredClone(identity), input = structuredClone(candidate);
    const notes = new Map(structuredClone([...trustedNotes])), owner = signer.profile.signingPublic;
    assert(Number.isSafeInteger(now) && now >= 0, 'Invalid authorization time');
    assert(input.body?.network === network && input.body?.pool === pool, 'Wrong network or pool');
    // Validate all terms, conservation, ownership and existing counterparty signatures.
    const signed = await signAgreement(signer, input, notes);
    const ownInputs = signed.body.inputs.filter(id => notes.get(id).owner === owner);
    const prior = saved.find(row => row.agreement.id === signed.id);
    if (prior) {
      assert(JSON.stringify(prior.inputs) === JSON.stringify(ownInputs), 'Trusted input ownership changed');
      const persisted = prior.agreement.signatures.find(item => item.owner === owner);
      signed.signatures = signed.signatures.map(item => item.owner === owner ? persisted : item);
      return signed;
    }
    assert(signed.body.deadline === 0 || now <= signed.body.deadline, 'Agreement expired');
    assert(!saved.some(row => row.agreement.body.network === network && row.agreement.body.pool === pool
      && row.inputs.some(id => ownInputs.includes(id))), 'This value is already reserved for another agreement');
    assert(saved.length < 1000, 'Authorization journal is full');
    saved.push({ inputs: ownInputs, agreement: signed, createdAt: now });
    return signed;
}
