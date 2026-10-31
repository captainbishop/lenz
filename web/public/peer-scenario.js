import { createIdentity, sealMessage, openMessage } from './peer-crypto.js';
import { ExchangeLedger, makeAgreement, signAgreement, swapOutputs, outputNotes } from './peer-exchange.js';

// The same scenario runs in Node and in a browser. Peers have independent keys
// but share this process; it is not a physical-device or Bluetooth test.
export async function runExchangeScenario() {
  const start = performance.now();
  const [a, b, c] = await Promise.all(['Amina', 'Bola', 'Chidi'].map(createIdentity));
  const names = new Map([a, b, c].map(person => [person.profile.signingPublic, person.profile.name]));
  const roots = [
    { id: 'root:amina-usd', owner: a.profile.signingPublic, asset: 'DEMO-USD', value: '100' },
    { id: 'root:bola-coin', owner: b.profile.signingPublic, asset: 'DEMO-COIN', value: '50' },
  ];
  const context = { network: 'research-local', pool: 'unfunded-demo' };
  const aView = new ExchangeLedger(roots, context), bView = new ExchangeLedger(roots, context), cView = new ExchangeLedger(roots, context);
  const trusted = new Map(roots.map(note => [note.id, note]));
  const messages = [], packets = [];
  async function deliver(sender, recipient, payload, label) {
    const packet = await sealMessage(sender, recipient.profile, payload);
    const opened = await openMessage(recipient, sender.profile, JSON.parse(JSON.stringify(packet)));
    packets.push(packet);
    messages.push({ from: sender.profile.name, to: recipient.profile.name, text: label });
    return opened;
  }
  await deliver(a, b, { kind: 'chat', text: 'Can we exchange 20 demo dollars for 10 demo coins?' }, 'Can we exchange 20 demo dollars for 10 demo coins?');
  let agreement = await makeAgreement({ ...context, kind: 'swap', inputs: roots.map(note => note.id), outputs: swapOutputs(roots[0], roots[1], '20', '10') });
  agreement = await signAgreement(a, agreement, trusted);
  const offer = await deliver(a, b, { kind: 'offer', agreement }, 'Offer: 20 DEMO-USD for 10 DEMO-COIN. Amina signed both sides of the agreement.');
  const both = await signAgreement(b, offer.agreement, trusted);
  const accepted = await deliver(b, a, { kind: 'agreement', agreement: both }, 'Agreed. Both owners signed the same exchange.');
  await aView.apply([accepted.agreement], 0); await bView.apply([both], 0);
  const received = outputNotes(both)[0];
  const localNotes = new Map(aView.snapshot().notes.map(note => [note.id, note]));
  let onward = await makeAgreement({ ...context, kind: 'transfer', inputs: [received.id], outputs: [
    { owner: c.profile.signingPublic, asset: received.asset, value: '6' },
    { owner: a.profile.signingPublic, asset: received.asset, value: '4' },
  ] });
  onward = await signAgreement(a, onward, localNotes);
  const handover = await deliver(a, c, { kind: 'handover', agreements: [both, onward] }, 'Passing 6 received demo coins to Chidi, with the signed exchange evidence.');
  await cView.apply(handover.agreements, 0);
  await aView.apply([onward], 0);
  // A separate ledger models later all-or-nothing settlement. No NEAR call.
  const settlement = new ExchangeLedger(roots, context);
  await settlement.apply(handover.agreements, 0);
  return { kind: 'direct-exchange-research', elapsedMs: Math.round(performance.now() - start), messages,
    packetBytes: packets.map(packet => new TextEncoder().encode(JSON.stringify(packet)).length),
    balances: settlement.unspent().map(note => ({ person: names.get(note.owner), asset: note.asset, value: note.value })),
    localAgreementCount: cView.snapshot().accepted.length,
    settlementModelAgreementCount: settlement.snapshot().accepted.length,
    note: 'Actual WebCrypto signatures/encryption; independent keys in one process; synthetic roots and settlement model. No chain or transport integration.' };
}
