import { assert, digest } from './peer-crypto.js';
import { readState, updateState } from './chat-store.js';
import { compressed, nearLedger, paymentPath, readNearVault, saveNearVault, transferTerms } from './near-protocol.js';

const idPattern = /^[0-9a-f]{64}$/;
const transferId = noteId => noteId.startsWith('root:') ? null : noteId.split(':')[0];
const sameNote = (a, b) => a && b && a.id === b.id && a.owner === b.owner && a.amount === b.amount;
const final = result => assert(result?.finality === 'FINAL', 'Invalid final NEAR response.');
async function expectedReceipts(vault, ledger) {
  const expected = new Map();
  for (const spend of vault.spends) {
    const id = await digest(transferTerms(vault.contract, spend));
    const outputs = [ledger.notes.get(id + ':0')];
    if (ledger.notes.has(id + ':1')) outputs.push(ledger.notes.get(id + ':1'));
    expected.set(id, { id, input: spend.input, outputs });
  }
  return expected;
}
function validateReceipt(receipt, expected) {
  assert(receipt && expected && receipt.id === expected.id && receipt.input === expected.input &&
    Number.isSafeInteger(receipt.block_height) && receipt.block_height > 0 &&
    Array.isArray(receipt.outputs) && receipt.outputs.length === expected.outputs.length &&
    receipt.outputs.every((note, i) => sameNote(note, expected.outputs[i])), 'NEAR receipt does not match the signed payment.');
}
function recordConsumption(vault, id, spent) {
  assert(spent === null || (typeof spent === 'string' && idPattern.test(spent)), 'Invalid NEAR consumption record.');
  const known = vault.chainConsumed?.[id];
  assert(!known || known === spent, 'NEAR response differs from a saved final spend. Check again.');
  vault.chainConsumed ??= {}; vault.chainConsumed[id] = spent;
}
async function reconcileConfirmations(vault) {
  if (!vault.confirmations) return vault;
  const ledger = await nearLedger(vault);
  for (const noteId of Object.keys(vault.confirmations)) {
    if (vault.receipts[transferId(noteId)]?.finality === 'FINAL' || ledger.blocked.has(noteId)) delete vault.confirmations[noteId];
  }
  return vault;
}

// Pure, all-or-nothing validation. Call against the CURRENT vault inside the
// storage lock; never replace it with the snapshot that started a network read.
export async function applyNearCheck(vault, ids, reply) {
  final(reply);
  assert(Array.isArray(ids) && new Set(ids).size === ids.length && Array.isArray(reply.results) && reply.results.length === ids.length, 'Incomplete NEAR payment response.');
  const ledger = await nearLedger(vault), expected = await expectedReceipts(vault, ledger), requested = new Set(ids), seen = new Set();
  const next = structuredClone(vault);
  for (const row of reply.results) {
    assert(row && requested.has(row.id) && !seen.has(row.id) && ledger.notes.has(row.id), 'Invalid or duplicate NEAR payment response.');
    seen.add(row.id);
    assert(row.note === null || sameNote(row.note, ledger.notes.get(row.id)), 'NEAR note does not match the payment file.');
    assert(row.note || (row.spent === null && row.receipt === null), 'Invalid NEAR response for a missing note.');
    recordConsumption(next, row.id, row.spent);
    const id = transferId(row.id);
    if (row.receipt !== null) {
      assert(id, 'Invalid receipt for a reserve root.');
      validateReceipt(row.receipt, expected.get(id));
      assert(sameNote(row.note, row.receipt.outputs.find(n => n.id === row.id)), 'NEAR note differs from its receipt.');
      next.receipts[id] ??= { finality: 'FINAL', blockHeight: row.receipt.block_height };
    } else {
      assert(!id || !next.receipts[id], 'NEAR response is missing a saved final receipt.');
      assert(!id || row.note === null, 'NEAR note is missing its receipt.');
    }
    if (!id) {
      assert(row.receipt === null && row.note, 'Reserve backing could not be verified.');
      next.receipts[row.id] ??= { finality: 'FINAL' };
    }
  }
  // A receipt establishes the consumed input too. A contradictory row cannot
  // turn that same signed path into a confirmation and a conflict simultaneously.
  for (const row of reply.results) if (row.receipt) {
    const input = reply.results.find(r => r.id === row.receipt.input);
    if (input) assert(input.spent === row.receipt.id, 'NEAR receipt and consumption records differ.');
    recordConsumption(next, row.receipt.input, row.receipt.id);
  }
  return reconcileConfirmations(next);
}

export async function applyNearSettlement(vault, path, result) {
  final(result);
  assert(Array.isArray(path) && path.length > 0 && path.length <= 16 && Array.isArray(result.receipts) && result.receipts.length === path.length, 'Incomplete NEAR settlement response.');
  const ledger = await nearLedger(vault), expected = await expectedReceipts(vault, ledger), next = structuredClone(vault);
  for (let i = 0; i < path.length; i++) {
    const id = await digest(transferTerms(vault.contract, path[i])), receipt = result.receipts[i];
    validateReceipt(receipt, expected.get(id));
    recordConsumption(next, receipt.input, receipt.id);
    next.receipts[id] = { finality: 'FINAL', blockHeight: receipt.block_height,
      ...(typeof result.txHash === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result.txHash) ? { txHash: result.txHash } : {}) };
  }
  return reconcileConfirmations(next);
}

export async function nearPaymentRequest(route, data) {
  assert(navigator.onLine !== false, 'Reconnect before checking or confirming a payment.');
  const response = await fetch('/api/testnet/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(90000) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error ?? 'NEAR could not be reached. Your signed payment is still saved.');
  return result;
}
export async function refreshNearPayments(contract) {
  assert(navigator.onLine !== false, 'Reconnect before checking a payment.');
  const state = await readState(); assert(state.identity, 'Create your profile first.');
  const owner = state.identity.profile.id, vault = await readNearVault(state, contract), ledger = await nearLedger(vault), ids = [...ledger.notes.keys()];
  if (!ids.length) return { checked: 0 };
  const results = [];
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40), reply = await nearPaymentRequest('check', { contract, ids: batch });
    await applyNearCheck(vault, batch, reply); results.push(...reply.results);
  }
  await updateState(async current => {
    assert(current.identity?.profile.id === owner, 'The active Lenz account changed.');
    const latest = await readNearVault(current, contract);
    await saveNearVault(current, await applyNearCheck(latest, ids, { finality: 'FINAL', results }));
  });
  return { checked: ids.length };
}
async function targetStatus(contract, noteId, requireAvailable = true) {
  const state = await readState(); assert(state.identity, 'Create your profile first.');
  const vault = await readNearVault(state, contract), ledger = await nearLedger(vault), note = ledger.notes.get(noteId);
  assert(note && note.owner === compressed(state.identity.profile.signingPublic) && transferId(noteId), 'This received payment does not belong to this account.');
  if (ledger.blocked.has(noteId)) return { status: 'conflicted' };
  // Local onward payments and swap authorizations retain their reservations.
  if (requireAvailable) assert(!ledger.consumed.has(noteId) && !ledger.reserved.has(noteId), 'This payment is already used or reserved. Check its status in the wallet.');
  return { status: vault.receipts[transferId(noteId)]?.finality === 'FINAL' ? 'confirmed' : 'pending', owner: state.identity.profile.id, vault };
}
export async function confirmNearPayment(contract, noteId, { retry = false } = {}) {
  assert(navigator.onLine !== false, 'Reconnect before confirming a payment.');
  assert(navigator.locks, 'This browser needs Web Locks to confirm payments safely across tabs.');
  return navigator.locks.request('lenz-near-confirm:' + contract, async () => {
    await targetStatus(contract, noteId);
    // This also recovers a previously successful submission with a lost reply.
    await refreshNearPayments(contract);
    const current = await targetStatus(contract, noteId);
    if (current.status !== 'pending') return { status: current.status, recovered: true };
    // An interrupted attempt defaults to a read. Retrying the identical signed
    // history is an explicit action, never a consequence of reload or reconnect.
    if (current.vault.confirmations?.[noteId] && !retry) return { status: 'pending', recovered: false };
    const path = await updateState(async state => {
      assert(state.identity?.profile.id === current.owner, 'The active Lenz account changed.');
      const latest = await readNearVault(state, contract), ledger = await nearLedger(latest);
      assert(!ledger.blocked.has(noteId) && !ledger.consumed.has(noteId) && !ledger.reserved.has(noteId), 'This payment is already used or reserved. Check its status in the wallet.');
      const { path } = await paymentPath(latest, noteId);
      latest.confirmations ??= {};
      latest.confirmations[noteId] = { startedAt: Date.now(), attempts: (latest.confirmations[noteId]?.attempts ?? 0) + 1 };
      await saveNearVault(state, latest);
      return path;
    });
    let result;
    try { result = await nearPaymentRequest('settle', { contract, path }); }
    catch (error) {
      // One read-only reconciliation, never an automatic second settlement.
      try {
        await refreshNearPayments(contract);
        const recovered = await targetStatus(contract, noteId, false);
        if (recovered.status !== 'pending') return { status: recovered.status, recovered: true };
      } catch (recoveryError) {
        throw new AggregateError([error, recoveryError], 'Confirmation is uncertain. Check payment status before trying again.');
      }
      throw new Error('Confirmation is uncertain. Check payment status before trying again.', { cause: error });
    }
    await updateState(async state => {
      assert(state.identity?.profile.id === current.owner, 'The active Lenz account changed.');
      const latest = await readNearVault(state, contract);
      await saveNearVault(state, await applyNearSettlement(latest, path, result));
    });
    return { status: 'confirmed', recovered: false };
  });
}
