import { DOMAIN, randomField, ownerKey, note, commitment, makeStep, verify, validatePayment } from './protocol.js';
import { sealBytes, openBytes, hex, unhex } from './capsule.js';
const check = (ok, message) => { if (!ok) throw new Error(message); };
export const id = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export function amount(text) {
  check(typeof text === 'string' && /^\d{1,12}(\.\d{1,2})?$/.test(text), 'Enter an amount with up to two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const value = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  check(value > 0n, 'Enter an amount greater than zero.'); return value;
}
export const displayAmount = value => {
  const n = BigInt(value); return `${(n / 100n).toLocaleString('en-US')}.${(n % 100n).toString().padStart(2, '0')}`;
};
export const balance = wallet => wallet.notes.reduce((sum, n) => sum + BigInt(n.note.value), 0n);
export function createStore() {
  const wallets = ['Amina', 'Bola', 'Chidi'].map(name => {
    const secret = randomField();
    return { id: id(), name, secret, owner: ownerKey(secret), deliveryKey: hex(crypto.getRandomValues(new Uint8Array(32))), notes: [], received: [], history: [] };
  });
  const genesis = note(wallets[0].owner, 10000n);
  const root = commitment(genesis);
  wallets[0].notes.push({ note: genesis, root, edges: [] });
  return { version: 1, active: wallets[0].id, root, wallets, outbox: [], spends: {} };
}
export async function sendPayment(store, senderId, recipientId, value, prove) {
  const sender = store.wallets.find(w => w.id === senderId);
  const recipient = store.wallets.find(w => w.id === recipientId);
  check(sender && recipient && sender !== recipient, 'Choose another demo person.');
  check(typeof value === 'bigint' && value > 0n && value < (1n << 64n), 'Invalid amount.');
  const input = sender.notes.find(n => BigInt(n.note.value) >= value);
  check(input, 'This demo spends one received payment at a time. Try a smaller amount.');
  check(input.edges.length < 16, 'This demo has reached its 16-step history limit.');
  const received = note(recipient.owner, value);
  const change = note(sender.owner, BigInt(input.note.value) - value);
  const edge = await prove(makeStep(input.note, sender.secret, [received, change]));
  check(await verify(edge), 'The generated payment proof did not verify.');
  const edges = [...input.edges, edge];
  const payment = { type: 'proof-u/web-demo/1', domain: DOMAIN, root: input.root, note: received, edges };
  const handoff = id();
  const envelope = await sealBytes(new TextEncoder().encode(JSON.stringify(payment)), unhex(recipient.deliveryKey), DOMAIN, handoff);
  const packet = { type: 'proof-u/demo-file/1', recipientId, envelope };
  // Caller must save the complete new state atomically BEFORE exposing a file.
  sender.notes = sender.notes.filter(n => n !== input);
  if (BigInt(change.value) > 0n) sender.notes.push({ note: change, root: input.root, edges });
  store.spends[edge.nf] = edge.id;
  sender.history.unshift({ type: 'sent', amount: value.toString(), person: recipient.name, handoff, time: Date.now() });
  const item = { id: handoff, sender: sender.name, recipient: recipientId, amount: value.toString(), packet, received: false };
  store.outbox.unshift(item);
  return item;
}
export async function receivePayment(store, recipientId, packet) {
  const recipient = store.wallets.find(w => w.id === recipientId);
  check(recipient && packet && Object.keys(packet).sort().join(',') === 'envelope,recipientId,type' && packet.type === 'proof-u/demo-file/1', 'Choose a valid demo payment file.');
  check(packet.recipientId === recipientId, 'Switch to the demo person this payment was sent to.');
  check(new TextEncoder().encode(JSON.stringify(packet)).length <= 140000, 'This payment file is too large.');
  const bytes = await openBytes(packet.envelope, unhex(recipient.deliveryKey), DOMAIN, packet.envelope.handoff);
  const payment = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  check(payment.root === store.root, 'This file belongs to another demo workspace.');
  await validatePayment(payment, recipient, store.spends);
  const cm = commitment(payment.note);
  if (recipient.received.includes(cm)) return { duplicate: true };
  recipient.received.push(cm);
  recipient.notes.push({ note: payment.note, root: payment.root, edges: payment.edges });
  for (const edge of payment.edges) store.spends[edge.nf] = edge.id;
  const outgoing = store.outbox.find(p => p.id === packet.envelope.handoff);
  if (outgoing) outgoing.received = true;
  recipient.history.unshift({ type: 'received', amount: payment.note.value, person: outgoing?.sender ?? 'Demo sender', handoff: packet.envelope.handoff, time: Date.now() });
  return { duplicate: false, amount: payment.note.value };
}
