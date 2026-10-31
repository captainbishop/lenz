// Checks saved public evidence only. Never opens a signer, funds or submits.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { applySpend, compressed, FUND } from './public/near-protocol.js';
import { bytes, digest, unhex } from './public/peer-crypto.js';
import { checkRheaPacket } from './public/rhea-protocol.js';

export async function verify(e) {
  assert.equal(e.ok, true);
  assert.equal(e.network, 'testnet');
  assert.deepEqual(e.pageErrors, []);
  assert.deepEqual(e.failures, []);
  const checks = [], txs = e.transactions;
  assert.equal(txs.length, 8);
  assert.equal(new Set(txs.map(t => t.transaction.hash)).size, txs.length);
  const calls = txs.map(t => {
    assert.equal(t.final_execution_status, 'FINAL');
    assert(Object.hasOwn(t.status, 'SuccessValue'));
    assert.equal(t.transaction.signer_id, e.recipient);
    for (const r of [t.transaction_outcome, ...t.receipts_outcome]) {
      assert(!Object.hasOwn(r.outcome.status, 'Failure'));
      assert(Object.keys(r.outcome.status).some(k => ['SuccessValue', 'SuccessReceiptId'].includes(k)));
    }
    assert.equal(t.transaction.actions.length, 1);
    const action = t.transaction.actions[0].FunctionCall;
    assert(action);
    const response = e.responses.find(r => r.body.txHash === t.transaction.hash);
    assert(response && response.status === 200 && response.body.finality === 'FINAL');
    return { tx: t, method: action.method_name, args: JSON.parse(Buffer.from(action.args, 'base64')), receiver: t.transaction.receiver_id };
  });
  assert.deepEqual(calls.map(c => c.method), ['fund_test', 'settle', 'submit', 'advance', 'advance', 'advance', 'advance', 'advance']);
  checks.push('Eight captured transactions are FINAL and contain no failed outcome');

  const grant = calls[0];
  assert.equal(grant.receiver, e.reserve);
  assert.equal(grant.args.amount, '10000000');
  const terms = [FUND, 'testnet', e.reserve, grant.args.owner, grant.args.amount, grant.args.nonce];
  const key = await crypto.subtle.importKey('raw', unhex(grant.args.owner), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unhex(grant.args.signature), bytes(terms)));
  assert.deepEqual(e.root, { id: 'root:' + await digest(terms), owner: compressed(e.profiles.a.signingPublic), amount: '10000000' });
  checks.push('The actual fund_test action binds the signed ten-tUSD root to Amina');

  const settlement = calls[1];
  assert.equal(settlement.receiver, e.reserve);
  assert.equal(settlement.args.path.length, 4);
  assert.equal(e.paymentReceipts.length, 4);
  const notes = new Map([[e.root.id, e.root]]), consumed = new Map();
  for (const [index, spend] of settlement.args.path.entries()) {
    const result = await applySpend(e.reserve, notes, consumed, spend);
    const receipt = e.paymentReceipts[index];
    assert.equal(receipt.id, result.id);
    assert.equal(receipt.input, spend.input);
    assert.deepEqual(receipt.outputs, result.outputs);
  }
  checks.push('All four chain-submitted transfers have valid signatures and matching conserved outputs');

  assert.equal(await checkRheaPacket(e.swap.config, e.swap), e.order.id);
  assert.equal(e.order.stage, 'complete');
  assert.deepEqual(e.order.instruction, e.swap.instruction);
  assert.equal(e.order.instruction.amount, '1000000');
  assert.equal(e.order.instruction.receiver_id, e.recipient);
  assert(BigInt(e.order.output) >= BigInt(e.order.instruction.min_output));
  assert.equal(calls[2].receiver, e.adapter);
  assert.deepEqual(calls[2].args.instruction, e.swap.instruction);
  for (const call of calls.slice(3)) {
    assert.equal(call.receiver, e.adapter);
    assert.deepEqual(call.args, { id: e.swap.id });
  }
  checks.push('The submitted swap matches both offline signatures, recipient and minimum output');

  const logs = txs.flatMap(t => t.receipts_outcome.flatMap(r => r.outcome.logs.map(log => ({ executor: r.outcome.executor_id, log }))));
  const events = logs.filter(l => l.log.startsWith('EVENT_JSON:')).flatMap(l => {
    const event = JSON.parse(l.log.slice(11));
    return event.data.map(data => ({ executor: l.executor, standard: event.standard, event: event.event, data }));
  });
  assert.equal(events.length, 3);
  assert.deepEqual(events.map(v => [v.executor, v.standard, v.event, v.data.amount]), [
    [e.reserve, 'nep141', 'ft_mint', '10000000'],
    [e.reserve, 'nep141', 'ft_transfer', '1000000'],
    [e.reserve, 'nep141', 'ft_transfer', '1000000']
  ]);
  assert.equal(events[0].data.owner_id, e.reserve);
  assert.deepEqual(events.slice(1).map(v => [v.data.old_owner_id, v.data.new_owner_id]), [[e.reserve, e.adapter], [e.adapter, e.swap.config.exchange]]);
  assert(logs.some(l => l.executor === e.swap.config.exchange && l.log === `Swapped 1000000 ${e.reserve} for ${e.order.output} ${e.swap.config.tokenOut}`));
  for (const [from, to] of [[e.swap.config.exchange, e.adapter], [e.adapter, e.recipient]]) {
    assert.equal(logs.filter(l => l.executor === e.swap.config.tokenOut && l.log === `Transfer ${e.order.output} from ${from} to ${to}`).length, 1);
  }
  checks.push('Contract logs show one mint, exact redemption/deposit, actual exchange and one final payout');

  assert.equal(BigInt(e.after.supply) - BigInt(e.before.supply), 10000000n);
  assert.equal(BigInt(e.after.reserve) - BigInt(e.before.reserve), 9000000n);
  assert.equal(e.after.reserve, e.after.reserved);
  assert.equal(e.after.adapter, e.before.adapter);
  assert.equal(BigInt(e.after.recipientOutput) - BigInt(e.before.recipientOutput), BigInt(e.order.output));
  const remaining = [...notes.values()].filter(n => !consumed.has(n.id) && n.id !== e.swap.instruction.input);
  for (const [role, expected] of [['a', '4000000'], ['b', '2000000'], ['c', '3000000']]) {
    const owned = remaining.filter(n => n.owner === compressed(e.profiles[role].signingPublic));
    assert.deepEqual(e.finalNotes[role], owned);
    assert.equal(owned.reduce((sum, n) => sum + BigInt(n.amount), 0n).toString(), expected);
  }
  checks.push('Final notes are 4/2/3 tUSD, reserve liability grows by nine and exact swap output reaches the recipient');
  assert.equal(e.steps['wallet payment shares chat history and all offline balances survive reload'].apiCallsWhileOffline, 0);
  assert.equal(e.steps['reconnecting does not submit the saved swap'].requestsOnReconnect, 0);
  const offlineSteps = new Set([
    'private message handover with all three browsers offline',
    'offline A to B payment and B to C onward payment',
    'save one actual swap authorization offline and retain its reservation',
    'wallet payment shares chat history and all offline balances survive reload',
    'reconnecting does not submit the saved swap'
  ]);
  assert(!e.requests.some(r => offlineSteps.has(r.step)));
  checks.push('Saved browser evidence records no offline API calls or automatic submission on reconnect');
  return checks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = new URL('./offline-social-live-results.json', import.meta.url), raw = await readFile(file);
  const evidence = JSON.parse(raw), checks = await verify(evidence);
  const alteredPayout = structuredClone(evidence); alteredPayout.after.recipientOutput = (BigInt(alteredPayout.after.recipientOutput) + 1n).toString();
  await assert.rejects(verify(alteredPayout));
  const alteredSignature = structuredClone(evidence); alteredSignature.swap.instruction.signature = '0'.repeat(128);
  await assert.rejects(verify(alteredSignature));
  const result = {
    checkedAt: new Date().toISOString(), ok: true, checks, rejectedAlterations: ['Recipient balance differs by one base unit', 'Invalid offline swap signature'],
    evidenceSha256: createHash('sha256').update(raw).digest('hex'),
    runnerSha256: createHash('sha256').update(await readFile(new URL('./offline-social-live.test.cjs', import.meta.url))).digest('hex'),
    scope: 'Offline verification of saved live RPC/browser evidence; no new network call, signature or transaction. RPC trust remains required.',
    transactionCoverage: 'Eight transaction hashes directly returned by the API. The relay also rechecks ancestry by calling settle before submit, but does not return that helper transaction hash.'
  };
  await writeFile(new URL('../research/offline-social-live-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
