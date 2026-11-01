// Offline verification of the bounded live exercise. No signer or RPC access.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { applySpend } from './public/near-protocol.js';

export async function verify(e) {
  assert.equal(e.schema, 1); assert(e.contract.endsWith('.testnet'));
  const checks = [], states = {};
  for (const label of ['winner', 'loser', 'onward']) {
    const p = e.paths[label], notes = new Map([[p.root.id, p.root]]), consumed = new Map(), receipts = [];
    assert.equal(p.contract, e.contract);
    for (const spend of p.path) {
      const result = await applySpend(e.contract, notes, consumed, spend);
      receipts.push({ id: result.id, input: spend.input, outputs: result.outputs });
    }
    assert.equal(p.id, receipts.at(-1).id); assert.equal(p.path.at(-1).amount, '10000');
    states[label] = { notes, consumed, receipts };
  }
  const winner = e.paths.winner, loser = e.paths.loser, onward = e.paths.onward;
  assert.equal(winner.path.at(-1).input, loser.path.at(-1).input);
  assert.notEqual(winner.id, loser.id);
  assert.equal(onward.path.at(-1).input, loser.id + ':0');
  assert.deepEqual(onward.path.slice(0, -1), loser.path);
  assert(e.before.a.notes.some(n => n.id === winner.path.at(-1).input));
  checks.push('Both competing paths and the losing onward transfer have valid signatures over the same existing funded input');

  const tx = e.transaction;
  assert.equal(tx.final_execution_status, 'FINAL'); assert(Object.hasOwn(tx.status, 'SuccessValue'));
  assert.equal(tx.transaction.receiver_id, e.contract);
  assert.equal(tx.transaction.actions.length, 1);
  const call = tx.transaction.actions[0].FunctionCall;
  assert.equal(call.method_name, 'settle');
  assert.deepEqual(JSON.parse(Buffer.from(call.args, 'base64')), { path: winner.path });
  for (const r of [tx.transaction_outcome, ...tx.receipts_outcome]) {
    assert(!Object.hasOwn(r.outcome.status, 'Failure'));
    assert(Object.keys(r.outcome.status).some(k => ['SuccessValue', 'SuccessReceiptId'].includes(k)));
  }
  const chainReceipts = JSON.parse(Buffer.from(tx.status.SuccessValue, 'base64'));
  assert.deepEqual(chainReceipts, e.receipts);
  assert.equal(e.receipts.length, states.winner.receipts.length);
  e.receipts.forEach((r, i) => {
    assert(Number.isSafeInteger(r.block_height) && r.block_height > 0);
    const { block_height, ...terms } = r; assert.deepEqual(terms, states.winner.receipts[i]);
  });
  checks.push('The recorded FINAL transaction calls settle with only the winning path and returns exact conserved outputs');

  assert.equal(e.requests.filter(r => r.name.endsWith('/settle')).length, 1);
  assert(e.requests.every(r => r.method === 'POST' && (r.name === '/api/testnet/check' || (r.role === 'b' && r.name === '/api/testnet/settle'))));
  assert.equal(e.steps['offline-onward'].offlineApiRequests, 0);
  assert.equal(e.steps['interrupted-confirmation'].persistedAttempts, 1);
  assert.equal(e.steps['interrupted-confirmation'].reloadApiRequests, 0);
  assert.deepEqual(e.steps.recovery, { status: 'confirmed', readOnlyRecovery: true });
  checks.push('The browser trace records one settlement, no losing-branch submission, a durable pending attempt and read-only recovery');

  assert.equal(e.after.a.total, String(BigInt(e.before.a.total) - 10000n));
  assert.equal(e.after.b.total, String(BigInt(e.before.b.total) + 10000n));
  assert.equal(e.after.c.total, e.before.c.total); assert.equal(e.after.d.total, '0');
  assert.deepEqual(e.backingBefore, e.steps['final-evidence'].backing);
  const ids = new Set();
  for (const [role, after] of Object.entries(e.after)) {
    assert.equal(after.total, after.notes.reduce((sum, n) => sum + BigInt(n.amount), 0n).toString());
    for (const note of after.notes) {
      assert(!ids.has(note.id)); ids.add(note.id);
      const expected = states.winner.notes.get(note.id) ?? e.before[role]?.notes.find(n => n.id === note.id);
      assert.deepEqual(note, expected); assert(!states.winner.consumed.has(note.id));
    }
  }
  assert.equal(e.steps['conflict-display'].c.blockedNote, loser.id + ':0');
  assert.equal(e.steps['conflict-display'].d.blockedNote, onward.id + ':0');
  assert.equal(e.steps['conflict-display'].c.total, e.before.c.total);
  assert.equal(e.steps['conflict-display'].d.total, '0');
  assert.equal(e.steps['final-evidence'].originalProfilesHistoryAndReservationsPreserved, true);
  checks.push('Final wallet allocations conserve existing backing and exclude both the losing payment and its descendant');
  return checks;
}

if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.endsWith('verify-near-payment-failure.mjs')) {
  const bytes = await readFile(new URL('./near-payment-failure-live-results.json', import.meta.url)), e = JSON.parse(bytes);
  const checks = await verify(e), rejected = [];
  for (const [name, alter] of [
    ['wrong confirmed amount', x => { x.receipts.at(-1).outputs[0].amount = '20000'; }],
    ['forged losing signature', x => { x.paths.loser.path.at(-1).signature = '0'.repeat(128); }],
    ['extra submission', x => { x.requests.push({ role: 'b', name: '/api/testnet/settle', method: 'POST' }); }],
    ['conflicted value credited', x => { x.after.d.total = '10000'; }],
  ]) {
    const changed = structuredClone(e); alter(changed); await assert.rejects(() => verify(changed)); rejected.push(name);
  }
  const sha = b => createHash('sha256').update(b).digest('hex');
  for (const [file, hash] of Object.entries(e.sourceHashes)) assert.equal(sha(await readFile(new URL('../' + file, import.meta.url))), hash, 'Evidence source changed: ' + file);
  await writeFile(new URL('./near-payment-failure-verification.json', import.meta.url), JSON.stringify({ checkedAt: new Date().toISOString(),
    checks, rejectedAlterations: rejected, evidenceSha256: sha(bytes),
    scope: 'Saved signatures, transaction outcomes, accounting, browser trace and source hashes. No independent RPC consensus verification or new financial action.' }, null, 2) + '\n');
  console.log(`PASS ${checks.length} saved-evidence checks; ${rejected.length} altered records rejected; source hashes match.`);
}
