import { assert, sealMessage } from './peer-crypto.js';
import { makeNearPayment, readNearVault, saveNearVault } from './near-protocol.js';

export const isNearPayment = payload => payload?.kind === 'lenz-near-payment-v1';
// Called inside updateState: commit the reserved spend, encrypted outbox and
// conversation history together before exposing a shareable payment.
export async function prepareNearPayment(state, contract, contactId, text) {
  assert(state.identity, 'Create your profile first.');
  const contact = state.contacts.find(c => c.id === contactId);
  assert(contact, 'Choose a confirmed contact.');
  assert(state.messages.length < 1000, 'This prototype has reached its 1,000-message storage limit.');
  const result = await makeNearPayment(await readNearVault(state, contract), state.identity, contact, text);
  const packet = await sealMessage(state.identity, contact, result.payload);
  result.vault.outbox.push({ packet, amount: result.payload.path.at(-1).amount });
  await saveNearVault(state, result.vault);
  state.messages.push({ packet });
  return packet;
}
