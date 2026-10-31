import test, { before } from 'node:test';
import assert from 'node:assert/strict';
const root = process.env.PEER_TEST_ROOT ?? new URL('./public/', import.meta.url).href;
const { createIdentity, validateProfile, sealMessage, openMessage, signValue } = await import(new URL('peer-crypto.js', root));
const { ExchangeLedger, makeAgreement, signAgreement, outputNotes, swapOutputs } = await import(new URL('peer-exchange.js', root));
const { runExchangeScenario } = await import(new URL('peer-scenario.js', root));
let a, b, c;
const context = { network: 'test-network', pool: 'test-pool' };
const clone = value => structuredClone(value);
const owner = person => person.profile.signingPublic;
const output = (person, asset, value) => ({ owner: owner(person), asset, value });
before(async () => { [a, b, c] = await Promise.all(['Amina', 'Bola', 'Chidi'].map(createIdentity)); });
function fixture() {
  const roots = [{ id: 'root:a', ...output(a, 'USD', '100') }, { id: 'root:b', ...output(b, 'COIN', '50') }];
  return { roots, notes: new Map(roots.map(note => [note.id, note])), ledger: new ExchangeLedger(roots, context) };
}
async function swap(f, deadline = 0) {
  let tx = await makeAgreement({ ...context, kind: 'swap', inputs: f.roots.map(note => note.id), outputs: swapOutputs(...f.roots, '20', '10'), deadline });
  tx = await signAgreement(a, tx, f.notes); return signAgreement(b, tx, f.notes);
}
async function spendRoot(f, person = a) {
  let tx = await makeAgreement({ ...context, kind: 'transfer', inputs: ['root:a'], outputs: [output(person, 'USD', '100')] });
  return signAgreement(a, tx, f.notes);
}
async function onward(f, parent, value = '6') {
  const received = outputNotes(parent)[0];
  const notes = new Map([...f.notes, ...outputNotes(parent).map(note => [note.id, note])]);
  let tx = await makeAgreement({ ...context, kind: 'transfer', inputs: [received.id], outputs: [output(c, 'COIN', value), output(a, 'COIN', String(10n - BigInt(value)))] });
  return signAgreement(a, tx, notes);
}

test('independent private keys are nonextractable; contact cards bind both keys', async () => {
  assert.notEqual(a.profile.id, b.profile.id);
  assert.equal(a.boxPrivate.extractable, false); assert.equal(a.signingPrivate.extractable, false);
  await assert.rejects(crypto.subtle.exportKey('jwk', a.signingPrivate));
  assert.deepEqual(await validateProfile(a.profile), a.profile);
  await assert.rejects(validateProfile({ ...a.profile, boxPublic: b.profile.boxPublic }), /fingerprint/);
});
test('chat round-trip is encrypted, authenticated and readable by both participants', async () => {
  const payload = { kind: 'chat', text: 'Meet at the market — ₦42 🔒' };
  const packet = await sealMessage(a, b.profile, payload);
  assert(!JSON.stringify(packet).includes(payload.text));
  assert.deepEqual(await openMessage(b, a.profile, packet), payload);
  assert.deepEqual(await openMessage(a, b.profile, packet), payload);
  await assert.rejects(openMessage(c, a.profile, packet), /different conversation/);
});
test('forged sender, changed recipient, domain and ciphertext are rejected', async () => {
  const packet = await sealMessage(a, b.profile, { kind: 'chat', text: 'original' });
  for (const patch of [{ from: c.profile.id }, { to: c.profile.id }, { type: 'wrong' }, { ciphertext: (packet.ciphertext[0] === '0' ? '1' : '0') + packet.ciphertext.slice(1) }]) {
    await assert.rejects(openMessage(b, a.profile, { ...packet, ...patch }));
  }
});
test('ciphertext with a forged signature is rejected before decryption', async () => {
  const packet = await sealMessage(a, b.profile, { kind: 'chat', text: 'authentic' });
  packet.signature = '00'.repeat(64);
  await assert.rejects(openMessage(b, a.profile, packet), /signature/);
});
test('even a signed invalid authentication tag fails', async () => {
  const packet = await sealMessage(a, b.profile, { kind: 'chat', text: 'original' });
  packet.ciphertext = packet.ciphertext.slice(0, -2) + (packet.ciphertext.endsWith('00') ? '01' : '00');
  packet.signature = await signValue(a, [packet.type, packet.id, packet.from, packet.to, packet.iv, packet.ciphertext]);
  await assert.rejects(openMessage(b, a.profile, packet));
});
test('fresh message keys use different IDs and IVs; limits reject oversized payloads', async () => {
  const first = await sealMessage(a, b.profile, { kind: 'chat', text: 'same' });
  const second = await sealMessage(a, b.profile, { kind: 'chat', text: 'same' });
  assert.notEqual(first.id, second.id); assert.notEqual(first.iv, second.iv); assert.notEqual(first.ciphertext, second.ciphertext);
  await assert.rejects(sealMessage(a, b.profile, { text: 'x'.repeat(100001) }), /too large/);
  await assert.rejects(openMessage(b, a.profile, { ...first, ciphertext: '00'.repeat(100017) }), /size/);
});
test('both swap legs conserve their assets and received value can move onward', async () => {
  const f = fixture(), tx = await swap(f), child = await onward(f, tx);
  await f.ledger.apply([tx, child], 1);
  const notes = f.ledger.unspent();
  assert.equal(notes.filter(n => n.asset === 'USD').reduce((s, n) => s + BigInt(n.value), 0n), 100n);
  assert.equal(notes.filter(n => n.asset === 'COIN').reduce((s, n) => s + BigInt(n.value), 0n), 50n);
  assert(notes.some(n => n.owner === owner(c) && n.value === '6' && n.asset === 'COIN'));
});
test('a missing second signature cannot debit either swap leg', async () => {
  const f = fixture(), tx = await swap(f); tx.signatures.pop(); const before = f.ledger.snapshot();
  await assert.rejects(f.ledger.apply([tx], 1), /Every input owner/);
  assert.deepEqual(f.ledger.snapshot(), before);
});
test('one party cannot substitute the other party’s signature', async () => {
  const f = fixture(), tx = await swap(f); tx.signatures[1].signature = tx.signatures[0].signature;
  await assert.rejects(f.ledger.apply([tx], 1), /signature/);
});
test('duplicate and foreign signers are rejected', async () => {
  const f = fixture(), tx = await swap(f);
  await assert.rejects(f.ledger.apply([{ ...tx, signatures: [tx.signatures[0], tx.signatures[0]] }], 1), /signer/);
  await assert.rejects(signAgreement(c, { ...tx, signatures: [] }, f.notes), /does not own/);
});
test('signatures bind recipient, amount, input, deadline, network and pool', async () => {
  const f = fixture(), tx = await swap(f);
  for (const mutate of [body => { body.outputs[0].owner = owner(c); }, body => { body.outputs[0].value = '11'; },
    body => { body.inputs[0] = 'root:elsewhere'; }, body => { body.deadline = 50; }, body => { body.network = 'elsewhere'; }, body => { body.pool = 'elsewhere'; }]) {
    const bad = clone(tx); mutate(bad.body); await assert.rejects(f.ledger.apply([bad], 1), /ID mismatch/);
  }
});
test('cross-network and cross-pool agreements cannot enter the checkpoint', async () => {
  const f = fixture();
  for (const patch of [{ network: 'elsewhere' }, { pool: 'elsewhere' }]) {
    let tx = await makeAgreement({ ...context, ...patch, kind: 'swap', inputs: f.roots.map(n => n.id), outputs: swapOutputs(...f.roots, '20', '10') });
    tx = await signAgreement(a, tx, f.notes); tx = await signAgreement(b, tx, f.notes);
    await assert.rejects(f.ledger.apply([tx], 1), /Wrong network or pool/);
  }
});
test('asset inflation cannot be authorized', async () => {
  const f = fixture(); const outputs = swapOutputs(...f.roots, '20', '10'); outputs[0].value = '11';
  const tx = await makeAgreement({ ...context, kind: 'swap', inputs: f.roots.map(n => n.id), outputs });
  await assert.rejects(signAgreement(a, tx, f.notes), /conserved/);
});
test('unfunded assets, duplicate inputs, invalid amounts and overlarge quantities fail', async () => {
  const f = fixture();
  const tx = await makeAgreement({ ...context, kind: 'transfer', inputs: ['root:a'], outputs: [output(a, 'INVENTED', '100')] });
  await assert.rejects(signAgreement(a, tx, f.notes), /Unfunded/);
  await assert.rejects(makeAgreement({ ...context, kind: 'swap', inputs: ['root:a', 'root:a'], outputs: [output(a, 'USD', '100')] }), /inputs/);
  for (const value of ['0', '-1', '01', '1.0', 1, '18446744073709551616']) {
    await assert.rejects(makeAgreement({ ...context, kind: 'transfer', inputs: ['root:a'], outputs: [output(a, 'USD', value)] }), /amount/);
  }
});
test('an already spent input rejects the whole swap, keeping the other asset intact', async () => {
  const f = fixture(), tx = await swap(f), competing = await spendRoot(f, c);
  await f.ledger.apply([competing], 1); const before = f.ledger.snapshot();
  await assert.rejects(f.ledger.apply([tx], 1), /already spent/);
  assert.deepEqual(f.ledger.snapshot(), before); assert(f.ledger.unspent().some(n => n.id === 'root:b'));
});
test('failed child rolls back the entire previously unaccepted dependency package', async () => {
  const f = fixture(), tx = await swap(f), child = await onward(f, tx); child.signatures = [];
  const before = f.ledger.snapshot(); await assert.rejects(f.ledger.apply([tx, child], 1), /Every input owner/);
  assert.deepEqual(f.ledger.snapshot(), before);
});
test('duplicate delivery is idempotent, including after an accepted deadline', async () => {
  const f = fixture(), tx = await swap(f, 10); await f.ledger.apply([tx], 10); const before = f.ledger.snapshot();
  await f.ledger.apply([tx, tx], 11); assert.deepEqual(f.ledger.snapshot(), before);
});
test('expiry is checked before first acceptance, with inclusive boundary', async () => {
  const f = fixture(), tx = await swap(f, 10); const before = f.ledger.snapshot();
  await assert.rejects(f.ledger.apply([tx], 11), /expired/); assert.deepEqual(f.ledger.snapshot(), before);
  await f.ledger.apply([tx], 10);
});
test('missing ancestry cannot create a spendable output', async () => {
  const f = fixture(), tx = await swap(f), child = await onward(f, tx);
  await assert.rejects(f.ledger.apply([child], 1), /Missing dependency/);
});
test('concurrent conflicting submissions serialize, with only one winner', async () => {
  const f = fixture(), tx = await swap(f), competing = await spendRoot(f, c);
  const results = await Promise.allSettled([f.ledger.apply([tx], 1), f.ledger.apply([competing], 1)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.ledger.snapshot().accepted.length, 1);
});
test('caller mutations during validation and snapshot mutations cannot alter ledger state', async () => {
  const f = fixture(), tx = await swap(f); const result = f.ledger.apply([tx], 1);
  tx.body.outputs[0].value = '999'; await result;
  const snapshot = f.ledger.snapshot(); snapshot.notes[0].value = '999';
  assert(!f.ledger.snapshot().notes.some(n => n.value === '999'));
});
test('fork test preserves the known boundary instead of calling signatures global uniqueness', async () => {
  const f = fixture(), tx = await swap(f), competing = await spendRoot(f, c);
  const isolated = new ExchangeLedger(f.roots, context);
  await f.ledger.apply([tx], 1); await isolated.apply([competing], 1);
  assert.equal(f.ledger.snapshot().accepted.length, 1); assert.equal(isolated.snapshot().accepted.length, 1);
  const canonical = new ExchangeLedger(f.roots, context); await canonical.apply([competing], 1);
  await assert.rejects(canonical.apply([tx], 1), /already spent/);
});
test('changed roots and caller root mutations do not silently change the trusted checkpoint', async () => {
  const f = fixture(); f.roots[0].value = '999'; assert.equal(f.ledger.unspent()[0].value, '100');
  assert.throws(() => new ExchangeLedger([f.roots[0], f.roots[0]], context), /Duplicate root/);
});
test('the complete encrypted exchange scenario runs with fetch disabled', async () => {
  const original = globalThis.fetch; globalThis.fetch = () => { throw new Error('Unexpected network call'); };
  try {
    const report = await runExchangeScenario(); assert.equal(report.messages.length, 4);
    assert.equal(report.localAgreementCount, 2); assert.equal(report.settlementModelAgreementCount, 2);
    assert(report.balances.some(row => row.person === 'Chidi' && row.value === '6'));
  } finally { globalThis.fetch = original; }
});
