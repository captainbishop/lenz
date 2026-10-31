import test from 'node:test';
import assert from 'node:assert/strict';
const root = process.env.TRADE_TEST_ROOT ?? new URL('./public/', import.meta.url).href;
const { createIdentity, openMessage } = await import(new URL('peer-crypto.js', root));
const { makeAgreement, signAgreement, outputNotes } = await import(new URL('peer-exchange.js', root));
const { createTradeVault, createTrade, receiveTrade, acceptTrade, availableNotes, tradeLedger } = await import(new URL('trade-model.js', root));
const { enableDemoMoney, readTradeVault, prepareTrade, openTradeCard, agreeToTrade } = await import(new URL('trade-service.js', root));
const fields = { mode: 'swap', give: '20', giveAsset: 'DEMO-USD', get: '10', getAsset: 'DEMO-COIN' };
async function fixture() {
  const [a, b, c] = await Promise.all(['Amina', 'Bola', 'Chidi'].map(createIdentity));
  return { a, b, c, av: await createTradeVault(a.profile.signingPublic), bv: await createTradeVault(b.profile.signingPublic), cv: await createTradeVault(c.profile.signingPublic) };
}
async function agreed(f) {
  const offer = await createTrade(f.av, f.a, f.b.profile, fields);
  const received = await receiveTrade(f.bv, offer.payload, f.a.profile.signingPublic, f.b.profile.signingPublic);
  const reply = await acceptTrade(received, f.b, f.a.profile, offer.payload);
  return { offer, reply, av: await receiveTrade(offer.vault, reply.payload, f.b.profile.signingPublic, f.a.profile.signingPublic) };
}
test('offer holds its whole input; agreement releases change and received value', async () => {
  const f = await fixture(), { offer, av } = await agreed(f);
  const before = await availableNotes(offer.vault, f.a.profile.signingPublic);
  assert.equal(before.held[0].value, '100'); assert(!before.available.some(n => n.asset === 'DEMO-USD'));
  const after = await availableNotes(av, f.a.profile.signingPublic);
  assert.equal(after.held.length, 0); assert(after.available.some(n => n.asset === 'DEMO-USD' && n.value === '80'));
});
test('received swap output moves onward with minimal ancestry; duplicate receipt adds no value', async () => {
  const f = await fixture(), { reply, av } = await agreed(f);
  const payment = await createTrade(av, f.a, f.c.profile, { mode: 'payment', give: '6', giveAsset: 'DEMO-COIN' });
  assert.equal(payment.payload.agreement.body.inputs[0], outputNotes(reply.payload.agreement)[0].id);
  assert.equal(payment.payload.parents.length, 1);
  const cv = await receiveTrade(f.cv, payment.payload, f.a.profile.signingPublic, f.c.profile.signingPublic);
  assert((await availableNotes(cv, f.c.profile.signingPublic)).available.some(n => n.value === '6'));
  assert.deepEqual(await receiveTrade(cv, payment.payload, f.a.profile.signingPublic, f.c.profile.signingPublic), cv);
  const incomplete = structuredClone(payment.payload); incomplete.parents = [];
  await assert.rejects(receiveTrade(f.cv, incomplete, f.a.profile.signingPublic, f.c.profile.signingPublic), /Missing/);
});
test('a held input cannot fund another offer and failures leave caller state untouched', async () => {
  const f = await fixture(), offer = await createTrade(f.av, f.a, f.b.profile, fields);
  const before = structuredClone(offer.vault);
  await assert.rejects(createTrade(offer.vault, f.a, f.c.profile, fields), /unavailable/);
  assert.deepEqual(offer.vault, before); assert.equal(f.av.journal.length, 0);
});
test('inflated or unrelated demo roots cannot create accepted value', async () => {
  const f = await fixture(), offer = await createTrade(f.av, f.a, f.b.profile, fields);
  const bad = structuredClone(offer.payload); bad.roots[0].value = '1000';
  const outputs = structuredClone(bad.agreement.body.outputs);
  outputs.find(o => o.owner === f.a.profile.signingPublic && o.asset === 'DEMO-USD').value = '980';
  bad.agreement = await signAgreement(f.a, await makeAgreement({ ...bad.agreement.body, outputs }), new Map(bad.roots.map(r => [r.id, r])));
  await assert.rejects(receiveTrade(f.bv, bad, f.a.profile.signingPublic, f.b.profile.signingPublic), /Unrecognized demo backing/);
  const unrelated = structuredClone(offer.payload); unrelated.roots.push(f.cv.roots[0]);
  await assert.rejects(receiveTrade(f.bv, unrelated, f.a.profile.signingPublic, f.b.profile.signingPublic), /unrelated payment history/);
});
test('financial action and conversation participants are bound independently of chat encryption', async () => {
  const f = await fixture(), offer = await createTrade(f.av, f.a, f.b.profile, fields);
  await assert.rejects(receiveTrade(f.cv, offer.payload, f.a.profile.signingPublic, f.c.profile.signingPublic), /different conversation/);
  await assert.rejects(receiveTrade(f.bv, { ...offer.payload, kind: 'trade-payment' }, f.a.profile.signingPublic, f.b.profile.signingPublic));
  const unsigned = structuredClone(offer.payload); unsigned.agreement.signatures = [];
  await assert.rejects(receiveTrade(f.bv, unsigned, f.a.profile.signingPublic, f.b.profile.signingPublic), /sender’s signature/);
});
test('a valid signature cannot hide a third recipient behind a two-person trade card', async () => {
  const f = await fixture(), offer = await createTrade(f.av, f.a, f.b.profile, fields);
  const outputs = structuredClone(offer.payload.agreement.body.outputs); outputs[1].owner = f.c.profile.signingPublic;
  let candidate = await makeAgreement({ ...offer.payload.agreement.body, outputs });
  const notes = new Map((await tradeLedger(offer.vault)).snapshot().notes.map(n => [n.id, n]));
  candidate = await signAgreement(f.a, candidate, notes);
  await assert.rejects(receiveTrade(f.bv, { ...offer.payload, agreement: candidate }, f.a.profile.signingPublic, f.b.profile.signingPublic), /unsupported terms/);
});
test('acceptance checks for a conflicting local reservation and already-spent inputs', async () => {
  const f = await fixture(), offer = await createTrade(f.av, f.a, f.b.profile, fields);
  const locked = await createTrade(f.bv, f.b, f.c.profile, { mode: 'swap', give: '5', giveAsset: 'DEMO-COIN', get: '5', getAsset: 'DEMO-USD' });
  await assert.rejects(acceptTrade(locked.vault, f.b, f.a.profile, offer.payload), /already reserved/);
  const spent = await createTrade(f.bv, f.b, f.c.profile, { mode: 'payment', give: '5', giveAsset: 'DEMO-COIN' });
  await assert.rejects(acceptTrade(spent.vault, f.b, f.a.profile, offer.payload), /already moved/);
});
test('a fully signed unsolicited reply cannot overwrite a missing local offer', async () => {
  const f = await fixture(), { reply } = await agreed(f);
  await assert.rejects(receiveTrade(f.av, reply.payload, f.b.profile.signingPublic, f.a.profile.signingPublic), /No matching offer/);
});
test('vault encryption and chat envelopes preserve a complete offer/reply across reload-shaped serialization', async () => {
  const f = await fixture();
  const a = { identity: f.a, contacts: [f.b.profile], messages: [] }, b = { identity: f.b, contacts: [f.a.profile], messages: [] };
  await enableDemoMoney(a); await enableDemoMoney(b);
  const before = a.tradeBox; await enableDemoMoney(a); assert.equal(a.tradeBox, before);
  const packet = await prepareTrade(a, f.b.profile.id, fields);
  assert.equal(a.messages[0].packet.id, packet.id);
  assert(!JSON.stringify(a).includes('"journal"')); assert.equal(a.tradeKey.extractable, false);
  const payload = await openMessage(b.identity, f.a.profile, packet);
  await openTradeCard(b, f.a.profile, payload); b.messages.push({ packet });
  const reply = await agreeToTrade(structuredClone(b), packet.id);
  const recovered = structuredClone(a);
  await openTradeCard(recovered, f.b.profile, await openMessage(a.identity, f.b.profile, reply));
  assert.equal((await readTradeVault(recovered)).agreements.length, 1);
  const corrupt = structuredClone(a); corrupt.tradeBox.ciphertext = (corrupt.tradeBox.ciphertext.startsWith('00') ? '01' : '00') + corrupt.tradeBox.ciphertext.slice(2);
  await assert.rejects(readTradeVault(corrupt));
});
