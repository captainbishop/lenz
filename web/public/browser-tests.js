import { createStore, amount, balance, sendPayment, receivePayment, id } from './wallet.js';
import { DOMAIN, FR, verify } from './protocol.js';
import { sealBytes, openBytes, unhex } from './capsule.js';
import { proveInWorker } from './proof-worker.js';

const $ = selector => document.querySelector(selector);
const assert = (ok, why) => { if (!ok) throw new Error(why); };
const copy = value => structuredClone(value);
const snapshot = value => JSON.stringify(value);
async function rejects(operation, unchanged, pattern) {
  const before = snapshot(unchanged);
  let error;
  try { await operation(); } catch (caught) { error = caught; }
  assert(error, 'Expected rejection');
  if (pattern) assert(pattern.test(error.message), `Unexpected error: ${error.message}`);
  assert(snapshot(unchanged) === before, 'Rejected operation mutated state');
}
async function requireUnavailableServer() {
  let responded = false;
  try { await fetch(`./server-probe?run=${id()}`, { cache: 'no-store', signal: AbortSignal.timeout(3000) }); responded = true; }
  catch (error) { assert(error.name !== 'TimeoutError', 'Server probe timed out; unavailability was not established'); }
  assert(!responded, 'The app server is still reachable. Stop it before this test.');
}

$('#run').disabled = false; $('#run').textContent = 'Run browser checks';
$('#run').onclick = async () => {
  $('#run').disabled = true; $('#results').replaceChildren(); $('#report').textContent = '';
  const results = [], timings = [], started = performance.now();
  // Keep unfinished proof stages available when the external runner times out.
  window.proofTestProgress = { results, timings };
  const offline = $('#require-offline').checked;
  const check = async (name, operation) => {
    const row = document.createElement('li'); row.textContent = `Running: ${name}`; $('#results').append(row);
    try { await operation(); results.push({ name, pass: true }); row.textContent = `PASS: ${name}`; }
    catch (error) { results.push({ name, pass: false, error: error.message }); row.textContent = `FAIL: ${name} — ${error.message}`; throw error; }
  };
  const prove = async input => {
    const start = performance.now(), stages = [];
    const timing = { status: 'running', stages };
    timings.push(timing);
    try {
      const edge = await proveInWorker(input, stage => { stages.push({ stage, ms: Math.round(performance.now() - start) }); $('#progress').textContent = stage; });
      timing.status = 'completed'; return edge;
    } catch (error) { timing.status = 'failed'; timing.error = error.message; throw error; }
    finally { timing.ms = Math.round(performance.now() - start); }
  };
  const store = createStore(), [a, b, c] = store.wallets;
  let ab, bc;
  const decode = async packet => JSON.parse(new TextDecoder().decode(await openBytes(packet.envelope, unhex(b.deliveryKey), DOMAIN, packet.envelope.handoff)));
  const reseal = async (payment, recipient = b) => ({ type: 'proof-u/demo-file/1', recipientId: recipient.id,
    envelope: await sealBytes(new TextEncoder().encode(JSON.stringify(payment)), unhex(recipient.deliveryKey), DOMAIN, id()) });
  try {
    if (offline) await check('app server is unreachable before proving', requireUnavailableServer);
    await check('amount parsing preserves cents', () => assert(amount('0.01') === 1n && amount('12.34') === 1234n && amount('999999999999.99') === 99999999999999n, 'Incorrect cents'));
    await check('invalid and zero amounts are rejected', async () => {
      for (const text of ['0', '-1', '1e2', 'NaN', '0.001', '1,000', '', '1000000000000']) await rejects(() => amount(text), store);
    });
    await check('insufficient funds do not call the prover', () => rejects(() => sendPayment(store, a.id, b.id, 10001n, () => { throw new Error('Prover should not run'); }), store, /smaller amount/));
    await check('self-payments are rejected', () => rejects(() => sendPayment(store, a.id, a.id, 1n, prove), store, /another demo person/));
    await check('a failed proof leaves the entire store unchanged', () => rejects(() => sendPayment(store, a.id, b.id, 4000n, () => { throw new Error('Injected proving failure'); }), store, /Injected/));
    await check('an invalid returned proof cannot debit funds', () => rejects(() => sendPayment(store, a.id, b.id, 4000n, async () => ({})), store, /did not verify/));
    await check('Amina creates a real 40.00 payment and keeps 60.00', async () => { ab = await sendPayment(store, a.id, b.id, 4000n, prove); assert(balance(a) === 6000n && balance(b) === 0n && store.outbox.length === 1, 'Incorrect send accounting'); });
    await check('wrong recipient cannot open the packet', () => rejects(() => receivePayment(store, c.id, ab.packet), store, /Switch/));
    await check('ciphertext tampering is rejected without credit', async () => { const packet = copy(ab.packet); packet.envelope.ciphertext = (packet.envelope.ciphertext[0] === '0' ? '1' : '0') + packet.envelope.ciphertext.slice(1); await rejects(() => receivePayment(store, b.id, packet), store); });
    await check('authenticated wrong workspace root is rejected', async () => { const payment = await decode(ab.packet); payment.root = '0'.repeat(64); const packet = await reseal(payment); await rejects(() => receivePayment(store, b.id, packet), store, /another demo workspace/); });
    await check('authenticated altered amount is rejected', async () => { const payment = await decode(ab.packet); payment.note.value = '4001'; const packet = await reseal(payment); await rejects(() => receivePayment(store, b.id, packet), store, /opening/); });
    await check('authenticated altered owner is rejected', async () => { const payment = await decode(ab.packet); payment.note.owner = c.owner; const packet = await reseal(payment); await rejects(() => receivePayment(store, b.id, packet), store, /another demo person/); });
    await check('tampered public transcript is rejected', async () => { const payment = await decode(ab.packet); const data = JSON.parse(payment.edges[0].proof); data.nonce = ((BigInt(data.nonce) + 1n) % FR).toString(); payment.edges[0].proof = JSON.stringify(data); const packet = await reseal(payment); await rejects(() => receivePayment(store, b.id, packet), store, /proof/); });
    await check('out-of-field public input is rejected', async () => { const edge = (await decode(ab.packet)).edges[0]; edge.nf = FR.toString(16).padStart(64, '0'); assert(!(await verify(edge)), 'Accepted non-canonical field'); });
    await check('an oversized proof is rejected', async () => { const edge = (await decode(ab.packet)).edges[0]; edge.proof = 'x'.repeat(8193); assert(!(await verify(edge)), 'Accepted oversized proof'); });
    await check('a previously observed local conflict is rejected', async () => { const other = copy(store); other.spends[(await decode(ab.packet)).edges[0].nf] = 'f'.repeat(64); await rejects(() => receivePayment(other, b.id, ab.packet), other, /conflicting/); });
    await check('Bola verifies and receives exactly 40.00', async () => { const result = await receivePayment(store, b.id, ab.packet); assert(!result.duplicate && balance(b) === 4000n, 'Incorrect receipt accounting'); });
    await check('repeated receipt changes no stored data', async () => { const before = snapshot(store); const result = await receivePayment(store, b.id, ab.packet); assert(result.duplicate && snapshot(store) === before, 'Duplicate changed state'); });
    await check('Bola creates a real onward 30.00 payment and keeps 10.00', async () => { bc = await sendPayment(store, b.id, c.id, 3000n, prove); assert(balance(b) === 1000n, 'Incorrect onward accounting'); });
    await check('replaying a spent receipt cannot restore the old balance', async () => { const before = snapshot(store); const result = await receivePayment(store, b.id, ab.packet); assert(result.duplicate && snapshot(store) === before && balance(b) === 1000n, 'Replay restored funds'); });
    await check('missing onward ancestry is rejected', async () => {
      const payment = JSON.parse(new TextDecoder().decode(await openBytes(bc.packet.envelope, unhex(c.deliveryKey), DOMAIN, bc.packet.envelope.handoff)));
      payment.edges.shift(); const packet = await reseal(payment, c);
      await rejects(() => receivePayment(store, c.id, packet), store, /history/);
    });
    await check('Chidi verifies onward ancestry and total remains 100.00', async () => { await receivePayment(store, c.id, bc.packet); assert(balance(a) === 6000n && balance(b) === 1000n && balance(c) === 3000n, 'Incorrect final balances'); });
    await check('serialized state preserves balances and replay protection', async () => { const restored = JSON.parse(snapshot(store)); const result = await receivePayment(restored, c.id, bc.packet); assert(result.duplicate && restored.wallets.reduce((total, wallet) => total + balance(wallet), 0n) === 10000n, 'Restore changed accounting'); });
    if (offline) await check('app server remains unreachable after proving', requireUnavailableServer);
  } catch { /* The failing check is preserved below; never report a partial pass as success. */ }
  finally {
    const report = { date: new Date().toISOString(), browser: navigator.userAgent, unavailableServerRequired: offline, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, elapsedMs: Math.round(performance.now() - started), timings, results };
    $('#report').textContent = JSON.stringify(report, null, 2);
    $('#progress').textContent = `${report.passed} passed; ${report.failed} failed. ${report.failed ? 'Stopped at first failure.' : 'All checks completed.'}`;
    $('#run').disabled = false;
  }
};
